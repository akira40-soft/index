/**
 * ═══════════════════════════════════════════════════════════════════════
 * CLASSE: ModerationSystem (VERSÃO COM SEGURANÇA MILITAR)
 * ═══════════════════════════════════════════════════════════════════════
 * ✅ Sistema de moderação: mute, ban, antilink, antispam, leveling
 * ✅ Rate limiting com 100 msgs/hora por usuário (não-dono)
 * ✅ Auto-blacklist após 3 tentativas de spam
 * ✅ Logs detalhados em terminal (usuário, número, mensagem, citação, timestamps)
 * ✅ Sistema imune a bypass - dono não é afetado
 * ═══════════════════════════════════════════════════════════════════════
 */

import ConfigManager from './ConfigManager.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

class ModerationSystem {
    private static instance: ModerationSystem;
    private config: any;
    private logger: any;
    private blacklistPath: string;
    private mutedUsers: Map<string, any>;
    private antiLinkGroups: Set<string>;
    private antiLinkPath: string;
    private muteCounts: Map<string, any>;
    private bannedUsers: Map<string, any>;
    private spamCache: Map<string, number[]>;
    private userRateLimit: Map<string, any>;
    private hourlyLimit: number;
    private hourlyWindow: number;
    private blockDuration: number;
    private maxAttemptsBeforeBlacklist: number;
    private warnings: Map<string, any>;
    private antiFakeGroups: Set<string>;
    private antiImageGroups: Set<string>;
    private antiStickerGroups: Set<string>;
    private antiVideoGroups: Set<string>;
    private warningsPath: string;
    private antiFakePath: string;
    private antiImagePath: string;
    private antiStickerPath: string;
    private antiVideoPath: string;
    private HOURLY_LIMIT: number;
    private HOURLY_WINDOW_MS: number;
    private SPAM_THRESHOLD: number;
    private SPAM_WINDOW_MS: number;
    private enableDetailedLogging: boolean;
    private qrTimeout: any;

    private constructor(logger: any = null) {
        this.config = ConfigManager.getInstance();
        this.logger = logger || console;

        // ═══════════════════════════════════════════════════════════════════════
        // HF SPACES: Usar /tmp para garantir permissões de escrita
        // ═══════════════════════════════════════════════════════════════════════

        this.blacklistPath = '/tmp/akira_data/datauser/blacklist.json';

        // ═══ ESTRUTURAS DE DADOS ═══
        this.mutedUsers = new Map(); // {groupId_userId} -> {expires, mutedAt, minutes}
        this.antiLinkGroups = new Set(); // groupIds com anti-link ativo
        this.antiLinkPath = '/tmp/akira_data/data/antilink.json';

        this.muteCounts = new Map(); // {groupId_userId} -> {count, lastMuteDate}
        this.bannedUsers = new Map(); // {userId} -> {reason, bannedAt, expiresAt}
        this.spamCache = new Map(); // {userId} -> [timestamps]

        this.userRateLimit = new Map(); // {userId} -> { windowStart, count, ... }
        this.hourlyLimit = 100;
        this.hourlyWindow = 60 * 60 * 1000;
        this.blockDuration = 60 * 60 * 1000;
        this.maxAttemptsBeforeBlacklist = 3;

        // ═══ SISTEMA DE AVISOS E FILTROS ADICIONAIS ═══
        this.warnings = new Map();
        this.antiFakeGroups = new Set();
        this.antiImageGroups = new Set();
        this.antiStickerGroups = new Set();
        this.antiVideoGroups = new Set();

        // Persistência
        this.warningsPath = '/tmp/akira_data/data/warnings.json';
        this.antiFakePath = '/tmp/akira_data/data/antifake.json';
        this.antiImagePath = '/tmp/akira_data/data/antiimage.json';
        this.antiStickerPath = '/tmp/akira_data/data/antisticker.json';
        this.antiVideoPath = '/tmp/akira_data/data/antivideo.json';

        this._loadAllSettings();

        // ═══ CONSTANTES ANTIGAS ═══
        this.HOURLY_LIMIT = 300;
        this.HOURLY_WINDOW_MS = 60 * 60 * 1000;
        this.SPAM_THRESHOLD = 3;
        this.SPAM_WINDOW_MS = 3000;

        // ═══ LOG DETALHADO ═══
        this.enableDetailedLogging = true;
    }

    public static getInstance(logger: any = null): ModerationSystem {
        if (!ModerationSystem.instance) {
            ModerationSystem.instance = new ModerationSystem(logger);
        }
        return ModerationSystem.instance;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // BLACKLIST (PERSISTENTE)
    // ═══════════════════════════════════════════════════════════════════════

    private _loadBlacklist(): any[] {
        try {
            if (!fs.existsSync(this.blacklistPath)) {
                const dir = path.dirname(this.blacklistPath);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
                fs.writeFileSync(this.blacklistPath, JSON.stringify([]));
                return [];
            }
            const data = fs.readFileSync(this.blacklistPath, 'utf8');
            const parsed = JSON.parse(data);
            return Array.isArray(parsed) ? parsed : [];
        } catch (error: any) {
            this.logger.error(`❌ Erro ao ler blacklist: ${error.message}`);
            return [];
        }
    }

    private _saveBlacklist(list: any[]): void {
        try {
            const dir = path.dirname(this.blacklistPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.blacklistPath, JSON.stringify(list, null, 2));
        } catch (error: any) {
            this.logger.error(`❌ Erro ao salvar blacklist: ${error.message}`);
        }
    }

    // Métodos iniciais de blacklist removidos (unificados no final do arquivo)

    // ═══════════════════════════════════════════════════════════════════════
    // SISTEMA DE MUTE (EM MEMÓRIA)
    // ═══════════════════════════════════════════════════════════════════════

    public isMuted(groupId: string, userId: string): boolean {
        if (!groupId || !userId) return false;
        const key = `${groupId}_${userId}`;
        const muteData = this.mutedUsers.get(key);

        if (!muteData) return false;

        if (Date.now() > muteData.expires) {
            this.mutedUsers.delete(key);
            this.logger.info(`🔊 Mute expirado para ${userId} no grupo ${groupId}`);
            return false;
        }

        return true;
    }

    public muteUser(groupId: string, userId: string, minutes: number = 5): any {
        const key = `${groupId}_${userId}`;

        // Lógica de incremento de mute (reincidência no mesmo dia)
        const today = new Date().toDateString();
        let countData = this.muteCounts.get(key) || { count: 0, lastMuteDate: today };

        if (countData.lastMuteDate !== today) {
            countData = { count: 0, lastMuteDate: today };
        }

        countData.count += 1;
        this.muteCounts.set(key, countData);

        // Calcula tempo com base na reincidência
        let muteMinutes = minutes;
        if (countData.count > 1) {
            muteMinutes = minutes * Math.pow(2, countData.count - 1); // Exponencial: 5, 10, 20...
            this.logger.warn(`⚠️ [MUTE INTENSIFICADO] ${userId} muteado ${countData.count}x hoje. Tempo: ${muteMinutes} min`);
        }

        const expires = Date.now() + (muteMinutes * 60 * 1000);
        this.mutedUsers.set(key, {
            expires,
            mutedAt: Date.now(),
            minutes: muteMinutes,
            muteCount: countData.count
        });

        return { expires, muteMinutes, muteCount: countData.count };
    }

    public unmuteUser(groupId: string, userId: string): boolean {
        const key = `${groupId}_${userId}`;
        const wasMuted = this.mutedUsers.has(key);
        this.mutedUsers.delete(key);
        if (wasMuted) {
            this.logger.info(`🔊 Usuário ${userId} desmutado manualmente no grupo ${groupId}`);
        }
        return wasMuted;
    }

    public checkAndLimitHourlyMessages(userId: string, userName: string, userNumber: string, messageText: string, quotedMessage: any = null, ehDono: boolean = false, isGroup: boolean = false, groupJid: string | null = null): any {
        // DONO JAMAIS É LIMITADO
        if (ehDono) {
            return { allowed: true, reason: 'DONO_ISENTO' };
        }

        const now = Date.now();
        let userData = this.userRateLimit?.get(userId) || {
            windowStart: now,
            count: 0,
            blockedUntil: 0,
            overAttempts: 0,     // Quantas vezes excedeu pós-bloqueio
            penaltyStage: 0,       // Estágio da Penha (1, 2, 3, 4)
            blocked_at: null,
            time_blocked: null     // Tempo que foi bloqueado
        };

        const limitToUse = isGroup ? 50 : 25; // 50 em Gp, 25 em PV
        const penaltyDurationStage1 = 30 * 60 * 1000; // 30 min (Stage 1 e 2 cooldown)
        const penaltyDurationStage3 = 2 * 24 * 60 * 60 * 1000; // 2 dias (Stage 3 Blacklist)

        // ═══ VERIFICA SE ESTÁ NA BLACKLIST PERMANENTE OU TEMPORÁRIA ═══
        if (this.isBlacklisted(userId)) {
            // Se tentar falar, kicka imediatamente se for grupo
            return {
                allowed: false,
                reason: 'AUTO_BLACKLIST_TRIGGERED',
                action: 'KICK_SILENT' // O BotCore deverá reagir expulsando
            };
        }

        // ═══ VERIFICA SE BLOQUEIO AINDA ESTÁ ATIVO (ESTÁGIO 1 ou 2) ═══
        if (userData.blockedUntil && now < userData.blockedUntil) {
            userData.overAttempts++;

            const timePassedMs = now - (userData.blocked_at || now);
            const timeRemainingMs = userData.blockedUntil - now;
            const timeRemainingMin = Math.ceil(timeRemainingMs / 60000);

            // INSISTÊNCIA...
            if (userData.overAttempts === 1) {
                // Stage 2: Aviso Rígido
                userData.penaltyStage = 2;
                this.userRateLimit?.set(userId, userData);
                this._logRateLimitAttempt('🚨 [STAGE 2] AVISO RIGOROSO', userId, userName, userNumber, messageText, null, `Insistiu no rate limit.`, `Enviando aviso de paragem obrigatória.`);
                return {
                    allowed: false,
                    reason: 'WARNING_RIGOROUS',
                    timeRemainingMin,
                    action: 'WARN_STOP'
                };
            }
            else if (userData.overAttempts >= 2) {
                // Stage 3: Auto Blacklist de 2 dias (48h) + Kick automático
                this.addToBlacklist(userId, userName, userNumber, 'spam_reincidente', penaltyDurationStage3);
                userData.penaltyStage = 3;
                this.userRateLimit?.set(userId, userData);

                this._logRateLimitAttempt('🚨 [STAGE 3] BLACKLIST TEMPORÁRIA APLICADA', userId, userName, userNumber, messageText, null, `Insistiu no Rate Limit Stage 2.`, `Blacklist por 48h aplicada. E vai ser Kickado se estiver em grupo.`);

                return {
                    allowed: false,
                    reason: 'AUTO_BLACKLIST_TRIGGERED',
                    action: 'KICK_SILENT'
                };
            }

            // Apenas repetição do Stage 1 silencioso para logs
            this.userRateLimit?.set(userId, userData);
            return {
                allowed: false,
                reason: 'BLOQUEADO_REINCIDENCIA_SILENTE'
            };
        }

        // ═══ RESETA JANELA SE EXPIROU (O user cumpriu o cooldown) ═══
        if (now - userData.windowStart >= this.hourlyWindow) {
            // Se ele tinha passado por penalties (ex: cumpriu os 30 min e tá livre) e resvalar de novo,
            // A regra diz: "se falar novamente sub-30min (verificado acima), blaclist". 
            // Se resvalar aqui, é porque ele esperou o blockedUntil terminar. 
            // Porém, o count zera a cada HORA desde a primeira msg dele hoje.
            userData.windowStart = now;
            userData.count = 0;
            userData.blockedUntil = 0;
            userData.overAttempts = 0;
            userData.blocked_at = null;
        }

        // ═══ INCREMENTA CONTADOR ═══
        userData.count++;

        // ═══ VERIFICA SE PASSOU DO LIMITE (ESTÁGIO 1) ═══
        if (!userData.blockedUntil && userData.count > limitToUse) {
            userData.blockedUntil = now + penaltyDurationStage1; // 30 mins block
            userData.blocked_at = now;
            userData.penaltyStage = 1;
            userData.overAttempts = 0; // zera as tentativas de falha pós bloqueio

            this._logRateLimitAttempt(
                '⚠️ [STAGE 1] LIMITE EXCEDIDO',
                userId,
                userName,
                userNumber,
                messageText,
                quotedMessage,
                `Mensagens: ${userData.count}/${limitToUse}`,
                `Bloqueado por 30 minutos`
            );

            this.userRateLimit?.set(userId, userData);
            return {
                allowed: false,
                reason: 'LIMITE_HORARIO_EXCEDIDO',
                messagesCount: userData.count,
                limit: limitToUse,
                blockDurationMinutes: 30
            };
        }

        this.userRateLimit?.set(userId, userData);

        return {
            allowed: true,
            reason: 'OK',
            messagesCount: userData.count,
            limit: limitToUse
        };
    }

    /**
    * ═══════════════════════════════════════════════════════════════════════
    * NOVO: Sistema de Logging Detalhado em Terminal
    * ═══════════════════════════════════════════════════════════════════════
    */
    private _logRateLimitAttempt(status: string, userId: string, userName: string, userNumber: string, messageText: string, quotedMessage: any, details: string, action: string): void {
        if (!this.enableDetailedLogging) return;

        const timestamp = new Date().toLocaleString('pt-BR', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });

        const separator = '═'.repeat(100);
        const border = '─'.repeat(100);

        // ═══ LOG FORMATADO ═══
        this.logger.log(`\n${separator}`);
        this.logger.log(`📊 [${timestamp}] ${status}`);
        this.logger.log(border);

        this.logger.log(`👤 USUÁRIO`);
        this.logger.log(` ├─ Nome: ${userName || 'Desconhecido'}`);
        this.logger.log(` ├─ Número: ${userNumber || 'N/A'}`);
        this.logger.log(` └─ JID: ${userId || 'N/A'}`);

        this.logger.log(`💬 MENSAGEM`);
        this.logger.log(` ├─ Texto: "${messageText?.substring(0, 150)}${messageText?.length > 150 ? '...' : ''}"`);
        this.logger.log(` ├─ Comprimento: ${messageText?.length || 0} caracteres`);
        if (quotedMessage) {
            this.logger.log(` ├─ Citada: "${quotedMessage?.substring(0, 100)}${quotedMessage?.length > 100 ? '...' : ''}"`);
        }
        this.logger.log(` └─ Tipo: ${messageText?.startsWith('#') ? 'COMANDO' : 'MENSAGEM'}`);

        this.logger.log(`📈 DETALHES`);
        this.logger.log(` └─ ${details}`);

        if (action) {
            this.logger.log(`⚡ AÇÃO`);
            this.logger.log(` └─ ${action}`);
        }

        this.logger.log(separator);
    }

    /**
    * Retorna relatório do usuário
    */
    public getHourlyLimitStatus(userId: string): any {
        const userData = this.userRateLimit?.get(userId);
        if (!userData) {
            return { allowed: true, reason: 'Novo usuário' };
        }

        const now = Date.now();
        const timePassedMs = now - userData.windowStart;
        const timePassedMin = Math.floor(timePassedMs / 60000);

        return {
            messagesCount: userData.count,
            limit: this.hourlyLimit,
            blocked: now < userData.blockedUntil,
            blockedUntil: userData.blockedUntil,
            overAttempts: userData.overAttempts,
            warnings: userData.warnings,
            timePassedMinutes: timePassedMin
        };
    }

    // Aliases removidos para evitar confusão (unificado para isMuted e isBlacklisted)


    public incrementMuteCount(groupId: string, userId: string): number {
        const key = `${groupId}_${userId}`;
        const today = new Date().toDateString();
        const countData = this.muteCounts?.get(key) || { count: 0, lastMuteDate: today };

        if (countData.lastMuteDate !== today) {
            countData.count = 0;
            countData.lastMuteDate = today;
        }

        countData.count += 1;
        this.muteCounts?.set(key, countData);

        return countData.count;
    }

    public getMuteCount(groupId: string, userId: string): number {
        const key = `${groupId}_${userId}`;
        const today = new Date().toDateString();
        const countData = this.muteCounts?.get(key);

        if (!countData || countData.lastMuteDate !== today) {
            return 0;
        }

        return countData.count || 0;
    }

    private _loadAntiLinkSettings(): void {
        try {
            if (!fs.existsSync(this.antiLinkPath)) {
                const dir = path.dirname(this.antiLinkPath);
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(this.antiLinkPath, JSON.stringify([]));
                return;
            }
            const data = fs.readFileSync(this.antiLinkPath, 'utf8');
            const groups = JSON.parse(data);
            if (Array.isArray(groups)) {
                groups.forEach(g => this.antiLinkGroups.add(g));
            }
        } catch (e: any) {
            this.logger.error(`❌ Erro ao carregar AntiLink: ${e.message}`);
        }
    }

    private _saveAntiLinkSettings(): void {
        try {
            const groups = Array.from(this.antiLinkGroups);
            const dir = path.dirname(this.antiLinkPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(this.antiLinkPath, JSON.stringify(groups, null, 2));
        } catch (e: any) {
            this.logger.error(`❌ Erro ao salvar AntiLink: ${e.message}`);
        }
    }

    public toggleAntiLink(groupId: string, enable: boolean = true): boolean {
        if (enable) {
            this.antiLinkGroups.add(groupId);
        } else {
            this.antiLinkGroups.delete(groupId);
        }
        this._saveAntiLinkSettings();
        return enable;
    }

    public isAntiLinkActive(groupId: string): boolean {
        return this.antiLinkGroups.has(groupId);
    }

    // ═══ SISTEMA DE AVISOS ═══
    public addWarning(groupId: string, userId: string, reason: string = 'No reason'): number {
        const key = `${groupId}_${userId}`;
        const data = this.warnings.get(key) || { count: 0, reasons: [] };
        data.count++;
        data.reasons.push(reason);
        this.warnings.set(key, data);
        this._saveAllSettings();
        return data.count;
    }

    public getWarnings(groupId: string, userId: string): any {
        const key = `${groupId}_${userId}`;
        return this.warnings.get(key) || { count: 0, reasons: [] };
    }

    public resetWarnings(groupId: string, userId: string): void {
        const key = `${groupId}_${userId}`;
        this.warnings.delete(key);
        this._saveAllSettings();
    }

    // ═══ ANTI-FAKE (+244) ═══
    public toggleAntiFake(groupId: string, enable: boolean = true): boolean {
        if (enable) this.antiFakeGroups.add(groupId);
        else this.antiFakeGroups.delete(groupId);
        this._saveAllSettings();
        return enable;
    }

    public isAntiFakeActive(groupId: string): boolean {
        return this.antiFakeGroups.has(groupId);
    }

    public isFakeNumber(userId: string): boolean {
        // Formato esperado: 244XXXXXXXXX@s.whatsapp.net
        return !userId.startsWith('244');
    }

    public toggleAntiImage(groupId: string, enable: boolean = true): boolean {
        if (enable) this.antiImageGroups.add(groupId);
        else this.antiImageGroups.delete(groupId);
        this._saveAllSettings();
        return enable;
    }

    public isAntiImageActive(groupId: string): boolean {
        return this.antiImageGroups.has(groupId);
    }

    public toggleAntiSticker(groupId: string, enable: boolean = true): boolean {
        if (enable) this.antiStickerGroups.add(groupId);
        else this.antiStickerGroups.delete(groupId);
        this._saveAllSettings();
        return enable;
    }

    public isAntiStickerActive(groupId: string): boolean {
        return this.antiStickerGroups.has(groupId);
    }

    public toggleAntiVideo(groupId: string, enable: boolean = true): boolean {
        if (enable) this.antiVideoGroups.add(groupId);
        else this.antiVideoGroups.delete(groupId);
        this._saveAllSettings();
        return enable;
    }

    public isAntiVideoActive(groupId: string): boolean {
        return this.antiVideoGroups.has(groupId);
    }

    private _loadAllSettings(): void {
        this._loadSettingsSet(this.antiLinkPath, this.antiLinkGroups);
        this._loadSettingsSet(this.antiFakePath, this.antiFakeGroups);
        this._loadSettingsSet(this.antiImagePath, this.antiImageGroups);
        this._loadSettingsSet(this.antiStickerPath, this.antiStickerGroups);
        this._loadSettingsSet(this.antiVideoPath, this.antiVideoGroups);
        this._loadSettingsMap(this.warningsPath, this.warnings);
    }

    private _saveAllSettings(): void {
        this._saveSettingsSet(this.antiLinkPath, this.antiLinkGroups);
        this._saveSettingsSet(this.antiFakePath, this.antiFakeGroups);
        this._saveSettingsSet(this.antiImagePath, this.antiImageGroups);
        this._saveSettingsSet(this.antiStickerPath, this.antiStickerGroups);
        this._saveSettingsSet(this.antiVideoPath, this.antiVideoGroups);
        this._saveSettingsMap(this.warningsPath, this.warnings);
    }

    private _loadSettingsSet(filePath: string, set: Set<string>): void {
        try {
            if (fs.existsSync(filePath)) {
                const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                if (Array.isArray(data)) data.forEach(i => set.add(i));
            }
        } catch (e: any) {
            this.logger.error(`Erro ao carregar ${filePath}: ${e.message}`);
        }
    }

    private _saveSettingsSet(filePath: string, set: Set<string>): void {
        try {
            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(filePath, JSON.stringify(Array.from(set), null, 2));
        } catch (e: any) {
            this.logger.error(`Erro ao salvar ${filePath}: ${e.message}`);
        }
    }

    private _loadSettingsMap(filePath: string, map: Map<string, any>): void {
        try {
            if (fs.existsSync(filePath)) {
                const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                Object.entries(data).forEach(([k, v]) => map.set(k, v));
            }
        } catch (e: any) {
            this.logger.error(`Erro ao carregar ${filePath}: ${e.message}`);
        }
    }

    private _saveSettingsMap(filePath: string, map: Map<string, any>): void {
        try {
            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            const obj = Object.fromEntries(map);
            fs.writeFileSync(filePath, JSON.stringify(obj, null, 2));
        } catch (e: any) {
            this.logger.error(`Erro ao salvar ${filePath}: ${e.message}`);
        }
    }

    public checkLink(text: string, groupId: string, userId: string, isAdmin: boolean = false): boolean {
        if (!this.isAntiLinkActive(groupId)) return false;
        if (isAdmin) return false; // Admins podem enviar links

        // Regex robusto para links (http, www, wa.me, t.me, IPs)
        const linkRegex = /(https?:\/\/[^\s]+)|(www\.[^\s]+)|(bit\.ly\/[^\s]+)|(t\.me\/[^\s]+)|(wa\.me\/[^\s]+)|(chat\.whatsapp\.com\/[^\s]+)|(\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b)/gi;

        const hasLink = linkRegex.test(text);

        if (hasLink && this.enableDetailedLogging) {
            const timestamp = new Date().toLocaleString('pt-BR');
            const detectedLink = text.match(linkRegex)?.[0] || 'link detectado';

            this.logger.log(`\n${'═'.repeat(80)}`);
            this.logger.log(`🔗 [${timestamp}] ANTILINK - LINK DETECTADO`);
            this.logger.log(`${'─'.repeat(80)}`);
            this.logger.log(`👤 Usuário: ${userId}`);
            this.logger.log(`👥 Grupo: ${groupId}`);
            this.logger.log(`🔗 Link: ${detectedLink.substring(0, 50)}${detectedLink.length > 50 ? '...' : ''}`);
            this.logger.log(`📝 Ação: Link bloqueado (AntiLink ativo)`);
            this.logger.log(`${'═'.repeat(80)}\n`);
        }

        return hasLink;
    }


    public banUser(userId: string, reason: string = 'violação de regras', expiresIn: number | null = null): any {
        const key = String(userId);
        let expiresAt: string | number = 'PERMANENT';

        if (expiresIn) {
            expiresAt = Date.now() + expiresIn;
        }

        this.bannedUsers?.set(key, {
            reason,
            bannedAt: Date.now(),
            expiresAt
        });

        return { userId, reason, expiresAt };
    }

    public unbanUser(userId: string): boolean {
        return this.bannedUsers?.delete(String(userId)) || false;
    }

    public isBanned(userId: string): boolean {
        const key = String(userId);
        const banData = this.bannedUsers?.get(key);

        if (!banData) return false;

        if (banData.expiresAt !== 'PERMANENT' && Date.now() > banData.expiresAt) {
            this.bannedUsers?.delete(key);
            return false;
        }

        return true;
    }

    public checkSpam(userId: string): boolean {
        const now = Date.now();
        const userData = this.spamCache?.get(userId) || [];

        const filtered = userData.filter(t => (now - t) < this.SPAM_WINDOW_MS);

        if (filtered.length >= this.SPAM_THRESHOLD) {
            return true;
        }

        filtered.push(now);
        this.spamCache?.set(userId, filtered);

        // Limpeza automática
        if (this.spamCache?.size > 1000) {
            const oldestKey = this.spamCache?.keys().next().value;
            if (oldestKey) this.spamCache?.delete(oldestKey);
        }

        return false;
    }

    public clearSpamCache(): void {
        this.spamCache?.clear();
    }

    /**
    * ═══════════════════════════════════════════════════════════════════════
    * NOVO: Sistema de Blacklist com Segurança Militar
    * ═══════════════════════════════════════════════════════════════════════
    */

    /**
    * Verifica se usuário está na blacklist
    */
    public isBlacklisted(userId: string): boolean {
        const list = this.loadBlacklistDataSync();
        if (!Array.isArray(list)) return false;

        // Limpeza de JID para comparação robusta
        const cleanUserId = typeof userId === 'string' ? userId.split(':')[0] : userId;
        const found = list.find(entry => entry && (entry.id === cleanUserId || entry.id === userId));

        if (found) {
            if (found.expiresAt && found.expiresAt !== 'PERMANENT') {
                if (Date.now() > found.expiresAt) {
                    this.removeFromBlacklist(userId);
                    return false;
                }
            }
            return true;
        }

        return false;
    }

    /**
     * Registra uma tentativa de comando não autorizado e aplica punição progressiva
     */
    public recordUnauthorizedCommandAttempt(userId: string, userName: string, userNumber: string, command: string, isGroup: boolean = false): any {
        const now = Date.now();
        let userData = this.userRateLimit.get(userId) || {
            windowStart: now,
            count: 0,
            blockedUntil: 0,
            overAttempts: 0,
            penaltyStage: 0,
            blocked_at: null,
            time_blocked: null
        };

        // Uso indevido de comando VIP é tratado como spam agressivo (+10 msgs equivalentes)
        userData.count += 10;
        userData.overAttempts++;

        this._logRateLimitAttempt(
            '🚫 [COMANDO RESTRITO]',
            userId,
            userName,
            userNumber,
            `Tentou usar #${command}`,
            null,
            `Tentativa não autorizada (${userData.overAttempts}x)`,
            'Punição acelerada aplicada'
        );

        // Se passar do limite ou se já estiver bloqueado, acelera a punição
        if (userData.overAttempts >= 2) {
            // Estágio 3 direto (Blacklist 2 dias)
            const duration = 2 * 24 * 60 * 60 * 1000;
            this.addToBlacklist(userId, userName, userNumber, 'abuso_comandos_vip', duration);
            userData.penaltyStage = 3;
            this.userRateLimit.set(userId, userData);

            return {
                allowed: false,
                reason: 'AUTO_BLACKLIST_TRIGGERED',
                action: 'KICK_SILENT'
            };
        } else if (userData.overAttempts === 1) {
            // Estágio 1: Bloqueio de 1 hora (mais longo que spam comum)
            userData.blockedUntil = now + (60 * 60 * 1000);
            userData.blocked_at = now;
            userData.penaltyStage = 1;
            this.userRateLimit.set(userId, userData);

            return {
                allowed: false,
                reason: 'WARNING_RIGOROUS',
                action: 'WARN_STOP'
            };
        }

        this.userRateLimit.set(userId, userData);
        return { allowed: false, reason: 'UNAUTHORIZED_COMMAND' };
    }


    public addToBlacklist(userId: string, userName: string, userNumber: string, reason: string = 'spam', expiryMs: number | null = null): any {
        const list = this.loadBlacklistDataSync();
        const arr = Array.isArray(list) ? list : [];

        let expiresAt: string | number = 'PERMANENT';
        if (expiryMs) {
            expiresAt = Date.now() + expiryMs;
        }

        let entry = {
            id: userId,
            name: userName,
            number: userNumber,
            reason,
            addedAt: Date.now(),
            expiresAt,
            severity: reason === 'abuse' ? 'CRÍTICO' : reason === 'spam' ? 'ALTO' : 'NORMAL'
        };

        const hasPrev = arr.find(x => x && x.id === userId);

        if (hasPrev) {
            this.logger.log(`⚠️ User ${userName} reincidiu na Blacklist. Convertendo para PERMANENT.`);
            expiresAt = 'PERMANENT';
            const idx = arr.findIndex(x => x.id === userId);
            arr[idx].expiresAt = 'PERMANENT';
            arr[idx].severity = 'MAXIMO';
            arr[idx].reason = 'spam_agravado';
            entry = arr[idx];
        } else {
            arr.push(entry);
        }

        try {
            fs.writeFileSync(
                this.blacklistPath || './database/datauser/blacklist.json',
                JSON.stringify(arr, null, 2)
            );

            // LOG DETALHADO
            const timestamp = new Date().toLocaleString('pt-BR');
            const expiresStr = expiresAt === 'PERMANENT' ? 'PERMANENTE' : new Date(expiresAt).toLocaleString('pt-BR');

            this.logger.log(`\n${'═'.repeat(100)}`);
            this.logger.log(`🚫 [${timestamp}] BLACKLIST ADICIONADO - SEVERIDADE: ${entry.severity}`);
            this.logger.log(`${'─'.repeat(100)}`);
            this.logger.log(`👤 USUÁRIO`);
            this.logger.log(` ├─ Nome: ${userName}`);
            this.logger.log(` ├─ Número: ${userNumber}`);
            this.logger.log(` └─ JID: ${userId}`);
            this.logger.log(`📋 RAZÃO: ${reason}`);
            this.logger.log(`⏰ EXPIRAÇÃO: ${expiresStr}`);
            this.logger.log(`🔐 STATUS: Agora será ignorado completamente`);
            this.logger.log(`${'═'.repeat(100)}\n`);

            return { success: true, entry };
        } catch (e: any) {
            this.logger.error('Erro ao adicionar à blacklist:', e.message);
            return { success: false, message: e.message };
        }
    }

    /**
    * Remove da blacklist
    */
    public removeFromBlacklist(userId: string): boolean {
        const list = this.loadBlacklistDataSync();
        const arr = Array.isArray(list) ? list : [];
        const index = arr.findIndex(x => x && x.id === userId);

        if (index !== -1) {
            const removed = arr[index];
            arr.splice(index, 1);

            try {
                fs.writeFileSync(
                    this.blacklistPath || './database/datauser/blacklist.json',
                    JSON.stringify(arr, null, 2)
                );

                this.logger.log(`✅ [BLACKLIST] ${removed.name} (${removed.number}) removido da blacklist`);
                return true;
            } catch (e: any) {
                this.logger.error('Erro ao remover da blacklist:', e.message);
                return false;
            }
        }
        return false;
    }

    public loadBlacklistDataSync(): any[] {
        return this._loadBlacklist();
    }
}

export default ModerationSystem;
