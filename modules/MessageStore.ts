/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MessageStore — Substituto nativo do makeInMemoryStore (removido no Baileys ^6.7.8)
 * ═══════════════════════════════════════════════════════════════════════════
 * Replica a interface pública do store original:
 *  - store.messages[jid].array  → lista de mensagens
 *  - store.loadMessage(jid, id) → busca mensagem pelo ID
 *  - store.bind(ev)             → escuta eventos do socket
 *  - store.readFromFile(path)   → carrega do disco
 *  - store.writeToFile(path)    → persiste no disco
 * ═══════════════════════════════════════════════════════════════════════════
 */

import fs from 'fs';
import path from 'path';

const MAX_MESSAGES_PER_JID = 200; // Limite por chat para não explodir a RAM

export class MessageStore {
    // messages[jid] = { array: WAMessage[] }
    public messages: Record<string, { array: any[] }> = {};

    /**
     * Liga o store ao event emitter do socket Baileys.
     * Capta mensagens recebidas, enviadas e apagadas.
     */
    bind(ev: any): void {
        ev.on('messages.upsert', ({ messages }: { messages: any[] }) => {
            for (const msg of messages) {
                const jid: string = msg.key?.remoteJid;
                if (!jid) continue;

                if (!this.messages[jid]) {
                    this.messages[jid] = { array: [] };
                }

                const arr = this.messages[jid].array;

                // Evita duplicatas
                const exists = arr.findIndex((m: any) => m.key?.id === msg.key?.id);
                if (exists >= 0) {
                    arr[exists] = msg; // Atualiza
                } else {
                    arr.push(msg);
                    // Limita ao máximo
                    if (arr.length > MAX_MESSAGES_PER_JID) {
                        arr.splice(0, arr.length - MAX_MESSAGES_PER_JID);
                    }
                }
            }
        });

        ev.on('messages.delete', (item: any) => {
            if (item.keys) {
                for (const key of item.keys) {
                    const jid: string = key.remoteJid;
                    if (!jid || !this.messages[jid]) continue;
                    this.messages[jid].array = this.messages[jid].array.filter(
                        (m: any) => m.key?.id !== key.id
                    );
                }
            }
        });

        ev.on('messages.update', (updates: any[]) => {
            for (const update of updates) {
                const jid: string = update.key?.remoteJid;
                if (!jid || !this.messages[jid]) continue;
                const idx = this.messages[jid].array.findIndex(
                    (m: any) => m.key?.id === update.key?.id
                );
                if (idx >= 0) {
                    this.messages[jid].array[idx] = {
                        ...this.messages[jid].array[idx],
                        ...update.update
                    };
                }
            }
        });
    }

    /**
     * Busca uma mensagem pelo JID e ID (compatível com a API do store original).
     * Usado no `getMessage` do socketConfig para resolver 'Bad MAC'.
     */
    async loadMessage(jid: string, id: string): Promise<any | undefined> {
        const arr = this.messages[jid]?.array;
        if (!arr) return undefined;
        return arr.find((m: any) => m.key?.id === id);
    }

    /**
     * Lê o estado do disco (ao inicializar o bot).
     */
    readFromFile(filePath: string): void {
        try {
            if (fs.existsSync(filePath)) {
                const raw = fs.readFileSync(filePath, 'utf8');
                const data = JSON.parse(raw);
                for (const [jid, msgs] of Object.entries(data)) {
                    this.messages[jid] = { array: (msgs as any[]) };
                }
            }
        } catch (_) {
            // Ignora erros de leitura (arquivo corrompido, etc.)
        }
    }

    /**
     * Persiste o estado no disco (chamado periodicamente).
     */
    writeToFile(filePath: string): void {
        try {
            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

            // Serializa apenas os arrays
            const data: Record<string, any[]> = {};
            for (const [jid, val] of Object.entries(this.messages)) {
                data[jid] = val.array;
            }
            fs.writeFileSync(filePath, JSON.stringify(data), 'utf8');
        } catch (_) {
            // Silencia erros de escrita
        }
    }
}
