import fs from 'fs';
import path from 'path';
import pino from 'pino';
import { JidUtils } from './JidUtils.js';
import ConfigManager from './ConfigManager.js';

export class SessionRepair {
    private logger: any;
    private config: any;
    private sock: any;

    constructor(sock: any) {
        this.sock = sock;
        this.config = ConfigManager.getInstance();
        this.logger = pino({ level: 'info' });
    }

    async repairCorruptedSession(jid: string): Promise<void> {
        try {
            const numero = JidUtils.getNumber(jid);
            const authDir = this.config.AUTH_FOLDER;
            if (!fs.existsSync(authDir)) return;

            // Log session files BEFORE delete (debug)
            const allFiles = fs.readdirSync(authDir);
            const relevantFiles = allFiles.filter(f => f.includes(`session-${numero}`) || f.includes(`sender-key-${numero}`));
            this.logger.info(`🔧 [REPAIR DEBUG] JID:${numero} | Relevant files: ${relevantFiles.join(', ') || 'none'}`);

            const files = fs.readdirSync(authDir);
            let deletedCount = 0;

            for (const file of files) {
                if (file.includes(`session-${numero}`) || file.includes(`sender-key-${numero}`)) {
                    try {
                        fs.unlinkSync(path.join(authDir, file));
                        deletedCount++;
                    } catch (err) { }
                }
            }

            if (deletedCount > 0) {
                this.logger.info(`🧹 [REPAIR] Removidos ${deletedCount} arquivos para ${numero}`);
            }

            // ✅ IN-MEMORY PURGE: Força o Baileys a esquecer a chave corrompida sem reiniciar o bot!
            if (this.sock?.authState?.keys) {
                try {
                    await this.sock.authState.keys.set({ 'session': { [jid]: null } });
                    this.logger.info(`🔥 [REPAIR] Chave de sessão do JID ${jid} expurgada da memória RAM do Baileys!`);
                } catch (cacheErr) {
                    this.logger.warn(`⚠️ [REPAIR] Aviso: Não foi possível expurgar chave da memória para ${jid}`);
                }
            }
        } catch (e: any) {
            this.logger.error(`❌ [REPAIR] Erro ao reparar sessão ${jid}: ${e.message}`);
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

    trackFailure(jid: string): number {
        // Track + return failure count (BotCore usa isso)
        // Implementação stateless - counter na memória local se necessário
        return 1;
    }
}

