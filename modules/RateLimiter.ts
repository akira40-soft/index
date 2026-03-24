/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CLASSE: RateLimiter (SEGURANÇA MODERNA)
 * ═══════════════════════════════════════════════════════════════════════════
 * ✅ Limite PV: 50 mensagens/hora
 * ✅ Limite Grupo: 100 mensagens/hora
 * ✅ Avisos progressivos (1º: Info, 2º: Bravo, 3º: Último)
 * ✅ Blacklist automática na 4ª tentativa
 * ✅ Contagem apenas para interações diretas com o bot
 * ═══════════════════════════════════════════════════════════════════════════
 */

import fs from 'fs';
import { promises as fsPromises } from 'fs';
import path from 'path';

class RateLimiter {
    public PV_LIMIT: number;
    public GROUP_LIMIT: number;
    public HOURLY_WINDOW: number;
    public MAX_VIOLATIONS: number;
    public LOG_FILE: string;
    public BLACKLIST_FILE: string;

    // Rastreio de uso: Map<userId, { pv: {count, startTime}, group: {count, startTime} }>
    public usage: Map<string, {
        pv: { count: number, startTime: number },
        group: { count: number, startTime: number }
    }>;

    // Rastreio de violações (avisos enviados): Map<userId, { pv: number, group: number }>
    public violations: Map<string, { pv: number, group: number }>;

    public blacklist: Set<string>;

    constructor(config: any = {}) {
        this.PV_LIMIT = config.pvLimit || 50;
        this.GROUP_LIMIT = config.groupLimit || 100;
        this.HOURLY_WINDOW = 60 * 60 * 1000; // 1 hora
        this.MAX_VIOLATIONS = 3; // 3 avisos, 4º é ban

        const basePath = process.env.DATA_DIR || './data';
        this.LOG_FILE = path.join(basePath, 'security_log.txt');
        this.BLACKLIST_FILE = path.join(basePath, 'blacklist.json');

        this.usage = new Map();
        this.violations = new Map();
        this.blacklist = new Set();

        this.init().catch(err => console.error('Erro RateLimiter:', err));
        setInterval(() => this._cleanup(), 10 * 60 * 1000);
    }

    async init() {
        await this._ensureFiles();
        await this._loadBlacklist();
    }

    private async _ensureFiles() {
        try {
            const dir = path.dirname(this.LOG_FILE);
            if (!fs.existsSync(dir)) await fsPromises.mkdir(dir, { recursive: true });
            if (!fs.existsSync(this.BLACKLIST_FILE)) await fsPromises.writeFile(this.BLACKLIST_FILE, JSON.stringify([]));
        } catch (e: any) {
            console.error('Erro ficheiros RateLimiter:', e.message);
        }
    }

    private async _loadBlacklist() {
        try {
            if (fs.existsSync(this.BLACKLIST_FILE)) {
                const content = await fsPromises.readFile(this.BLACKLIST_FILE, 'utf8');
                const data = JSON.parse(content);
                data.forEach((id: string) => this.blacklist.add(id));
            }
        } catch (e) { }
    }

    private async _saveBlacklist() {
        try {
            await fsPromises.writeFile(this.BLACKLIST_FILE, JSON.stringify([...this.blacklist]));
        } catch (e) { }
    }

    private async _log(type: string, userId: string, details: string): Promise<void> {
        const logLine = `[${new Date().toISOString()}] ${type} | ${userId} | ${details}\n`;
        try {
            await fsPromises.appendFile(this.LOG_FILE, logLine);
        } catch (e) { }
    }

    public isBlacklisted(userId: string): boolean {
        return this.blacklist.has(userId);
    }

    /**
     * Verifica o limite de mensagens.
     * @param userId JID do usuário
     * @param isGroup Se a mensagem veio de um grupo
     * @param isOwner Se o usuário é o dono (ignora limites)
     * @param userName Nome do usuário para os avisos
     */
    public check(userId: string, isGroup: boolean, isOwner: boolean = false, userName: string = 'usuário'): {
        allowed: boolean,
        message?: string,
        reason?: string
    } {
        if (isOwner) return { allowed: true };
        if (this.blacklist.has(userId)) return { allowed: false, reason: 'BLACKLISTED' };

        const now = Date.now();
        const type = isGroup ? 'group' : 'pv';
        const limit = isGroup ? this.GROUP_LIMIT : this.PV_LIMIT;

        // Inicializa uso
        if (!this.usage.has(userId)) {
            this.usage.set(userId, {
                pv: { count: 0, startTime: now },
                group: { count: 0, startTime: now }
            });
        }
        const userUsage = this.usage.get(userId)![type];

        // Reset janela
        if (now - userUsage.startTime > this.HOURLY_WINDOW) {
            userUsage.count = 0;
            userUsage.startTime = now;
            // Reseta violações daquela categoria também ao resetar a hora? 
            // O usuário disse "só deve enviar 3 msg de passar do rate limiti". 
            // Vamos manter as violações até o ban ou reset manual para ser rigoroso.
        }

        userUsage.count++;

        if (userUsage.count > limit) {
            return this._getViolationResponse(userId, type, userUsage.startTime, userName, limit);
        }

        return { allowed: true };
    }

    private _getViolationResponse(userId: string, type: 'pv' | 'group', startTime: number, userName: string, limit: number): { allowed: boolean, message: string } {
        if (!this.violations.has(userId)) {
            this.violations.set(userId, { pv: 0, group: 0 });
        }
        const v = this.violations.get(userId)!;
        v[type]++;

        const nextReset = new Date(startTime + this.HOURLY_WINDOW).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

        let msg = '';
        if (v[type] === 1) {
            msg = `⚠️ *Aviso 1:* Você excedeu o limite de mensagens no ${type.toUpperCase()}.\nO limite é de *${limit}* mensagens por hora.\nPor favor, aguarde até às *${nextReset}* para usar a Akira novamente.`;
        } else if (v[type] === 2) {
            msg = `😡 *Aviso 2:* Pare de mandar msg e aguarda caralho, ${userName.split(' ')[0]}!\nSeja paciente e aguarde até às *${nextReset}* ou vou te bloquear permanentemente.`;
        } else if (v[type] === 3) {
            msg = `🖕 *ÚLTIMO AVISO:* Vai a merda! Manda novamente que serás bloqueado agora mesmo.`;
        } else {
            // 4ª tentativa ou mais
            this.blacklist.add(userId);
            this._saveBlacklist().catch(() => { });
            this._log('BAN', userId, `Blacklist automática após ${v[type]} violações no ${type}`);
            return { allowed: false, message: '🚫 *BLOQUEADO:* Você foi adicionado à minha blacklist por insistência. Adeus.' };
        }

        this._log('WARN', userId, `Violação ${v[type]}/3 no ${type} (Limite ${limit})`);
        return { allowed: false, message: msg };
    }

    private _cleanup(): void {
        const now = Date.now();
        for (const [userId, data] of this.usage.entries()) {
            if (now - data.pv.startTime > this.HOURLY_WINDOW && now - data.group.startTime > this.HOURLY_WINDOW) {
                this.usage.delete(userId);
            }
        }
    }

    public async unbanUser(userId: string): Promise<boolean> {
        if (this.blacklist.delete(userId)) {
            await this._saveBlacklist();
            this.violations.delete(userId);
            this.usage.delete(userId);
            return true;
        }
        return false;
    }
}

export default RateLimiter;
