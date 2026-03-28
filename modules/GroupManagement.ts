/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MÓDULO: GroupManagement (FIX FINAL - SOCKET INSTANT)
 * ═══════════════════════════════════════════════════════════════════════════
 * Todos métodos implementados. _checkSocket() único no handleCommand.
 */

import ConfigManager from './ConfigManager.js';
import fs from 'fs';
import path from 'path';

declare const Buffer: any;

class GroupManagement {
    public sock: any;
    public config: any;
    public logger: any;
    public groupsDataPath: string;
    public scheduledActionsPath: string;
    public groupSettings: any;
    public scheduledActions: any;
    public moderationSystem: any;
    private metadataCache: Map<string, { data: any; timestamp: number }>;
    private adminCache: Map<string, { admins: string[]; timestamp: number }>;
    private readonly CACHE_TTL = 120000; // 2 minutos

    constructor(sock: any, config: any = null, moderationSystem: any = null) {
        this.sock = sock;
        this.config = config || ConfigManager.getInstance();
        this.logger = console;
        this.moderationSystem = moderationSystem;
        this.metadataCache = new Map();
        this.adminCache = new Map();

        this.groupsDataPath = path.join(this.config.DATABASE_FOLDER || './data', 'group_settings.json');
        this.scheduledActionsPath = path.join(this.config.DATABASE_FOLDER || './data', 'scheduled_actions.json');

        this.groupSettings = this.loadGroupSettings();
        this.scheduledActions = this.loadScheduledActions();

        this.startScheduledActionsChecker();
    }

    setSocket(sock: any) {
        this.sock = sock;
        this.logger.info('[GroupManagement] Socket atualizado');
    }

    /**
     * Espera o sock.user estar disponível (aquecimento pós-conexão).
     */
    private async _waitForSocketUser(maxRetries = 10): Promise<boolean> {
        for (let i = 0; i < maxRetries; i++) {
            if (this.sock?.user?.id || this.sock?.authState?.creds?.me?.id) return true;
            this.logger.debug(`[GroupManagement] Aguardando sock.user... (${i + 1}/${maxRetries})`);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        return !!(this.sock?.user?.id || this.sock?.authState?.creds?.me?.id);
    }

    /**
     * Resiliência para conexões instáveis com o WebSocket.
     */
    private async _withRetry<T>(action: () => Promise<T>, groupJid?: string, retries = 3): Promise<T> {
        let lastError;
        for (let i = 0; i < retries; i++) {
            if (!await this._checkSocket()) throw new Error('Socket offline');
            try {
                return await action();
            } catch (e: any) {
                lastError = e;
                // ERRO 500 / INTERNAL-SERVER-ERROR: Limpa cache IMEDIATAMENTE
                const isInternalError = e.message?.includes('internal-server-error') ||
                    e.message?.includes('500') ||
                    e.message?.includes('Server Timeout');

                if (isInternalError && groupJid) {
                    this.logger.warn(`[GroupManagement] Erro 500 detectado. Limpando cache de ${groupJid} e tentando novamente...`);
                    this.clearMetadataCache(groupJid);
                }

                const isRetryable = isInternalError ||
                    e.message?.includes('Connection Closed') ||
                    e.message?.includes('timeout') ||
                    e.message?.includes('503') ||
                    e.message?.includes('rate-overlimit');

                if (isRetryable) {
                    const waitMs = 2000 * (i + 1);
                    this.logger.warn(`[GroupManagement] Retry ${i + 1}/${retries} em ${waitMs}ms (${e.message?.substring(0, 40)})...`);
                    await new Promise(resolve => setTimeout(resolve, waitMs));
                    continue;
                }
                throw e;
            }
        }
        throw lastError;
    }

    /**
     * Check socket resiliente.
     */
    private async _checkSocket(): Promise<boolean> {
        if (!this.sock) {
            this.logger.warn('[GroupManagement] Socket null');
            return false;
        }
        if (typeof this.sock.sendMessage !== 'function') {
            this.logger.warn('[GroupManagement] sock.sendMessage missing');
            return false;
        }
        // Tenta esperar o user se estiver ausente
        if (!(this.sock?.user?.id || this.sock?.authState?.creds?.me?.id)) {
            const ready = await this._waitForSocketUser();
            if (!ready) {
                this.logger.error('[GroupManagement] Socket não disponível após espera (sock.user ausente)');
                return false;
            }
        }
        return true;
    }

    private _extractTargets(m: any): string[] {
        const normalizeJid = (jid: string): string => {
            if (!jid) return '';
            // Remove sufixos de dispositivo (:1, :2) e garante formato correto
            return jid.split(':')[0].split('@')[0] + '@s.whatsapp.net';
        };

        // 1. Mencões diretas (@mention na mensagem)
        const contextInfo =
            m.message?.extendedTextMessage?.contextInfo ||
            m.message?.imageMessage?.contextInfo ||
            m.message?.videoMessage?.contextInfo ||
            m.message?.documentMessage?.contextInfo ||
            {};

        const mentioned: string[] = contextInfo.mentionedJid || [];
        if (mentioned.length > 0) {
            return mentioned.map(normalizeJid).filter(Boolean);
        }

        // 2. Reply: quotedParticipant no contextInfo (caminho principal do Baileys)
        if (contextInfo.quotedParticipant) {
            return [normalizeJid(contextInfo.quotedParticipant)];
        }

        // 3. Reply: participant no contextInfo
        if (contextInfo.participant) {
            return [normalizeJid(contextInfo.participant)];
        }

        // 4. replyInfo customizado (mapeado no BotCore)
        const replyInfo = m.replyInfo || m._replyInfo;
        if (replyInfo?.quemEscreveuCitacaoJid) {
            return [normalizeJid(replyInfo.quemEscreveuCitacaoJid)];
        }

        // 5. participant da mensagem pai (para documentos, áudios, etc. com reply)
        if (m.message?.extendedTextMessage?.contextInfo?.quotedMessage?.senderKeyDistributionMessage?.groupId) {
            // ignora
        }

        // 6. participant direto da mensagem (casos extremos em grupos)
        const directParticipant = m.participant || m.key?.participant;
        if (directParticipant) {
            return [normalizeJid(directParticipant)];
        }

        return [];
    }

    private async _getGroupAdmins(groupJid: string): Promise<string[]> {
        const cached = this.adminCache.get(groupJid);
        if (cached && (Date.now() - cached.timestamp) < this.CACHE_TTL) return cached.admins;

        const metadata = await this._getGroupMetadata(groupJid);
        if (!metadata || !metadata.participants) return [];

        const admins = metadata.participants
            .filter((p: any) => p.admin === 'admin' || p.admin === 'superadmin')
            .map((p: any) => p.id);

        this.adminCache.set(groupJid, { admins, timestamp: Date.now() });
        return admins;
    }

    private async _getGroupMetadata(groupJid: string, force = false, retries = 2): Promise<any | null> {
        const cached = this.metadataCache.get(groupJid);
        if (!force && cached && (Date.now() - cached.timestamp) < this.CACHE_TTL) return cached.data;

        if (!this.sock) return cached?.data || null;

        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                const metadata = await this.sock.groupMetadata(groupJid);
                this.metadataCache.set(groupJid, { data: metadata, timestamp: Date.now() });
                const admins = metadata.participants.filter((p: any) => p.admin || p.isAdmin || p.isSuperAdmin).map((p: any) => p.id);
                this.adminCache.set(groupJid, { admins, timestamp: Date.now() });
                return metadata;
            } catch (e: any) {
                if (attempt === retries) break;
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
        return cached?.data || null;
    }

    clearMetadataCache(groupJid?: string) {
        if (groupJid) {
            this.metadataCache.delete(groupJid);
            this.adminCache.delete(groupJid);
        } else {
            this.metadataCache.clear();
            this.adminCache.clear();
        }
    }

    loadGroupSettings(): any {
        try {
            if (fs.existsSync(this.groupsDataPath)) {
                const data = fs.readFileSync(this.groupsDataPath, 'utf8');
                return JSON.parse(data || '{}');
            }
        } catch (e: any) {
            this.logger.error('❌ [GroupManagement] Erro load settings:', e.message);
        }
        return {};
    }

    saveGroupSettings(): void {
        try {
            const dir = path.dirname(this.groupsDataPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(this.groupsDataPath, JSON.stringify(this.groupSettings, null, 2));
        } catch (e: any) {
            this.logger.error('❌ [GroupManagement] Erro save settings:', e.message);
        }
    }

    loadScheduledActions(): any {
        try {
            if (fs.existsSync(this.scheduledActionsPath)) {
                const data = fs.readFileSync(this.scheduledActionsPath, 'utf8');
                return JSON.parse(data || '[]');
            }
        } catch (e: any) {
            this.logger.error('❌ [GroupManagement] Erro load actions:', e.message);
        }
        return [];
    }

    saveScheduledActions(): void {
        try {
            const dir = path.dirname(this.scheduledActionsPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(this.scheduledActionsPath, JSON.stringify(this.scheduledActions, null, 2));
        } catch (e: any) {
            this.logger.error('❌ [GroupManagement] Erro save actions:', e.message);
        }
    }

    startScheduledActionsChecker(): void {
        setInterval(() => this.checkScheduledActions(), 60000);
    }

    async checkScheduledActions(): Promise<void> {
        const now = Date.now();
        const actionsToExecute = this.scheduledActions.filter((action: any) => action.executeAt <= now);

        for (const action of actionsToExecute) {
            try {
                if (action.type === 'unmute') {
                    if (this.moderationSystem) this.moderationSystem.unmuteUser(action.groupJid, action.userJid);
                    if (this.groupSettings[action.groupJid]?.mutedUsers?.[action.userJid]) delete this.groupSettings[action.groupJid].mutedUsers[action.userJid];
                } else if (action.type === 'openGroup') {
                    await this.openGroup(action.groupJid);
                } else if (action.type === 'closeGroup') {
                    await this.closeGroup(action.groupJid);
                }
            } catch (e: any) {
                this.logger.error(`❌ Erro ação programada:`, e.message);
            }
        }

        this.scheduledActions = this.scheduledActions.filter((action: any) => action.executeAt > now);
        this.saveScheduledActions();
    }

    async handleCommand(m: any, command: string, args: any[]) {
        const isGroup = m.key.remoteJid.endsWith('@g.us');
        if (!isGroup) return true;

        // SOCKET CHECK ÚNICO - AGORA ASSÍNCRONO E RESILIENTE
        if (!await this._checkSocket()) {
            this.logger.warn(`[GroupManagement] '${command}' bloqueado: socket offline ou incompleto`);
            return true;
        }

        switch (command) {
            case 'antilink':
                return await this.toggleSetting(m, 'antilink', args[0]);
            case 'mute':
                return await this.muteUser(m, args);
            case 'desmute':
            case 'unmute':
                return await this.unmuteUser(m, args);
            case 'fechar':
            case 'close':
                return await this.closeGroupCommand(m);
            case 'abrir':
            case 'open':
                return await this.openGroupCommand(m);
            case 'fixar':
            case 'pin':
                return await this.pinMessage(m, args);
            case 'desafixar':
            case 'unpin':
                return await this.unpinMessage(m);
            case 'lido':
            case 'read':
                return await this.markAsRead(m);
            case 'reagir':
            case 'react':
                return await this.reactToMessage(m, args);
            case 'ban':
            case 'kick':
                return await this.kickUser(m, args);
            case 'add':
                return await this.addUser(m, args);
            case 'promote':
                return await this.promoteUser(m, args);
            case 'demote':
                return await this.demoteUser(m, args);
            case 'link':
                return await this.getGroupLink(m);
            case 'revlink':
            case 'revogar':
                return await this.revokeGroupLink(m);
            case 'totag':
                return await this.tagAll(m, args);
            case 'groupinfo':
            case 'infogrupo':
            case 'ginfo':
                return await this.getGroupInfo(m);
            case 'listar':
            case 'membros':
                return await this.listMembers(m);
            case 'admins':
            case 'listadmins':
                return await this.listAdmins(m);
            case 'welcome':
            case 'saudar':
            case 'saudacao':
                return await this.toggleSetting(m, 'welcome', args[0]);
            case 'goodbye':
            case 'despedir':
            case 'despedida':
                return await this.toggleSetting(m, 'goodbye', args[0]);
            case 'antifake':
                if (args[0] === 'add' && args[1]) {
                    const num = args[1].replace(/\D/g, '') + '@s.whatsapp.net';
                    if (this.moderationSystem) Object.getPrototypeOf(this.moderationSystem).addFakeException?.call(this.moderationSystem, num);
                    if (this.sock) await this.sock.sendMessage(m.key.remoteJid, { text: `✅ Exceção AntiFake adicionada para: ${args[1]}` }, { quoted: m });
                    return true;
                } else if (args[0] === 'remove' && args[1]) {
                    const num = args[1].replace(/\D/g, '') + '@s.whatsapp.net';
                    if (this.moderationSystem) Object.getPrototypeOf(this.moderationSystem).removeFakeException?.call(this.moderationSystem, num);
                    if (this.sock) await this.sock.sendMessage(m.key.remoteJid, { text: `🗑️ Exceção AntiFake removida para: ${args[1]}` }, { quoted: m });
                    return true;
                }
                return await this.toggleSetting(m, 'antifake', args[0]);
            case 'antispam':
                return await this.toggleSetting(m, 'antispam', args[0]);
            case 'antiimage':
                return await this.toggleSetting(m, 'antiimage', args[0]);
            case 'antivideo':
                return await this.toggleSetting(m, 'antivideo', args[0]);
            case 'antisticker':
                return await this.toggleSetting(m, 'antisticker', args[0]);
            case 'antiaudio':
            case 'antivoz':
                return await this.toggleSetting(m, 'antiaudio', args[0]);
            case 'antidoc':
            case 'antidocumento':
                return await this.toggleSetting(m, 'antidoc', args[0]);
            case 'blacklist': {
                const isAdd = args[0] === 'add';
                const isRemove = args[0] === 'remove';

                if (isAdd || isRemove) {
                    const targets = this._extractTargets(m);
                    // Pega o primeiro alvo (seja reply ou menção) ou tenta pegar do argumento texto
                    const targetJid = targets[0] || (args[1] ? args[1].replace(/\D/g, '') + '@s.whatsapp.net' : null);

                    if (!targetJid) {
                        if (this.sock) await this.sock.sendMessage(m.key.remoteJid, { text: `⚠️ Uso: #${command} add/remove [mencione ou responda]` }, { quoted: m });
                        return true;
                    }

                    if (isAdd) {
                        if (this.moderationSystem) this.moderationSystem.addToBlacklist(targetJid, 'Manual', targetJid, 'Adicionado por admin', 0);
                        if (this.sock) await this.sock.sendMessage(m.key.remoteJid, { text: `🚫 @${targetJid.split('@')[0]} cadastrado na Blacklist Global!`, mentions: [targetJid] }, { quoted: m });
                    } else {
                        if (this.moderationSystem) this.moderationSystem.removeFromBlacklist(targetJid);
                        if (this.sock) await this.sock.sendMessage(m.key.remoteJid, { text: `✅ @${targetJid.split('@')[0]} libertado da Blacklist.`, mentions: [targetJid] }, { quoted: m });
                    }
                    return true;
                }

                // Se não for add/remove, apenas mostra o relatório
                if (typeof (this as any).getBlacklistInfo === 'function' || true) {
                    const report = await this.getBlacklistInfo(m.key.remoteJid);
                    if (this.sock) await this.sock.sendMessage(m.key.remoteJid, { text: report }, { quoted: m });
                }
                return true;
            }

            case 'setwelcome':
            case 'setsaudar':
            case 'setsaudacao': {
                const welcomeMsg = args.join(' ');
                if (!welcomeMsg) {
                    await this.sock.sendMessage(m.key.remoteJid, { text: '❌ Uso: #setwelcome [texto]\n\nVariáveis disponíveis:\n@user — Etiqueta a pessoa\n@group — Nome do grupo\n@desc — Descrição do grupo\n\nExemplo: #setwelcome Olá @user, bem vindo ao @group!' }, { quoted: m });
                    return true;
                }
                await this.setWelcomeMessage(m.key.remoteJid, welcomeMsg);
                await this.sock.sendMessage(m.key.remoteJid, { text: '✅ Nova mensagem de Boas Vindas guardada com sucesso!' }, { quoted: m });
                return true;
            }

            case 'setgoodbye':
            case 'setdespedir':
            case 'setdespedida': {
                const goodbyeMsg = args.join(' ');
                if (!goodbyeMsg) {
                    await this.sock.sendMessage(m.key.remoteJid, { text: '❌ Uso: #setgoodbye [texto]\n\nVariáveis disponíveis:\n@user — Etiqueta a pessoa\n@group — Nome do grupo\n@desc — Descrição do grupo\n\nExemplo: #setgoodbye Adeus @user, nos vemos em breve!' }, { quoted: m });
                    return true;
                }
                await this.setGoodbyeMessage(m.key.remoteJid, goodbyeMsg);
                await this.sock.sendMessage(m.key.remoteJid, { text: '✅ Nova mensagem de Despedida guardada com sucesso!' }, { quoted: m });
                return true;
            }

            case 'warn': {
                if (!this.moderationSystem) return true;
                const targets = this._extractTargets(m);
                const target = targets[0];
                if (!target) {
                    await this.sock.sendMessage(m.key.remoteJid, { text: '❌ Uso: responda a alguém ou marque (@alguem) com #warn' }, { quoted: m });
                    return true;
                }
                const reason = args.join(' ') || 'Comportamento inadequado';
                const warns = this.moderationSystem.addWarning(m.key.remoteJid, target, reason);

                if (warns >= 3) {
                    await this._withRetry(() => this.sock.groupParticipantsUpdate(m.key.remoteJid, [target], 'remove'), m.key.remoteJid);
                    await this.sock.sendMessage(m.key.remoteJid, { text: `🚨 *@${target.split('@')[0]}* atingiu 3 advertências e foi automaticamente banido da organização!`, mentions: [target] });
                    this.moderationSystem.resetWarnings(m.key.remoteJid, target);
                } else {
                    await this.sock.sendMessage(m.key.remoteJid, { text: `⚠️ *@${target.split('@')[0]}* recebeu uma advertência!\n\n*Motivo:* ${reason}\n*Status:* [${warns}/3] — No 3º warn será expulso.`, mentions: [target] });
                }
                return true;
            }

            case 'unwarn': {
                if (!this.moderationSystem) return true;
                const targets = this._extractTargets(m);
                const target = targets[0];
                if (!target) {
                    await this.sock.sendMessage(m.key.remoteJid, { text: '❌ Uso: responda a alguém ou marque com #unwarn' }, { quoted: m });
                    return true;
                }
                // Como não há função explícita de unwarn no ModerationSystem pronto:
                const currentData = this.moderationSystem.getWarnings(m.key.remoteJid, target);
                if (currentData && currentData.count > 0) {
                    currentData.count -= 1;
                    if (currentData.reasons.length > 0) currentData.reasons.pop();
                    await this.sock.sendMessage(m.key.remoteJid, { text: `✅ Removida 1 advertência de *@${target.split('@')[0]}*\n*Restante:* [${currentData.count}/3]`, mentions: [target] });
                } else {
                    await this.sock.sendMessage(m.key.remoteJid, { text: `ℹ️ *@${target.split('@')[0]}* não tem advertências cadastradas.`, mentions: [target] });
                }
                return true;
            }

            case 'resetwarns': {
                if (!this.moderationSystem) return true;
                const targets = this._extractTargets(m);
                const target = targets[0];
                if (!target) return true;
                this.moderationSystem.resetWarnings(m.key.remoteJid, target);
                await this.sock.sendMessage(m.key.remoteJid, { text: `🔄 O registro de punição de *@${target.split('@')[0]}* foi resetado para [0/3]!`, mentions: [target] });
                return true;
            }
            case 'setdesc':
            case 'descricao':
                const desc = args.join(' ');
                if (!desc) {
                    await this.sock.sendMessage(m.key.remoteJid, { text: '❌ Uso: #setdesc [texto]' }, { quoted: m });
                    return true;
                }
                const resDesc = await this.setGroupDesc(m.key.remoteJid, desc);
                await this.sock.sendMessage(m.key.remoteJid, { text: resDesc.message || (resDesc.success ? '✅ OK' : '❌ Falha') }, { quoted: m });
                return true;

            case 'setfoto':
            case 'fotodogrupo':
                const quoted = m.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                if (!quoted?.imageMessage) {
                    await this.sock.sendMessage(m.key.remoteJid, { text: '❌ Responda a uma imagem' }, { quoted: m });
                    return true;
                }
                try {
                    const stream = await this.sock.downloadContentFromMessage(quoted.imageMessage, 'image');
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
                    const resFoto = await this.setGroupPhoto(m.key.remoteJid, buffer);
                    await this.sock.sendMessage(m.key.remoteJid, { text: resFoto.message || (resFoto.success ? '✅ OK' : '❌ Falha') }, { quoted: m });
                } catch (e: any) {
                    await this.sock.sendMessage(m.key.remoteJid, { text: `❌ Erro: ${e.message}` }, { quoted: m });
                }
                return true;

            case 'setname':
            case 'setnome':
                const name = args.join(' ');
                if (!name) {
                    await this.sock.sendMessage(m.key.remoteJid, { text: '❌ Uso: #setname [novo nome]' }, { quoted: m });
                    return true;
                }
                const resName = await this.setGroupName(m.key.remoteJid, name);
                await this.sock.sendMessage(m.key.remoteJid, { text: resName.message || (resName.success ? '✅ OK' : '❌ Falha') }, { quoted: m });
                return true;
            case 'requireregister':
                return await this.toggleRequireRegister(m, args[0]);
            case 'level':
            case 'niveis':
                return await this.toggleSetting(m, 'leveling', args[0]);
            default:
                return false;
        }
    }

    async toggleSetting(m: any, setting: string, value: any) {
        const groupJid = m.key.remoteJid;
        const state = value === 'on' ? true : value === 'off' ? false : null;

        if (state === null) {
            const currentStatus = this.groupSettings?.[groupJid]?.[setting] ? '🟢 *ATIVADO*' : '🔴 *DESATIVADO*';
            if (this.sock) {
                await this.sock.sendMessage(groupJid, {
                    text: `ℹ️ O status de *${setting.toUpperCase()}* neste grupo é: ${currentStatus}\n\n👉 Para alterar, digite:\n*#${setting} on*\n*#${setting} off*`
                }, { quoted: m }).catch(() => { });
            }
            return true;
        }

        if (!this.groupSettings[groupJid]) this.groupSettings[groupJid] = {};
        this.groupSettings[groupJid][setting] = state;
        this.saveGroupSettings();

        const statusStr = state ? '🟢 ATIVADO' : '🔴 DESATIVADO';
        if (this.sock) await this.sock.sendMessage(groupJid, { text: `🛡️ *${setting.toUpperCase()}* foi ${statusStr}` }, { quoted: m }).catch(() => { });
        return true;
    }

    async getGroupLink(m: any): Promise<boolean> {
        const groupJid = m.key.remoteJid;
        try {
            const code = await this._withRetry(() => this.sock.groupInviteCode(groupJid), groupJid);
            const link = `https://chat.whatsapp.com/${code}`;
            if (this.sock) await this.sock.sendMessage(groupJid, { text: `🔗 *LINK DO GRUPO*\n\n${link}` }, { quoted: m });
        } catch (e: any) {
            this.logger.error(`[GroupManagement] getGroupLink erro: ${e.message}`);
            if (this.sock) await this.sock.sendMessage(groupJid, { text: `❌ Erro ao gerar link: ${e.message?.includes('not-authorized') ? 'Não sou admin deste grupo.' : 'Tente novamente.'}` }, { quoted: m }).catch(() => { });
        }
        return true;
    }

    async revokeGroupLink(m: any): Promise<boolean> {
        const groupJid = m.key.remoteJid;
        try {
            await this._withRetry(() => this.sock.groupRevokeInvite(groupJid), groupJid);
            if (this.sock) await this.sock.sendMessage(groupJid, { text: '🔄 Link revogado com sucesso!' }, { quoted: m });
        } catch (e: any) {
            if (this.sock) await this.sock.sendMessage(groupJid, { text: '❌ Erro ao revogar link.' }, { quoted: m });
        }
        return true;
    }

    async setCustomMessage(groupJid: string, type: string, text: string): Promise<boolean> {
        if (!this.groupSettings[groupJid]) this.groupSettings[groupJid] = {};
        if (!this.groupSettings[groupJid].messages) this.groupSettings[groupJid].messages = {};
        this.groupSettings[groupJid].messages[type] = text;
        this.saveGroupSettings();
        return true;
    }

    getCustomMessage(groupJid: string, type: string): string | null {
        return this.groupSettings?.[groupJid]?.messages?.[type] || null;
    }

    getWelcomeStatus(groupJid: string): boolean {
        return this.groupSettings?.[groupJid]?.welcome === true;
    }

    getGoodbyeStatus(groupJid: string): boolean {
        return this.groupSettings?.[groupJid]?.goodbye === true;
    }

    async setWelcomeMessage(groupJid: string, message: string): Promise<boolean> {
        return await this.setCustomMessage(groupJid, 'welcome', message);
    }

    async setGoodbyeMessage(groupJid: string, message: string): Promise<boolean> {
        return await this.setCustomMessage(groupJid, 'goodbye', message);
    }

    async formatMessage(groupJid: string, participantJid: string, template: string): Promise<string> {
        try {
            const metadata = await this._getGroupMetadata(groupJid);
            if (!metadata) return template;

            const groupName = metadata.subject || 'Grupo';
            const groupDesc = metadata.desc?.toString() || 'Sem descrição';
            const userTag = `@${participantJid.split('@')[0]}`;

            let groupLink = 'Apenas admins podem gerar link';
            try {
                const myId = this.sock?.user?.id || this.sock?.authState?.creds?.me?.id;
                if (!myId) {
                    this.logger.warn('[GroupManagement] formatMessage: Meu ID ausente para gerar link');
                } else {
                    const me = metadata.participants.find((p: any) => p.id === myId);
                    if (me && (me.admin === 'admin' || me.admin === 'superadmin')) {
                        const code = await this.sock.groupInviteCode(groupJid);
                        groupLink = `https://chat.whatsapp.com/${code}`;
                    }
                }
            } catch (e) { }

            return template
                .replace(/@user/g, userTag)
                .replace(/@group/g, groupName)
                .replace(/@desc/g, groupDesc)
                .replace(/@links/g, groupLink);
        } catch (e) {
            return template;
        }
    }

    async closeGroupCommand(m: any): Promise<boolean> {
        const result = await this.closeGroup(m.key.remoteJid);
        if (this.sock) {
            const text = result.success ? result.message : `❌ Erro: ${result.error}`;
            await this.sock.sendMessage(m.key.remoteJid, { text }, { quoted: m }).catch(() => { });
        }
        return true;
    }

    async openGroupCommand(m: any): Promise<boolean> {
        const result = await this.openGroup(m.key.remoteJid);
        if (this.sock) {
            const text = result.success ? result.message : `❌ Erro: ${result.error}`;
            await this.sock.sendMessage(m.key.remoteJid, { text }, { quoted: m }).catch(() => { });
        }
        return true;
    }

    async closeGroup(groupJid: string): Promise<{ success: boolean; message?: string; error?: string }> {
        if (!await this._checkSocket()) return { success: false, error: 'Socket offline' };
        try {
            await this._withRetry(() => this.sock.groupSettingUpdate(groupJid, 'announcement'), groupJid);
            this.clearMetadataCache(groupJid);
            this.logger.info(`✅ Grupo ${groupJid} fechado`);
            return { success: true, message: '🔒 Grupo fechado. Apenas admins.' };
        } catch (e: any) {
            this.logger.error(`❌ Fechar grupo: ${e.message}`);
            return { success: false, error: 'Falha fechar grupo' };
        }
    }

    async openGroup(groupJid: string): Promise<{ success: boolean; message?: string; error?: string }> {
        if (!await this._checkSocket()) return { success: false, error: 'Socket offline' };
        try {
            await this._withRetry(() => this.sock.groupSettingUpdate(groupJid, 'not_announcement'), groupJid);
            this.clearMetadataCache(groupJid);
            this.logger.info(`✅ Grupo ${groupJid} aberto`);
            return { success: true, message: '🔓 Grupo aberto. Todos.' };
        } catch (e: any) {
            this.logger.error(`❌ Abrir grupo: ${e.message}`);
            return { success: false, error: 'Falha abrir grupo' };
        }
    }

    async muteUser(m: any, args: any[]) {
        const targets = this._extractTargets(m);
        const target = targets[0];
        if (!target) return true;

        const groupJid = m.key.remoteJid;
        let duration = 5;
        if (args.length > 0) {
            const parsed = parseInt(args[0]);
            if (!isNaN(parsed) && parsed > 0 && parsed <= 1440) duration = parsed;
        }

        if (this.moderationSystem) {
            const muteInfo = this.moderationSystem.muteUser(groupJid, target, duration);
            if (!this.groupSettings[groupJid]) this.groupSettings[groupJid] = {};
            if (!this.groupSettings[groupJid].mutedUsers) this.groupSettings[groupJid].mutedUsers = {};
            this.groupSettings[groupJid].mutedUsers[target] = muteInfo.expires;
            this.saveGroupSettings();

            if (muteInfo.muteCount >= 3) {
                // Ao 3º Strike no mesmo dia, auto-ban!
                if (this.sock) {
                    await this._withRetry(() => this.sock.groupParticipantsUpdate(groupJid, [target], 'remove'), groupJid);
                    await this.sock.sendMessage(groupJid, { text: `🚨 @${target.split('@')[0]} recebeu o seu 3º MUTE hoje e foi banido permanentemente por infrações repetidas!`, mentions: [target] }, { quoted: m });
                }
                return true;
            }

            if (this.sock) {
                const userName = target.split('@')[0];
                await this.sock.sendMessage(m.key.remoteJid, { text: `🔇 @${userName} silenciado ${muteInfo.muteMinutes}m\n\n⚠️ *Aviso [${muteInfo.muteCount}/3]*: Ao 3º mute será banido. Se falar no chat, será banido.`, mentions: [target] }, { quoted: m });
            }
        } else {
            if (!this.groupSettings[groupJid]) this.groupSettings[groupJid] = {};
            if (!this.groupSettings[groupJid].mutedUsers) this.groupSettings[groupJid].mutedUsers = {};
            this.groupSettings[groupJid].mutedUsers[target] = Date.now() + (duration * 60 * 1000);
            this.saveGroupSettings();

            if (this.sock) {
                const userName = target.split('@')[0];
                await this.sock.sendMessage(m.key.remoteJid, { text: `🔇 @${userName} silenciado ${duration}m`, mentions: [target] }, { quoted: m });
            }
        }

        return true;
    }

    async unmuteUser(m: any, args: any[]) {
        const targets = this._extractTargets(m);
        const target = targets[0];
        if (!target) return true;

        const groupJid = m.key.remoteJid;

        if (this.moderationSystem) this.moderationSystem.unmuteUser(groupJid, target);
        if (this.groupSettings[groupJid]?.mutedUsers?.[target]) {
            delete this.groupSettings[groupJid].mutedUsers[target];
            this.saveGroupSettings();
        }

        if (this.sock) {
            const userName = target.split('@')[0];
            await this.sock.sendMessage(m.key.remoteJid, { text: `🔊 @${userName} desmutado`, mentions: [target] }, { quoted: m });
        }
        return true;
    }

    isUserMuted(groupJid: string, userJid: string): boolean {
        const mutedUsers = this.groupSettings?.[groupJid]?.mutedUsers || {};
        const muteUntil = mutedUsers[userJid];
        if (!muteUntil || Date.now() > muteUntil) {
            delete mutedUsers[userJid];
            this.saveGroupSettings();
            return false;
        }
        return true;
    }

    async pinMessage(m: any, args: any[]) {
        const quotedMsg = m.message?.extendedTextMessage?.contextInfo;
        if (!quotedMsg) {
            if (this.sock) await this.sock.sendMessage(m.key.remoteJid, { text: '❌ Responda mensagem para fixar' }, { quoted: m });
            return true;
        }
        let duration = 86400;
        if (args.length > 0) {
            const time = args[0].toLowerCase();
            if (time.endsWith('h')) duration = parseInt(time) * 3600;
            else if (time.endsWith('d')) duration = parseInt(time) * 86400;
            else if (time.endsWith('m')) duration = parseInt(time) * 60;
        }
        try {
            await this.sock.sendMessage(m.key.remoteJid, { pin: quotedMsg.stanzaId, type: 1, time: duration });
            await this.sock.sendMessage(m.key.remoteJid, { text: `📌 Fixada ${duration / 86400}d` }, { quoted: m });
        } catch (e) { }
        return true;
    }

    async unpinMessage(m: any) {
        const quotedMsg = m.message?.extendedTextMessage?.contextInfo;
        if (!quotedMsg) {
            if (this.sock) await this.sock.sendMessage(m.key.remoteJid, { text: '❌ Responda mensagem fixada' }, { quoted: m });
            return true;
        }
        try {
            await this.sock.sendMessage(m.key.remoteJid, { pin: quotedMsg.stanzaId, type: 0 });
            await this.sock.sendMessage(m.key.remoteJid, { text: '📌 Desfixada' }, { quoted: m });
        } catch (e) { }
        return true;
    }

    async markAsRead(m: any) {
        try {
            await this._withRetry(() => this.sock.readMessages([m.key]));
        } catch (e) { }
        return true;
    }

    async reactToMessage(m: any, args: any[]) {
        const quotedMsg = m.message?.extendedTextMessage?.contextInfo;
        if (!quotedMsg) return true;
        const emoji = args[0] || '👍';
        try {
            await this.sock.sendMessage(m.key.remoteJid, { react: { text: emoji, key: quotedMsg } });
        } catch (e) { }
        return true;
    }

    async kickUser(m: any, args: any[]) {
        const rawTargets = this._extractTargets(m);
        if (rawTargets.length === 0) {
            await this.sock.sendMessage(m.key.remoteJid, { text: '❌ Mencione (@alguem) ou responda a mensagem de quem deseja remover.' }, { quoted: m }).catch(() => { });
            return true;
        }

        const targets = rawTargets.map((t: string) => t.split(':')[0].split('@')[0] + '@s.whatsapp.net');
        const groupJid = m.key.remoteJid;

        this.logger.info(`[kickUser] Alvos extraídos: ${JSON.stringify(targets)}`);

        try {
            const metadata = await this._getGroupMetadata(groupJid, true);
            if (!metadata) throw new Error('Falha ao obter dados do grupo');

            const participants = metadata.participants.map((p: any) => p.id);
            this.logger.info(`[kickUser] Participantes no grupo: ${participants.length}. Procurando: ${JSON.stringify(targets)}`);

            // Comparação numérica parcial: remove @ e : para evitar mismatch de formato
            const getNum = (jid: string) => jid.split(':')[0].split('@')[0];
            const toRemove = targets.map(target => {
                const targetNum = getNum(target);
                const realJid = participants.find((p: string) => getNum(p) === targetNum);
                return realJid || null;
            }).filter(Boolean) as string[];

            if (toRemove.length === 0) {
                this.logger.warn(`[kickUser] Nenhum alvo encontrado! Alvos: ${JSON.stringify(targets)} | Participantes (primeiros 3): ${JSON.stringify(participants.slice(0, 3))}`);
                await this.sock.sendMessage(groupJid, { text: '⚠️ O(s) usuário(s) indicado(s) não estão mais no grupo.' }, { quoted: m });
                return true;
            }

            this.logger.info(`[kickUser] Iniciando remoção de ${toRemove.length} alvos em ${groupJid}`);

            // Verificação explícita de admin do bot usando os metadados frescos
            // Verificação de admin mais robusta: Procura por prefixo numérico (LID/JID)
            const myNum = this.sock?.user?.id?.split(':')[0]?.split('@')[0];
            const me = metadata.participants.find((p: any) => p.id?.split(':')[0]?.split('@')[0] === myNum);
            const isBotAdmin = me?.admin === 'admin' || me?.admin === 'superadmin';

            this.logger.info(`[kickUser] Bot ID: ${myNum} | Status Admin: ${isBotAdmin ? 'SIM' : 'NÃO'}`);

            // Dump de Admins para depuração profunda conforme pedido pelo usuário
            const groupAdmins = metadata.participants.filter((p: any) => p.admin).map((p: any) => p.id);
            this.logger.info(`[kickUser] Todos os Admins detectados: ${JSON.stringify(groupAdmins)}`);

            if (!isBotAdmin) {
                const adminList = groupAdmins.map((a: string) => '@' + a.split('@')[0]).join(', ');
                await this.sock.sendMessage(groupJid, {
                    text: `❌ Não posso remover membros: eu (@${myNum}) não sou administrador deste grupo.\n\n🛡️ *Admins atuais:* ${adminList}`,
                    mentions: [me?.id, ...groupAdmins].filter(Boolean)
                }, { quoted: m });
                return true;
            }

            this.logger.info(`[kickUser] Enviando JIDs para remoção: ${JSON.stringify(toRemove)}`);
            await this._withRetry(() => this.sock.groupParticipantsUpdate(groupJid, toRemove, 'remove'), groupJid);
            const mentions = toRemove.map((t: string) => `@${t.split('@')[0]}`).join(', ');
            await this.sock.sendMessage(groupJid, { text: `👢 ${mentions} removido(s) do grupo.`, mentions: toRemove }, { quoted: m });
            this.clearMetadataCache(groupJid);
        } catch (e: any) {
            this.logger.error(`[kickUser] ERRO CRÍTICO (500 ou Outro): ${e.message}`);
            this.logger.error(`[kickUser] Detalhes do erro: ${e.stack}`);
            // Se falhou mesmo com retry, limpa cache forçado para o próximo comando
            this.clearMetadataCache(groupJid);
            const msg = e.message?.includes('not-authorized') ? 'Não tenho permissão de admin.' :
                e.message?.includes('internal-server-error') ? 'Erro interno (500). Verifique se o alvo ainda está no grupo ou se o bot é admin.' : e.message;
            await this.sock.sendMessage(groupJid, { text: `❌ Falha ao remover: ${msg}` }, { quoted: m }).catch(() => { });
        }
        return true;
    }

    async addUser(m: any, args: any[]) {
        const groupJid = m.key.remoteJid;
        if (args.length === 0) {
            await this.sock.sendMessage(groupJid, { text: '❌ Uso: #add [número] — ex: #add 244900000000' }, { quoted: m }).catch(() => { });
            return true;
        }

        // Sanitização e formatação agressiva
        // Remove +, espaços, parênteses e garante o sufixo @s.whatsapp.net
        const numbers = args.map((arg: string) => arg.replace(/\D/g, '')).filter(n => n.length >= 8).map((n: string) => `${n}@s.whatsapp.net`);

        if (numbers.length === 0) {
            await this.sock.sendMessage(groupJid, { text: '❌ Forneça um número válido com código do país (DDI).' }, { quoted: m });
            return true;
        }

        try {
            this.logger.info(`[GroupManagement] Tentando adicionar: ${JSON.stringify(numbers)}`);

            const metadata = await this._getGroupMetadata(groupJid);
            if (!metadata) throw new Error('Falha ao obter dados do grupo');

            const participants = metadata.participants.map((p: any) => p.id);
            const toAdd = numbers.filter((n: string) => !participants.some(p => p.startsWith(n.split('@')[0])));

            if (toAdd.length === 0) {
                await this.sock.sendMessage(groupJid, { text: '⚠️ Este(s) usuário(s) já estão no grupo.' }, { quoted: m });
                return true;
            }

            this.logger.info(`[addUser] Tentando adicionar números: ${JSON.stringify(toAdd)}`);
            this.logger.info(`[addUser] Socket Status: ${this.sock ? 'Conectado' : 'Nulo'}`);

            // Ação de ADIÇÃO via socket com Retry e Cache Flush
            const response = await this._withRetry(() => this.sock.groupParticipantsUpdate(groupJid, toAdd, 'add'), groupJid);
            this.logger.info(`[addUser] Resposta do WhatsApp: ${JSON.stringify(response)}`);

            // Verificação de resposta detalhada
            // O Baileys retorna um array de objetos [{status: '200', jid: '...'}, ...]
            if (Array.isArray(response)) {
                for (const res of response) {
                    if (res.status === '403') {
                        await this.sock.sendMessage(groupJid, { text: `⚠️ Não pude adicionar @${res.jid.split('@')[0]} devido às configurações de privacidade dele. Link de convite enviado via PV (se disponível).`, mentions: [res.jid] });
                    } else if (res.status === '408') {
                        await this.sock.sendMessage(groupJid, { text: `❌ Falha ao adicionar @${res.jid.split('@')[0]}: O número não existe ou não usa WhatsApp.`, mentions: [res.jid] });
                    } else if (res.status === '409') {
                        await this.sock.sendMessage(groupJid, { text: `⚠️ @${res.jid.split('@')[0]} já é um participante.`, mentions: [res.jid] });
                    }
                }
            }

            await this.sock.sendMessage(groupJid, { text: `✅ Processo de adição concluído para: ${toAdd.map((n: string) => `@${n.split('@')[0]}`).join(', ')}`, mentions: toAdd }, { quoted: m });

            this.clearMetadataCache(groupJid);
        } catch (e: any) {
            this.logger.error(`[GroupManagement] addUser erro: ${e.message}`);
            let errorMsg = e.message;
            if (e.message?.includes('not-authorized')) errorMsg = 'Não sou admin ou não tenho permissão.';
            if (e.message?.includes('bad-request')) errorMsg = 'Formato do número inválido ou erro de protocolo. Tente sem o sinal de "+".';

            await this.sock.sendMessage(groupJid, { text: `❌ Falha ao adicionar: ${errorMsg}` }, { quoted: m }).catch(() => { });
        }
        return true;
    }

    async promoteUser(m: any, args: any[]) {
        const targets = this._extractTargets(m);
        if (targets.length === 0) {
            await this.sock.sendMessage(m.key.remoteJid, { text: '❌ Mencione (@alguem) quem promover a admin.' }, { quoted: m }).catch(() => { });
            return true;
        }
        const groupJid = m.key.remoteJid;
        this.logger.info(`[promoteUser] Alvos para admin: ${JSON.stringify(targets)} em ${groupJid}`);

        try {
            // Check Bot Admin Status explicitly
            const metadata = await this._getGroupMetadata(groupJid, true);
            const myJid = this.sock?.user?.id?.split(':')[0] + '@s.whatsapp.net';
            const me = metadata?.participants?.find((p: any) => p.id?.split(':')[0] + '@s.whatsapp.net' === myJid);
            const isBotAdmin = me?.admin === 'admin' || me?.admin === 'superadmin';

            if (!isBotAdmin) {
                await this.sock.sendMessage(groupJid, { text: '❌ Não posso promover membros: eu não sou administrador deste grupo.' }, { quoted: m });
                return true;
            }

            await this._withRetry(() => this.sock.groupParticipantsUpdate(groupJid, targets, 'promote'), groupJid);
            this.logger.info(`[promoteUser] Sucesso na promoção.`);
            const mentions = targets.map((t: string) => `@${t.split('@')[0]}`).join(', ');
            await this.sock.sendMessage(groupJid, { text: `👑 ${mentions} promovido(s) a admin!`, mentions: targets }, { quoted: m });
        } catch (e: any) {
            await this.sock.sendMessage(m.key.remoteJid, { text: `❌ Falha ao promover: ${e.message?.includes('not-authorized') ? 'Não tenho permissão.' : e.message}` }, { quoted: m }).catch(() => { });
        }
        return true;
    }

    async demoteUser(m: any, args: any[]) {
        const targets = this._extractTargets(m);
        if (targets.length === 0) {
            await this.sock.sendMessage(m.key.remoteJid, { text: '❌ Mencione (@alguem) quem rebaixar.' }, { quoted: m }).catch(() => { });
            return true;
        }
        const groupJid = m.key.remoteJid;
        this.logger.info(`[demoteUser] Alvos para rebaixar: ${JSON.stringify(targets)} em ${groupJid}`);

        try {
            // Check Bot Admin Status explicitly
            const metadata = await this._getGroupMetadata(groupJid, true);
            const myJid = this.sock?.user?.id?.split(':')[0] + '@s.whatsapp.net';
            const me = metadata?.participants?.find((p: any) => p.id?.split(':')[0] + '@s.whatsapp.net' === myJid);
            const isBotAdmin = me?.admin === 'admin' || me?.admin === 'superadmin';

            if (!isBotAdmin) {
                await this.sock.sendMessage(groupJid, { text: '❌ Não posso rebaixar membros: eu não sou administrador deste grupo.' }, { quoted: m });
                return true;
            }

            await this._withRetry(() => this.sock.groupParticipantsUpdate(groupJid, targets, 'demote'), groupJid);
            this.logger.info(`[demoteUser] Sucesso no rebaixamento.`);
            const mentions = targets.map((t: string) => `@${t.split('@')[0]}`).join(', ');
            await this.sock.sendMessage(groupJid, { text: `⬇️ ${mentions} rebaixado(s) de admin.`, mentions: targets }, { quoted: m });
        } catch (e: any) {
            await this.sock.sendMessage(m.key.remoteJid, { text: `❌ Falha ao rebaixar: ${e.message?.includes('not-authorized') ? 'Não tenho permissão.' : e.message}` }, { quoted: m }).catch(() => { });
        }
        return true;
    }

    async tagAll(m: any, args: any[]) {
        const groupJid = m.key.remoteJid;
        const message = args.join(' ') || '📢';
        try {
            const metadata = await this._getGroupMetadata(groupJid);
            if (metadata) {
                const participants = metadata.participants.map((p: any) => p.id);
                await this.sock.sendMessage(groupJid, { text: `${message}\n\n${participants.map((p: string) => `@${p.split('@')[0]}`).join(' ')}`, mentions: participants }, { quoted: m });
            }
        } catch (e) { }
        return true;
    }

    async getGroupInfo(m: any) {
        const groupJid = m.key.remoteJid;
        try {
            const metadata = await this._getGroupMetadata(groupJid);
            if (metadata) {
                const info = `*Grupo:* ${metadata.subject}\n*Membros:* ${metadata.participants.length}`;
                await this.sock.sendMessage(groupJid, { text: info }, { quoted: m });
            }
        } catch (e) { }
        return true;
    }

    async listMembers(m: any) {
        const groupJid = m.key.remoteJid;
        try {
            const metadata = await this._getGroupMetadata(groupJid);
            if (metadata) {
                const text = metadata.participants.map((p: any, i: number) => `${i + 1}. @${p.id.split('@')[0]}`).join('\n');
                await this.sock.sendMessage(groupJid, { text: `*Membros (${metadata.participants.length})*\n${text}`, mentions: metadata.participants.map((p: any) => p.id) }, { quoted: m });
            }
        } catch (e) { }
        return true;
    }

    async listAdmins(m: any) {
        const groupJid = m.key.remoteJid;
        try {
            const admins = await this._getGroupAdmins(groupJid);
            const text = admins.map((a: string, i: number) => `${i + 1}. @${a.split('@')[0]}`).join('\n');
            await this.sock.sendMessage(groupJid, { text: `*Admins (${admins.length})*\n${text}`, mentions: admins }, { quoted: m });
        } catch (e) { }
        return true;
    }

    async setGroupDesc(groupJid: string, desc: string): Promise<{ success: boolean; message?: string; error?: string }> {
        if (!await this._checkSocket()) return { success: false, error: 'Socket offline' };
        try {
            await this._withRetry(() => this.sock.groupUpdateDescription(groupJid, desc));
            this.clearMetadataCache(groupJid);
            return { success: true, message: '✅ Descrição alterada com sucesso!' };
        } catch (e: any) {
            this.logger.error(`❌ Alterar descrição: ${e.message}`);
            return { success: false, error: 'Falha ao alterar descrição' };
        }
    }

    async setGroupPhoto(groupJid: string, buffer: any): Promise<{ success: boolean; message?: string; error?: string }> {
        if (!await this._checkSocket()) return { success: false, error: 'Socket offline' };
        try {
            await this._withRetry(() => this.sock.updateProfilePicture(groupJid, buffer));
            this.clearMetadataCache(groupJid);
            return { success: true, message: '✅ Foto alterada com sucesso!' };
        } catch (e: any) {
            this.logger.error(`❌ Alterar foto: ${e.message}`);
            return { success: false, error: 'Falha ao alterar foto' };
        }
    }

    async setGroupName(groupJid: string, name: string): Promise<{ success: boolean; message?: string; error?: string }> {
        if (!await this._checkSocket()) return { success: false, error: 'Socket offline' };
        try {
            await this._withRetry(() => this.sock.groupUpdateSubject(groupJid, name));
            this.clearMetadataCache(groupJid);
            return { success: true, message: '✅ Nome alterado com sucesso!' };
        } catch (e: any) {
            this.logger.error(`❌ Alterar nome: ${e.message}`);
            return { success: false, error: 'Falha ao alterar nome' };
        }
    }

    async toggleRequireRegister(m: any, value: string) {
        const groupJid = m.key.remoteJid;
        const require = value === 'on';
        if (!this.groupSettings[groupJid]) this.groupSettings[groupJid] = {};
        this.groupSettings[groupJid].requireRegistration = require;
        this.saveGroupSettings();
        const msg = require ? '✅ Registro obrigatório ON' : '✅ Registro opcional';
        if (this.sock) await this.sock.sendMessage(groupJid, { text: msg }, { quoted: m });
        return true;
    }

    async isUserAdmin(groupJid: string, userJid: string): Promise<boolean> {
        const admins = await this._getGroupAdmins(groupJid);
        return admins.includes(userJid);
    }

    async getBlacklistInfo(groupJid: string): Promise<string> {
        const settings = this.groupSettings[groupJid] || {};
        const muted = Object.keys(settings.mutedUsers || {}).length;
        const antilink = settings.antilink ? '✅ ATIVO' : '❌ INATIVO';
        const antifake = settings.antifake ? '✅ ATIVO' : '❌ INATIVO';

        return `📊 *RELATÓRIO DE SEGURANÇA*\n\n` +
            `🚫 *Silenciados:* ${muted}\n` +
            `🔗 *Anti-Link:* ${antilink}\n` +
            `🏴 *Anti-Fake:* ${antifake}\n` +
            `⚔️ *Moderação:* Sistema Operacional`;
    }
}

export default GroupManagement;

