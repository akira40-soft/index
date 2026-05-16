/**
 * ═══════════════════════════════════════════════════════════════════════
 * SafeSessionRepair.ts — Reparo Cirúrgico de Sessão
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Estratégia CIRÚRGICA (NÃO apaga creds.json):
 *  - Apaga session-{jid}.json   → chave de sessão específica do remetente
 *  - Apaga sender-keys-{jid}.*  → chave de grupo corrompida
 *  - Protege creds.json         → mantém login ativo (sem forçar logout)
 *
 * Threshold de segurança:
 *  - Máximo 3 reparos por JID em 10 minutos → previne loop infinito
 *
 * Compatível com: Baileys v6+ e auth_info_baileys (multiFileAuth)
 * ═══════════════════════════════════════════════════════════════════════
 */

import fs from 'fs';
import path from 'path';

interface RepairAttempt {
    count: number;
    firstAttemptAt: number;
}

export class SafeSessionRepair {
    private readonly authFolder: string;
    private readonly logger: any;

    // Threshold: máx 3 reparos por JID dentro de 10 minutos
    private readonly MAX_REPAIRS_PER_JID = 3;
    private readonly REPAIR_WINDOW_MS = 10 * 60 * 1000; // 10 min

    // Rastreamento de tentativas: { jid -> { count, firstAttemptAt } }
    private repairAttempts: Map<string, RepairAttempt> = new Map();

    constructor(authFolder: string, logger: any) {
        this.authFolder = authFolder;
        this.logger = logger;
    }

    /**
     * Tenta reparar a sessão de um JID específico apagando os arquivos
     * de chave corrompidos, sem tocar em creds.json.
     *
     * @param jid - O JID do remetente com Bad MAC (ex: "244912345@s.whatsapp.net")
     * @returns true se reparou, false se atingiu o threshold (loop detectado)
     */
    public async repair(jid: string): Promise<boolean> {
        const normalizedJid = this._normalizeJidForFilename(jid);

        // === THRESHOLD CHECK ===
        if (this._isThresholdExceeded(jid)) {
            this.logger.error(
                `🛑 [SESSION REPAIR] Threshold atingido para ${jid}. ` +
                `Máx ${this.MAX_REPAIRS_PER_JID} reparos/${this.REPAIR_WINDOW_MS / 60000}min. ` +
                `Abortando para prevenir loop infinito.`
            );
            return false;
        }

        // === VERIFICAÇÃO DA PASTA ===
        if (!fs.existsSync(this.authFolder)) {
            this.logger.warn(`⚠️ [SESSION REPAIR] Pasta de auth não encontrada: ${this.authFolder}`);
            return false;
        }

        // === APAGAR ARQUIVOS ESPECÍFICOS DO JID ===
        const deletedFiles: string[] = [];
        const protectedFiles = ['creds.json', 'creds.json.bak'];

        try {
            const allFiles = fs.readdirSync(this.authFolder);

            for (const filename of allFiles) {
                // NUNCA apagar creds.json
                if (protectedFiles.includes(filename)) {
                    continue;
                }

                const shouldDelete = this._fileCorrespondsToJid(filename, normalizedJid);
                if (shouldDelete) {
                    const fullPath = path.join(this.authFolder, filename);
                    try {
                        fs.unlinkSync(fullPath);
                        deletedFiles.push(filename);
                        this.logger.info(`🗑️ [SESSION REPAIR] Apagado: ${filename}`);
                    } catch (unlinkErr: any) {
                        this.logger.warn(`⚠️ [SESSION REPAIR] Não foi possível apagar ${filename}: ${unlinkErr.message}`);
                    }
                }
            }
        } catch (readErr: any) {
            this.logger.error(`❌ [SESSION REPAIR] Erro ao ler pasta de auth: ${readErr.message}`);
            return false;
        }

        // === REGISTRAR TENTATIVA ===
        this._recordAttempt(jid);

        if (deletedFiles.length > 0) {
            this.logger.info(
                `✅ [SESSION REPAIR] Reparo cirúrgico concluído para ${jid}. ` +
                `${deletedFiles.length} arquivo(s) removido(s). ` +
                `creds.json PROTEGIDO. ` +
                `Tentativa ${this._getAttemptCount(jid)}/${this.MAX_REPAIRS_PER_JID}`
            );
        } else {
            this.logger.info(
                `ℹ️ [SESSION REPAIR] Nenhum arquivo de sessão encontrado para ${jid}. ` +
                `O Baileys reconstruirá as chaves automaticamente.`
            );
        }

        return true;
    }

    /**
     * Verifica se o arquivo corresponde ao JID dado.
     * Padrões conhecidos do Baileys multiFileAuth:
     *  - session-{jid}.json
     *  - sender-key-{jid}.json
     *  - app-state-sync-key-{jid}.json
     */
    private _fileCorrespondsToJid(filename: string, normalizedJid: string): boolean {
        // Normaliza o JID para comparação (remove @ e substitui por _)
        const jidInFile = normalizedJid.replace('@', '_').replace(/\./g, '_');

        const patterns = [
            `session-${normalizedJid}.json`,
            `session-${jidInFile}.json`,
            `sender-key-${normalizedJid}.json`,
            `sender-key-${jidInFile}.json`,
            `app-state-sync-key-${normalizedJid}`,
            `app-state-sync-key-${jidInFile}`,
            // Padrão alternativo do Baileys: pre-key-{number}
        ];

        // Verificação exata
        if (patterns.includes(filename)) return true;

        // Verificação por prefixo+JID (caso o Baileys use variações)
        const lowerFile = filename.toLowerCase();
        const lowerJid = normalizedJid.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (lowerFile.includes(lowerJid) && (
            lowerFile.startsWith('session-') ||
            lowerFile.startsWith('sender-key-') ||
            lowerFile.startsWith('app-state-sync-key-')
        )) {
            return true;
        }

        return false;
    }

    /**
     * Normaliza um JID para uso em nome de arquivo.
     * Ex: "244912345678@s.whatsapp.net" → "244912345678@s.whatsapp.net"
     *     "1234567890-1234567890@g.us"  → "1234567890-1234567890@g.us"
     */
    private _normalizeJidForFilename(jid: string): string {
        // Remove o sufixo de dispositivo (:0, :1, etc.) se presente
        return jid.replace(/:\d+@/, '@');
    }

    /**
     * Verifica se o threshold de reparos foi atingido para este JID.
     */
    private _isThresholdExceeded(jid: string): boolean {
        const attempt = this.repairAttempts.get(jid);
        if (!attempt) return false;

        const now = Date.now();
        const windowExpired = now - attempt.firstAttemptAt > this.REPAIR_WINDOW_MS;

        if (windowExpired) {
            // Janela expirou — reset
            this.repairAttempts.delete(jid);
            return false;
        }

        return attempt.count >= this.MAX_REPAIRS_PER_JID;
    }

    /**
     * Regista uma tentativa de reparo para o JID.
     */
    private _recordAttempt(jid: string): void {
        const now = Date.now();
        const existing = this.repairAttempts.get(jid);

        if (!existing || now - existing.firstAttemptAt > this.REPAIR_WINDOW_MS) {
            this.repairAttempts.set(jid, { count: 1, firstAttemptAt: now });
        } else {
            existing.count++;
        }
    }

    /**
     * Retorna o número de tentativas actuais para um JID.
     */
    private _getAttemptCount(jid: string): number {
        return this.repairAttempts.get(jid)?.count ?? 0;
    }

    /**
     * Limpa o registo de tentativas de um JID (usado após reconexão bem-sucedida).
     */
    public clearAttempts(jid: string): void {
        this.repairAttempts.delete(jid);
        this.logger.debug(`🔄 [SESSION REPAIR] Tentativas limpas para ${jid}`);
    }

    /**
     * Retorna o estado de todos os JIDs em período de threshold.
     */
    public getRepairStatus(): Record<string, RepairAttempt> {
        const result: Record<string, RepairAttempt> = {};
        const now = Date.now();
        for (const [jid, attempt] of this.repairAttempts) {
            if (now - attempt.firstAttemptAt <= this.REPAIR_WINDOW_MS) {
                result[jid] = attempt;
            }
        }
        return result;
    }
}

export default SafeSessionRepair;
