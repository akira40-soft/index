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
    config;
    logger;
    blacklistPath;
    mutedUsers;
    antiLinkGroups;
    antiLinkPath;
    muteCounts;
    bannedUsers;
    spamCache;
    userRateLimit;
    hourlyLimit;
    hourlyWindow;
    blockDuration;
    maxAttemptsBeforeBlacklist;
    warnings;
    antiFakeGroups;
    antiImageGroups;
    antiStickerGroups;
    warningsPath;
    antiFakePath;
    antiImagePath;
    antiStickerPath;
    HOURLY_LIMIT;
    HOURLY_WINDOW_MS;
    SPAM_THRESHOLD;
    SPAM_WINDOW_MS;
    enableDetailedLogging;
    qrTimeout;
    sock;
    constructor(logger = null) {
        this.config = ConfigManager.getInstance();
        this.logger = logger || console;
        // Usar DATABASE_FOLDER do ConfigManager para persistência local
        const basePath = this.config.DATABASE_FOLDER || './database';
        this.blacklistPath = path.join(basePath, 'datauser', 'blacklist.json');
        // ═══ ESTRUTURAS DE DADOS ═══
        this.mutedUsers = new Map(); // {groupId_userId} -> {expires, mutedAt, minutes}
        this.antiLinkGroups = new Set(); // groupIds com anti-link ativo
        this.antiLinkPath = path.join(basePath, 'data', 'antilink.json');
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
        // Persistência
        this.warningsPath = path.join(basePath, 'data', 'warnings.json');
        this.antiFakePath = path.join(basePath, 'data', 'antifake.json');
        this.antiImagePath = path.join(basePath, 'data', 'antiimage.json');
        this.antiStickerPath = path.join(basePath, 'data', 'antisticker.json');
        this._loadAllSettings();
        // ═══ CONSTANTES ANTIGAS ═══
        this.HOURLY_LIMIT = 300;
        this.HOURLY_WINDOW_MS = 60 * 60 * 1000;
        this.SPAM_THRESHOLD = 3;
        this.SPAM_WINDOW_MS = 3000;
        // ═══ LOG DETALHADO ═══
        this.enableDetailedLogging = true;
    }
    setSocket(sock) {
        this.sock = sock;
    }
    // ═══════════════════════════════════════════════════════════════════════
    // BLACKLIST (PERSISTENTE)
    // ═══════════════════════════════════════════════════════════════════════
    _loadBlacklist() {
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
        }
        catch (error) {
            this.logger.error(`❌ Erro ao ler blacklist: ${error.message}`);
            return [];
        }
    }
    _saveBlacklist(list) {
        try {
            const dir = path.dirname(this.blacklistPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.blacklistPath, JSON.stringify(list, null, 2));
        }
        catch (error) {
            this.logger.error(`❌ Erro ao salvar blacklist: ${error.message}`);
        }
    }
    // Métodos iniciais de blacklist removidos (unificados no final do arquivo)
    // ═══════════════════════════════════════════════════════════════════════
    // SISTEMA DE MUTE (EM MEMÓRIA)
    // ═══════════════════════════════════════════════════════════════════════
    isMuted(groupId, userId) {
        if (!groupId || !userId)
            return false;
        const key = `${groupId}_${userId}`;
        const muteData = this.mutedUsers.get(key);
        if (!muteData)
            return false;
        if (Date.now() > muteData.expires) {
            this.mutedUsers.delete(key);
            this.logger.info(`🔊 Mute expirado para ${userId} no grupo ${groupId}`);
            return false;
        }
        return true;
    }
    muteUser(groupId, userId, minutes = 5) {
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
    unmuteUser(groupId, userId) {
        const key = `${groupId}_${userId}`;
        const wasMuted = this.mutedUsers.has(key);
        this.mutedUsers.delete(key);
        if (wasMuted) {
            this.logger.info(`🔊 Usuário ${userId} desmutado manualmente no grupo ${groupId}`);
        }
        return wasMuted;
    }
    /**
    * ═══════════════════════════════════════════════════════════════════════
    * NOVO: Sistema de Rate Limiting com Logs Detalhados
    * ═══════════════════════════════════════════════════════════════════════
    */
    checkAndLimitHourlyMessages(userId, userName, userNumber, messageText, quotedMessage = null, ehDono = false) {
        // DONO JAMAIS É LIMITADO
        if (ehDono) {
            return { allowed: true, reason: 'DONO_ISENTO' };
        }
        const now = Date.now();
        let userData = this.userRateLimit?.get(userId) || {
            windowStart: now,
            count: 0,
            blockedUntil: 0,
            overAttempts: 0,
            warnings: 0,
            blocked_at: null,
            blocked_by_warning: false
        };
        // ═══ VERIFICA SE BLOQUEIO AINDA ESTÁ ATIVO ═══
        if (userData.blockedUntil && now < userData.blockedUntil) {
            userData.overAttempts++;
            const timePassedMs = now - (userData.blocked_at || now);
            const timePassedSec = Math.floor(timePassedMs / 1000);
            const timeRemainingMs = userData.blockedUntil - now;
            const timeRemainingSec = Math.ceil(timeRemainingMs / 1000);
            const blockExpireTime = new Date(userData.blockedUntil).toLocaleTimeString('pt-BR');
            this._logRateLimitAttempt('BLOQUEADO_REINCIDÊNCIA', userId, userName, userNumber, messageText, quotedMessage, `Tentativa ${userData.overAttempts}/${this.maxAttemptsBeforeBlacklist}`, `Passou: ${timePassedSec}s | Falta: ${timeRemainingSec}s | Desbloqueio: ${blockExpireTime}`);
            // AUTO-BLACKLIST APÓS MÚLTIPLAS TENTATIVAS
            if (userData.overAttempts >= this.maxAttemptsBeforeBlacklist) {
                this._logRateLimitAttempt('🚨 AUTO-BLACKLIST ACIONADO', userId, userName, userNumber, messageText, quotedMessage, `MÚLTIPLAS REINCIDÊNCIAS (${userData.overAttempts})`, 'USUÁRIO ADICIONADO À BLACKLIST PERMANENTE');
                this.userRateLimit?.set(userId, userData);
                return {
                    allowed: false,
                    reason: 'AUTO_BLACKLIST_TRIGGERED',
                    overAttempts: userData.overAttempts,
                    action: 'ADD_TO_BLACKLIST'
                };
            }
            this.userRateLimit?.set(userId, userData);
            return {
                allowed: false,
                reason: 'BLOQUEADO_REINCIDÊNCIA',
                timePassedSec,
                timeRemainingSec,
                blockExpireTime,
                overAttempts: userData.overAttempts
            };
        }
        // ═══ RESETA JANELA SE EXPIROU ═══
        if (now - userData.windowStart >= this.hourlyWindow) {
            userData.windowStart = now;
            userData.count = 0;
            userData.blockedUntil = 0;
            userData.overAttempts = 0;
            userData.warnings = 0;
            userData.blocked_at = null;
            userData.blocked_by_warning = false;
        }
        // ═══ INCREMENTA CONTADOR ═══
        userData.count++;
        // ═══ VERIFICA SE PASSOU DO LIMITE ═══
        if (userData.count > this.hourlyLimit) {
            userData.blockedUntil = now + this.blockDuration;
            userData.blocked_at = now;
            userData.blocked_by_warning = true;
            userData.warnings++;
            this._logRateLimitAttempt('⚠️ LIMITE EXCEDIDO', userId, userName, userNumber, messageText, quotedMessage, `Mensagens: ${userData.count}/${this.hourlyLimit}`, `Bloqueado por 1 hora`);
            this.userRateLimit?.set(userId, userData);
            return {
                allowed: false,
                reason: 'LIMITE_HORARIO_EXCEDIDO',
                messagesCount: userData.count,
                limit: this.hourlyLimit,
                blockDurationMinutes: 60
            };
        }
        // ═══ AVISO DE PROXIMIDADE DO LIMITE ═══
        const percentualUso = (userData.count / this.hourlyLimit) * 100;
        if (percentualUso >= 80 && userData.count > 0) {
            this._logRateLimitAttempt('⚡ AVISO: PROXIMIDADE DO LIMITE', userId, userName, userNumber, messageText, quotedMessage, `${userData.count}/${this.hourlyLimit} (${percentualUso.toFixed(1)}%)`, `Faltam ${this.hourlyLimit - userData.count} mensagens`);
        }
        this.userRateLimit?.set(userId, userData);
        return {
            allowed: true,
            reason: 'OK',
            messagesCount: userData.count,
            limit: this.hourlyLimit,
            percentualUso
        };
    }
    /**
    * ═══════════════════════════════════════════════════════════════════════
    * NOVO: Sistema de Logging Detalhado em Terminal
    * ═══════════════════════════════════════════════════════════════════════
    */
    _logRateLimitAttempt(status, userId, userName, userNumber, messageText, quotedMessage, details, action) {
        if (!this.enableDetailedLogging)
            return;
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
    getHourlyLimitStatus(userId) {
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
    incrementMuteCount(groupId, userId) {
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
    getMuteCount(groupId, userId) {
        const key = `${groupId}_${userId}`;
        const today = new Date().toDateString();
        const countData = this.muteCounts?.get(key);
        if (!countData || countData.lastMuteDate !== today) {
            return 0;
        }
        return countData.count || 0;
    }
    _loadAntiLinkSettings() {
        try {
            if (!fs.existsSync(this.antiLinkPath)) {
                const dir = path.dirname(this.antiLinkPath);
                if (!fs.existsSync(dir))
                    fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(this.antiLinkPath, JSON.stringify([]));
                return;
            }
            const data = fs.readFileSync(this.antiLinkPath, 'utf8');
            const groups = JSON.parse(data);
            if (Array.isArray(groups)) {
                groups.forEach(g => this.antiLinkGroups.add(g));
            }
        }
        catch (e) {
            this.logger.error(`❌ Erro ao carregar AntiLink: ${e.message}`);
        }
    }
    _saveAntiLinkSettings() {
        try {
            const groups = Array.from(this.antiLinkGroups);
            const dir = path.dirname(this.antiLinkPath);
            if (!fs.existsSync(dir))
                fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(this.antiLinkPath, JSON.stringify(groups, null, 2));
        }
        catch (e) {
            this.logger.error(`❌ Erro ao salvar AntiLink: ${e.message}`);
        }
    }
    toggleAntiLink(groupId, enable = true) {
        if (enable) {
            this.antiLinkGroups.add(groupId);
        }
        else {
            this.antiLinkGroups.delete(groupId);
        }
        this._saveAntiLinkSettings();
        return enable;
    }
    isAntiLinkActive(groupId) {
        return this.antiLinkGroups.has(groupId);
    }
    // ═══ SISTEMA DE AVISOS ═══
    addWarning(groupId, userId, reason = 'No reason') {
        const key = `${groupId}_${userId}`;
        const data = this.warnings.get(key) || { count: 0, reasons: [] };
        data.count++;
        data.reasons.push(reason);
        this.warnings.set(key, data);
        this._saveAllSettings();
        return data.count;
    }
    getWarnings(groupId, userId) {
        const key = `${groupId}_${userId}`;
        return this.warnings.get(key) || { count: 0, reasons: [] };
    }
    resetWarnings(groupId, userId) {
        const key = `${groupId}_${userId}`;
        this.warnings.delete(key);
        this._saveAllSettings();
    }
    // ═══ ANTI-FAKE (+244) ═══
    toggleAntiFake(groupId, enable = true) {
        if (enable)
            this.antiFakeGroups.add(groupId);
        else
            this.antiFakeGroups.delete(groupId);
        this._saveAllSettings();
        return enable;
    }
    isAntiFakeActive(groupId) {
        return this.antiFakeGroups.has(groupId);
    }
    isFakeNumber(userId) {
        // Formato esperado: 244XXXXXXXXX@s.whatsapp.net
        return !userId.startsWith('244');
    }
    toggleAntiImage(groupId, enable = true) {
        if (enable)
            this.antiImageGroups.add(groupId);
        else
            this.antiImageGroups.delete(groupId);
        this._saveAllSettings();
        return enable;
    }
    isAntiImageActive(groupId) {
        return this.antiImageGroups.has(groupId);
    }
    toggleAntiSticker(groupId, enable = true) {
        if (enable)
            this.antiStickerGroups.add(groupId);
        else
            this.antiStickerGroups.delete(groupId);
        this._saveAllSettings();
        return enable;
    }
    isAntiStickerActive(groupId) {
        return this.antiStickerGroups.has(groupId);
    }
    _loadAllSettings() {
        this._loadSettingsSet(this.antiLinkPath, this.antiLinkGroups);
        this._loadSettingsSet(this.antiFakePath, this.antiFakeGroups);
        this._loadSettingsSet(this.antiImagePath, this.antiImageGroups);
        this._loadSettingsSet(this.antiStickerPath, this.antiStickerGroups);
        this._loadSettingsMap(this.warningsPath, this.warnings);
    }
    _saveAllSettings() {
        this._saveSettingsSet(this.antiLinkPath, this.antiLinkGroups);
        this._saveSettingsSet(this.antiFakePath, this.antiFakeGroups);
        this._saveSettingsSet(this.antiImagePath, this.antiImageGroups);
        this._saveSettingsSet(this.antiStickerPath, this.antiStickerGroups);
        this._saveSettingsMap(this.warningsPath, this.warnings);
    }
    _loadSettingsSet(filePath, set) {
        try {
            if (fs.existsSync(filePath)) {
                const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                if (Array.isArray(data))
                    data.forEach(i => set.add(i));
            }
        }
        catch (e) {
            this.logger.error(`Erro ao carregar ${filePath}: ${e.message}`);
        }
    }
    _saveSettingsSet(filePath, set) {
        try {
            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir))
                fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(filePath, JSON.stringify(Array.from(set), null, 2));
        }
        catch (e) {
            this.logger.error(`Erro ao salvar ${filePath}: ${e.message}`);
        }
    }
    _loadSettingsMap(filePath, map) {
        try {
            if (fs.existsSync(filePath)) {
                const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                Object.entries(data).forEach(([k, v]) => map.set(k, v));
            }
        }
        catch (e) {
            this.logger.error(`Erro ao carregar ${filePath}: ${e.message}`);
        }
    }
    _saveSettingsMap(filePath, map) {
        try {
            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir))
                fs.mkdirSync(dir, { recursive: true });
            const obj = Object.fromEntries(map);
            fs.writeFileSync(filePath, JSON.stringify(obj, null, 2));
        }
        catch (e) {
            this.logger.error(`Erro ao salvar ${filePath}: ${e.message}`);
        }
    }
    checkLink(text, groupId, userId, isAdmin = false) {
        if (!this.isAntiLinkActive(groupId))
            return false;
        if (isAdmin)
            return false; // Admins podem enviar links
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
    banUser(userId, reason = 'violação de regras', expiresIn = null) {
        const key = String(userId);
        let expiresAt = 'PERMANENT';
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
    unbanUser(userId) {
        return this.bannedUsers?.delete(String(userId)) || false;
    }
    isBanned(userId) {
        const key = String(userId);
        const banData = this.bannedUsers?.get(key);
        if (!banData)
            return false;
        if (banData.expiresAt !== 'PERMANENT' && Date.now() > banData.expiresAt) {
            this.bannedUsers?.delete(key);
            return false;
        }
        return true;
    }
    checkSpam(userId) {
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
            if (oldestKey)
                this.spamCache?.delete(oldestKey);
        }
        return false;
    }
    clearSpamCache() {
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
    isBlacklisted(userId) {
        const list = this.loadBlacklistDataSync();
        if (!Array.isArray(list))
            return false;
        const found = list.find(entry => entry && entry.id === userId);
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
    addToBlacklist(userId, userName, userNumber, reason = 'spam', expiryMs = null) {
        const list = this.loadBlacklistDataSync();
        const arr = Array.isArray(list) ? list : [];
        if (arr.find(x => x && x.id === userId)) {
            return { success: false, message: 'Já estava na blacklist' };
        }
        let expiresAt = 'PERMANENT';
        if (expiryMs) {
            expiresAt = Date.now() + expiryMs;
        }
        const entry = {
            id: userId,
            name: userName,
            number: userNumber,
            reason,
            addedAt: Date.now(),
            expiresAt,
            severity: reason === 'abuse' ? 'CRÍTICO' : reason === 'spam' ? 'ALTO' : 'NORMAL'
        };
        arr.push(entry);
        try {
            fs.writeFileSync(this.blacklistPath || './database/datauser/blacklist.json', JSON.stringify(arr, null, 2));
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
        }
        catch (e) {
            this.logger.error('Erro ao adicionar à blacklist:', e.message);
            return { success: false, message: e.message };
        }
    }
    /**
    * Remove da blacklist
    */
    removeFromBlacklist(userId) {
        const list = this.loadBlacklistDataSync();
        const arr = Array.isArray(list) ? list : [];
        const index = arr.findIndex(x => x && x.id === userId);
        if (index !== -1) {
            const removed = arr[index];
            arr.splice(index, 1);
            try {
                fs.writeFileSync(this.blacklistPath || './database/datauser/blacklist.json', JSON.stringify(arr, null, 2));
                this.logger.log(`✅ [BLACKLIST] ${removed.name} (${removed.number}) removido da blacklist`);
                return true;
            }
            catch (e) {
                this.logger.error('Erro ao remover da blacklist:', e.message);
                return false;
            }
        }
        return false;
    }
    /**
    * Carrega dados da blacklist
    */
    loadBlacklistDataSync() {
        try {
            const filePath = this.blacklistPath || './database/datauser/blacklist.json';
            if (!fs.existsSync(filePath)) {
                return [];
            }
            const data = fs.readFileSync(filePath, 'utf8');
            if (!data || !data.trim()) {
                return [];
            }
            return JSON.parse(data);
        }
        catch (e) {
            this.logger.error('Erro ao carregar blacklist:', e.message);
            return [];
        }
    }
    getStats() {
        const blacklist = this.loadBlacklistDataSync();
        return {
            mutedUsers: this.mutedUsers?.size || 0,
            bannedUsers: this.bannedUsers?.size || 0,
            antiLinkGroups: this.antiLinkGroups?.size || 0,
            spamCacheSize: this.spamCache?.size || 0,
            hourlyBlockedUsers: Array.from(this.userRateLimit?.entries() || []).filter(([_, data]) => data.blockedUntil > Date.now()).length,
            blacklistedUsers: blacklist?.length || 0
        };
    }
    reset() {
        this.mutedUsers?.clear();
        this.antiLinkGroups?.clear();
        this.muteCounts?.clear();
        this.bannedUsers?.clear();
        this.spamCache?.clear();
        this.userRateLimit?.clear();
        this.logger?.info('🔄 Sistema de moderação resetado');
    }
    /**
    * Retorna um relatório formatado da blacklist
    */
    getBlacklistReport() {
        const list = this.loadBlacklistDataSync();
        if (!Array.isArray(list) || list.length === 0) {
            return '🕳️ *A Blacklist está vazia.*';
        }
        let report = `🚫 *RELATÓRIO DE BLACKLIST (${list.length})*\n\n`;
        list.slice(0, 15).forEach((entry, i) => {
            const date = new Date(entry.addedAt).toLocaleDateString('pt-BR');
            const expires = entry.expiresAt === 'PERMANENT' ? 'Permanente' : new Date(entry.expiresAt).toLocaleDateString('pt-BR');
            report += `${i + 1}. *${entry.name}* (${entry.number})\n`;
            report += `   └ Razão: ${entry.reason} | Expira: ${expires}\n`;
        });
        if (list.length > 15) {
            report += `\n_...e mais ${list.length - 15} registros._`;
        }
        return report;
    }
    /**
    * Retorna um relatório formatado de usuários silenciados (mute)
    */
    getMutedReport(currentGroupJid) {
        const now = Date.now();
        const groupMutes = [];
        this.mutedUsers.forEach((data, key) => {
            const [groupId, userId] = key.split('_');
            if (groupId === currentGroupJid && data.expires > now) {
                groupMutes.push({ userId, ...data });
            }
        });
        if (groupMutes.length === 0) {
            return '🔊 *Ninguém está silenciado neste grupo.*';
        }
        let report = `🔇 *USUÁRIOS SILENCIADOS NESTE GRUPO (${groupMutes.length})*\n\n`;
        groupMutes.forEach((m, i) => {
            const timeLeft = Math.ceil((m.expires - now) / 60000);
            report += `${i + 1}. @${m.userId.split('@')[0]} — ${timeLeft} min restantes\n`;
        });
        return report;
    }
}
export default ModerationSystem;
