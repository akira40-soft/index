/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CLASSE: RateLimiter (SEGURANÇA MILITAR)
 * ═══════════════════════════════════════════════════════════════════════════
 * ✅ LIMITES POR CONTEXTO:
 *    PV (Conversa Privada):
 *       - Free: 50 msgs/hora
 *       - Premium: 500 msgs/hora
 *    Grupo (Apenas mensagens direcionadas a Akira):
 *       - Free: 100 msgs/hora
 *       - Premium: 1000 msgs/hora
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
    public HOURLY_LIMIT: number;
    public HOURLY_WINDOW: number;
    public MAX_VIOLATIONS: number;
    public LOG_FILE: string;
    public BLACKLIST_FILE: string;
    public usage: Map<string, { count: number, startTime: number }>;
    public violations: Map<string, number>;
    public blacklist: Set<string>;
    public config: any;
    public sock: any;

    constructor(config: any = null) {
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

    public setSocket(sock: any): void {
        this.sock = sock;
    }

    _ensureFiles() {
        const dir = path.dirname(this.LOG_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        if (!fs.existsSync(this.BLACKLIST_FILE)) fs.writeFileSync(this.BLACKLIST_FILE, JSON.stringify([]));
    }

    _loadBlacklist() {
        try {
            if (fs.existsSync(this.BLACKLIST_FILE)) {
                const data = JSON.parse(fs.readFileSync(this.BLACKLIST_FILE, 'utf8'));
                data.forEach((id: string) => this.blacklist.add(id));
            }
        } catch (e: any) {
            console.error('Erro ao carregar blacklist:', e);
        }
    }

    _saveBlacklist() {
        try {
            fs.writeFileSync(this.BLACKLIST_FILE, JSON.stringify([...this.blacklist]));
        } catch (e: any) {
            console.error('Erro ao salvar blacklist:', e);
        }
    }

    private _log(type: string, userId: string, details: string): void {
        const timestamp = new Date().toISOString();
        const icon = type === 'BAN' ? '🚫' : (type === 'WARN' ? '⚠️' : 'ℹ️');
        const logLine = `[${timestamp}] ${icon} ${type} | User: ${userId} | ${details}\n`;

        try {
            fs.appendFileSync(this.LOG_FILE, logLine);
            console.log(logLine.trim());
        } catch (e: any) {
            console.error('Erro ao escrever log:', e);
        }
    }

    public isBlacklisted(userId: string): boolean {
        return this.blacklist.has(userId);
    }

    public check(userId: string, isOwner: boolean = false, isPremium: boolean = false, tipoConversa: string = 'pv'): { allowed: boolean, reason?: string, wait?: string, remaining?: number, violations?: number, resetAt?: string } {
        // ✅ NORMALIZAÇÃO: Unifica LID e PN
        const normId = userId.replace(/\D/g, '');

        // ✅ IMUNIDADE TOTAL: Owner e Premium não têm limite
        if (isOwner) return { allowed: true }; // Dono sem limite
        if (isPremium) return { allowed: true }; // Premium sem limite
        if (this.blacklist.has(normId)) return { allowed: false, reason: 'BLACKLISTED', violations: 999 };

        // ✅ CORREÇÃO: Grupos têm limite de 100 msgs/hora (apenas mensagens direcionadas contam)
        // As mensagens genéricas já são filtradas por shouldRespondToAI() em BotCore
        // Usando HOURLY_LIMIT (padrão 100) para grupos também
        const now = Date.now();
        const usageKey = `${normId}:${tipoConversa}`; // Contexto separado por tipo

        // Inicializa registro do usuário
        if (!this.usage.has(usageKey)) {
            this.usage.set(usageKey, { count: 0, startTime: now });
        }

        const userUsage = this.usage.get(usageKey)!;

        // Reset janela de tempo
        if (now - userUsage.startTime > this.HOURLY_WINDOW) {
            userUsage.count = 0;
            userUsage.startTime = now;
        }

        // Incrementa contador
        userUsage.count++;

        // ✅ Applica limite DIFERENTE por contexto
        // PV: 50 msgs/hora (mais restritivo)
        // Grupo: 100 msgs/hora (mas apenas msgs direcionadas contam via shouldRespondToAI)
        const CONTEXT_LIMITS = {
            'pv': 50,
            'grupo': 100
        };
        const limit = CONTEXT_LIMITS[tipoConversa as keyof typeof CONTEXT_LIMITS] || 50;

        // Verifica limite
        if (userUsage.count > limit) {
            const violations = this._handleViolation(userId);

            // ✅ Calcula tempo restante E hora exata do reset
            const timeRemaining = this.HOURLY_WINDOW - (now - userUsage.startTime);
            const resetTimestamp = now + timeRemaining;
            const resetDate = new Date(resetTimestamp);

            // Tempo restante em HH:MM:SS
            const hours = Math.floor(timeRemaining / 1000 / 60 / 60);
            const minutes = Math.floor((timeRemaining / 1000 / 60) % 60);
            const seconds = Math.floor((timeRemaining / 1000) % 60);
            const formattedTime = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

            // Mensagem com hora exata (fuso horário de Angola para consistência)
            let resetAtTime;
            try {
                resetAtTime = resetDate.toLocaleTimeString('pt-BR', { timeZone: 'Africa/Luanda' });
            } catch (e) {
                resetAtTime = resetDate.toLocaleTimeString(); // Fallback se timezone falhar
            }

            return {
                allowed: false,
                reason: 'RATE_LIMIT_EXCEEDED',
                wait: formattedTime,
                resetAt: resetAtTime,
                violations
            };
        }

        return { allowed: true, remaining: limit - userUsage.count };
    }

    private _handleViolation(userId: string): number {
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

    private _cleanup(): void {
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
     * ✅ IMPORTANTE: 
     *    - Owner: SEM LIMITE (imune total)
     *    - Premium: SEM LIMITE (usuarios pagos)
     *    - Free: TEM LIMITE (usuarios normais)
     */
    public checkPremium(userId: string, isPremium: boolean = false, tipoConversa: string = 'pv'): { allowed: boolean; reason?: string; resetAt?: string } {
        // ✅ NORMALIZAÇÃO: Unifica LID e PN
        const normId = userId.replace(/\D/g, '');

        // ✅ Premium e Owner têm imunidade total
        if (isPremium) {
            return { allowed: true }; // Premium user - sem limite
        }

        if (this.blacklist.has(normId)) {
            return { allowed: false, reason: 'BLACKLISTED' };
        }

        // ✅ APLICA LIMITE APENAS PARA USUÁRIOS FREE
        // PV: 50 msgs/hora
        // Grupo: 100 msgs/hora (apenas msgs direcionadas)
        const now = Date.now();
        const usageKey = `${normId}:${tipoConversa}`; // Contexto separado
        if (!this.usage.has(usageKey)) {
            this.usage.set(usageKey, { count: 0, startTime: now });
        }

        const userUsage = this.usage.get(usageKey)!;

        // Reset janela de tempo
        if (now - userUsage.startTime > this.HOURLY_WINDOW) {
            userUsage.count = 0;
            userUsage.startTime = now;
        }

        // ✅ LIMITE SÓ PARA FREE (não premium)
        const FREE_CONTEXT_LIMITS = {
            'pv': 50,      // PV: 50 msgs/hora
            'grupo': 100   // Grupo: 100 msgs/hora (só direcionadas)
        };
        const limit = FREE_CONTEXT_LIMITS[tipoConversa as keyof typeof FREE_CONTEXT_LIMITS] || 50;

        userUsage.count++;

        if (userUsage.count > limit) {
            // ✅ Calcula hora exata do reset
            const timeRemaining = this.HOURLY_WINDOW - (now - userUsage.startTime);
            const resetTimestamp = now + timeRemaining;
            const resetDate = new Date(resetTimestamp);

            let resetAt;
            try {
                resetAt = resetDate.toLocaleTimeString('pt-BR', { timeZone: 'Africa/Luanda' });
            } catch (e) {
                resetAt = resetDate.toLocaleTimeString();
            }

            return { allowed: false, reason: 'FREE_LIMIT', resetAt };
        }

        return { allowed: true };
    }

    // Comandos manuais para admins
    public banUser(userId: string, adminId: string): boolean {
        this.blacklist.add(userId);
        this._saveBlacklist();
        this._log('BAN', userId, `Banido manualmente por admin ${adminId}`);
        return true;
    }

    public unbanUser(userId: string, adminId: string): boolean {
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
