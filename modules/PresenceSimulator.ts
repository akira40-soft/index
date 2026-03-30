/**
 * ═══════════════════════════════════════════════════════════════════════
 * PRESENCE SIMULATOR - AKIRA BOT V21
 * ═══════════════════════════════════════════════════════════════════════
 * ✅ Simulações realistas de presença e status de mensagem
 * ✅ Digitação, gravação de áudio, ticks, leitura
 * ✅ Totalmente compatível com Baileys
 * ═══════════════════════════════════════════════════════════════════════
 */

import { delay } from '@whiskeysockets/baileys';

class PresenceSimulator {
    public sock: any;
    public logger: any;

    constructor(sock: any) {
        this.sock = sock;
        this.logger = console;
    }

    /**
     * Aguarda a conexão ficar estável (OPEN) por um tempo limitado
     */
    async waitForConnection(timeoutMs: number = 2000) {
        if (this.sock?.ws?.readyState === 1) return true;

        const startTime = Date.now();
        while (Date.now() - startTime < timeoutMs) {
            if (this.sock?.ws?.readyState === 1) return true;
            await new Promise(r => setTimeout(r, 200));
        }
        return false;
    }

    /**
     * Envia atualização de presença de forma segura, verificando se o socket está ativo
     */
    async safeSendPresenceUpdate(type: any, jid: string) {
        if (!jid || !this.sock) return false;

        const maxRetries = 2;
        for (let i = 0; i < maxRetries; i++) {
            try {
                // Verifica se o socket está realmente aberto (readyState 1 = OPEN)
                if (this.sock?.ws?.readyState !== 1) {
                    this.logger.warn(`⚠️ [PRESENCE] Socket não está OPEN (Estado: ${this.sock?.ws?.readyState})`);
                    return false;
                }

                await this.sock.sendPresenceUpdate(type, jid);
                return true;
            } catch (e: any) {
                this.logger.warn(`⚠️ [PRESENCE] Tentativa ${i + 1} falhou para ${jid}: ${e.message}`);
                if (i < maxRetries - 1) await delay(1000);
            }
        }
        return false;
    }

    /**
     * Simula digitação realista
     * - Inicia presença como "disponível"
     * - Muda para "digitando"
     * - Aguarda tempo proporcional ao tamanho da resposta
     * - Volta para "pausado"
     * - Retorna para "disponível"
     */
    async simulateTyping(jid: string, durationMs: number = 3000) {
        try {
            // Step 1: Garantir que está online
            await this.safeSendPresenceUpdate('available', jid);
            await delay(300);

            // Step 2: Começar a digitar
            await this.safeSendPresenceUpdate('composing', jid);
            this.logger.log(`⌨️  [DIGITANDO] Simulando digitação por ${(durationMs / 1000).toFixed(1)}s...`);

            // Step 3: Aguardar conforme tamanho da mensagem
            await delay(durationMs);

            // Step 4: Parar de digitar (transição)
            await this.safeSendPresenceUpdate('paused', jid);
            await delay(300);

            // Step 5: Voltar ao normal
            await this.safeSendPresenceUpdate('available', jid);
            this.logger.log('✅ [PRONTO] Digitação simulada concluída');

            return true;
        } catch (e: any) {
            this.logger.error('❌ Erro inesperado ao simular digitação:', e.message);
            return false;
        }
    }

    /**
     * Simula gravação de áudio realista
     * - Muda para "gravando"
     * - Aguarda duração
     * - Volta para "pausado"
     */
    async simulateRecording(jid: string, durationMs: number = 2000) {
        try {
            this.logger.log(`🎤 [GRAVANDO] Preparando áudio por ${(durationMs / 1000).toFixed(1)}s...`);

            // Step 1: Começar a "gravar"
            await this.safeSendPresenceUpdate('recording', jid);

            // Step 2: Aguardar processamento
            await delay(durationMs);

            // Step 3: Concluir gravação
            await this.safeSendPresenceUpdate('paused', jid);

            this.logger.log('✅ [PRONTO] Áudio preparado para envio');

            return true;
        } catch (e: any) {
            this.logger.error('❌ Erro inesperado ao simular gravação:', e.message);
            return false;
        }
    }

    /**
     * Simula envio de "ticks" (confirmações de entrega/leitura)
     * 
     * Em grupos:
     *   - Sem ativação: Um tick (entregue)
     *   - Com ativação: Dois ticks azuis (lido)
     * 
     * Em PV:
     *   - Sem ativação: Um tick (entregue)
     *   - Com ativação: Dois ticks azuis (lido)
     */
    async simulateTicks(m: any, wasActivated: boolean = true, isAudio: boolean = false) {
        try {
            // REMOVIDO: Verificação de socket bloqueante
            if (!this.sock) return false;

            const isGroup = String(m.key.remoteJid || '').endsWith('@g.us');
            const jid = m.key.remoteJid;
            const participant = m.key.participant;
            const messageId = m.key.id;

            if (isGroup) {
                // ═══ GRUPO ═══
                if (!wasActivated) {
                    // Não foi ativada: Apenas um tick (entregue)
                    try {
                        // EXPLICITAR 'delivered' PARA 2 TICKS CINZAS
                        await this.sock.sendReadReceipt(jid, participant, [messageId], 'delivered');
                        this.logger.log('✓✓ [ENTREGUE] Grupo');
                        return true;
                    } catch (err) {
                        return false;
                    }
                } else {
                    // Foi ativada: Dois ticks azuis (lido)
                    try {
                        await this.sock.readMessages([m.key]);
                        this.logger.log('✓✓ [LIDO] Grupo');
                        return true;
                    } catch (err) {
                        return false;
                    }
                }
            } else {
                // ═══ PV (PRIVADO) ═══
                if (wasActivated || isAudio) {
                    try {
                        await this.sock.readMessages([m.key]);
                        this.logger.log(isAudio ? '▶️ [REPRODUZIDO] PV' : '✓✓ [LIDO] PV');
                        return true;
                    } catch (err) {
                        return false;
                    }
                } else {
                    try {
                        // EXPLICITAR 'delivered' PARA 2 TICKS CINZAS
                        await this.sock.sendReadReceipt(jid, participant, [messageId], 'delivered');
                        this.logger.log('✓✓ [ENTREGUE] PV');
                        return true;
                    } catch (err) {
                        return false;
                    }
                }
            }
        } catch (e: any) {
            return false;
        }
    }

    /**
     * Simula leitura de mensagem
     */
    async markAsRead(m: any) {
        try {
            if (!this.sock) return false;
            await this.sock.readMessages([m.key]);
            this.logger.log('✓✓ [LIDO] Mensagem marcada');
            return true;
        } catch (e: any) {
            return false;
        }
    }

    /**
     * Simula status completo de mensagem
     */
    async simulateMessageStatus(m: any, wasActivated: boolean = true) {
        try {
            if (!this.sock) return false;

            const isGroup = String(m.key.remoteJid || '').endsWith('@g.us');

            if (isGroup) {
                try {
                    await this.sock.sendReadReceipt(m.key.remoteJid, m.key.participant, [m.key.id], 'delivered');
                    await delay(300);
                } catch (e) { }
            } else {
                try {
                    await this.sock.sendReadReceipt(m.key.remoteJid, undefined, [m.key.id], 'delivered');
                    await delay(300);
                } catch (e) { }
            }

            if (wasActivated) {
                await delay(500);
                await this.markAsRead(m);
            }

            return true;
        } catch (e: any) {
            return false;
        }
    }

    /**
     * Simula comportamento completo ao responder
     * 1. Marca entrega
     * 2. Simula digitação
     * 3. Envia mensagem
     * 4. Marca leitura
     */
    async simulateFullResponse(sock: any, m: any, responseText: string, isAudio: boolean = false) {
        try {
            // Atualizar socket se fornecido novo
            if (sock) this.sock = sock;

            // REMOVIDO: Verificação bloqueante e waitForConnection
            // Agora confiamos no safeSendPresenceUpdate para lidar com erros silenciosamente

            const jid = m.key.remoteJid;
            const isGroup = String(jid || '').endsWith('@g.us');

            // Step 1: Marcar como entregue (em grupos)
            if (isGroup) {
                await this.simulateTicks(m, false, false);
                await delay(300);
            }

            // Step 2: Simular digitação ou gravação
            if (isAudio) {
                const estimatedDuration = this.calculateRecordingDuration(responseText);
                await this.simulateRecording(jid, estimatedDuration);
            } else {
                const estimatedDuration = this.calculateTypingDuration(responseText);
                await this.simulateTyping(jid, estimatedDuration);
            }

            // Step 4: Marcar como lido
            await delay(500);
            await this.simulateTicks(m, true, isAudio);

            return true;
        } catch (e: any) {
            this.logger.error('❌ Erro inesperado ao simular resposta completa:', e.message);
            return false;
        }
    }

    /**
     * Calcula duração realista de digitação baseado no tamanho da resposta
     * Fórmula: 20-30ms por caractere, mínimo 500ms, máximo 5s
     */
    calculateTypingDuration(text: string, minMs: number = 500, maxMs: number = 5000) {
        if (!text) return minMs;
        const estimatedMs = Math.max(text.length * 25, minMs);
        return Math.min(estimatedMs, maxMs);
    }

    /**
     * Calcula duração realista de gravação de áudio
     * Fórmula: 80ms por 10 caracteres, mínimo 1s, máximo 6s
     */
    calculateRecordingDuration(text: string, minMs: number = 1000, maxMs: number = 6000) {
        if (!text) return minMs;
        const estimatedMs = Math.max((text.length / 10) * 80, minMs);
        return Math.min(estimatedMs, maxMs);
    }
}

export default PresenceSimulator;

