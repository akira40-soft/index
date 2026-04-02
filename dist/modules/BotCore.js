/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CLASSE: BotCore
 * ═══════════════════════════════════════════════════════════════════════════
 * Núcleo central do bot Akira.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, delay, Browsers } from '@whiskeysockets/baileys';
import fs from 'fs';
import path from 'path';
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
import JidUtils from './JidUtils.js';
class BotCore {
    config;
    logger;
    sock;
    isConnected = false;
    reconnectAttempts = 0;
    MAX_RECONNECT_ATTEMPTS = 15;
    connectionStartTime = null;
    currentQR = null;
    BOT_JID = null;
    // Componentes
    registrationSystem;
    moderationSystem;
    mediaProcessor;
    messageProcessor;
    levelSystem;
    apiClient;
    audioProcessor;
    paymentManager;
    subscriptionManager;
    commandHandler;
    presenceSimulator;
    rateLimiter;
    economySystem;
    gameSystem;
    gridTacticsGame;
    userProfile;
    botProfile;
    groupManagement;
    imageEffects;
    permissionManager;
    stickerViewOnceHandler;
    // Event listeners
    eventListeners = {
        onQRGenerated: null,
        onConnected: null,
        onDisconnected: null
    };
    // Deduplicação
    processedMessages = new Set();
    MAX_PROCESSED_MESSAGES = 1000;
    pipelineLogCounter = 0;
    PIPELINE_LOG_INTERVAL = 10;
    constructor() {
        this.config = ConfigManager.getInstance();
        this.logger = this.config.logger || pino({
            level: this.config.LOG_LEVEL || 'info',
            timestamp: () => `,"time":"${new Date().toISOString()}"`
        });
        this.sock = null;
    }
    async initialize() {
        try {
            this.logger.info('🚀 Inicializando BotCore...');
            HFCorrections.apply();
            this.config.validate();
            await this.initializeComponents();
            return true;
        }
        catch (error) {
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
    async _selfUpdateYtdlp() {
        try {
            this.logger.info('🔄 [yt-dlp] Verificando atualizações...');
            const { stdout } = await _execAsync('yt-dlp -U 2>&1', { timeout: 120000 });
            if (stdout.includes('up to date')) {
                this.logger.info('✅ [yt-dlp] Já está atualizado');
            }
            else {
                this.logger.info('✅ [yt-dlp] Atualizado com sucesso!');
            }
        }
        catch (err) {
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
                const GridTacticsClass = GridTacticsGame.default || GridTacticsGame;
                const GameSystemClass = GameSystem.default || GameSystem;
                const CommandHandlerClass = CommandHandler.default || CommandHandler;
                this.gridTacticsGame = typeof GridTacticsClass === 'function' ? new GridTacticsClass(this.logger, this.config) : null;
                this.gameSystem = typeof GameSystemClass === 'function' ? new GameSystemClass(this.logger, this.config, this.gridTacticsGame) : null;
                this.commandHandler = new CommandHandlerClass(this.sock, this.config, this, this.messageProcessor);
                if (this.commandHandler) {
                    this.commandHandler.economySystem = this.economySystem;
                    this.commandHandler.gameSystem = this.gameSystem;
                    this.commandHandler.gridTacticsGame = this.gridTacticsGame;
                    // Inicializa módulos async do CommandHandler
                    await this.commandHandler.initAsyncModules();
                    this.logger.debug('✅ CommandHandler inicializado (ESM Safe + Async Modules)');
                }
            }
            catch (err) {
                this.logger.error(`❌ Erro crítico no CommandHandler: ${err.message}`);
                this.commandHandler = null;
            }
            const poToken = this.config?.YT_PO_TOKEN;
            const cookiesPath = this.config?.YT_COOKIES_PATH;
            this.logger.info(`📺 YouTube: PO_TOKEN=${poToken ? '✅' : '❌'}, Cookies=${cookiesPath ? '✅' : '❌'}`);
            this.logger.debug('✅ Componentes inicializados');
        }
        catch (error) {
            this.logger.error('❌ Erro componentes:', error.message);
        }
    }
    _updateComponentsSocket(sock) {
        try {
            this.logger.info('🔄 Atualizando socket em todos os módulos core...');
            // Módulos com setSocket nativo
            if (this.commandHandler?.setSocket)
                this.commandHandler.setSocket(sock);
            if (this.groupManagement?.setSocket)
                this.groupManagement.setSocket(sock);
            if (this.stickerViewOnceHandler?.setSocket)
                this.stickerViewOnceHandler.setSocket(sock);
            if (this.botProfile?.setSocket)
                this.botProfile.setSocket(sock);
            if (this.userProfile?.setSocket)
                this.userProfile.setSocket(sock);
            // Módulos de processamento (adicionando suporte agora)
            if (this.mediaProcessor?.setSocket)
                this.mediaProcessor.setSocket(sock);
            if (this.moderationSystem?.setSocket)
                this.moderationSystem.setSocket(sock);
            if (this.registrationSystem?.setSocket)
                this.registrationSystem.setSocket(sock);
            if (this.subscriptionManager?.setSocket)
                this.subscriptionManager.setSocket(sock);
            if (this.paymentManager?.setSocket)
                this.paymentManager.setSocket(sock);
            if (this.levelSystem?.setSocket)
                this.levelSystem.setSocket(sock);
            if (this.economySystem?.setSocket)
                this.economySystem.setSocket(sock);
            if (this.gameSystem?.setSocket)
                this.gameSystem.setSocket(sock);
            if (this.gridTacticsGame?.setSocket)
                this.gridTacticsGame.setSocket(sock);
            if (this.messageProcessor?.setSocket)
                this.messageProcessor.setSocket(sock);
            if (this.rateLimiter?.setSocket)
                this.rateLimiter.setSocket(sock);
            if (this.permissionManager?.setSocket)
                this.permissionManager.setSocket(sock);
            if (this.imageEffects?.setSocket)
                this.imageEffects.setSocket(sock);
            if (this.audioProcessor?.setSocket)
                this.audioProcessor.setSocket(sock);
            if (this.apiClient?.setSocket)
                this.apiClient.setSocket(sock);
            // Simulador de presença (propriedade direta)
            if (this.presenceSimulator)
                this.presenceSimulator.sock = sock;
            this.logger.info('✅ Todos os módulos sincronizados');
        }
        catch (e) {
            this.logger.error('❌ Erro na sincronização global de socket:', e.message);
        }
    }
    async connect() {
        try {
            const { state, saveCreds } = await useMultiFileAuthState(this.config.AUTH_FOLDER);
            const { version, isLatest } = await fetchLatestBaileysVersion();
            this.logger.info(`📡 WhatsApp v${version.join('.')} (Latest: ${isLatest})`);
            const socketConfig = {
                version,
                logger: pino({ level: 'silent' }),
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
                },
                browser: Browsers.macOS('Akira-Bot'),
                generateHighQualityLinkPreview: true,
                getMessage: async (key) => ({ conversation: 'hello' }),
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
            this.sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, qr } = update;
                if (qr) {
                    this.logger.info('📸 QR Code recebido');
                    this.currentQR = qr;
                    if (this.eventListeners.onQRGenerated)
                        this.eventListeners.onQRGenerated(qr);
                }
                if (connection === 'close') {
                    this.isConnected = false;
                    this.currentQR = null;
                    // ✅ NOVO: Parar de manter presença disponível quando desconectar
                    if (this.presenceSimulator) {
                        this.presenceSimulator.stopMaintainingPresence();
                    }
                    const reason = lastDisconnect?.error?.output?.statusCode;
                    const shouldReconnect = reason !== DisconnectReason.loggedOut;
                    this.logger.warn(`🔴 Conexão fechada. Motivo: ${reason}. Reconectar: ${shouldReconnect}`);
                    if (this.eventListeners.onDisconnected)
                        this.eventListeners.onDisconnected(reason);
                    if (shouldReconnect) {
                        if (this.reconnectAttempts < this.MAX_RECONNECT_ATTEMPTS) {
                            this.reconnectAttempts++;
                            // Exponential backoff com jitter (até 30s)
                            const baseDelay = Math.min(Math.pow(1.5, this.reconnectAttempts) * 1000, 30000);
                            const delayMs = Math.floor(baseDelay + Math.random() * 1000);
                            this.logger.info(`⏳ Reconectando em ${delayMs}ms (Tentativa ${this.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS})`);
                            await delay(delayMs);
                            this.connect();
                        }
                        else {
                            this.logger.error('❌ Muitas falhas. Reiniciando...');
                            process.exit(1);
                        }
                    }
                    else {
                        this.logger.info('🔒 Desconectado permanentemente');
                        this._cleanAuthOnError();
                    }
                }
                else if (connection === 'open') {
                    this.logger.info('✅ CONEXÃO ESTABELECIDA!');
                    this.isConnected = true;
                    this.reconnectAttempts = 0;
                    this.currentQR = null;
                    this.connectionStartTime = Date.now();
                    this._updateComponentsSocket(this.sock);
                    this.BOT_JID = this.sock.user?.id;
                    const normalizedJid = JidUtils.normalize(this.BOT_JID);
                    this.logger.info(`🤖 Logado como: ${normalizedJid}`);
                    // ✅ NOVO: Manter bot sempre disponível (nunca offline)
                    if (this.presenceSimulator) {
                        await this.presenceSimulator.maintainAvailablePresence();
                        this.logger.info('🟢 Status de presença: SEMPRE DISPONÍVEL');
                    }
                    if (this.eventListeners.onConnected)
                        this.eventListeners.onConnected(normalizedJid);
                }
            });
            this.sock.ev.on('creds.update', saveCreds);
            this.sock.ev.on('messages.upsert', async ({ messages, type }) => {
                if (type !== 'notify')
                    return;
                for (const m of messages)
                    await this.processMessage(m);
            });
            this.sock.ev.on('group-participants.update', async (update) => {
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
        }
        catch (error) {
            this.logger.error('❌ Erro conexão:', error.message);
            await delay(5000);
            this.connect();
        }
    }
    isMessageProcessed(key) {
        if (!key?.id)
            return false;
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
    async processMessage(m) {
        try {
            if (this.isMessageProcessed(m.key))
                return;
            this.pipelineLogCounter++;
            const shouldLog = this.pipelineLogCounter % this.PIPELINE_LOG_INTERVAL === 1;
            if (shouldLog)
                this.logger.debug('🔹 [PIPELINE] Iniciando');
            if (!m) {
                this.logger.debug('🔹 [PIPELINE] m null');
                return;
            }
            if (!m.message) {
                this.logger.debug('🔹 [PIPELINE] msg vazia');
                return;
            }
            // ✅ VALIDAÇÃO RÍGIDA: Ignorar mensagens do próprio bot
            if (m.key.fromMe) {
                if (shouldLog)
                    this.logger.debug('⏭️ Mensagem é do bot (fromMe=true)');
                return;
            }
            if (m.message.protocolMessage)
                return;
            if (this.connectionStartTime && m.messageTimestamp) {
                const messageTimeMs = Number(m.messageTimestamp) * 1000;
                if (messageTimeMs < this.connectionStartTime - 5000) {
                    if (shouldLog)
                        this.logger.debug(`⏭️ Ignorado mensagem antiga (backlog): ${new Date(messageTimeMs).toISOString()}`);
                    return;
                }
            }
            if (shouldLog)
                this.logger.debug('🔹 [PIPELINE] Válida');
            const remoteJid = String(m.key.remoteJid || '');
            // ✅ VALIDAÇÃO CORRETA: Usar métodos Type-Safe para detectar tipo de conversa
            const ehGrupo = remoteJid.endsWith('@g.us');
            const ehStatus = remoteJid === 'status@broadcast';
            const ehNewsletter = remoteJid.endsWith('@newsletter');
            // ✅ BUG FIX: Ignorar Status e Newsletters imediatamente
            // Evita que Newsletters esgotem o rate limit do utilizador e poluem logs
            if (ehStatus)
                return;
            if (ehNewsletter) {
                // [NOVA FEATURE] Escuta passiva de canais para recolha de "raw data" para treino base sem despender chamadas API
                this._sniffNewsletter(m, remoteJid);
                return;
            }
            if (!this.messageProcessor)
                throw new Error('messageProcessor não inicializado');
            // Extrair informações ANTES de qualquer processamento
            const numero = this.messageProcessor.extractUserNumber(m);
            const conversationType = this.messageProcessor.getConversationType(m);
            // ✅ VALIDAÇÃO DUPLA: Também verificar se o numero é do bot
            const botNumero = JidUtils.getNumber(String(this.config.BOT_NUMERO_REAL));
            const numeroLimpo = JidUtils.getNumber(numero);
            if (numeroLimpo === botNumero) {
                if (shouldLog)
                    this.logger.debug(`⏭️ Ignorado: mensagem é do próprio bot (numero: ${numero})`);
                return;
            }
            // [NFA] Feedback Imediato: Marca como entregue (2 ticks cinzas) assim que entra na fila
            if (this.presenceSimulator) {
                this.presenceSimulator.simulateTicks(m, false).catch(() => { });
            }
            const nome = m.pushName || 'Usuário';
            const numeroReal = numero;
            const conversaType = conversationType;
            if (shouldLog) {
                this.logger.debug(`🔹 [PIPELINE] ${numeroReal} (${conversaType}) remoteJid=${remoteJid.substring(0, 20)} ehGrupo=${ehGrupo}`);
            }
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
                        await this.handleViolation(m, 'rate_limit', limitStatus);
                    }
                    else if (limitStatus.reason === 'BLACKLISTED') {
                        // Ignorar silenciosamente (não enviar mensagem)
                    }
                    return;
                }
            }
            const texto = this.messageProcessor.extractText(m);
            const temImagem = this.messageProcessor.hasImage(m);
            const temAudio = this.messageProcessor.hasAudio(m);
            const caption = this.messageProcessor.extractText(m) || '';
            const participant = m.key.participant || m.key.remoteJid;
            const replyInfo = this.messageProcessor.extractReplyInfo(m);
            const temSticker = !!m.message?.stickerMessage;
            const textoFinal = texto || caption;
            const isCommand = this.messageProcessor.isCommand(textoFinal);
            if (shouldLog)
                this.logger.debug(`🔹 [PIPELINE] txt=${!!texto} img=${temImagem} aud=${temAudio} sticker=${temSticker}`);
            if (ehGrupo && this.moderationSystem?.isMuted(remoteJid, participant)) {
                await this.handleViolation(m, 'mute');
                return;
            }
            if (isCommand) {
                if (shouldLog)
                    this.logger.debug(`🔹 [PIPELINE] comando detectado: ${textoFinal.substring(0, 50)}`);
                await this.handleTextMessage(m, nome, numeroReal, textoFinal, replyInfo, ehGrupo);
                return;
            }
            // 3. Decisão de resposta da IA (passa nome e numero para verificar Morena exclusiva)
            const deveResponder = this.shouldRespondToAI(m, textoFinal, ehGrupo, replyInfo, nome, numeroReal);
            if (!deveResponder) {
                this.logger.debug(`⏭️ Ignorado: ${textoFinal.substring(0, 50)}`);
                return;
            }
            // [NFA] Rate Limit Check - Militar (APENAS mensagens que o bot vai responder)
            if (this.rateLimiter) {
                const isOwner = this.config.isDono(numeroReal);
                const limitStatus = this.rateLimiter.check(numeroReal, isOwner);
                if (!limitStatus.allowed) {
                    this.logger.warn(`⏳ [RATE LIMIT] ${nome} (${numeroReal}) bloqueado. Motivo: ${limitStatus.reason}`);
                    if (limitStatus.reason === 'RATE_LIMIT_EXCEEDED') {
                        await this.handleViolation(m, 'rate_limit', limitStatus);
                    }
                    return;
                }
            }
            if (ehGrupo && (texto || caption) && this.moderationSystem) {
                let isAdmin = false;
                try {
                    if (this.groupManagement)
                        isAdmin = await this.groupManagement.isUserAdmin(remoteJid, participant);
                }
                catch (e) {
                    isAdmin = false;
                }
                if (!isAdmin && this.moderationSystem.checkLink(texto || caption, remoteJid, participant, isAdmin)) {
                    await this.handleViolation(m, 'link');
                    return;
                }
            }
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
            }
            else if (temAudio) {
                await this.handleAudioMessage(m, nome, numeroReal, replyInfo, ehGrupo);
            }
            else {
                // Se for texto ou qualquer outra msg com texto (sticker com legenda, etc)
                await this.handleTextMessage(m, nome, numeroReal, texto || caption, replyInfo, ehGrupo);
            }
        }
        catch (error) {
            this.logger.error('❌ Erro pipeline:', error?.message);
        }
    }
    async handleImageMessage(m, nome, numeroReal, replyInfo, ehGrupo) {
        this.logger.info(`🖼️ [IMAGEM] ${nome}`);
        if (ehGrupo && this.config.FEATURE_LEVELING && this.levelSystem && this.groupManagement?.groupSettings[m.key.remoteJid]?.leveling) {
            const xp = this.levelSystem.awardXp(m.key.remoteJid, numeroReal, 15);
            if (xp)
                this.logger.info(`📈 [LEVEL] ${nome} +15 XP`);
        }
        try {
            let deveResponder = false;
            const caption = this.messageProcessor.extractText(m) || '';
            const captionLower = caption.toLowerCase();
            const botNameLower = (this.config.BOT_NAME || 'belmira').toLowerCase();
            if (!ehGrupo)
                deveResponder = true;
            else if (this.messageProcessor.isBotMentioned(m))
                deveResponder = true;
            else if (replyInfo?.ehRespostaAoBot)
                deveResponder = true;
            else if (captionLower.includes(botNameLower))
                deveResponder = true;
            else if (this.messageProcessor.isCommand(caption))
                deveResponder = true;
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
                }
                catch (err) {
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
                if (!base64Image || base64Image.length < 100)
                    throw new Error('Base64 inválido');
            }
            catch (err) {
                this.logger.error('❌ Erro base64:', err.message);
                await this.reply(m, '❌ Erro ao processar imagem.');
                return;
            }
            const grupoNome = ehGrupo ? (m.key.remoteJid.split('@')[0] || 'Grupo Desconhecido') : null;
            const payload = this.apiClient.buildPayload({
                usuario: nome,
                numero: numeroReal,
                mensagem: caption || 'O que tem nesta imagem?',
                tipo_conversa: ehGrupo ? 'grupo' : 'pv',
                grupo_id: ehGrupo ? m.key.remoteJid : null,
                grupo_nome: grupoNome,
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
            // ✅ SEMPRE reply em grupos
            const opcoes = ehGrupo ? { quoted: m } : {};
            await this.sock.sendMessage(m.key.remoteJid, { text: resposta }, opcoes);
            await this.presenceSimulator.simulateTicks(m, true, false);
        }
        catch (error) {
            this.logger.error('❌ Erro imagem:', error.message);
        }
    }
    async handleAudioMessage(m, nome, numeroReal, replyInfo, ehGrupo) {
        this.logger.info(`🎤 [ÁUDIO] ${nome}`);
        try {
            this.logger.debug('⬇️ Baixando áudio...');
            const result = await this.mediaProcessor.downloadMedia(m.message, 'audio');
            await this.handleAudioMessage_internal(m, nome, numeroReal, replyInfo, ehGrupo, result?.buffer || null);
        }
        catch (error) {
            this.logger.error('❌ Erro áudio:', error.message);
        }
    }
    async handleAudioMessage_internal(m, nome, numeroReal, replyInfo, ehGrupo, audioBuffer) {
        try {
            if (!audioBuffer) {
                this.logger.error('❌ Buffer áudio vazio');
                return;
            }
            const transcricao = await this.mediaProcessor.transcribeAudio(audioBuffer);
            if (!transcricao.sucesso) {
                this.logger.warn('⚠️ Falha transcrição');
                return;
            }
            this.logger.info(`📝 Transcrição: ${transcricao.texto.substring(0, 80)}`);
            await this.handleTextMessage(m, nome, numeroReal, transcricao.texto, replyInfo, ehGrupo, true);
        }
        catch (error) {
            this.logger.error('❌ Erro áudio interno:', error.message);
        }
    }
    async handleTextMessage(m, nome, numeroReal, texto, replyInfo, ehGrupo, foiAudio = false) {
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
                    const opcoes = ehGrupo ? { quoted: m } : {};
                    await this.sock.sendMessage(m.key.remoteJid, { text: msg }, opcoes);
                    return;
                }
            }
            else if (!isOwner && this.moderationSystem?.checkAndLimitHourlyMessages) {
                // Sem ModerationSystem ativo, não bloqueamos usuários (evita bloquear dono no PV)
                this.logger.debug(`⏳ [RATE] Sem moderationSystem. Permitindo ${nome}.`);
            }
            // REMOVIDO: fallback checkRateLimit que bloqueava usuários novos no PV
            // 2. Verificar se é comando (Ignora IA se for #comando)
            if (this.messageProcessor.isCommand(texto)) {
                this.logger.info(`⚡ COMANDO: ${texto.substring(0, 30)}`);
                try {
                    const handled = await this.commandHandler.handle(m, { nome, numeroReal, texto, replyInfo, ehGrupo });
                    if (handled) {
                        // MARK AS READ - ticks azuis instantâneos para comandos
                        if (this.presenceSimulator) {
                            this.presenceSimulator.simulateTicks(m, true).catch(() => { });
                        }
                        // XP para comandos em grupos com leveling
                        if (ehGrupo && this.config.FEATURE_LEVELING && this.levelSystem &&
                            this.groupManagement?.groupSettings[m.key.remoteJid]?.leveling) {
                            const xp = this.levelSystem.awardXp(m.key.remoteJid, numeroReal, 5);
                            if (xp)
                                this.logger.info(`📈 [LEVEL] ${nome} +5 XP (comando)`);
                        }
                        return; // COMANDO PROCESSADO ✓
                    }
                }
                catch (err) {
                    this.logger.error(`❌ CommandHandler erro: ${err.message}`);
                }
                // Fallback: comando desconhecido continua para AI
            }
            // 3. Decisão de resposta da IA (passa nome e numero para verificar Morena exclusiva)
            const deveResponder = this.shouldRespondToAI(m, texto, ehGrupo, replyInfo, nome, numeroReal);
            if (!deveResponder) {
                this.logger.debug(`⏭️ Ignorado: ${texto.substring(0, 50)}`);
                return;
            }
            // 4. Processar Resposta via API
            this.logger.info(`🤖 Resposta para ${nome}: ${texto.substring(0, 30)}...`);
            if (ehGrupo && this.config.FEATURE_LEVELING && this.levelSystem && this.groupManagement?.groupSettings[m.key.remoteJid]?.leveling) {
                const xp = this.levelSystem.awardXp(m.key.remoteJid, numeroReal, 10);
                if (xp)
                    this.logger.info(`📈 [LEVEL] ${nome} +10 XP`);
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
                if (xp)
                    this.logger.info(`📈 [LEVEL] ${nome} +10 XP`);
            }
            const grupoNome = ehGrupo ? (m.key.remoteJid.split('@')[0] || 'Grupo Desconhecido') : null;
            const tipoConversa = ehGrupo ? 'grupo' : 'pv';
            const payload = this.apiClient.buildPayload({
                usuario: nome,
                numero: numeroReal,
                mensagem: texto,
                tipo_conversa: tipoConversa,
                grupo_id: ehGrupo ? m.key.remoteJid : null,
                grupo_nome: grupoNome,
                tipo_mensagem: foiAudio ? 'audio' : 'texto',
                mensagem_citada: replyInfo?.textoMensagemCitada || '',
                reply_metadata: replyMetadata,
                is_bot_self_response: false,
                is_group: ehGrupo,
                sender_is_bot: false
            });
            // ✅ Inicia composing ANTES da API com delay mínimo de 800ms
            // Garante que o usuário sempre vê o status 'digitando' antes da resposta
            if (this.presenceSimulator) {
                this.presenceSimulator.safeSendPresenceUpdate('composing', m.key.remoteJid).catch(() => { });
            }
            // Delay mínimo: garante que o composing aparece na UI antes da mensagem
            const composingStart = Date.now();
            const resultado = await this.apiClient.processMessage(payload);
            if (!resultado.success) {
                if (this.presenceSimulator)
                    await this.presenceSimulator.stop(m.key.remoteJid);
                this.logger.error('❌ Erro API:', resultado.error);
                const opcoes = ehGrupo ? { quoted: m } : {};
                await this.sock.sendMessage(m.key.remoteJid, { text: 'Tive um problema. Tenta de novo?' }, opcoes);
                return;
            }
            // Garante delay mínimo de 800ms de composing para qualquer resposta
            const elapsed = Date.now() - composingStart;
            if (elapsed < 800)
                await delay(800 - elapsed);
            const resposta = resultado.resposta || 'Sem resposta';
            if (foiAudio) {
                this.logger.info('🎤 [AUDIO RESPONSE]');
                if (this.presenceSimulator)
                    await this.presenceSimulator.simulateRecording(m.key.remoteJid, 2000);
                try {
                    const tts = await this.audioProcessor.textToSpeech(resposta);
                    const bufferValid = tts?.buffer && Buffer.isBuffer(tts.buffer) && tts.buffer.length > 0;
                    if (!tts.sucesso || !bufferValid) {
                        this.logger.warn('⚠️ Falha TTS', tts?.error || tts?.message || 'sem buffer de áudio');
                        if (this.presenceSimulator)
                            await this.presenceSimulator.stop(m.key.remoteJid);
                        await this.sock.sendMessage(m.key.remoteJid, { text: resposta }, { quoted: m });
                    }
                    else {
                        this.logger.info('📤 Voice Note...');
                        if (this.presenceSimulator)
                            await this.presenceSimulator.stop(m.key.remoteJid);
                        await this.sock.sendMessage(m.key.remoteJid, {
                            audio: tts.buffer,
                            mimetype: tts.mimetype || 'audio/ogg; codecs=opus',
                            ptt: true
                        }, { quoted: m });
                    }
                }
                catch (err) {
                    this.logger.error(`❌ Erro TTS: ${err.message}`);
                    if (this.presenceSimulator)
                        await this.presenceSimulator.stop(m.key.remoteJid);
                    await this.sock.sendMessage(m.key.remoteJid, { text: resposta }, { quoted: m });
                }
                if (this.presenceSimulator)
                    await this.presenceSimulator.markAsRead(m);
            }
            else {
                // ✅ BUG FIX #3: Para o 'composing' iniciado antes da API e envia imediatamente
                // O 'composing' já foi disparado ANTES da chamada à API.
                // Aqui apenas paramos e enviamos — sem nenhum delay extra.
                if (this.presenceSimulator)
                    await this.presenceSimulator.stop(m.key.remoteJid);
                // ✅ SEMPRE reply em grupos - Akira responde diretamente ao usuário
                const opcoes = ehGrupo ? { quoted: m } : {};
                await this.sock.sendMessage(m.key.remoteJid, { text: resposta }, opcoes);
                this.logger.info(`✅ [DISPATCH OK]`);
                if (this.presenceSimulator)
                    await this.presenceSimulator.markAsRead(m);
            }
            this.logger.info(`✅ [RESPONDIDO] ${resposta.substring(0, 80)}`);
        }
        catch (error) {
            // ✅ BUG FIX: Imprime o erro completo, não apenas .message (que pode ser undefined)
            const errMsg = error?.message || String(error) || 'erro desconhecido';
            const errStack = error?.stack ? `\n${error.stack.split('\n').slice(0, 3).join('\n')}` : '';
            this.logger.error(`❌ Erro texto: ${errMsg}${errStack}`);
        }
    }
    async simulateTyping(jid, durationMs) {
        try {
            if (!this.sock)
                return;
            await this.sock.sendPresenceUpdate('available', jid);
            await delay(300);
            await this.sock.sendPresenceUpdate('composing', jid);
            await delay(durationMs);
            await this.sock.sendPresenceUpdate('paused', jid);
        }
        catch (e) {
            this.logger.debug('Erro typing:', e.message);
        }
    }
    async reply(m, text, options = {}) {
        try {
            if (!this.sock) {
                this.logger.warn('⚠️ Socket não disponível');
                return false;
            }
            return await this.sock.sendMessage(m.key.remoteJid, { text, ...options }, { quoted: m });
        }
        catch (error) {
            this.logger.error('❌ Erro reply:', error.message);
            return false;
        }
    }
    async handleViolation(m, tipo, limitStatus) {
        if (!this.sock)
            return;
        const jid = m.key.remoteJid;
        const participant = m.key.participant || m.key.remoteJid;
        const nome = m.pushName || 'Usuário';
        const numeroReal = participant?.split('@')[0] || '';
        this.logger.warn(`🚫 [VIOLAÇÃO] ${tipo} de ${participant} (${nome})`);
        try {
            // 1. Deletar mensagem
            await this.sock.sendMessage(jid, { delete: m.key });
            // 2. Notificar e agir com base no tipo
            if (tipo === 'link') {
                await this.sock.sendMessage(jid, {
                    text: `🚫 *ANTILINK* 🚫\n\n@${numeroReal}, links não são permitidos neste grupo.`,
                    mentions: [participant]
                });
            }
            else if (tipo === 'mute') {
                await this.sock.sendMessage(jid, { text: `🚫 *${nome} removido por falar durante o silenciamento!*` });
                await this.sock.groupParticipantsUpdate(jid, [participant], 'remove');
            }
            else if (tipo === 'rate_limit') {
                // MENSAGENS AGRESSIVAS BASEADO NO NÚMERO DE VIOLAÇÕES
                const violations = limitStatus?.violations || 1;
                const waitTime = limitStatus?.wait || '01:00:00';
                let mensagem = '';
                if (violations === 1) {
                    // 1ª AVISO: Educado (ainda)
                    mensagem = `⏳ *LIMITE DE MENSAGENS EXCEDIDO* ⏳\n\n@${numeroReal}, você excedeu o limite de 50ms por hora.\n\n⏱️ *Seu contador será recarregado em:* ${waitTime}\n\nAguarde esse tempo para continuar usando a Akira.`;
                }
                else if (violations === 2) {
                    // 2ª AVISO: AGRESSIVO
                    mensagem = `⚠️ *PARE DE INCOMODAR!* ⚠️\n\n@${numeroReal}, você já foi avisado!\n\n*Para de incomodar e espera caralho!*\n\nMais uma tentativa e você será bloqueado PERMANENTEMENTE.`;
                }
                else if (violations >= 3) {
                    // 3ª AVISO: MUITO AGRESSIVO + BLOQUEIO
                    mensagem = `🚫 *VOCÊ É UMA MERDA!* 🚫\n\n@${numeroReal}, você é uma merda mesmo... é por isso que a namorada dele terminou com você!\n\n*BLOQUEADO PERMANENTEMENTE!*\n\nSe tentar mandar mensagem de novo, será ignorado pela Akira PARA SEMPRE.`;
                }
                await this.sock.sendMessage(jid, {
                    text: mensagem,
                    mentions: [participant]
                });
            }
            else {
                await this.sock.sendMessage(jid, {
                    text: `🚫 *ANTI-${tipo.toUpperCase()}* 🚫\n\nEste tipo de mídia não é permitido no momento.`,
                    mentions: [participant]
                });
            }
        }
        catch (e) {
            this.logger.error(`Erro ao tratar violação: ${e.message}`);
        }
    }
    /**
     * Lógica central de decisão de resposta da IA
     */
    shouldRespondToAI(m, texto, ehGrupo, replyInfo, nomeRemetente = '', numeroRemetente = '') {
        // Removed PV short-circuit per user request
        // Universal logic
        const textoLower = (texto || '').toLowerCase();
        const botName = (this.config.BOT_NAME || 'akira').toLowerCase();
        // 1. Responde se for menção direta ao bot (@JID)
        if (this.messageProcessor.isBotMentioned(m))
            return true;
        // 1.1 Verificação extra de menção por número do bot (config.BOT_NUMERO_REAL para multi-device)
        const botNumber = JidUtils.getNumber(String(this.config.BOT_NUMERO_REAL));
        if (botNumber && (texto.includes(`@${botNumber}`) || texto.includes(botNumber))) {
            this.logger.debug(`🔍 Mention by number detected: ${botNumber} in "${texto.substring(0, 50)}"`);
            return true;
        }
        // 2. Responde se for reply ao bot
        if (replyInfo?.ehRespostaAoBot)
            return true;
        // 3. Responde ao nome público do bot (qualquer um pode chamar)
        if (textoLower.includes(botName))
            return true;
        // 4. ✅ BUG FIX: 'Morena'/'Morema' é EXCLUSIVO do Dono
        // Não-donos que usam 'morena' no texto são completamente ignorados
        const isOwner = typeof this.config?.isDono === 'function'
            ? this.config.isDono(numeroRemetente, nomeRemetente)
            : false;
        if ((textoLower.includes('morena') || textoLower.includes('morema')) && isOwner)
            return true;
        // 5. Se for reply a outra pessoa no grupo, ignora
        if (replyInfo?.isReply && !replyInfo?.ehRespostaAoBot)
            return false;
        return false;
    }
    _cleanAuthOnError() {
        try {
            if (fs.existsSync(this.config.AUTH_FOLDER)) {
                fs.rmSync(this.config.AUTH_FOLDER, { recursive: true, force: true });
                this.logger.info('🧹 Credenciais limpas');
            }
            this.isConnected = false;
            this.currentQR = null;
            this.BOT_JID = null;
            this.reconnectAttempts = 0;
        }
        catch (error) {
            this.logger.error('❌ Erro limpar credenciais:', error.message);
        }
    }
    getStatus() {
        return {
            isConnected: this.isConnected,
            botJid: JidUtils.normalize(this.BOT_JID),
            botNumero: JidUtils.getNumber(this.BOT_JID),
            botName: this.config.BOT_NAME,
            version: this.config.BOT_VERSION,
            uptime: Math.floor(process.uptime()),
            hasQR: !!this.currentQR,
            reconnectAttempts: this.reconnectAttempts
        };
    }
    getQRCode() {
        return this.currentQR;
    }
    getStats() {
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
    async _forceQRGeneration() {
        this.logger.info('🔄 Forçando geração de novo QR code...');
        this.currentQR = null;
        if (this.sock) {
            try {
                this.sock.ev.removeAllListeners();
                this.sock.ws?.close();
            }
            catch (e) {
                this.logger.warn('Erro ao limpar socket:', e.message);
            }
            this.sock = null;
        }
        this.isConnected = false;
        this.BOT_JID = null;
        await delay(1000);
        await this.connect();
    }
    async disconnect() {
        try {
            this.logger.info('🔴 Desconectando...');
            // ✅ NOVO: Parar de manter presença quando desconectar
            if (this.presenceSimulator) {
                this.presenceSimulator.stopMaintainingPresence();
            }
            if (this.sock) {
                try {
                    this.sock.ev.removeAllListeners();
                    this.sock.ws?.close();
                }
                catch (e) {
                    this.logger.warn('Erro limpar socket:', e.message);
                }
                this.sock = null;
            }
            this.isConnected = false;
            this.currentQR = null;
            this.BOT_JID = null;
            this.logger.info('✅ Desconectado');
        }
        catch (error) {
            this.logger.error('❌ Erro desconectar:', error.message);
        }
    }
    /**
     * Intercepta passivamente mensagens de canais (Newsletters)
     * e guarda os dados estruturados para futuro treino da inteligência artificial.
     * Não gera respostas, logs no terminal (evitar spam) nem conta para Rate Limits.
     */
    _sniffNewsletter(m, remoteJid) {
        try {
            if (!m.message || !this.config)
                return;
            const sniffDir = path.join(this.config.DATABASE_FOLDER || './database', 'sniffed_data');
            if (!fs.existsSync(sniffDir))
                fs.mkdirSync(sniffDir, { recursive: true });
            const timestamp = m.messageTimestamp ? new Date(m.messageTimestamp * 1000).toISOString() : new Date().toISOString();
            const pushName = m.pushName || 'Newsletter';
            const messageType = Object.keys(m.message)[0];
            let content = '';
            if (this.messageProcessor) {
                content = this.messageProcessor.extractText(m) || '';
            }
            // Ignorar mensagens de sistema vazias que não sejam mídia
            if (!content && messageType !== 'imageMessage' && messageType !== 'videoMessage')
                return;
            const sniffData = {
                timestamp,
                channelId: remoteJid,
                channelName: pushName,
                type: messageType,
                content: content,
                messageId: m.key?.id
            };
            const filePath = path.join(sniffDir, 'newsletters_corpus.jsonl');
            fs.appendFileSync(filePath, JSON.stringify(sniffData) + '\n');
            // Envia para o backend Python auxiliar no treinamento offline
            if (this.apiClient) {
                this.apiClient.sendSniffData(sniffData);
            }
            // Log opcional muito sutil (silenciado por defeito para evitar console spam)
            // this.logger.debug(`📡 [SNIFFER] Capturada: ${pushName}`);
        }
        catch (e) {
            // Ignorado silenciosamente para não interromper outros fluxos
        }
    }
}
export default BotCore;
