import fs from 'fs';
import path from 'path';
import pino from 'pino';
import { JidUtils } from './JidUtils.js';
import ConfigManager from './ConfigManager.js';

export class SessionRepair {
    private logger: any;
    private config: any;
    private sock: any;

    // NEW: Failure tracking
    private failureCounts: Map<string, number> = new Map();
    private readonly MAX_FAILURES_AUTO = 3;
    private readonly MAX_FAILURES_NUCLEAR = 5;
    private readonly PERSIST_FILE = path.join(ConfigManager.getInstance().DATABASE_FOLDER, 'session_failures.json');

    constructor(sock: any) {
        this.sock = sock;
        this.config = ConfigManager.getInstance();
        this.logger = pino({ level: 'info' });
        this.loadFailureCounts();
    }

    private loadFailureCounts() {
        try {
            if (fs.existsSync(this.PERSIST_FILE)) {
                const data = JSON.parse(fs.readFileSync(this.PERSIST_FILE, 'utf8'));
                this.failureCounts = new Map(Object.entries(data));
                this.logger.info(`📊 Loaded ${this.failureCounts.size} session failure counts`);
            }
        } catch (e: any) {
            this.logger.warn(`⚠️ Failed to load failure counts: ${e.message}`);
        }
    }

    private saveFailureCounts() {
        try {
            const data: any = {};
            this.failureCounts.forEach((count, jid) => data[jid] = count);
            fs.writeFileSync(this.PERSIST_FILE, JSON.stringify(data, null, 2));
        } catch (e: any) {
            this.logger.error(`❌ Failed to save failure counts: ${e.message}`);
        }
    }

    // Track failure and return count
    trackSessionFailures(jid: string): number {
        const numero = JidUtils.getNumber(jid);
        const key = numero || jid;
        const current = this.failureCounts.get(key) || 0;
        const newCount = current + 1;
        this.failureCounts.set(key, newCount);
        this.saveFailureCounts();
        this.logger.warn(`⚠️ [FAILURE TRACK] ${jid} (${numero}) → ${newCount} failures`);
        return newCount;
    }

    // Auto repair trigger
    async autoRepair(jid: string): Promise<boolean> {
        const count = this.failureCounts.get(JidUtils.getNumber(jid) || jid) || 0;
        this.logger.info(`🔧 [AUTO REPAIR] Triggered for ${jid} (failures: ${count})`);
        
        await this.repairCorruptedSession(jid);
        await this.forceSignalSync(jid);
        
        // Reset counter on success
        if (count >= this.MAX_FAILURES_AUTO) {
            this.failureCounts.delete(JidUtils.getNumber(jid) || jid);
            this.saveFailureCounts();
        }
        return true;
    }

    // Nuclear reset for critical failures
    async nuclearReset(jid: string): Promise<void> {
        const numero = JidUtils.getNumber(jid);
        this.logger.error(`💥 [NUCLEAR RESET] Critical failure → Full reset for ${jid} (${numero})`);
        
        // Delete ALL files for this JID
        const authDir = this.config.AUTH_FOLDER;
        if (fs.existsSync(authDir)) {
            const files = fs.readdirSync(authDir);
            let deleted = 0;
            for (const file of files) {
                if (file.includes(numero) || file.includes(jid.split('@')[0])) {
                    fs.unlinkSync(path.join(authDir, file));
                    deleted++;
                }
            }
            this.logger.info(`🧹 [NUCLEAR] Deleted ${deleted} files`);
        }
        
        // In-memory purge
        if (this.sock?.authState?.keys) {
            await this.sock.authState.keys.set({ 'session': { [jid]: null } });
        }
        
        // Notify owner
        const ownerJid = `${this.config.BOT_NUMERO_REAL}@s.whatsapp.net`;
        await this.sock?.sendMessage(ownerJid, {
            text: `🔥 *NUCLEAR RESET*\n👤 ${numero}\nSessão corrompida resetada após 5+ Bad MAC. Nova sessão iniciada.`
        }).catch(() => {});
        
        // Reset counter
        this.failureCounts.delete(JidUtils.getNumber(jid) || jid);
        this.saveFailureCounts();
    }

    async repairCorruptedSession(jid: string): Promise<void> {
        try {
            const numero = JidUtils.getNumber(jid);
            const authDir = this.config.AUTH_FOLDER;
            if (!fs.existsSync(authDir)) return;

            // Log BEFORE repair
            const allFiles = fs.readdirSync(authDir);
            const relevantFiles = allFiles.filter(f => 
                f.includes(`session-${numero}`) || 
                f.includes(`sender-key-${numero}`) ||
                f.includes(`app-state-${numero}`)
            );
            this.logger.info(`🔧 [REPAIR] ${jid} | Files: ${relevantFiles.join(', ') || 'none'}`);

            // ✅ RE-ENABLED: Safe targeted deletion (only corrupted files)
            const files = fs.readdirSync(authDir);
            let deletedCount = 0;
            for (const file of files) {
                if (file.includes(`session-${numero}`) || 
                    file.includes(`sender-key-${numero}`) ||
                    file.includes(`app-state-${numero}`)) {
                    try {
                        fs.unlinkSync(path.join(authDir, file));
                        deletedCount++;
                    } catch (err: any) {
                        this.logger.debug(`Skip delete ${file}: ${err.message}`);
                    }
                }
            }

            this.logger.info(`🧹 [REPAIR] Deleted ${deletedCount} files for ${numero}`);

            // In-memory purge
            if (this.sock?.authState?.keys) {
                try {
                    await this.sock.authState.keys.set({ 'session': { [jid]: null }, 'app-state-sync-key': { [jid]: null } });
                    this.logger.info(`🔥 [REPAIR] Purged memory keys for ${jid}`);
                } catch (cacheErr: any) {
                    this.logger.warn(`⚠️ Memory purge failed for ${jid}: ${cacheErr.message}`);
                }
            }
        } catch (e: any) {
            this.logger.error(`❌ [REPAIR] Error ${jid}: ${e.message}`);
        }
    }

    async forceSignalSync(jid: string): Promise<void> {
        try {
            if (!this.sock) return;
            const numero = JidUtils.getNumber(jid);

            this.logger.info(`🔄 [SIGNAL SYNC] Forçando sincronização para ${numero}`);
            await this.sock.onWhatsApp(jid).catch(() => { });
            await this.sock.profilePictureUrl(jid, 'image').catch(() => { });
            this.logger.info(`✅ [SIGNAL SYNC] Executado para ${numero}`);
        } catch (e: any) {
            this.logger.warn(`⚠️ [SIGNAL SYNC] Falha para ${jid}: ${e.message}`);
        }
    }

    async forcePVReset(numero: string, jid: string): Promise<void> {
        try {
            this.logger.warn(`💥 [PV RESET NUCLEAR] Reset total para ${numero}`);
            const authDir = this.config.AUTH_FOLDER;
            if (fs.existsSync(authDir)) {
                const files = fs.readdirSync(authDir);
                let totalPurged = 0;
                for (const file of files) {
                    if (file.includes(numero) || file.includes(jid.split('@')[0])) {
                        fs.unlinkSync(path.join(authDir, file));
                        totalPurged++;
                    }
                }
                this.logger.info(`🧹 [NUCLEAR] Purgados ${totalPurged} arquivos`);
            }

            // Notify owner
            const ownerJid = `${this.config.BOT_NUMERO_REAL}@s.whatsapp.net`;
            await this.sock?.sendMessage(ownerJid, {
                text: `🔥 *PV RESET NUCLEAR*\n👤 ${numero}\nNova sessão iniciada.`
            }).catch(() => { });

            this.logger.success(`✅ [PV RESET] Completo para ${numero}`);
        } catch (e: any) {
            this.logger.error(`❌ [PV RESET] Erro: ${e.message}`);
        }
    }

    // Get failure count (public API for BotCore)
    getFailureCount(jid: string): number {
        return this.failureCounts.get(JidUtils.getNumber(jid) || jid) || 0;
    }

    // Clear specific JID (manual reset)
    clearFailures(jid: string): void {
        const key = JidUtils.getNumber(jid) || jid;
        this.failureCounts.delete(key);
        this.saveFailureCounts();
        this.logger.info(`🧹 Cleared failures for ${jid}`);
    }

    // Stats
    getStats(): { totalJids: number; maxFailures: number } {
        const max = Math.max(...Array.from(this.failureCounts.values()), 0);
        return { totalJids: this.failureCounts.size, maxFailures: max };
    }
}

