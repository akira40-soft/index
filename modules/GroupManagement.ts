/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MÓDULO: GroupManagement.js
 * ═══════════════════════════════════════════════════════════════════════════
 * Gestão completa do grupo: foto, nome, descrição, abertura/fechamento
 * ═══════════════════════════════════════════════════════════════════════════
 */

import ConfigManager from './ConfigManager.js';
import fs from 'fs';
import path from 'path';

class GroupManagement {
    public sock: any;
    public config: any;
    public logger: any;
    public groupsDataPath: string;
    public scheduledActionsPath: string;
    public groupSettings: any;
    public scheduledActions: any;
    public moderationSystem: any;
    public mediaProcessor: any;
    public levelSystem: any;
    private metadataCache: Map<string, { data: any; timestamp: number }>;
    private adminCache: Map<string, { admins: string[]; timestamp: number }>;
    private readonly CACHE_TTL = 120000; // 2 minutos

    /**
     * Cria uma lista de alvos a partir da mensagem, incluindo mentions e
     * usuário citado no reply. Retorna array vazio se nenhum alvo encontrado.
     */
    private _extractTargets(m: any): string[] {
        const mentioned: string[] = m.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        if (mentioned.length > 0) {
            return mentioned;
        }

        const replyInfo = m.replyInfo || m._replyInfo;
        if (replyInfo?.quemEscreveuCitacaoJid) {
            return [replyInfo.quemEscreveuCitacaoJid];
        }

        const participant = m.message?.extendedTextMessage?.contextInfo?.participant;
        if (participant) {
            return [participant];
        }

        return [];
    }

    constructor(sock: any, config: any = null, moderationSystem: any = null, mediaProcessor: any = null, levelSystem: any = null) {
        this.sock = sock;
        this.config = config || ConfigManager.getInstance();
        this.logger = console;
        this.moderationSystem = moderationSystem;
        this.mediaProcessor = mediaProcessor;
        this.levelSystem = levelSystem;
        this.metadataCache = new Map();
        this.adminCache = new Map();

        this.groupsDataPath = path.join(this.config.DATABASE_FOLDER, 'group_settings.json');
        this.scheduledActionsPath = path.join(this.config.DATABASE_FOLDER, 'scheduled_actions.json');

        this.groupSettings = this.loadGroupSettings();
        this.scheduledActions = this.loadScheduledActions();

        this.startScheduledActionsChecker();
    }

    /**
     * Obtém administradores do grupo com cache
     */
    private async _getGroupAdmins(groupJid: string): Promise<string[]> {
        const cached = this.adminCache.get(groupJid);
        if (cached && (Date.now() - cached.timestamp) < this.CACHE_TTL) {
            return cached.admins;
        }

        const metadata = await this._getGroupMetadata(groupJid);
        if (!metadata || !metadata.participants) return cached?.admins || [];

        const admins = metadata.participants
            .filter((p: any) => p.admin === 'admin' || p.admin === 'superadmin')
            .map((p: any) => p.id);

        this.adminCache.set(groupJid, { admins, timestamp: Date.now() });
        return admins;
    }

    setSocket(sock: any) {
        this.sock = sock;
    }

    /**
     * Verifica se o socket está conectado e pronto
     */
    private _checkSocket(): boolean {
        if (!this.sock) {
            return false;
        }

        if (typeof this.sock.sendMessage !== 'function') {
            this.logger.error('❌ [GroupManagement] Socket não tem sendMessage');
            return false;
        }

        // Verifica se o bot está logado
        // Fallback para creds.me se sock.user estiver ausente (comum logo após reconexão)
        const me = this.sock.user || this.sock.authState?.creds?.me;
        if (!me || !me.id) {
            this.logger.debug('🔍 [GroupManagement] Identidade do bot (sock.user) ausente');
            return false;
        }

        return true;
    }

    /**
     * Aguarda o socket estar pronto (v21: simplificado para evitar bloqueio)
     */
    private async _waitForSocket(maxWaitMs: number = 3000): Promise<boolean> {
        return this._checkSocket();
    }

    /**
     * Obtém metadados do grupo com cache e retry
     */
    private async _getGroupMetadata(groupJid: string, retries: number = 2): Promise<any | null> {
        // Verifica cache
        const cached = this.metadataCache.get(groupJid);
        if (cached && (Date.now() - cached.timestamp) < this.CACHE_TTL) {
            return cached.data;
        }

        // ✅ BUG FIX #5: Se socket não está pronto, usa cache de emergência IMEDIATAMENTE
        // Sem retries com delays que travam a resposta por 3-7 segundos
        if (!this._checkSocket()) {
            if (cached) {
                this.logger?.debug(`✨ [GroupManagement] Socket indisponível. Usando cache para ${groupJid}`);
                return cached.data;
            }
            this.logger.warn(`❌ [GroupManagement] Socket não disponível e sem cache para ${groupJid}`);
            return null;
        }

        // Socket disponível — tenta buscar metadados (1 tentativa, fallback para cache)
        try {
            const metadata = await this.sock.groupMetadata(groupJid);
            this.metadataCache.set(groupJid, { data: metadata, timestamp: Date.now() });

            const admins = metadata.participants
                .filter((p: any) => p.admin || p.isAdmin || p.isSuperAdmin)
                .map((p: any) => p.id);
            this.adminCache.set(groupJid, { admins, timestamp: Date.now() });

            return metadata;
        } catch (e: any) {
            const isConnClosed = e.message?.includes('Connection Closed') || e.message?.includes('515');

            // Se falhou por instabilidade e temos cache (mesmo expirado), usa sem delay
            if (cached) {
                this.logger?.warn(`⚠️ [GroupManagement] Falha ao buscar metadados (${e.message?.substring(0, 40)}). Usando cache.`);
                return cached.data;
            }

            // Sem cache, tenta 1 vez com delay mínimo
            if (!isConnClosed && retries > 0) {
                await new Promise(resolve => setTimeout(resolve, 800));
                return this._getGroupMetadata(groupJid, retries - 1);
            }

            this.logger.error(`❌ [GroupManagement] Sem cache e sem conexão para ${groupJid}`);
            return null;
        }
    }

    /**
     * Limpa cache de metadados
     */
    clearMetadataCache(groupJid?: string) {
        if (groupJid) {
            this.metadataCache.delete(groupJid);
        } else {
            this.metadataCache.clear();
        }
    }

    /**
     * Carrega configurações dos grupos do arquivo
     */
    loadGroupSettings(): any {
        try {
            if (fs.existsSync(this.groupsDataPath)) {
                const data = fs.readFileSync(this.groupsDataPath, 'utf8');
                const parsed = JSON.parse(data || '{}');
                return parsed || {};
            }
        } catch (e: any) {
            this.logger.error('❌ [GroupManagement] Erro ao carregar configurações:', e.message);
        }
        return {};
    }

    /**
     * Salva configurações dos grupos no arquivo
     */
    saveGroupSettings(): void {
        try {
            const dir = path.dirname(this.groupsDataPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.groupsDataPath, JSON.stringify(this.groupSettings, null, 2));
        } catch (e: any) {
            this.logger.error('❌ [GroupManagement] Erro ao salvar configurações:', e.message);
        }
    }

    /**
     * Carrega ações programadas do arquivo
     */
    loadScheduledActions(): any {

        try {
            if (fs.existsSync(this.scheduledActionsPath)) {
                const data = fs.readFileSync(this.scheduledActionsPath, 'utf8');
                return JSON.parse(data || '[]');
            }
        } catch (e: any) {
            this.logger.error('❌ [GroupManagement] Erro ao carregar ações programadas:', e.message);
        }
        return [];
    }

    /**
     * Inicia verificador de ações programadas
     */
    startScheduledActionsChecker(): void {
        setInterval(() => {
            this.checkScheduledActions();
        }, 60000);
    }

    /**
     * Verifica e executa ações programadas
     */
    async checkScheduledActions(): Promise<void> {
        const now = Date.now();
        const actionsToExecute = this.scheduledActions.filter((action: any) => action.executeAt <= now);

        for (const action of actionsToExecute) {
            try {
                if (action.type === 'unmute') {
                    if (this.moderationSystem) {
                        this.moderationSystem.unmuteUser(action.groupJid, action.userJid);
                    }
                    if (this.groupSettings[action.groupJid]?.mutedUsers?.[action.userJid]) {
                        delete this.groupSettings[action.groupJid].mutedUsers[action.userJid];
                    }
                } else if (action.type === 'openGroup') {
                    await this.openGroup(action.groupJid);
                } else if (action.type === 'closeGroup') {
                    await this.closeGroup(action.groupJid);
                }
            } catch (e: any) {
                this.logger.error(`❌ [GroupManagement] Erro ao executar ação programada:`, e.message);
            }
        }

        this.scheduledActions = this.scheduledActions.filter((action: any) => action.executeAt > now);
        this.saveScheduledActions();
    }

    /**
     * Salva ações programadas no arquivo
     */
    saveScheduledActions(): void {
        try {
            const dir = path.dirname(this.scheduledActionsPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.scheduledActionsPath, JSON.stringify(this.scheduledActions, null, 2));
        } catch (e: any) {
            this.logger.error('❌ [GroupManagement] Erro ao salvar ações programadas:', e.message);
        }
    }

    /**
     * Processa comandos de grupo
     */
    async handleCommand(m: any, command: string, args: any[]) {
        const isGroup = m.key.remoteJid.endsWith('@g.us');
        if (!isGroup) {
            if (this._checkSocket()) {
                await this.sock.sendMessage(m.key.remoteJid, { text: '📵 Comandos de grupo apenas em grupos.' }, { quoted: m });
            }
            return true;
        }

        const needsSocket = ['mute', 'desmute', 'unmute', 'kick', 'ban', 'add', 'promote', 'demote',
            'fechar', 'close', 'abrir', 'open', 'link', 'revlink', 'revogar',
            'fixar', 'pin', 'desafixar', 'unpin', 'tagall', 'totag'].includes(command);

        if (needsSocket && !this._checkSocket()) {
            this.logger.error(`❌ [GroupManagement] Comando ${command} falhou: socket não disponível`);
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
            case 'bemvindo':
                return await this.toggleSetting(m, 'welcome', args[0]);
            case 'goodbye':
            case 'adeus':
                return await this.toggleSetting(m, 'goodbye', args[0]);
            case 'setwelcome':
                return await this.setWelcomeMessage(m.key.remoteJid, args.join(' '));
            case 'setgoodbye':
                return await this.setGoodbyeMessage(m.key.remoteJid, args.join(' '));
            case 'antifake':
                return await this.toggleSetting(m, 'antifake', args[0]);
            case 'antispam':
                return await this.toggleSetting(m, 'antispam', args[0]);
            case 'setdesc':
            case 'descricao':
                return await this.setGroupDesc(m, args);
            case 'setfoto':
            case 'fotodogrupo':
                return await this.setGroupPhoto(m);
            case 'setnome':
            case 'nome':
            case 'setsubject':
                return await this.setGroupName(m, args);
            case 'requireregister':
                return await this.toggleRequireRegister(m, args[0]);
            case 'rank':
            case 'level':
            case 'nivel':
                return await this.getRank(m);
            case 'resetwins':
                // ... (existing logic or placeholder)
                return true;
            default:
                return false;
        }
    }

    /**
     * Alterna uma configuração de grupo
     */
    async toggleSetting(m: any, setting: string, value: any) {
        const groupJid = m.key.remoteJid;
        const state = value === 'on' ? true : value === 'off' ? false : null;

        if (state === null) {
            if (this._checkSocket()) {
                await this.sock.sendMessage(groupJid, { text: `❌ Use: *#${setting} on/off*` }, { quoted: m });
            }
            return true;
        }

        if (!this.groupSettings[groupJid]) this.groupSettings[groupJid] = {};

        this.groupSettings[groupJid][setting] = state;
        this.saveGroupSettings();

        const statusStr = state ? 'ATIVADO' : 'DESATIVADO';
        if (this._checkSocket()) {
            await this.sock.sendMessage(groupJid, { text: `✅ **${setting.toUpperCase()}** agora está **${statusStr}** para este grupo.` }, { quoted: m });
        }
        return true;
    }

    /**
     * Define uma mensagem personalizada
     */
    async setCustomMessage(groupJid: string, type: string, text: string) {
        if (!this.groupSettings[groupJid]) this.groupSettings[groupJid] = {};
        if (!this.groupSettings[groupJid].messages) this.groupSettings[groupJid].messages = {};

        this.groupSettings[groupJid].messages[type] = text;
        this.saveGroupSettings();
        return true;
    }

    /**
     * Obtém uma mensagem personalizada
     */
    getCustomMessage(groupJid: string, type: string): string | null {
        if (!this.groupSettings) this.groupSettings = {};
        return this.groupSettings[groupJid]?.messages?.[type] || null;
    }

    /**
     * Verifica se welcome está ativo
     */
    getWelcomeStatus(groupJid: string): boolean {
        if (!this.groupSettings) this.groupSettings = {};
        return this.groupSettings[groupJid]?.welcome === true;
    }

    /**
     * Verifica se goodbye está ativo
     */
    getGoodbyeStatus(groupJid: string): boolean {
        if (!this.groupSettings) this.groupSettings = {};
        return this.groupSettings[groupJid]?.goodbye === true;
    }

    /**
     * Define mensagem de welcome
     */
    async setWelcomeMessage(groupJid: string, message: string): Promise<boolean> {
        return await this.setCustomMessage(groupJid, 'welcome', message);
    }

    /**
     * Define mensagem de goodbye
     */
    async setGoodbyeMessage(groupJid: string, message: string): Promise<boolean> {
        return await this.setCustomMessage(groupJid, 'goodbye', message);
    }

    /**
     * Envia mensagem de welcome para novos membros
     */
    async sendWelcomeMessage(groupJid: string, participants: string[]): Promise<void> {
        if (!this.getWelcomeStatus(groupJid)) return;
        const template = this.getCustomMessage(groupJid, 'welcome') || 'Bem-vindo(a) @user ao grupo @group!';

        for (const jid of participants) {
            const formatted = await this.formatMessage(groupJid, jid, template);
            await this.sock.sendMessage(groupJid, { text: formatted, mentions: [jid] });
        }
    }

    /**
     * Envia mensagem de goodbye para membros que saíram
     */
    async sendGoodbyeMessage(groupJid: string, participants: string[]): Promise<void> {
        if (!this.getGoodbyeStatus(groupJid)) return;
        const template = this.getCustomMessage(groupJid, 'goodbye') || 'Adeus @user, sentiremos sua falta!';

        for (const jid of participants) {
            const formatted = await this.formatMessage(groupJid, jid, template);
            await this.sock.sendMessage(groupJid, { text: formatted, mentions: [jid] });
        }
    }

    /**
     * Formata uma mensagem com placeholders
     */
    async formatMessage(groupJid: string, participantJid: string, template: string) {
        try {
            const metadata = await this._getGroupMetadata(groupJid);
            if (!metadata) return template;

            const groupName = metadata.subject || 'Grupo';
            const groupDesc = metadata.desc?.toString() || 'Sem descrição';
            const userTag = `@${participantJid.split('@')[0]}`;

            let groupLink = 'Apenas admins podem gerar link';
            try {
                const me = metadata.participants.find((p: any) => p.id === this.sock?.user?.id);
                if (me && (me.admin === 'admin' || me.admin === 'superadmin')) {
                    const code = await this.sock.groupInviteCode(groupJid);
                    groupLink = `https://chat.whatsapp.com/${code}`;
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

    // ═════════════════════════════════════════════════════════════════
    // COMANDOS DE GRUPO: FECHAR/ABRIR
    // ═════════════════════════════════════════════════════════════════

    async closeGroupCommand(m: any): Promise<boolean> {
        if (!this._checkSocket()) {
            this.logger.error('❌ [GroupManagement] Socket não disponível');
            return true;
        }
        const result = await this.closeGroup(m.key.remoteJid);
        if (result.success) {
            await this.sock.sendMessage(m.key.remoteJid, { text: result.message }, { quoted: m });
        } else {
            await this.sock.sendMessage(m.key.remoteJid, { text: `❌ Erro: ${result.error}` }, { quoted: m });
        }
        return true;
    }

    async openGroupCommand(m: any): Promise<boolean> {
        if (!this._checkSocket()) {
            this.logger.error('❌ [GroupManagement] Socket não disponível');
            return true;
        }
        const result = await this.openGroup(m.key.remoteJid);
        if (result.success) {
            await this.sock.sendMessage(m.key.remoteJid, { text: result.message }, { quoted: m });
        } else {
            await this.sock.sendMessage(m.key.remoteJid, { text: `❌ Erro: ${result.error}` }, { quoted: m });
        }
        return true;
    }

    /**
     * Fecha o grupo
     */
    async closeGroup(groupJid: string): Promise<{ success: boolean; message?: string; error?: string }> {
        if (!this._checkSocket()) {
            return { success: false, error: 'Socket não disponível' };
        }

        try {
            await this.sock.groupSettingUpdate(groupJid, 'announcement');
            this.clearMetadataCache(groupJid);
            this.logger.info(`✅ [GroupManagement] Grupo ${groupJid} fechado`);
            return { success: true, message: '🔒 Grupo fechado. Apenas admins podem enviar mensagens.' };
        } catch (e: any) {
            this.logger.error(`❌ [GroupManagement] Erro ao fechar grupo:`, e.message);
            return { success: false, error: 'Não foi possível fechar o grupo' };
        }
    }

    /**
     * Abre o grupo
     */
    async openGroup(groupJid: string): Promise<{ success: boolean; message?: string; error?: string }> {
        if (!this._checkSocket()) {
            return { success: false, error: 'Socket não disponível' };
        }

        try {
            await this.sock.groupSettingUpdate(groupJid, 'not_announcement');
            this.clearMetadataCache(groupJid);
            this.logger.info(`✅ [GroupManagement] Grupo ${groupJid} aberto`);
            return { success: true, message: '🔓 Grupo aberto. Todos podem enviar mensagens.' };
        } catch (e: any) {
            this.logger.error(`❌ [GroupManagement] Erro ao abrir grupo:`, e.message);
            return { success: false, error: 'Não foi possível abrir o grupo' };
        }
    }

    // ═════════════════════════════════════════════════════════════════
    // COMANDOS DE USUÁRIO: MUTE/UNMUTE
    // ═════════════════════════════════════════════════════════════════

    async muteUser(m: any, args: any[]) {
        const targets = this._extractTargets(m);
        const target = targets[0];

        if (!target) {
            if (this.sock) await this.sock.sendMessage(m.key.remoteJid, {
                text: '❌ Mencione ou responda a alguém para silenciar.'
            }, { quoted: m });
            return true;
        }

        const groupJid = m.key.remoteJid;
        let duration = 5;
        if (args.length > 0) {
            const parsed = parseInt(args[0]);
            if (!isNaN(parsed) && parsed > 0 && parsed <= 1440) {
                duration = parsed;
            }
        }

        if (this.moderationSystem) {
            const muteInfo = this.moderationSystem.muteUser(groupJid, target, duration);

            if (!this.groupSettings[groupJid]) {
                this.groupSettings[groupJid] = {};
            }
            if (!this.groupSettings[groupJid].mutedUsers) {
                this.groupSettings[groupJid].mutedUsers = {};
            }
            this.groupSettings[groupJid].mutedUsers[target] = muteInfo.expires;
            this.saveGroupSettings();

            if (this.sock) {
                const userName = target.split('@')[0];
                const extra = muteInfo.muteCount && muteInfo.muteCount > 1
                    ? `\n⚠️ Reincidência: ${muteInfo.muteCount} mute(s) hoje.`
                    : '';
                await this.sock.sendMessage(m.key.remoteJid, {
                    text: `🔇 Usuário @${userName} silenciado por ${muteInfo.muteMinutes} minuto(s).${extra}`,
                    mentions: [target]
                }, { quoted: m });
            }

            return true;
        }

        // Fallback
        if (!this.groupSettings[groupJid]) {
            this.groupSettings[groupJid] = {};
        }

        if (!this.groupSettings[groupJid].mutedUsers) {
            this.groupSettings[groupJid].mutedUsers = {};
        }

        const muteUntil = Date.now() + (duration * 60 * 1000);
        this.groupSettings[groupJid].mutedUsers[target] = muteUntil;
        this.saveGroupSettings();

        if (this.sock) {
            const userName = target.split('@')[0];
            await this.sock.sendMessage(m.key.remoteJid, {
                text: `🔇 Usuário @${userName} silenciado por ${duration} minuto(s).`,
                mentions: [target]
            }, { quoted: m });
        }

        return true;
    }

    async unmuteUser(m: any, args: any[]): Promise<boolean> {
        const targets = this._extractTargets(m);
        const target = targets[0];

        if (!target) {
            if (this.sock) await this.sock.sendMessage(m.key.remoteJid, {
                text: '❌ Mencione ou responda a alguém para des-silenciar.'
            }, { quoted: m });
            return true;
        }

        const groupJid = m.key.remoteJid;

        if (this.moderationSystem) {
            this.moderationSystem.unmuteUser(groupJid, target);
        }

        if (this.groupSettings[groupJid]?.mutedUsers?.[target]) {
            delete this.groupSettings[groupJid].mutedUsers[target];
            this.saveGroupSettings();

            if (this.sock) {
                const userName = target.split('@')[0];
                await this.sock.sendMessage(m.key.remoteJid, {
                    text: `🔊 Usuário @${userName} pode falar novamente.`,
                    mentions: [target]
                }, { quoted: m });
            }
        } else {
            if (this.sock) {
                await this.sock.sendMessage(m.key.remoteJid, {
                    text: '❌ Este usuário não está silenciado.'
                }, { quoted: m });
            }
        }

        return true;
    }

    /**
     * Verifica se usuário está mutado
     */
    isUserMuted(groupJid: string, userJid: string): boolean {
        if (!this.groupSettings) this.groupSettings = {};
        const mutedUsers = this.groupSettings[groupJid]?.mutedUsers || {};

        const muteUntil = mutedUsers[userJid];

        if (!muteUntil) return false;

        if (Date.now() > muteUntil) {
            delete mutedUsers[userJid];
            this.saveGroupSettings();
            return false;
        }

        return true;
    }

    // ═════════════════════════════════════════════════════════════════
    // COMANDOS DE AUTONOMIA WHATSAPP
    // ═════════════════════════════════════════════════════════════════

    async pinMessage(m: any, args: any[]) {
        if (!this._checkSocket()) {
            this.logger.error('❌ [GroupManagement] Socket não disponível');
            return false;
        }

        const quotedMsg = m.message?.extendedTextMessage?.contextInfo;
        if (!quotedMsg) {
            await this.sock.sendMessage(m.key.remoteJid, {
                text: '❌ Responda a uma mensagem para fixá-la.'
            }, { quoted: m });
            return true;
        }

        try {
            let duration = 86400;
            if (args.length > 0) {
                const time = args[0].toLowerCase();
                if (time.endsWith('h')) duration = parseInt(time) * 3600;
                else if (time.endsWith('d')) duration = parseInt(time) * 86400;
                else if (time.endsWith('m')) duration = parseInt(time) * 60;
            }

            await this.sock.sendMessage(m.key.remoteJid, {
                pin: quotedMsg.stanzaId,
                type: 1,
                time: duration
            });

            await this.sock.sendMessage(m.key.remoteJid, {
                text: `📌 Mensagem fixada por ${duration >= 86400 ? Math.floor(duration / 86400) + 'd' : duration >= 3600 ? Math.floor(duration / 3600) + 'h' : Math.floor(duration / 60) + 'm'}`
            }, { quoted: m });
        } catch (e: any) {
            this.logger?.error('❌ [GroupManagement] Erro ao fixar mensagem:', e.message);
            await this.sock.sendMessage(m.key.remoteJid, {
                text: `❌ Não foi possível fixar a mensagem.`
            }, { quoted: m });
        }

        return true;
    }

    async unpinMessage(m: any): Promise<boolean> {
        if (!this._checkSocket()) {
            this.logger.error('❌ [GroupManagement] Socket não disponível');
            return false;
        }

        const quotedMsg = m.message?.extendedTextMessage?.contextInfo;
        if (!quotedMsg) {
            await this.sock.sendMessage(m.key.remoteJid, {
                text: '❌ Responda a uma mensagem fixada para desafixá-la.'
            }, { quoted: m });
            return true;
        }

        try {
            await this.sock.sendMessage(m.key.remoteJid, {
                pin: quotedMsg.stanzaId,
                type: 0
            });

            await this.sock.sendMessage(m.key.remoteJid, {
                text: '📌🚫 Mensagem desafixada.'
            }, { quoted: m });
        } catch (e: any) {
            this.logger?.error('❌ [GroupManagement] Erro ao desafixar mensagem:', e.message);
            await this.sock.sendMessage(m.key.remoteJid, {
                text: `❌ Não foi possível desafixar a mensagem.`
            }, { quoted: m });
        }

        return true;
    }

    async markAsRead(m: any): Promise<boolean> {
        if (!this._checkSocket()) {
            this.logger.error('❌ [GroupManagement] Socket não disponível');
            return false;
        }

        try {
            await this.sock.readMessages([m.key]);
            this.logger?.info('✅ [GroupManagement] Mensagens marcadas como lidas');
        } catch (e: any) {
            this.logger?.error('❌ [GroupManagement] Erro ao marcar como lido:', e.message);
        }

        return true;
    }

    async reactToMessage(m: any, args: any[]): Promise<boolean> {
        if (!this._checkSocket()) {
            this.logger.error('❌ [GroupManagement] Socket não disponível');
            return false;
        }

        const quotedMsg = m.message?.extendedTextMessage?.contextInfo;
        if (!quotedMsg) {
            await this.sock.sendMessage(m.key.remoteJid, {
                text: '❌ Responda a uma mensagem para reagir. Uso: #reagir 👍'
            }, { quoted: m });
            return true;
        }

        const emoji = args[0] || '👍';

        try {
            await this.sock.sendMessage(m.key.remoteJid, {
                react: {
                    text: emoji,
                    key: quotedMsg
                }
            });

            this.logger?.info(`✅ [GroupManagement] Reagiu com ${emoji}`);
        } catch (e: any) {
            this.logger?.error('❌ [GroupManagement] Erro ao reagir:', e.message);
        }

        return true;
    }

    // ═════════════════════════════════════════════════════════════════
    // COMANDOS DE GERENCIAMENTO DE MEMBROS
    // ═════════════════════════════════════════════════════════════════

    async kickUser(m: any, args: any[]): Promise<boolean> {
        if (!this._checkSocket()) return true;
        const groupJid = m.key.remoteJid;
        const targets = this._extractTargets(m);

        if (targets.length === 0) {
            await this.sock.sendMessage(groupJid, { text: '❌ Mencione ou responda a alguém para remover.' }, { quoted: m });
            return true;
        }

        // Verificar se bot é admin
        const admins = await this._getGroupAdmins(groupJid);
        const botId = this.sock.user.id.split(':')[0] + '@s.whatsapp.net';
        if (!admins.includes(botId)) {
            await this.sock.sendMessage(groupJid, { text: '❌ Eu preciso ser admin para remover membros.' }, { quoted: m });
            return true;
        }

        try {
            await this.sock.groupParticipantsUpdate(groupJid, targets, 'remove');
            const mentions = targets.map((t: string) => `@${t.split('@')[0]}`);
            await this.sock.sendMessage(groupJid, {
                text: `👢 *Membro(s) removido(s):* ${mentions.join(', ')}`,
                mentions: targets
            }, { quoted: m });
            this.clearMetadataCache(groupJid);
            return true;
        } catch (e: any) {
            this.logger.error(`❌ [GroupManagement] Erro ao expulsar:`, e.message);
            await this.sock.sendMessage(groupJid, { text: '❌ Erro ao tentar remover membro. Talvez ele seja admin?' }, { quoted: m });
            return true;
        }
    }

    async addUser(m: any, args: any[]): Promise<boolean> {
        if (!this._checkSocket()) return true;
        const groupJid = m.key.remoteJid;
        let targets = args.map(a => a.replace(/\D/g, '') + '@s.whatsapp.net');

        if (targets.length === 0) {
            await this.sock.sendMessage(groupJid, { text: '❌ Informe o número do usuário.\nExemplo: #add 244937...' }, { quoted: m });
            return true;
        }

        // Verificar se bot é admin
        const admins = await this._getGroupAdmins(groupJid);
        const botId = this.sock.user.id.split(':')[0] + '@s.whatsapp.net';
        if (!admins.includes(botId)) {
            await this.sock.sendMessage(groupJid, { text: '❌ Eu preciso ser admin para adicionar membros.' }, { quoted: m });
            return true;
        }

        try {
            const response = await this.sock.groupParticipantsUpdate(groupJid, targets, 'add');
            // Baileys returns status codes for each target
            for (const res of response) {
                const jid = res.jid;
                const status = res.status;
                const num = jid.split('@')[0];

                if (status === '200') {
                    await this.sock.sendMessage(groupJid, { text: `✅ @${num} adicionado com sucesso!`, mentions: [jid] });
                } else if (status === '403') {
                    await this.sock.sendMessage(groupJid, { text: `⚠️ @${num} tem privacidade ativa. Enviei um convite privado.`, mentions: [jid] });
                } else {
                    await this.sock.sendMessage(groupJid, { text: `❌ Falha ao adicionar @${num}. Status: ${status}`, mentions: [jid] });
                }
            }
            this.clearMetadataCache(groupJid);
            return true;
        } catch (e: any) {
            this.logger.error(`❌ [GroupManagement] Erro ao adicionar:`, e.message);
            await this.sock.sendMessage(groupJid, { text: '❌ Erro interno ao tentar adicionar membro.' }, { quoted: m });
            return true;
        }
    }

    async promoteUser(m: any, args: any[]): Promise<boolean> {
        if (!this._checkSocket()) {
            this.logger.error('❌ [GroupManagement] Socket não disponível');
            return true;
        }

        const targets = this._extractTargets(m);
        const groupJid = m.key.remoteJid;

        if (targets.length === 0) {
            await this.sock.sendMessage(groupJid, {
                text: '❌ Mencione ou responda a alguém para promover a admin.'
            }, { quoted: m });
            return true;
        }

        try {
            await this.sock.groupParticipantsUpdate(groupJid, targets, 'promote');

            const mentions = targets.map((t: string) => `@${t.split('@')[0]}`).join(', ');
            await this.sock.sendMessage(groupJid, {
                text: `👑 Usuário(s) ${mentions} promovido(s) a admin.`,
                mentions: targets
            }, { quoted: m });

            this.logger.info(`✅ [GroupManagement] Usuários promovidos: ${targets.join(', ')}`);
        } catch (e: any) {
            this.logger.error(`❌ [GroupManagement] Erro ao promover usuário:`, e.message);
            await this.sock.sendMessage(groupJid, {
                text: '❌ Não foi possível promover o usuário.'
            }, { quoted: m });
        }

        return true;
    }

    async demoteUser(m: any, args: any[]): Promise<boolean> {
        if (!this._checkSocket()) {
            this.logger.error('❌ [GroupManagement] Socket não disponível');
            return true;
        }

        const targets = this._extractTargets(m);
        const groupJid = m.key.remoteJid;

        if (targets.length === 0) {
            await this.sock.sendMessage(groupJid, {
                text: '❌ Mencione ou responda a alguém para rebaixar de admin.'
            }, { quoted: m });
            return true;
        }

        try {
            await this.sock.groupParticipantsUpdate(groupJid, targets, 'demote');

            const mentions = targets.map((t: string) => `@${t.split('@')[0]}`).join(', ');
            await this.sock.sendMessage(groupJid, {
                text: `⬇️ Usuário(s) ${mentions} rebaixado(s) de admin.`,
                mentions: targets
            }, { quoted: m });

            this.logger.info(`✅ [GroupManagement] Usuários rebaixados: ${targets.join(', ')}`);
        } catch (e: any) {
            this.logger.error(`❌ [GroupManagement] Erro ao rebaixar usuário:`, e.message);
            await this.sock.sendMessage(groupJid, {
                text: '❌ Não foi possível rebaixar o usuário.'
            }, { quoted: m });
        }

        return true;
    }

    /**
     * Verifica se um usuário é admin do grupo
     */
    async isUserAdmin(groupJid: string, userJid: string): Promise<boolean> {
        const admins = await this._getGroupAdmins(groupJid);
        return admins.includes(userJid);
    }

    // ═════════════════════════════════════════════════════════════════
    // COMANDOS DE LINK DO GRUPO
    // ═════════════════════════════════════════════════════════════════

    async getGroupLink(m: any): Promise<boolean> {
        if (!this._checkSocket()) {
            this.logger.error('❌ [GroupManagement] Socket não disponível');
            return true;
        }

        const groupJid = m.key.remoteJid;

        try {
            const code = await this.sock.groupInviteCode(groupJid);
            const link = `https://chat.whatsapp.com/${code}`;

            await this.sock.sendMessage(groupJid, {
                text: `🔗 *Link do Grupo:*\n\n${link}\n\n⚠️ Não compartilhe com pessoas não autorizadas.`
            }, { quoted: m });

            this.logger.info(`✅ [GroupManagement] Link gerado para ${groupJid}`);
        } catch (e: any) {
            this.logger.error(`❌ [GroupManagement] Erro ao obter link:`, e.message);
            await this.sock.sendMessage(groupJid, {
                text: '❌ Não foi possível obter o link. Verifique se o bot é admin do grupo.'
            }, { quoted: m });
        }

        return true;
    }

    async revokeGroupLink(m: any): Promise<boolean> {
        if (!this._checkSocket()) {
            this.logger.error('❌ [GroupManagement] Socket não disponível');
            return true;
        }

        const groupJid = m.key.remoteJid;

        try {
            await this.sock.groupRevokeInvite(groupJid);

            await this.sock.sendMessage(groupJid, {
                text: '✅ Link do grupo revogado com sucesso!\n\n🔗 O link antigo não funciona mais.'
            }, { quoted: m });

            this.logger.info(`✅ [GroupManagement] Link revogado para ${groupJid}`);
        } catch (e: any) {
            this.logger.error(`❌ [GroupManagement] Erro ao revogar link:`, e.message);
            await this.sock.sendMessage(groupJid, {
                text: '❌ Não foi possível revogar o link. Verifique se o bot é admin do grupo.'
            }, { quoted: m });
        }

        return true;
    }

    // ═════════════════════════════════════════════════════════════════
    // COMANDOS DE INFORMAÇÃO DO GRUPO
    // ═════════════════════════════════════════════════════════════════

    async tagAll(m: any, args: any[]): Promise<boolean> {
        if (!this._checkSocket()) {
            this.logger.error('❌ [GroupManagement] Socket não disponível');
            return true;
        }

        const groupJid = m.key.remoteJid;
        const message = args.join(' ') || '📢 Chamando todos...';

        try {
            const metadata = await this._getGroupMetadata(groupJid);
            if (!metadata) {
                await this.sock.sendMessage(groupJid, { text: '❌ Não foi possível obter informações do grupo.' }, { quoted: m });
                return true;
            }

            const participants = metadata.participants.map((p: any) => p.id);

            await this.sock.sendMessage(groupJid, {
                text: `${message}\n\n${participants.map((p: string) => `@${p.split('@')[0]}`).join(' ')}`,
                mentions: participants
            }, { quoted: m });

            this.logger.info(`✅ [GroupManagement] TagAll executado em ${groupJid}`);
        } catch (e: any) {
            this.logger.error(`❌ [GroupManagement] Erro no tagAll:`, e.message);
            await this.sock.sendMessage(groupJid, {
                text: '❌ Não foi possível taguear todos.'
            }, { quoted: m });
        }

        return true;
    }

    async getGroupInfo(m: any): Promise<boolean> {
        if (!this._checkSocket()) {
            this.logger.error('❌ [GroupManagement] Socket não disponível');
            return true;
        }

        const groupJid = m.key.remoteJid;

        try {
            const metadata = await this._getGroupMetadata(groupJid);
            if (!metadata) {
                await this.sock.sendMessage(groupJid, { text: '❌ Não foi possível obter informações do grupo.' }, { quoted: m });
                return true;
            }

            const creationDate = metadata.creation ? new Date(metadata.creation * 1000).toLocaleDateString('pt-BR') : 'Desconhecida';
            const owner = metadata.owner ? `@${metadata.owner.split('@')[0]}` : 'Desconhecido';

            const admins = metadata.participants
                .filter((p: any) => p.admin === 'admin' || p.admin === 'superadmin')
                .map((p: any) => `@${p.id.split('@')[0]}`);

            const totalMembers = metadata.participants.length;
            const totalAdmins = admins.length;

            const infoText = `📊 *Informações do Grupo*\n\n` +
                `🏷️ *Nome:* ${metadata.subject}\n` +
                `📝 *Descrição:* ${metadata.desc || 'Sem descrição'}\n` +
                `👥 *Total de Membros:* ${totalMembers}\n` +
                `👑 *Total de Admins:* ${totalAdmins}\n` +
                `📅 *Criado em:* ${creationDate}\n` +
                `👤 *Criador:* ${owner}\n\n` +
                `👑 *Admins:*\n${admins.slice(0, 10).join('\n')}${admins.length > 10 ? `\n...e mais ${admins.length - 10} admins` : ''}`;

            await this.sock.sendMessage(groupJid, {
                text: infoText,
                mentions: metadata.participants.map((p: any) => p.id)
            }, { quoted: m });

            this.logger.info(`✅ [GroupManagement] Info obtida para ${groupJid}`);
        } catch (e: any) {
            this.logger.error(`❌ [GroupManagement] Erro ao obter info:`, e.message);
            await this.sock.sendMessage(groupJid, {
                text: '❌ Não foi possível obter informações do grupo.'
            }, { quoted: m });
        }

        return true;
    }

    async listMembers(m: any): Promise<boolean> {
        if (!this._checkSocket()) {
            this.logger.error('❌ [GroupManagement] Socket não disponível');
            return true;
        }

        const groupJid = m.key.remoteJid;

        try {
            const metadata = await this._getGroupMetadata(groupJid);
            if (!metadata) {
                await this.sock.sendMessage(groupJid, { text: '❌ Não foi possível obter informações do grupo.' }, { quoted: m });
                return true;
            }

            const participants = metadata.participants;

            let text = `👥 *Lista de Membros (${participants.length})*\n\n`;

            participants.forEach((p: any, index: number) => {
                const admin = p.admin === 'superadmin' ? '👑 Criador' : p.admin === 'admin' ? '⭐ Admin' : '👤 Membro';
                text += `${index + 1}. @${p.id.split('@')[0]} - ${admin}\n`;
            });

            await this.sock.sendMessage(groupJid, {
                text: text,
                mentions: participants.map((p: any) => p.id)
            }, { quoted: m });

            this.logger.info(`✅ [GroupManagement] Lista de membros enviada para ${groupJid}`);
        } catch (e: any) {
            this.logger.error(`❌ [GroupManagement] Erro ao listar membros:`, e.message);
            await this.sock.sendMessage(groupJid, {
                text: '❌ Não foi possível listar os membros.'
            }, { quoted: m });
        }

        return true;
    }

    async listAdmins(m: any): Promise<boolean> {
        if (!this._checkSocket()) {
            this.logger.error('❌ [GroupManagement] Socket não disponível');
            return true;
        }

        const groupJid = m.key.remoteJid;

        try {
            const metadata = await this._getGroupMetadata(groupJid);
            if (!metadata) {
                await this.sock.sendMessage(groupJid, { text: '❌ Não foi possível obter informações do grupo.' }, { quoted: m });
                return true;
            }

            const admins = metadata.participants.filter((p: any) => p.admin === 'admin' || p.admin === 'superadmin');

            if (admins.length === 0) {
                await this.sock.sendMessage(groupJid, {
                    text: '❌ Nenhum admin encontrado neste grupo.'
                }, { quoted: m });
                return true;
            }

            let text = `👑 *Lista de Admins (${admins.length})*\n\n`;

            admins.forEach((p: any, index: number) => {
                const role = p.admin === 'superadmin' ? '👑 Criador' : '⭐ Admin';
                text += `${index + 1}. @${p.id.split('@')[0]} - ${role}\n`;
            });

            await this.sock.sendMessage(groupJid, {
                text: text,
                mentions: admins.map((p: any) => p.id)
            }, { quoted: m });

            this.logger.info(`✅ [GroupManagement] Lista de admins enviada para ${groupJid}`);
        } catch (e: any) {
            this.logger.error(`❌ [GroupManagement] Erro ao listar admins:`, e.message);
            await this.sock.sendMessage(groupJid, {
                text: '❌ Não foi possível listar os admins.'
            }, { quoted: m });
        }

        return true;
    }

    // ═════════════════════════════════════════════════════════════════
    // COMANDOS DE CONFIGURAÇÃO DO GRUPO
    // ═════════════════════════════════════════════════════════════════

    async setGroupDesc(m: any, args: any[]): Promise<boolean> {
        if (!this._checkSocket()) {
            this.logger.error('❌ [GroupManagement] Socket não disponível');
            return true;
        }

        const groupJid = m.key.remoteJid;
        const description = args.join(' ');

        if (!description) {
            await this.sock.sendMessage(groupJid, {
                text: '❌ Informe a descrição do grupo.\nExemplo: #setdesc Bem-vindos ao nosso grupo!'
            }, { quoted: m });
            return true;
        }

        // Verificar se bot é admin
        const admins = await this._getGroupAdmins(groupJid);
        const botId = this.sock.user.id.split(':')[0] + '@s.whatsapp.net';
        if (!admins.includes(botId)) {
            await this.sock.sendMessage(groupJid, { text: '❌ Eu preciso ser admin para alterar a descrição do grupo.' }, { quoted: m });
            return true;
        }

        try {
            await this.sock.groupUpdateDescription(groupJid, description);
            await this.sock.sendMessage(groupJid, { text: '✅ Descrição do grupo atualizada!' }, { quoted: m });
            this.clearMetadataCache(groupJid);
            return true;
        } catch (e: any) {
            this.logger.error(`❌ [GroupManagement] Erro ao definir descrição:`, e.message);
            await this.sock.sendMessage(groupJid, { text: '❌ Erro ao atualizar descrição. Verifique as permissões do bot.' }, { quoted: m });
            return true;
        }
    }

    async setGroupPhoto(m: any): Promise<boolean> {
        if (!this._checkSocket()) {
            this.logger.error('❌ [GroupManagement] Socket não disponível');
            return true;
        }

        const groupJid = m.key.remoteJid;
        const quoted = m.message?.extendedTextMessage?.contextInfo?.quotedMessage;

        if (!quoted?.imageMessage) {
            await this.sock.sendMessage(groupJid, {
                text: '❌ Responda a uma imagem para definir como foto do grupo.'
            }, { quoted: m });
            return true;
        }

        // Verificar se bot é admin
        const admins = await this._getGroupAdmins(groupJid);
        const botId = this.sock.user.id.split(':')[0] + '@s.whatsapp.net';
        if (!admins.includes(botId)) {
            await this.sock.sendMessage(groupJid, { text: '❌ Eu preciso ser admin para alterar a foto do grupo.' }, { quoted: m });
            return true;
        }

        try {
            const buffer = await this.mediaProcessor.downloadMedia(quoted, 'image');
            if (!buffer) {
                await this.sock.sendMessage(groupJid, { text: '❌ Falha ao baixar a imagem citada.' }, { quoted: m });
                return true;
            }

            await this.sock.updateProfilePicture(groupJid, buffer);
            await this.sock.sendMessage(groupJid, { text: '✅ Foto do grupo atualizada!' }, { quoted: m });
            this.clearMetadataCache(groupJid);
            return true;
        } catch (e: any) {
            this.logger.error(`❌ [GroupManagement] Erro ao definir foto:`, e.message);
            await this.sock.sendMessage(groupJid, { text: '❌ Erro ao atualizar foto do grupo.' }, { quoted: m });
            return true;
        }
    }

    /**
     * Define a foto do grupo via Buffer (chamado pelo CommandHandler)
     */
    async setGroupPhotoDirect(groupJid: string, buffer: Buffer): Promise<{ success: boolean; error?: string }> {
        if (!this._checkSocket()) return { success: false, error: 'Socket não disponível' };
        try {
            await this.sock.updateProfilePicture(groupJid, buffer);
            this.clearMetadataCache(groupJid);
            return { success: true };
        } catch (e: any) {
            return { success: false, error: e.message };
        }
    }

    async setGroupName(m: any, args: any[]): Promise<boolean> {
        if (!this._checkSocket()) return true;
        const groupJid = m.key.remoteJid;
        const newName = args.join(' ');

        if (!newName || newName.trim().length === 0) {
            await this.sock.sendMessage(groupJid, { text: '❌ Informe o novo nome do grupo.\nExemplo: #setnome Meu Novo Grupo' }, { quoted: m });
            return true;
        }

        try {
            await this.sock.groupUpdateSubject(groupJid, newName);
            await this.sock.sendMessage(groupJid, { text: `✅ Nome do grupo alterado para: *${newName}*` }, { quoted: m });
            this.clearMetadataCache(groupJid);
            return true;
        } catch (e: any) {
            this.logger.error(`❌ [GroupManagement] Erro ao alterar nome:`, e.message);
            await this.sock.sendMessage(groupJid, { text: '❌ Não foi possível alterar o nome do grupo. Verifique se o bot é admin.' }, { quoted: m });
            return true;
        }
    }

    async toggleRequireRegister(m: any, value: string): Promise<boolean> {
        const groupJid = m.key.remoteJid;
        const require = value === 'on';

        if (!this.groupSettings[groupJid]) {
            this.groupSettings[groupJid] = {};
        }

        this.groupSettings[groupJid].requireRegistration = require;
        this.saveGroupSettings();

        // Também salvar no arquivo específico de registro
        try {
            const configPath = './temp/akira_data/group_registration_config.json';

            let config: any = {};
            if (fs.existsSync(configPath)) {
                const data = fs.readFileSync(configPath, 'utf8');
                config = JSON.parse(data || '{}');
            }

            if (!config[groupJid]) {
                config[groupJid] = {};
            }
            config[groupJid].requireRegistration = require;

            const dir = path.dirname(configPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        } catch (e: any) {
            this.logger?.error('Erro ao salvar config de registro:', e);
        }

        if (this.sock) {
            const messageText = require
                ? '✅ **Registro Obrigatório Ativado**\n\n' +
                'A partir de agora, usuários NÃO registrados não poderão usar comandos comuns neste grupo.\n\n' +
                '📝 Para se registrar: `#registrar Nome|Idade`'
                : '✅ **Registro Opcional**\n\n' +
                'Usuários podem usar comandos comuns sem se registrar.';

            await this.sock.sendMessage(groupJid, { text: messageText }, { quoted: m });
        }

        return true;
    }

    /**
     * Mostra o rank/nível do usuário ou do citado
     */
    async getRank(m: any): Promise<boolean> {
        if (!this._checkSocket()) return true;
        if (!this.levelSystem) {
            await this.sock.sendMessage(m.key.remoteJid, { text: '❌ Sistema de níveis não disponível.' }, { quoted: m });
            return true;
        }

        const groupJid = m.key.remoteJid;
        const targets = this._extractTargets(m);
        const participant = targets.length > 0 ? targets[0] : (m.key.participant || m.key.remoteJid);
        const nome = (targets.length > 0 ? 'Usuário' : m.pushName) || 'Usuário';

        try {
            const result = this.levelSystem.awardXp(groupJid, participant, 0); // Só pega os dados sem dar XP
            const rec = result.rec;
            const level = rec.level || 0;
            const xp = rec.xp || 0;
            const reqXp = this.levelSystem.requiredXp(level);
            const patente = this.levelSystem.getPatente(level);

            let progress = 0;
            if (reqXp !== Infinity && reqXp > 0) {
                progress = Math.min(100, Math.floor((xp / reqXp) * 100));
            } else if (reqXp === Infinity) {
                progress = 100;
            }

            const progressBar = '▓'.repeat(Math.floor(progress / 10)) + '░'.repeat(10 - Math.floor(progress / 10));

            const text = `📊 *RANKING DE ${nome.toUpperCase()}* 📊\n\n` +
                `⭐ *Nível:* ${level}\n` +
                `🎖️ *Patente:* ${patente}\n` +
                `✨ *XP:* ${xp} / ${reqXp === Infinity ? 'MAX' : reqXp}\n\n` +
                `📈 *Progresso:* [${progressBar}] ${progress}%\n\n` +
                `_Continue interagindo para subir de nível!_`;

            await this.sock.sendMessage(groupJid, { text, mentions: [participant] }, { quoted: m });
            return true;
        } catch (e: any) {
            this.logger.error(`❌ [GroupManagement] Erro ao buscar rank:`, e.message);
            await this.sock.sendMessage(groupJid, { text: '❌ Erro ao buscar informações de rank.' }, { quoted: m });
            return true;
        }
    }
}

export default GroupManagement;
