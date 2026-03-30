/**
 * ═══════════════════════════════════════════════════════════════════════
 * PRESENCE SIMULATOR - AKIRA BOT V21 (REACTIVE EDITION)
 * ═══════════════════════════════════════════════════════════════════════
 * ✅ Simulações hiper-realistas de presença
 * ✅ Não-bloqueante: Não trava o fluxo de resposta do bot
 * ✅ Sincronizado: Pára de digitar IMEDIATAMENTE ao enviar msg
 * ═══════════════════════════════════════════════════════════════════════
 */

import { delay } from '@whiskeysockets/baileys';

class PresenceSimulator {
    public sock: any;
    public logger: any;
    private activeSimulations: Map<string, AbortController>;

    constructor(sock: any) {
        this.sock = sock;
        this.logger = console;
        this.activeSimulations = new Map();
    }

    /**
     * Envia atualização de presença de forma segura
     */
    async safeSendPresenceUpdate(type: 'composing' | 'recording' | 'paused' | 'available', jid: string) {
        if (!jid || !this.sock) return false;
        try {
            await this.sock.sendPresenceUpdate(type, jid);
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
     * Simula leitura e ticks de confirmação
     */
    async simulateTicks(m: any, wasActivated: boolean = true) {
        if (!this.sock || !m?.key) return false;

        const jid = m.key.remoteJid;
        const participant = m.key.participant;
        const messageId = m.key.id;

        try {
            if (wasActivated) {
                await this.sock.readMessages([m.key]);
            } else {
                await this.sock.sendReadReceipt(jid, participant, [messageId], 'delivered');
            }
            return true;
        } catch (e) {
            return false;
        }
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
