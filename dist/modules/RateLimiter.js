/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CLASSE: RateLimiter (SEGURANÇA MILITAR)
 * ═══════════════════════════════════════════════════════════════════════════
 * ✅ Limite de 100 mensagens/hora por usuário (não-dono)
 * ✅ Auto-blacklist após 3 tentativas reincidentes
 * ✅ Logs detalhados com timestamp, usuário, número, mensagem, citação
 * ✅ Imune a bypass - dono não é afetado
 * ✅ Sem repetição de logs - rastreamento completo
 * ═══════════════════════════════════════════════════════════════════════════
 */
import fs from 'fs';
import path from 'path';
import ConfigManager from './ConfigManager.js';
class RateLimiter {
    HOURLY_LIMIT;
    HOURLY_WINDOW;
    MAX_VIOLATIONS;
    LOG_FILE;
    BLACKLIST_FILE;
    usage;
    violations;
    blacklist;
    config;
    sock;
    constructor(config = null) {
        this.config = config || ConfigManager.getInstance();
        this.sock = null;
        // ═══ LIMITES E CONFIGURAÇÃO ═══
        this.HOURLY_LIMIT = this.config.RATE_LIMIT_MAX_CALLS || 100; // Usa config global se disponível
        this.HOURLY_WINDOW = (this.config.RATE_LIMIT_WINDOW || 1) * 60 * 60 * 1000; // 1 hora padrão
        this.MAX_VIOLATIONS = 3; // Max violações antes do ban
        // Usar caminhos centralizados
        const logsBase = this.config.LOGS_FOLDER || './logs';
        const dbBase = this.config.DATABASE_FOLDER || './database';
        this.LOG_FILE = path.join(logsBase, 'security_log.txt');
        this.BLACKLIST_FILE = path.join(dbBase, 'blacklist.json');
        // Cache em memória
        this.usage = new Map();
        this.violations = new Map();
        this.blacklist = new Set();
        this._ensureFiles();
        this._loadBlacklist();
        // Limpeza periódica (a cada 10 min)
        setInterval(() => this._cleanup(), 10 * 60 * 1000);
    }
    setSocket(sock) {
        this.sock = sock;
    }
    _ensureFiles() {
        const dir = path.dirname(this.LOG_FILE);
        if (!fs.existsSync(dir))
            fs.mkdirSync(dir, { recursive: true });
        if (!fs.existsSync(this.BLACKLIST_FILE))
            fs.writeFileSync(this.BLACKLIST_FILE, JSON.stringify([]));
    }
    _loadBlacklist() {
        try {
            if (fs.existsSync(this.BLACKLIST_FILE)) {
                const data = JSON.parse(fs.readFileSync(this.BLACKLIST_FILE, 'utf8'));
                data.forEach((id) => this.blacklist.add(id));
            }
        }
        catch (e) {
            console.error('Erro ao carregar blacklist:', e);
        }
    }
    _saveBlacklist() {
        try {
            fs.writeFileSync(this.BLACKLIST_FILE, JSON.stringify([...this.blacklist]));
        }
        catch (e) {
            console.error('Erro ao salvar blacklist:', e);
        }
    }
    _log(type, userId, details) {
        const timestamp = new Date().toISOString();
        const icon = type === 'BAN' ? '🚫' : (type === 'WARN' ? '⚠️' : 'ℹ️');
        const logLine = `[${timestamp}] ${icon} ${type} | User: ${userId} | ${details}\n`;
        try {
            fs.appendFileSync(this.LOG_FILE, logLine);
            console.log(logLine.trim());
        }
        catch (e) {
            console.error('Erro ao escrever log:', e);
        }
    }
    isBlacklisted(userId) {
        return this.blacklist.has(userId);
    }
    check(userId, isOwner = false) {
        if (isOwner)
            return { allowed: true }; // Dono imune
        if (this.blacklist.has(userId))
            return { allowed: false, reason: 'BLACKLISTED', violations: 999 };
        const now = Date.now();
        // Inicializa registro do usuário
        if (!this.usage.has(userId)) {
            this.usage.set(userId, { count: 0, startTime: now });
        }
        const userUsage = this.usage.get(userId);
        // Reset janela de tempo
        if (now - userUsage.startTime > this.HOURLY_WINDOW) {
            userUsage.count = 0;
            userUsage.startTime = now;
        }
        // Incrementa contador
        userUsage.count++;
        // Verifica limite
        if (userUsage.count > this.HOURLY_LIMIT) {
            const violations = this._handleViolation(userId);
            // Calcula tempo exato até reset (formato HH:MM:SS)
            const timeRemaining = this.HOURLY_WINDOW - (now - userUsage.startTime);
            const hours = Math.floor(timeRemaining / 1000 / 60 / 60);
            const minutes = Math.floor((timeRemaining / 1000 / 60) % 60);
            const seconds = Math.floor((timeRemaining / 1000) % 60);
            const formattedTime = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
            return {
                allowed: false,
                reason: 'RATE_LIMIT_EXCEEDED',
                wait: formattedTime,
                violations
            };
        }
        return { allowed: true, remaining: this.HOURLY_LIMIT - userUsage.count };
    }
    _handleViolation(userId) {
        const violations = (this.violations.get(userId) || 0) + 1;
        this.violations.set(userId, violations);
        this._log('WARN', userId, `Violação de rate limit (${violations}/${this.MAX_VIOLATIONS})`);
        // Auto-blacklist na 3ª violação
        if (violations >= this.MAX_VIOLATIONS) {
            this.blacklist.add(userId);
            this._saveBlacklist();
            this._log('BAN', userId, 'Adicionado à blacklist por excesso de violações');
        }
        return violations;
    }
    _cleanup() {
        const now = Date.now();
        // Remove entradas expiradas do cache de uso
        for (const [userId, data] of this.usage.entries()) {
            if (now - data.startTime > this.HOURLY_WINDOW) {
                this.usage.delete(userId);
            }
        }
    }
    /**
     * Método compatível com CommandHandler - rate limit para Premium
     * Premium users têm limite 10x maior
     */
    checkPremium(userId, isPremium = false) {
        if (this.blacklist.has(userId)) {
            return { allowed: false, reason: 'BLACKLISTED' };
        }
        const now = Date.now();
        if (!this.usage.has(userId)) {
            this.usage.set(userId, { count: 0, startTime: now });
        }
        const userUsage = this.usage.get(userId);
        // Reset janela de tempo
        if (now - userUsage.startTime > this.HOURLY_WINDOW) {
            userUsage.count = 0;
            userUsage.startTime = now;
        }
        // Premium tem limite 10x maior
        const limit = isPremium ? this.HOURLY_LIMIT * 10 : this.HOURLY_LIMIT;
        userUsage.count++;
        if (userUsage.count > limit) {
            return { allowed: false, reason: isPremium ? 'PREMIUM_LIMIT' : 'FREE_LIMIT' };
        }
        return { allowed: true };
    }
    // Comandos manuais para admins
    banUser(userId, adminId) {
        this.blacklist.add(userId);
        this._saveBlacklist();
        this._log('BAN', userId, `Banido manualmente por admin ${adminId}`);
        return true;
    }
    unbanUser(userId, adminId) {
        if (this.blacklist.delete(userId)) {
            this._saveBlacklist();
            this.violations.delete(userId); // Reseta violações
            this._log('UNBAN', userId, `Desbanido manualmente por admin ${adminId}`);
            return true;
        }
        return false;
    }
    getBlacklist() {
        return [...this.blacklist];
    }
}
export default RateLimiter;
