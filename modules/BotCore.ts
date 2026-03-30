/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CLASSE: BotCore
 * ═══════════════════════════════════════════════════════════════════════════
 * Núcleo central do bot Akira.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, delay, Browsers, getContentType } from '@whiskeysockets/baileys';
import fs from 'fs';
import pino from 'pino';
import { exec } from 'child_process';
import util from 'util';
const _execAsync = util.promisify(exec);

import ConfigManager from './ConfigManager.js';
import APIClient from './APIClient.js';
import AudioProcessor from './AudioProcessor.js';
import MediaProcessor from './MediaProcessor.js';
import MessageProcessor from './MessageProcessor.js';
import ModerationSystem from './ModerationSystem.js';
import RateLimiter from './RateLimiter.js';
import LevelSystem from './LevelSystem.js';
import RegistrationSystem from './RegistrationSystem.js';
import GameSystem from './GameSystem.js';
import GridTacticsGame from './GridTacticsGame.js';
import EconomySystem from './EconomySystem.js';
import PaymentManager from './PaymentManager.js';
import CommandHandler from './CommandHandler.js';
import HFCorrections from './HFCorrections.js';
import PresenceSimulator from './PresenceSimulator.js';
import SubscriptionManager from './SubscriptionManager.js';
import UserProfile from './UserProfile.js';
import BotProfile from './BotProfile.js';
import GroupManagement from './GroupManagement.js';
import ImageEffects from './ImageEffects.js';
import StickerViewOnceHandler from './StickerViewOnceHandler.js';
import PermissionManager from './PermissionManager.js';

class BotCore {
    public config: any;
    public logger: any;
    public sock: any;
    public isConnected: boolean = false;
    public reconnectAttempts: number = 0;
    public MAX_RECONNECT_ATTEMPTS: number = 15;
    public connectionStartTime: number | null = null;
    public currentQR: string | null = null;
    public BOT_JID: string | null = null;

    // Componentes
    public registrationSystem: any;
    public moderationSystem: any;
    public mediaProcessor: any;
    public messageProcessor: any;
    public levelSystem: any;
    public apiClient: any;
    public audioProcessor: any;
    public paymentManager: any;
    public subscriptionManager: any;
    public commandHandler: any;
    public presenceSimulator: any;
    public rateLimiter: any;
    public economySystem: any;
    public gameSystem: any;
    public gridTacticsGame: any;
    public userProfile: any;
    public botProfile: any;
    public groupManagement: any;
    public imageEffects: any;
    public permissionManager: any;
    public stickerViewOnceHandler: any;

    // Event listeners
    public eventListeners: {
        onQRGenerated: ((qr: string) => void) | null;
        onConnected: ((jid: string) => void) | null;
        onDisconnected: ((reason: any) => void) | null;
    } = {
            onQRGenerated: null,
            onConnected: null,
            onDisconnected: null
        };

    // Deduplicação
    private processedMessages: Set<string> = new Set();
    private readonly MAX_PROCESSED_MESSAGES = 1000;
    private pipelineLogCounter: number = 0;
    private readonly PIPELINE_LOG_INTERVAL = 10;

    constructor() {
        this.config = ConfigManager.getInstance();
        this.logger = this.config.logger || pino({
            level: this.config.LOG_LEVEL || 'info',
            timestamp: () => `,"time":"${new Date().toISOString()}"`
        });
        this.sock = null;
    }

    async initialize(): Promise<boolean> {
        try {
            this.logger.info('🚀 Inicializando BotCore...');
            HFCorrections.apply();
            this.config.validate();
            await this.initializeComponents();
            return true;
        } catch (error: any) {
            this.logger.error('❌ Erro ao inicializar:', error.message);
            throw error;
        }
    }

    async start() {
        await this.initialize();
        await this.connect();
    }

    /**
     * Auto-atualiza o yt-dlp em background para garantir downloads funcionando
     * Essencial para Railway onde o build envelhece mas o bot continua rodando
     */
    private async _selfUpdateYtdlp(): Promise<void> {
        try {
            this.logger.info('🔄 [yt-dlp] Verificando atualizações...');
            const { stdout } = await _execAsync('yt-dlp -U 2>&1', { timeout: 120000 });
            if (stdout.includes('up to date')) {
                this.logger.info('✅ [yt-dlp] Já está atualizado');
            } else {
                this.logger.info('✅ [yt-dlp] Atualizado com sucesso!');
            }
        } catch (err: any) {
            // Falha silenciosa — não bloqueia o startup
            this.logger.warn(`⚠️ [yt-dlp] Não foi possível atualizar: ${err.message?.substring(0, 80)}`);
        }
    }

    async initializeComponents() {
        try {
            this.logger.debug('🔧 Inicializando componentes..');

            // Auto-atualiza yt-dlp em background (não bloqueia o startup)
            this._selfUpdateYtdlp().catch(() => { });

            this.apiClient = new APIClient(this.logger);
            this.audioProcessor = new AudioProcessor(this.logger);
            this.mediaProcessor = new MediaProcessor(this.logger);
            this.messageProcessor = new MessageProcessor(this.logger);
            // @ts-ignore
            this.moderationSystem = new ModerationSystem(this.logger);
            // @ts-ignore
            this.levelSystem = new LevelSystem(this.logger);
            // @ts-ignore
            this.registrationSystem = new RegistrationSystem(this.logger);
            this.subscriptionManager = new SubscriptionManager(this.config);
            // @ts-ignore
            this.userProfile = new UserProfile(this.sock, this.logger, this.config);
            // @ts-ignore
            this.botProfile = new BotProfile(this.sock, this.logger, this.config);
            // @ts-ignore
            // @ts-ignore
            this.groupManagement = new GroupManagement(this.sock, this.config, this.moderationSystem, this.mediaProcessor, this.levelSystem);
            // @ts-ignore
            this.imageEffects = new ImageEffects(this.logger);
            // @ts-ignore
            this.permissionManager = new PermissionManager(this.logger, this.registrationSystem);
            // @ts-ignore
            this.rateLimiter = new RateLimiter(this.config);
            // @ts-ignore
            this.stickerViewOnceHandler = new StickerViewOnceHandler(this.sock, this.config);

            this.paymentManager = new PaymentManager(this, this.subscriptionManager);
            this.presenceSimulator = new PresenceSimulator(this.sock || null);
            // @ts-ignore
            this.economySystem = new EconomySystem(this.logger);

            try {
                // Instanciação segura para ESM/CJS (evita erro "is not a constructor")
                const GridTacticsClass = (GridTacticsGame as any).default || GridTacticsGame;
                const GameSystemClass = (GameSystem as any).default || GameSystem;
                const CommandHandlerClass = (CommandHandler as any).default || CommandHandler;

                this.gridTacticsGame = typeof GridTacticsClass === 'function' ? new GridTacticsClass(this.logger, this.config) : null;
                this.gameSystem = typeof GameSystemClass === 'function' ? new GameSystemClass(this.logger, this.config, this.gridTacticsGame) : null;

                this.commandHandler = new CommandHandlerClass(this.sock, this.config, this, this.messageProcessor);
                if (this.commandHandler) {
                    this.commandHandler.economySystem = this.economySystem;
                    this.commandHandler.gameSystem = this.gameSystem;
                    this.commandHandler.gridTacticsGame = this.gridTacticsGame;
                    this.logger.debug('✅ CommandHandler inicializado (ESM Safe)');
                }
            } catch (err: any) {
                this.logger.error(`❌ Erro crítico no CommandHandler: ${err.message}`);
                this.commandHandler = null;
            }

            const poToken = this.config?.YT_PO_TOKEN;
            const cookiesPath = this.config?.YT_COOKIES_PATH;
            this.logger.info(`📺 YouTube: PO_TOKEN=${poToken ? '✅' : '❌'}, Cookies=${cookiesPath ? '✅' : '❌'}`);

            this.logger.debug('✅ Componentes inicializados');
        } catch (error: any) {
            this.logger.error('❌ Erro componentes:', error.message);
        }
    }

    private _updateComponentsSocket(sock: any): void {
        try {
            this.logger.info('🔄 Atualizando socket em todos os módulos core...');

            // Módulos com setSocket nativo
            if (this.commandHandler?.setSocket) this.commandHandler.setSocket(sock);
            if (this.groupManagement?.setSocket) this.groupManagement.setSocket(sock);
            if (this.stickerViewOnceHandler?.setSocket) this.stickerViewOnceHandler.setSocket(sock);
            if (this.botProfile?.setSocket) this.botProfile.setSocket(sock);
            if (this.userProfile?.setSocket) this.userProfile.setSocket(sock);

            // Módulos de processamento (adicionando suporte agora)
            if (this.mediaProcessor?.setSocket) this.mediaProcessor.setSocket(sock);
            if (this.moderationSystem?.setSocket) this.moderationSystem.setSocket(sock);
            if (this.registrationSystem?.setSocket) this.registrationSystem.setSocket(sock);
            if (this.subscriptionManager?.setSocket) this.subscriptionManager.setSocket(sock);
            if (this.paymentManager?.setSocket) this.paymentManager.setSocket(sock);
            if (this.levelSystem?.setSocket) this.levelSystem.setSocket(sock);
            if (this.economySystem?.setSocket) this.economySystem.setSocket(sock);
            if (this.gameSystem?.setSocket) this.gameSystem.setSocket(sock);
            if (this.gridTacticsGame?.setSocket) this.gridTacticsGame.setSocket(sock);
            if (this.messageProcessor?.setSocket) this.messageProcessor.setSocket(sock);
            if (this.rateLimiter?.setSocket) this.rateLimiter.setSocket(sock);
            if (this.permissionManager?.setSocket) this.permissionManager.setSocket(sock);
            if (this.imageEffects?.setSocket) this.imageEffects.setSocket(sock);
            if (this.audioProcessor?.setSocket) this.audioProcessor.setSocket(sock);
            if (this.apiClient?.setSocket) this.apiClient.setSocket(sock);

            // Simulador de presença (propriedade direta)
            if (this.presenceSimulator) this.presenceSimulator.sock = sock;

            this.logger.info('✅ Todos os módulos sincronizados');
        } catch (e: any) {
            this.logger.error('❌ Erro na sincronização global de socket:', e.message);
        }
    }

    async connect(): Promise<void> {
        try {
            const { state, saveCreds } = await useMultiFileAuthState(this.config.AUTH_FOLDER);
            const { version, isLatest } = await fetchLatestBaileysVersion();

            this.logger.info(`📡 WhatsApp v${version.join('.')} (Latest: ${isLatest})`);

            const socketConfig: any = {
                version,
                logger: pino({ level: 'silent' }),
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
                },
                browser: Browsers.macOS('Akira-Bot'),
                generateHighQualityLinkPreview: true,
                getMessage: async (key: any) => ({ conversation: 'hello' }),
                connectTimeoutMs: 60000,
                defaultQueryTimeoutMs: 60000,
                keepAliveIntervalMs: 10000,
                emitOwnEvents: false,
                retryRequestDelayMs: 250
            };

            const agent = HFCorrections.createHFAgent();
            if (agent) {
                socketConfig.agent = agent;
                this.logger.info('🌐 Agente HTTP personalizado');
            }

            this.sock = makeWASocket(socketConfig);
            this._updateComponentsSocket(this.sock);

            this.sock.ev.on('connection.update', async (update: any) => {
                const { connection, lastDisconnect, qr } = update;

                if (qr) {
                    this.logger.info('📸 QR Code recebido');
                    this.currentQR = qr;
                    if (this.eventListeners.onQRGenerated) this.eventListeners.onQRGenerated(qr);
                }

                if (connection === 'close') {
                    this.isConnected = false;
                    this.currentQR = null;
                    const reason = lastDisconnect?.error?.output?.statusCode;
                    const shouldReconnect = reason !== DisconnectReason.loggedOut;
                    this.logger.warn(`🔴 Conexão fechada. Motivo: ${reason}. Reconectar: ${shouldReconnect}`);

                    if (this.eventListeners.onDisconnected) this.eventListeners.onDisconnected(reason);

                    if (shouldReconnect) {
                        if (this.reconnectAttempts < this.MAX_RECONNECT_ATTEMPTS) {
                            this.reconnectAttempts++;
                            // Exponential backoff com jitter (até 30s)
                            const baseDelay = Math.min(Math.pow(1.5, this.reconnectAttempts) * 1000, 30000);
                            const delayMs = Math.floor(baseDelay + Math.random() * 1000);

                            this.logger.info(`⏳ Reconectando em ${delayMs}ms (Tentativa ${this.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS})`);
                            await delay(delayMs);
                            this.connect();
                        } else {
                            this.logger.error('❌ Muitas falhas. Reiniciando...');
                            process.exit(1);
                        }
                    } else {
                        this.logger.info('🔒 Desconectado permanentemente');
                        this._cleanAuthOnError();
                    }
                } else if (connection === 'open') {
                    this.logger.info('✅ CONEXÃO ESTABELECIDA!');
                    this.isConnected = true;
                    this.reconnectAttempts = 0;
                    this.currentQR = null;
                    this.connectionStartTime = Date.now();

                    this._updateComponentsSocket(this.sock);
                    this.BOT_JID = this.sock.user?.id;
                    this.logger.info(`🤖 Logado como: ${this.BOT_JID}`);
                    if (this.eventListeners.onConnected) this.eventListeners.onConnected(this.BOT_JID);
                }
            });

            this.sock.ev.on('creds.update', saveCreds);

            this.sock.ev.on('messages.upsert', async ({ messages, type }: any) => {
                if (type !== 'notify') return;
                for (const m of messages) await this.processMessage(m);
            });

            this.sock.ev.on('group-participants.update', async (update: any) => {
                const { id, participants, action } = update;

                if (action === 'add') {
                    // 1. Anti-Fake
                    if (this.moderationSystem?.isAntiFakeActive(id)) {
                        for (const participant of participants) {
                            if (this.moderationSystem.isFakeNumber(participant)) {
                                this.logger.warn(`🚫 [ANTI-FAKE] ${participant}`);
                                await this.sock.sendMessage(id, { text: '⚠️ Número fake removido.' });
                                await this.sock.groupParticipantsUpdate(id, [participant], 'remove');
                                // Remove from the list so welcome isn't sent
                                participants.splice(participants.indexOf(participant), 1);
                            }
                        }
                    }
                }

                if (action === 'add' && this.groupManagement && participants.length > 0) {
                    const isWelcomeOn = this.groupManagement.groupSettings?.[id]?.welcome;
                    if (isWelcomeOn) {
                        for (const p of participants) {
                            const template = this.groupManagement.getCustomMessage(id, 'welcome') || 'Olá @user!';
                            const formatted = await this.groupManagement.formatMessage(id, p, template);
                            await this.sock.sendMessage(id, { text: formatted, mentions: [p] });
                        }
                    }
                }

                if (action === 'remove' && this.groupManagement) {
                    const isGoodbyeOn = this.groupManagement.groupSettings?.[id]?.goodbye;
                    if (isGoodbyeOn) {
                        for (const p of participants) {
                            const template = this.groupManagement.getCustomMessage(id, 'goodbye') || 'Adeus @user!';
                            const formatted = await this.groupManagement.formatMessage(id, p, template);
                            await this.sock.sendMessage(id, { text: formatted, mentions: [p] });
                        }
                    }
                }
            });

        } catch (error: any) {
            this.logger.error('❌ Erro conexão:', error.message);
            await delay(5000);
            this.connect();
        }
    }

    private isMessageProcessed(key: any): boolean {
        if (!key?.id) return false;
        const messageId = key.id;
        if (this.processedMessages.has(messageId)) {
            this.logger.debug(`⏭️ Já processada: ${messageId.substring(0, 15)}`);
            return true;
        }
        this.processedMessages.add(messageId);
        if (this.processedMessages.size > this.MAX_PROCESSED_MESSAGES) {
            const arr = Array.from(this.processedMessages);
            this.processedMessages = new Set(arr.slice(-this.MAX_PROCESSED_MESSAGES / 2));
        }
        return false;
    }

    async processMessage(m: any): Promise<void> {
        try {
            if (this.isMessageProcessed(m.key)) return;

            this.pipelineLogCounter++;
            const shouldLog = this.pipelineLogCounter % this.PIPELINE_LOG_INTERVAL === 1;

            if (shouldLog) this.logger.debug('🔹 [PIPELINE] Iniciando');
            if (!m) { this.logger.debug('🔹 [PIPELINE] m null'); return; }
            if (!m.message) { this.logger.debug('🔹 [PIPELINE] msg vazia'); return; }
            if (m.key.fromMe) return;
            if (m.message.protocolMessage) return;

            if (shouldLog) this.logger.debug('🔹 [PIPELINE] Válida');

            const remoteJid = m.key.remoteJid;
            const ehGrupo = remoteJid.endsWith('@g.us');
            const ehStatus = remoteJid === 'status@broadcast';
            if (ehStatus) return;

            if (!this.messageProcessor) throw new Error('messageProcessor não inicializado');

            // [NFA] Feedback Imediato: Marca como entregue (2 ticks cinzas) assim que entra na fila
            if (this.presenceSimulator) {
                this.presenceSimulator.simulateTicks(m, false).catch(() => { });
            }

            const nome = m.pushName || 'Usuário';
            const numeroReal = this.messageProcessor.extractUserNumber(m);
            if (shouldLog) this.logger.debug(`🔹 [PIPELINE] ${numeroReal}`);

            if (this.moderationSystem?.isBlacklisted(numeroReal)) {
                this.logger.debug(`🚫 Banido: ${nome}`);
                return;
            }

            // [NFA] Rate Limit Check - Militar
            if (this.rateLimiter) {
                const isOwner = this.config.isDono(numeroReal);
                const limitStatus = this.rateLimiter.check(numeroReal, isOwner);
                if (!limitStatus.allowed) {
                    this.logger.warn(`⏳ [RATE LIMIT] ${nome} (${numeroReal}) bloqueado. Motivo: ${limitStatus.reason}`);
                    if (limitStatus.reason === 'RATE_LIMIT_EXCEEDED') {
                        await this.handleViolation(m, 'rate_limit');
                    }
                    return;
                }
            }

            if (ehGrupo && this.moderationSystem?.isMuted(remoteJid, m.key.participant)) {
                await this.handleViolation(m, 'mute');
                return;
            }

            const texto = this.messageProcessor.extractText(m);
            const temImagem = this.messageProcessor.hasImage(m);
            const temAudio = this.messageProcessor.hasAudio(m);
            if (shouldLog) this.logger.debug(`🔹 [PIPELINE] txt=${!!texto} img=${temImagem} aud=${temAudio}`);

            const caption = this.messageProcessor.extractText(m) || '';
            const participant = m.key.participant || m.key.remoteJid;

            if (ehGrupo && (texto || caption) && this.moderationSystem) {
                let isAdmin = false;
                try {
                    if (this.groupManagement) isAdmin = await this.groupManagement.isUserAdmin(remoteJid, participant);
                } catch (e) { isAdmin = false; }

                if (!isAdmin && this.moderationSystem.checkLink(texto || caption, remoteJid, participant, isAdmin)) {
                    await this.handleViolation(m, 'link');
                    return;
                }
            }

            const replyInfo = this.messageProcessor.extractReplyInfo(m);
            const temSticker = !!m.message?.stickerMessage;


            if (temSticker && ehGrupo && this.moderationSystem?.isAntiStickerActive(remoteJid)) {
                await this.handleViolation(m, 'sticker');
                return;
            }

            if (temImagem) {
                if (ehGrupo && this.moderationSystem?.isAntiImageActive(remoteJid)) {
                    await this.handleViolation(m, 'imagem');
                    return;
                }
                await this.handleImageMessage(m, nome, numeroReal, replyInfo, ehGrupo);
            } else if (temAudio) {
                await this.handleAudioMessage(m, nome, numeroReal, replyInfo, ehGrupo);
            } else {
                // Se for texto ou qualquer outra msg com texto (sticker com legenda, etc)
                await this.handleTextMessage(m, nome, numeroReal, texto || caption, replyInfo, ehGrupo);
            }
        } catch (error: any) {
            this.logger.error('❌ Erro pipeline:', error?.message);
        }
    }

    async handleImageMessage(m: any, nome: string, numeroReal: string, replyInfo: any, ehGrupo: boolean): Promise<void> {
        this.logger.info(`🖼️ [IMAGEM] ${nome}`);
        if (ehGrupo && this.config.FEATURE_LEVELING && this.levelSystem && this.groupManagement?.groupSettings[m.key.remoteJid]?.leveling) {
            const xp = this.levelSystem.awardXp(m.key.remoteJid, numeroReal, 15);
            if (xp) this.logger.info(`📈 [LEVEL] ${nome} +15 XP`);
        }

        try {
            let deveResponder = false;
            const caption = this.messageProcessor.extractText(m) || '';
            const captionLower = caption.toLowerCase();
            const botNameLower = (this.config.BOT_NAME || 'belmira').toLowerCase();

            if (!ehGrupo) deveResponder = true;
            else if (this.messageProcessor.isBotMentioned(m)) deveResponder = true;
            else if (replyInfo?.ehRespostaAoBot) deveResponder = true;
            else if (captionLower.includes(botNameLower)) deveResponder = true;
            else if (this.messageProcessor.isCommand(caption)) deveResponder = true;

            if (!deveResponder) {
                this.logger.debug(`⏭️ Imagem ignorada: ${caption.substring(0, 30)}`);
                return;
            }

            if (this.commandHandler && this.messageProcessor.isCommand(caption)) {
                try {
                    const handled = await this.commandHandler.handle(m, { nome, numeroReal, texto: caption, replyInfo, ehGrupo });
                    if (handled) {
                        this.logger.info(`⚡ Comando imagem: ${caption.substring(0, 30)}`);
                        return;
                    }
                } catch (err: any) {
                    this.logger.warn(`⚠️ Comando legenda: ${err.message}`);
                }
            }

            await this.presenceSimulator.simulateTicks(m, true, false);
            await this.presenceSimulator.simulateTyping(m.key.remoteJid, 1500);

            this.logger.debug('⬇️ Baixando imagem...');
            // ⚡ OTIMIZAÇÃO: Deixa o MediaProcessor extrair a imagem de qualquer container (viewOnce, ephemeral, etc)
            const result = await this.mediaProcessor.downloadMedia(m.message, 'image');
            if (!result || !result.buffer?.length) {
                this.logger.error('❌ Buffer vazio');
                await this.reply(m, '❌ Não consegui baixar a imagem.');
                return;
            }

            const { buffer: imageBuffer, mediaContent } = result;

            this.logger.debug(`✅ Imagem: ${imageBuffer.length} bytes`);
            let base64Image;
            try {
                base64Image = imageBuffer.toString('base64');
                if (!base64Image || base64Image.length < 100) throw new Error('Base64 inválido');
            } catch (err: any) {
                this.logger.error('❌ Erro base64:', err.message);
                await this.reply(m, '❌ Erro ao processar imagem.');
                return;
            }

            const payload = this.apiClient.buildPayload({
                usuario: nome,
                numero: numeroReal,
                mensagem: caption || 'O que tem nesta imagem?',
                tipo_conversa: ehGrupo ? 'grupo' : 'pv',
                grupo_id: ehGrupo ? m.key.remoteJid : null,
                grupo_nome: ehGrupo ? (m.key.remoteJid.split('@')[0] || 'Grupo') : null,
                tipo_mensagem: 'image',
                imagem_dados: {
                    dados: base64Image,
                    mime_type: mediaContent.mimetype || 'image/jpeg',
                    descricao: caption || 'Imagem'
                },
                mensagem_citada: replyInfo?.textoMensagemCitada || '',
                reply_metadata: replyInfo ? {
                    is_reply: replyInfo.isReply || true,
                    reply_to_bot: replyInfo.ehRespostaAoBot,
                    quoted_author_name: replyInfo.quemEscreveuCitacao || 'desconhecido'
                } : null
            });

            this.logger.info(`👁️ Analisando imagem...`);
            const resultado = await this.apiClient.processMessage(payload);

            if (!resultado.success) {
                this.logger.error('❌ Erro API:', resultado.error);
                await this.sock.sendMessage(m.key.remoteJid, { text: 'Não consegui analisar a imagem.' });
                return;
            }

            const resposta = resultado.resposta || 'Sem resposta.';

            // ⚡ OTIMIZAÇÃO: Simulação não-bloqueante
            if (this.presenceSimulator) {
                this.presenceSimulator.simulateTyping(m.key.remoteJid, this.presenceSimulator.calculateTypingDuration(resposta)).catch(() => { });
            }

            const opcoes = ehGrupo ? { quoted: m } : (replyInfo?.ehRespostaAoBot) ? { quoted: m } : {};
            await this.sock.sendMessage(m.key.remoteJid, { text: resposta }, opcoes);
            await this.presenceSimulator.simulateTicks(m, true, false);
        } catch (error: any) {
            this.logger.error('❌ Erro imagem:', error.message);
        }
    }

    async handleAudioMessage(m: any, nome: string, numeroReal: string, replyInfo: any, ehGrupo: boolean): Promise<void> {
        this.logger.info(`🎤 [ÁUDIO] ${nome}`);
        try {
            this.logger.debug('⬇️ Baixando áudio...');
            const result = await this.mediaProcessor.downloadMedia(m.message, 'audio');
            await this.handleAudioMessage_internal(m, nome, numeroReal, replyInfo, ehGrupo, result?.buffer || null);
        } catch (error: any) {
            this.logger.error('❌ Erro áudio:', error.message);
        }
    }

    async handleAudioMessage_internal(m: any, nome: string, numeroReal: string, replyInfo: any, ehGrupo: boolean, audioBuffer: Buffer | null): Promise<void> {
        try {
            if (!audioBuffer) { this.logger.error('❌ Buffer áudio vazio'); return; }

            const transcricao = await this.mediaProcessor.transcribeAudio(audioBuffer);
            if (!transcricao.sucesso) { this.logger.warn('⚠️ Falha transcrição'); return; }

            this.logger.info(`📝 Transcrição: ${transcricao.texto.substring(0, 80)}`);
            await this.handleTextMessage(m, nome, numeroReal, transcricao.texto, replyInfo, ehGrupo, true);
        } catch (error: any) {
            this.logger.error('❌ Erro áudio interno:', error.message);
        }
    }

    async handleTextMessage(m: any, nome: string, numeroReal: string, texto: string, replyInfo: any, ehGrupo: boolean, foiAudio: boolean = false): Promise<void> {
        try {
            // ✅ BUG FIX #1: isDono deve receber o NOME (pushName) do usuário, NÃO o texto da mensagem.
            // O texto da mensagem nunca contém 'morema', o NOME sim.
            const isOwner = typeof this.config?.isDono === 'function'
                ? this.config.isDono(numeroReal, nome)
                : false;

            if (!isOwner && this.moderationSystem?.checkAndLimitHourlyMessages) {
                const res = this.moderationSystem.checkAndLimitHourlyMessages(numeroReal, nome, numeroReal, texto, null, isOwner);
                if (!res?.allowed) {
                    const msg = res?.reason === 'LIMITE_HORARIO_EXCEDIDO' ? '⏰ Limite por hora excedido.' : '⏰ Muitas mensagens. Aguarde.';
                    await this.sock.sendMessage(m.key.remoteJid, { text: msg });
                    return;
                }
            } else if (!isOwner && this.moderationSystem?.checkAndLimitHourlyMessages) {
                // Sem ModerationSystem ativo, não bloqueamos usuários (evita bloquear dono no PV)
                this.logger.debug(`⏳ [RATE] Sem moderationSystem. Permitindo ${nome}.`);
            }
            // REMOVIDO: fallback checkRateLimit que bloqueava usuários novos no PV

            // 2. Verificar se é comando (Ignora IA se for #comando)
            if (this.messageProcessor.isCommand(texto)) {
                this.logger.debug(`⌨️ Comando detectado: ${texto.split(' ')[0]}`);
                try {
                    if (this.commandHandler) {
                        const handled = await this.commandHandler.handle(m, { nome, numeroReal, texto, replyInfo, ehGrupo });
                        if (handled) {
                            this.logger.info(`⚡ Comando: ${texto.substring(0, 30)}`);
                            if (ehGrupo && this.config.FEATURE_LEVELING && this.levelSystem && this.groupManagement?.groupSettings[m.key.remoteJid]?.leveling) {
                                const xp = this.levelSystem.awardXp(m.key.remoteJid, numeroReal, 5);
                                if (xp) this.logger.info(`📈 [LEVEL] ${nome} +5 XP`);
                            }
                            return; // Comando tratado, não prossegue para IA
                        }
                    }
                } catch (err: any) {
                    this.logger.warn('Erro CommandHandler:', err.message);
                }
                // If it's a command but not handled by commandHandler, it might still be ignored or fall through.
                // For now, if it's a command, we return after trying to handle it.
                return;
            }

            // 3. Lógica de Decisão de Resposta (deveResponder)
            const deveResponder = this.shouldRespondToAI(m, texto, ehGrupo, replyInfo);

            if (!deveResponder) {
                this.logger.debug(`⏭️ Ignorado: ${texto.substring(0, 50)}`);
                return;
            }

            // 4. Processar Resposta via API
            this.logger.info(`🤖 Resposta para ${nome}: ${texto.substring(0, 30)}...`);

            if (ehGrupo && this.config.FEATURE_LEVELING && this.levelSystem && this.groupManagement?.groupSettings[m.key.remoteJid]?.leveling) {
                const xp = this.levelSystem.awardXp(m.key.remoteJid, numeroReal, 10);
                if (xp) this.logger.info(`📈 [LEVEL] ${nome} +10 XP`);
            }

            const replyMetadata = replyInfo ? {
                is_reply: replyInfo.isReply || true,
                reply_to_bot: replyInfo.ehRespostaAoBot,
                quoted_author_name: replyInfo.quemEscreveuCitacao || 'desconhecido',
                quoted_author_numero: replyInfo.quotedAuthorNumero || 'desconhecido',
                quoted_type: replyInfo.quotedType || 'texto',
                quoted_text_original: replyInfo.quotedTextOriginal || '',
                context_hint: replyInfo.contextHint || '',
                priority_level: replyInfo.priorityLevel || 2
            } : { is_reply: false, reply_to_bot: false };

            if (ehGrupo && this.config.FEATURE_LEVELING && this.levelSystem && this.groupManagement?.groupSettings[m.key.remoteJid]?.leveling) {
                const xp = this.levelSystem.awardXp(m.key.remoteJid, numeroReal, 10);
                if (xp) this.logger.info(`📈 [LEVEL] ${nome} +10 XP`);
            }

            const payload = this.apiClient.buildPayload({
                usuario: nome,
                numero: numeroReal,
                mensagem: texto,
                tipo_conversa: ehGrupo ? 'grupo' : 'pv',
                grupo_id: ehGrupo ? m.key.remoteJid : null,
                grupo_nome: ehGrupo ? (m.key.remoteJid.split('@')[0] || 'Grupo') : null,
                tipo_mensagem: foiAudio ? 'audio' : 'texto',
                mensagem_citada: replyInfo?.textoMensagemCitada || '',
                reply_metadata: replyMetadata
            });

            // ✅ BUG FIX #3: PRESENCE CORRETO
            // O 'composing' deve comecar ANTES de chamar a API.
            // Assim o usuario ve 'digitando' enquanto a IA processa. Natural e realista.
            // O stop() sera chamado ANTES de enviar a resposta.
            if (this.presenceSimulator) {
                this.presenceSimulator.safeSendPresenceUpdate('composing', m.key.remoteJid).catch(() => { });
            }

            const resultado = await this.apiClient.processMessage(payload);
            if (!resultado.success) {
                if (this.presenceSimulator) await this.presenceSimulator.stop(m.key.remoteJid);
                this.logger.error('❌ Erro API:', resultado.error);
                await this.sock.sendMessage(m.key.remoteJid, { text: 'Tive um problema. Tenta de novo?' });
                return;
            }

            const resposta = resultado.resposta || 'Sem resposta';

            if (foiAudio) {
                this.logger.info('🎤 [AUDIO RESPONSE]');
                if (this.presenceSimulator) await this.presenceSimulator.simulateRecording(m.key.remoteJid, 2000);
                try {
                    const tts = await this.audioProcessor.textToSpeech(resposta);
                    if (!tts.sucesso) {
                        this.logger.warn('⚠️ Falha TTS');
                        if (this.presenceSimulator) await this.presenceSimulator.stop(m.key.remoteJid);
                        await this.sock.sendMessage(m.key.remoteJid, { text: resposta }, { quoted: m });
                    } else {
                        this.logger.info('📤 Voice Note...');
                        if (this.presenceSimulator) await this.presenceSimulator.stop(m.key.remoteJid);
                        await this.sock.sendMessage(m.key.remoteJid, {
                            audio: tts.buffer,
                            mimetype: tts.mimetype || 'audio/ogg; codecs=opus',
                            ptt: true
                        }, { quoted: m });
                    }
                } catch (err: any) {
                    this.logger.error(`❌ Erro TTS: ${err.message}`);
                    if (this.presenceSimulator) await this.presenceSimulator.stop(m.key.remoteJid);
                    await this.sock.sendMessage(m.key.remoteJid, { text: resposta }, { quoted: m });
                }
                if (this.presenceSimulator) await this.presenceSimulator.markAsRead(m);
            } else {
                // ✅ BUG FIX #3: Para o 'composing' iniciado antes da API e envia imediatamente
                // O 'composing' já foi disparado ANTES da chamada à API.
                // Aqui apenas paramos e enviamos — sem nenhum delay extra.
                if (this.presenceSimulator) await this.presenceSimulator.stop(m.key.remoteJid);

                const opcoes = ehGrupo ? { quoted: m } : (replyInfo?.ehRespostaAoBot ? { quoted: m } : {});
                await this.sock.sendMessage(m.key.remoteJid, { text: resposta }, opcoes);
                this.logger.info(`✅ [DISPATCH OK]`);

                if (this.presenceSimulator) await this.presenceSimulator.markAsRead(m);
            }

            this.logger.info(`✅ [RESPONDIDO] ${resposta.substring(0, 80)}`);
        } catch (error: any) {
            this.logger.error('❌ Erro texto:', error.message);
        }
    }

    async simulateTyping(jid: string, durationMs: number): Promise<void> {
        try {
            if (!this.sock) return;
            await this.sock.sendPresenceUpdate('available', jid);
            await delay(300);
            await this.sock.sendPresenceUpdate('composing', jid);
            await delay(durationMs);
            await this.sock.sendPresenceUpdate('paused', jid);
        } catch (e: any) {
            this.logger.debug('Erro typing:', e.message);
        }
    }

    async reply(m: any, text: string, options: any = {}): Promise<any> {
        try {
            if (!this.sock) { this.logger.warn('⚠️ Socket não disponível'); return false; }
            return await this.sock.sendMessage(m.key.remoteJid, { text, ...options }, { quoted: m });
        } catch (error: any) {
            this.logger.error('❌ Erro reply:', error.message);
            return false;
        }
    }

    async handleViolation(m: any, tipo: string): Promise<void> {
        if (!this.sock) return;
        const jid = m.key.remoteJid;
        const participant = m.key.participant || m.key.remoteJid;
        const nome = m.pushName || 'Usuário';

        this.logger.warn(`🚫 [VIOLAÇÃO] ${tipo} de ${participant} (${nome})`);

        try {
            // 1. Deletar mensagem
            await this.sock.sendMessage(jid, { delete: m.key });

            // 2. Notificar e agir com base no tipo
            if (tipo === 'link') {
                await this.sock.sendMessage(jid, {
                    text: `🚫 *ANTILINK* 🚫\n\n@${participant.split('@')[0]}, links não são permitidos neste grupo.`,
                    mentions: [participant]
                });
                // Notifica no log mas não chuta (pode ser configurado)
            } else if (tipo === 'mute') {
                await this.sock.sendMessage(jid, { text: `🚫 *${nome} removido por falar durante o silenciamento!*` });
                await this.sock.groupParticipantsUpdate(jid, [participant], 'remove');
            } else if (tipo === 'rate_limit') {
                await this.sock.sendMessage(jid, {
                    text: `⏳ *LIMITE DE MENSAGENS EXCEDIDO* ⏳\n\n@${participant.split('@')[0]}, você atingiu o limite de ${this.config.RATE_LIMIT_MAX_CALLS || 100} mensagens/hora.\nAguarde a próxima janela de tempo.`,
                    mentions: [participant]
                });
            } else {
                await this.sock.sendMessage(jid, {
                    text: `🚫 *ANTI-${tipo.toUpperCase()}* 🚫\n\nEste tipo de mídia não é permitido no momento.`,
                    mentions: [participant]
                });
            }
        } catch (e: any) {
            this.logger.error(`Erro ao tratar violação: ${e.message}`);
        }
    }

    /**
     * Lógica central de decisão de resposta da IA
     */
    shouldRespondToAI(m: any, texto: string, ehGrupo: boolean, replyInfo: any): boolean {
        if (!ehGrupo) return true; // No privado, responde sempre

        const textoLower = (texto || '').toLowerCase();
        const botName = (this.config.BOT_NAME || 'akira').toLowerCase();

        // 1. Responde se for menção direta ao bot (marcado @244...)
        if (this.messageProcessor.isBotMentioned(m)) return true;

        // 1.1 Verificação extra de menção por texto (@número ou número)
        const myNum = this.sock?.user?.id?.split(':')[0];
        if (myNum && (texto.includes(`@${myNum}`) || texto.includes(myNum))) return true;

        // 2. Responde se for resposta (reply) a uma mensagem do próprio bot
        if (replyInfo?.ehRespostaAoBot) return true;

        // 3. Responde se o nome do bot for citado explicitamente
        if (textoLower.includes(botName) || textoLower.includes('akira')) return true;

        // 4. Se for resposta a outra pessoa no grupo, ignora
        if (replyInfo?.isReply && !replyInfo?.ehRespostaAoBot) return false;

        return false;
    }

    _cleanAuthOnError(): void {
        try {
            if (fs.existsSync(this.config.AUTH_FOLDER)) {
                fs.rmSync(this.config.AUTH_FOLDER, { recursive: true, force: true });
                this.logger.info('🧹 Credenciais limpas');
            }
            this.isConnected = false;
            this.currentQR = null;
            this.BOT_JID = null;
            this.reconnectAttempts = 0;
        } catch (error: any) {
            this.logger.error('❌ Erro limpar credenciais:', error.message);
        }
    }

    getStatus(): any {
        return {
            isConnected: this.isConnected,
            botJid: this.BOT_JID,
            botNumero: this.config.BOT_NUMERO_REAL,
            botName: this.config.BOT_NAME,
            version: this.config.BOT_VERSION,
            uptime: Math.floor(process.uptime()),
            hasQR: !!this.currentQR,
            reconnectAttempts: this.reconnectAttempts
        };
    }

    getQRCode(): string | null {
        return this.currentQR;
    }

    getStats(): any {
        return {
            isConnected: this.isConnected,
            botJid: this.BOT_JID,
            botNumero: this.config.BOT_NUMERO_REAL,
            botName: this.config.BOT_NAME,
            version: this.config.BOT_VERSION,
            uptime: Math.floor(process.uptime()),
            hasQR: !!this.currentQR,
            reconnectAttempts: this.reconnectAttempts,
            connectionStartTime: this.connectionStartTime,
            features: {
                stt: this.config.FEATURE_STT_ENABLED,
                tts: this.config.FEATURE_TTS_ENABLED,
                youtube: this.config.FEATURE_YT_DOWNLOAD,
                stickers: this.config.FEATURE_STICKERS,
                moderation: this.config.FEATURE_MODERATION,
                leveling: this.config.FEATURE_LEVELING,
                vision: this.config.FEATURE_VISION
            }
        };
    }

    async _forceQRGeneration(): Promise<void> {
        this.logger.info('🔄 Forçando geração de novo QR code...');
        this.currentQR = null;
        if (this.sock) {
            try {
                this.sock.ev.removeAllListeners();
                this.sock.ws?.close();
            } catch (e: any) {
                this.logger.warn('Erro ao limpar socket:', e.message);
            }
            this.sock = null;
        }
        this.isConnected = false;
        this.BOT_JID = null;
        await delay(1000);
        await this.connect();
    }

    async disconnect(): Promise<void> {
        try {
            this.logger.info('🔴 Desconectando...');
            if (this.sock) {
                try {
                    this.sock.ev.removeAllListeners();
                    this.sock.ws?.close();
                } catch (e: any) {
                    this.logger.warn('Erro limpar socket:', e.message);
                }
                this.sock = null;
            }
            this.isConnected = false;
            this.currentQR = null;
            this.BOT_JID = null;
            this.logger.info('✅ Desconectado');
        } catch (error: any) {
            this.logger.error('❌ Erro desconectar:', error.message);
        }
    }
}

export default BotCore;

