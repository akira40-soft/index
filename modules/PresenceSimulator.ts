/**
 * ═══════════════════════════════════════════════════════════════════════
 * PRESENCE SIMULATOR - AKIRA BOT V21 (REACTIVE EDITION)
 * ═══════════════════════════════════════════════════════════════════════
 * ✅ Simulações hiper-realistas de presença
 * ✅ Não-bloqueante: Não trava o fluxo de resposta do bot
 * ✅ Sincronizado: Pára de digitar IMEDIATAMENTE ao enviar msg
 * ✅ SEMPRE DISPONÍVEL: Nunca fica offline completamente
 * ═══════════════════════════════════════════════════════════════════════
 */

import { delay } from '@whiskeysockets/baileys';

class PresenceSimulator {
    public sock: any;
    public logger: any;
    private activeSimulations: Map<string, AbortController>;
    private availabilityTimer: ReturnType<typeof setInterval> | null = null;
    private lastAvailabilityUpdate: number = Date.now();
    private readonly AVAILABILITY_INTERVAL: number = 45000; // 45 segundos

    constructor(sock: any) {
        this.sock = sock;
        this.logger = console;
        this.activeSimulations = new Map();
    }

    /**
     * ✅ NOVA FUNÇÃO: Mantém o bot sempre em status "available"
     * Previne que o bot apareça como offline ao ficar inativo
     */
    async maintainAvailablePresence() {
        if (this.availabilityTimer) {
            clearInterval(this.availabilityTimer);
        }

        // Envia inicial imediatamente
        await this.safeSendPresenceUpdate('available');

        // Depois mantém a cada 45 segundos (bem antes de expirar em 60s)
        this.availabilityTimer = setInterval(async () => {
            try {
                await this.safeSendPresenceUpdate('available');
                this.lastAvailabilityUpdate = Date.now();
            } catch (e) {
                // Silencia - não é crítico se falhar
            }
        }, this.AVAILABILITY_INTERVAL);
    }

    /**
     * Para de manter presença disponível (ex: desconexão)
     */
    stopMaintainingPresence() {
        if (this.availabilityTimer) {
            clearInterval(this.availabilityTimer);
            this.availabilityTimer = null;
        }
    }

    /**
     * Envia atualização de presença de forma segura
     */
    async safeSendPresenceUpdate(type: 'composing' | 'recording' | 'paused' | 'available', jid?: string) {
        if (!this.sock) return false;
        try {
            if (jid) {
                await this.sock.sendPresenceUpdate(type, jid);
            } else {
                await this.sock.sendPresenceUpdate(type);
            }
            return true;
        } catch (e: any) {
            // Silencia erros de conexão fechada para não poluir o log
            return false;
        }
    }

    /**
     * Pára qualquer simulação ativa para um JID
     */
    async stop(jid: string) {
        const controller = this.activeSimulations.get(jid);
        if (controller) {
            controller.abort();
            this.activeSimulations.delete(jid);
        }
        await this.safeSendPresenceUpdate('paused', jid);
    }

    /**
     * Simula digitação hiper-realista (Não-Bloqueante)
     */
    async simulateTyping(jid: string, durationMs: number = 2000) {
        // Interrompe simulação anterior se houver
        await this.stop(jid);

        const controller = new AbortController();
        this.activeSimulations.set(jid, controller);

        // Execução asíncrona (não usa await no chamador principal do BotCore)
        const run = async () => {
            try {
                if (controller.signal.aborted) return;

                await this.safeSendPresenceUpdate('composing', jid);

                // Divisão em pequenos blocos para permitir cancelamento rápido
                const step = 200;
                let elapsed = 0;
                while (elapsed < durationMs && !controller.signal.aborted) {
                    await delay(step);
                    elapsed += step;
                }

                if (!controller.signal.aborted) {
                    await this.stop(jid);
                }
            } catch (e) {
                this.activeSimulations.delete(jid);
            }
        };

        run(); // Chama sem await
        return true;
    }

    /**
     * Simula gravação de áudio (Não-Bloqueante)
     */
    async simulateRecording(jid: string, durationMs: number = 3000) {
        await this.stop(jid);

        const controller = new AbortController();
        this.activeSimulations.set(jid, controller);

        const run = async () => {
            try {
                await this.safeSendPresenceUpdate('recording', jid);

                const step = 200;
                let elapsed = 0;
                while (elapsed < durationMs && !controller.signal.aborted) {
                    await delay(step);
                    elapsed += step;
                }

                if (!controller.signal.aborted) {
                    await this.stop(jid);
                }
            } catch (e) {
                this.activeSimulations.delete(jid);
            }
        };

        run();
        return true;
    }

    /**
     * ✅ MELHORADA: Simula leitura e ticks de confirmação
     * - wasActivated = false: Envia "delivered" (2 ticks cinzas)
     * - wasActivated = true: Envia "read" (2 ticks azuis)
     * - isGroup: Ajusta sintaxe para grupos vs PV
     */
    async simulateTicks(m: any, wasActivated: boolean = true, isGroup: boolean = false) {
        if (!this.sock || !m?.key) return false;

        const jid = m.key.remoteJid;
        const messageId = m.key.id;
        const participant = m.key.participant;

        try {
            // ✅ LÓGICA MELHORADA:
            // - Se foi ativado (processando): marca como lido (visto) = 2 ticks azuis
            // - Se não foi ativado: apenas marca como entregue = 2 ticks cinzas
            if (wasActivated) {
                // ✅ 2 ticks azuis - visto/lido (READ - marcado como lido)
                try {
                    await this.sock.readMessages([m.key]);
                    return true;
                } catch (e) {
                    // Fallback: se não conseguir marcar como lido, pelo menos tenta delivered
                    try {
                        await this.sock.sendReadReceipt(jid, null, [messageId], 'received');
                    } catch (e2) {
                        // Último fallback silencioso
                    }
                    return false;
                }
            } else {
                // ✅ 2 ticks cinzas - ENTREGUE (RECEIVED - recebido mas não lido)
                // Enviar "received" manualmente costuma causar conflitos na bailey.
                // O Multi-device já envia recibos de entrega automaticamente, deixamos quieto para não bugar.
                return true;
            }
        } catch (e) {
            return false;
        }
    }

    /**
     * Alias retrocompatível com código antigo
     */
    async markAsRead(m: any, isGroup: boolean = false) {
        return this.simulateTicks(m, true, isGroup);
    }

    /**
     * Calcula duração proporcional (20ms por char + jitter)
     */
    calculateTypingDuration(text: string): number {
        if (!text) return 500;
        // IA é mais lenta (humana), comandos são instantâneos
        const isCommand = text.startsWith('#') || text.startsWith('/');
        if (isCommand) return 400; // Delay mínimo apenas para feedback visual

        const base = text.length * 25;
        const jitter = Math.random() * 500;
        return Math.min(Math.max(base + jitter, 1000), 7000);
    }
}

export default PresenceSimulator;
