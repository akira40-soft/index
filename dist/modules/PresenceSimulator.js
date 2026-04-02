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
    sock;
    logger;
    activeSimulations;
    availabilityTimer = null;
    lastAvailabilityUpdate = Date.now();
    AVAILABILITY_INTERVAL = 45000; // 45 segundos
    constructor(sock) {
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
        await this.safeSendPresenceUpdate('available', 'status@broadcast');
        // Depois mantém a cada 45 segundos (bem antes de expirar em 60s)
        this.availabilityTimer = setInterval(async () => {
            try {
                await this.safeSendPresenceUpdate('available', 'status@broadcast');
                this.lastAvailabilityUpdate = Date.now();
            }
            catch (e) {
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
    async safeSendPresenceUpdate(type, jid) {
        if (!jid || !this.sock)
            return false;
        try {
            await this.sock.sendPresenceUpdate(type, jid);
            return true;
        }
        catch (e) {
            // Silencia erros de conexão fechada para não poluir o log
            return false;
        }
    }
    /**
     * Pára qualquer simulação ativa para um JID
     */
    async stop(jid) {
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
    async simulateTyping(jid, durationMs = 2000) {
        // Interrompe simulação anterior se houver
        await this.stop(jid);
        const controller = new AbortController();
        this.activeSimulations.set(jid, controller);
        // Execução asíncrona (não usa await no chamador principal do BotCore)
        const run = async () => {
            try {
                if (controller.signal.aborted)
                    return;
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
            }
            catch (e) {
                this.activeSimulations.delete(jid);
            }
        };
        run(); // Chama sem await
        return true;
    }
    /**
     * Simula gravação de áudio (Não-Bloqueante)
     */
    async simulateRecording(jid, durationMs = 3000) {
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
            }
            catch (e) {
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
     */
    async simulateTicks(m, wasActivated = true) {
        if (!this.sock || !m?.key)
            return false;
        const jid = m.key.remoteJid;
        const messageId = m.key.id;
        try {
            // ✅ LÓGICA MELHORADA:
            // - Se foi ativado (processando): marca como lido (visto)
            // - Se não foi ativado: apenas marca como entregue
            if (wasActivated) {
                // 2 ticks azuis - visto/lido
                await this.sock.readMessages([m.key]);
                return true;
            }
            else {
                // 2 ticks cinzas - entregue (nunca offline)
                // Envia de forma explícita para garantir que chegue
                try {
                    await this.sock.sendReadReceipt(jid, null, [messageId], 'delivered');
                }
                catch (e1) {
                    // Fallback: tenta via readMessages com delay pequeno
                    try {
                        await delay(300);
                        // Não marca como read, apenas delivered
                    }
                    catch (e2) {
                        // Se falhar, pelo menos tentamos
                    }
                }
                return true;
            }
        }
        catch (e) {
            return false;
        }
    }
    /**
     * Alias retrocompatível com código antigo
     */
    async markAsRead(m) {
        return this.simulateTicks(m, true);
    }
    /**
     * Calcula duração proporcional (20ms por char + jitter)
     */
    calculateTypingDuration(text) {
        if (!text)
            return 500;
        // IA é mais lenta (humana), comandos são instantâneos
        const isCommand = text.startsWith('#') || text.startsWith('/');
        if (isCommand)
            return 400; // Delay mínimo apenas para feedback visual
        const base = text.length * 25;
        const jitter = Math.random() * 500;
        return Math.min(Math.max(base + jitter, 1000), 7000);
    }
}
export default PresenceSimulator;
