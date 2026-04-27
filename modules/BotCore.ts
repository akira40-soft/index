/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CLASSE: BotCore
 * ═══════════════════════════════════════════════════════════════════════════
 * Núcleo central do bot Akira.
 * 
 * 📋 ARQUITETURA DE RATE LIMIT (Profissional):
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * ORDEM DE PROCESSAMENTO:
 * 1. Mensagem chega → shouldRespondToAI() FILTRA
 * 2. Se retorna FALSE → Mensagem NÃO conta no rate limit (ignora)
 * 3. Se retorna TRUE → Mensagem CONTA no rate limit (check executed)
 * 
 * CONTEXTO PV (tipoConversa = 'pv'):
 * ├─ shouldRespondToAI() → SEMPRE true (toda msg é direcionada por definição)
 * ├─ Rate limit: 50 msgs/hora (free) | ilimitado (premium/owner)
 * └─ Logs: ⏱️ [RATE LIMIT ATIVO] 💬 PV (todas as msgs)
 * 
 * CONTEXTO GRUPO (tipoConversa = 'grupo'):
 * ├─ MENSAGEM GENÉRICA ("oi tudo bem"):
 * │  ├─ shouldRespondToAI() → FALSE
 * │  ├─ ⏭️ [IGNORADO] (genérico em grupo)
 * │  └─ ❌ NÃO e conta no rate limit
 * │
 * ├─ MENÇÃO (@bot):
 * │  ├─ shouldRespondToAI() → TRUE
 * │  ├─ ⏱️ [RATE LIMIT ATIVO] 👥 GRUPO (menção/reply/comando)
 * │  └─ ✅ CONTA no rate limit: 100 msgs/hora (free)
 * │
 * ├─ COMANDO (#comando):
 * │  ├─ shouldRespondToAI() → TRUE (via CommandHandler)
 * │  ├─ ⏱️ [RATE LIMIT ATIVO] 👥 GRUPO (menção/reply/comando)
 * │  └─ ✅ CONTA no rate limit: 100 msgs/hora (free)
 * │
 * └─ REPLY AO BOT:
 *    ├─ shouldRespondToAI() → TRUE
 *    ├─ ⏱️ [RATE LIMIT ATIVO] 👥 GRUPO (menção/reply/comando)
 *    └─ ✅ CONTA no rate limit: 100 msgs/hora (free)
 * 
 * IMUNIDADE:
 * ├─ Owner (isOwner=true) → SEM LIMITE
 * └─ Premium (isPremium=true) → SEM LIMITE
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

import * as Baileys from '@whiskeysockets/baileys';
const {
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    delay,
    Browsers,
    getContentType
} = Baileys as any;

// @ts-ignore
const makeWASocket = (Baileys as any).default ?? (Baileys as any).makeWASocket;

import { MessageStore } from './MessageStore.js';

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
    public economySystem: any;
    public presenceSimulator: any;
    public store: any;
    private storePath: string = '';
    public rateLimiter: any;
    public gameSystem: any;
    public gridTacticsGame: any;
    public userProfile: any;
    public botProfile: any;
    public groupManagement: any;
    public imageEffects: any;
    public permissionManager: any;
    public stickerViewOnceHandler: any;
    public commandHandler: any;

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
        this.logger = pino({
            level: this.config.LOG_LEVEL || 'info',
            transport: {
                target: 'pino-pretty',
                options: { colorize: true }
            }
        });

        // Inicializa store de mensagens próprio (makeInMemoryStore foi removido do Baileys 6.7+)
        this.storePath = path.join(this.config.DATABASE_FOLDER, 'baileys_store.json');
        this.store = new MessageStore();
        this._loadStore();
        this.sock = null;
    }

    private _loadStore() {
        try {
            if (fs.existsSync(this.storePath)) {
                this.store.readFromFile(this.storePath);
                this.logger.debug('✅ Store carregado com sucesso');
            }
        } catch (e: any) {
            this.logger.warn(`⚠️ Falha ao carregar store: ${e.message}`);
        }
    }

    private _saveStore() {
        try {
            const dir = path.dirname(this.storePath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            this.store.writeToFile(this.storePath);
        } catch (e: any) {
            this.logger.error(`❌ Falha ao salvar store: ${e.message}`);
        }
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
        this._installBadMACHandler();
        await this.initialize();
        await this.connect();
    }

    /**
     * Silencia erros "Bad MAC" não fatais do libsignal no log.
     * O bot continua funcionando normalmente — a mensagem simplesmente não
     * pôde ser decriptada (sessão Signal expirada). Isso é esperado após
     * reconexões e resolve-se sozinho quando a sessão é renegociada.
     */
    private _installBadMACHandler(): void {
        // 1. Silenciar unhandledRejection (prevenir logs de sistema)
        const originalEmit = process.emit.bind(process);
        (process as any).emit = function (event: string, error: any, ...args: any[]) {
            if (event === 'unhandledRejection' || event === 'uncaughtException') {
                const msg = error?.message || String(error);
                if (msg.includes('Bad MAC') || msg.includes('Failed to decrypt') || msg.includes('known session')) {
                    return false;
                }
            }
            return originalEmit(event, error, ...args);
        };

        // 2. Silenciar console.error (prevenir ruído visual no terminal)
        const originalError = console.error;
        console.error = (...args: any[]) => {
            const msg = args.join(' ');
            if (msg.includes('Bad MAC') || msg.includes('Failed to decrypt') || msg.includes('known session')) {
                return;
            }
            originalError.apply(console, args);
        };
    }

    /**
     * Purga arquivos de sessão Signal corrompidos/expirados.
     * Mantém creds.json intacto — sem necessidade de novo QR.
     * Chamado automaticamente na conexão bem-sucedida.
     */
    private async _purgeCorruptedSessions(): Promise<void> {
        try {
            const authFolder = this.config.AUTH_FOLDER;
            if (!fs.existsSync(authFolder)) return;

            const files = fs.readdirSync(authFolder);
            // Padrões que costumam causar "Bad MAC" quando dessincronizados
            const stalePatterns = ['session-', 'sender-key-', 'app-state-sync-', 'pre-key-'];
            let purged = 0;

            for (const file of files) {
                const isStale = stalePatterns.some(p => file.startsWith(p));
                if (isStale) {
                    try {
                        const filePath = path.join(authFolder, file);
                        const stats = fs.statSync(filePath);
                        const ageMs = Date.now() - stats.mtimeMs;

                        // Purgar agressivamente sessões e chaves de remetente (causa principal do Bad MAC)
                        // Pre-keys agora limpamos se tiverem mais de 1 hora (em vez de 24h)
                        // Isso força a regeneração se o Signal se perder
                        if (file.startsWith('pre-key-')) {
                            if (ageMs > 1 * 60 * 60 * 1000) {
                                fs.unlinkSync(filePath);
                                purged++;
                            }
                        } else if (file.startsWith('sender-key-')) {
                            // Chaves de grupo são as mais problemáticas — limpa sempre que houver suspeita
                            fs.unlinkSync(filePath);
                            purged++;
                        } else {
                            // Outros tipos de sessão (app-state, etc) limpa sempre
                            fs.unlinkSync(filePath);
                            purged++;
                        }
                    } catch (_) { }
                }
            }

            if (purged > 0) {
                this.logger.info(`🧹 [Bad MAC Fix] ${purged} arquivos de sinal/sessão obsoletos removidos.`);
            }
        } catch (e: any) {
            this.logger.warn(`⚠️ [Bad MAC Fix] Erro ao purgar sessões: ${e.message}`);
        }
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

                    // Inicializa módulos async do CommandHandler
                    await this.commandHandler.initAsyncModules();

                    this.logger.debug('✅ CommandHandler inicializado (ESM Safe + Async Modules)');
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
        // ✅ [CRÍTICO] Purgar sessões corrompidas ANTES de carregar o estado
        // Isso previne que o Baileys carregue arquivos "Bad MAC" na memória
        await this._purgeCorruptedSessions().catch(() => { });

        // ✅ Instalar silenciador de ruído Signal (Bad MAC)
        this._installBadMACHandler();

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
                syncFullHistory: false, // ✅ MODERNO: Não carrega histórico antigo (evita corromper chaves)
                markOnlineOnConnect: true,
                maxMsgRetryCount: 15, // ✅ AGRESSIVO: Tenta 15 vezes decriptar antes de dar erro
                getMessage: async (key: any) => {
                    if (this.store) {
                        const msg = await this.store.loadMessage(key.remoteJid, key.id);
                        return msg?.message || undefined;
                    }
                    return undefined;
                },
                connectTimeoutMs: 60000,
                defaultQueryTimeoutMs: 60000,
                keepAliveIntervalMs: 30000,
                emitOwnEvents: false,
                retryRequestDelayMs: 500
            };

            const agent = HFCorrections.createHFAgent();
            if (agent) {
                socketConfig.agent = agent;
                this.logger.info('🌐 Agente HTTP personalizado');
            }

            this.sock = makeWASocket(socketConfig);

            // Liga o store ao socket
            // Liga o store ao socket (se disponível)
            if (this.store) {
                this.store.bind(this.sock.ev);

                // Auto-salvamento periódico do store (a cada 10 min)
                setInterval(() => this._saveStore(), 10 * 60 * 1000);
            }

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

                    // ✅ NOVO: Parar de manter presença disponível quando desconectar
                    if (this.presenceSimulator) {
                        this.presenceSimulator.stopMaintainingPresence();
                    }

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
                    const normalizedJid = JidUtils.normalize(this.BOT_JID);
                    this.logger.info(`🤖 Logado como: ${normalizedJid}`);

                    // ✅ NOVO: Manter bot sempre disponível (nunca offline)
                    if (this.presenceSimulator) {
                        await this.presenceSimulator.maintainAvailablePresence();
                        this.logger.info('🟢 Status de presença: SEMPRE DISPONÍVEL');
                    }

                    if (this.eventListeners.onConnected) this.eventListeners.onConnected(normalizedJid);
                }
            });

            this.sock.ev.on('creds.update', saveCreds);

            // ✅ MAPEAMENTO DE LIDs (Linked IDs) - Novo padrão WhatsApp
            this.sock.ev.on('lid-mapping.update', (mappings: any[]) => {
                if (this.moderationSystem && Array.isArray(mappings)) {
                    for (const { jid, pn } of mappings) {
                        this.moderationSystem.updateLidMapping(jid, pn);
                    }
                }
            });

            this.sock.ev.on('messages.upsert', async ({ messages, type }: any) => {
                if (type !== 'notify') return;
                for (const m of messages) await this.processMessage(m);
            });

            this.sock.ev.on('group-participants.update', async (update: any) => {
                const { id, participants, action } = update;
                this.logger.debug(`👥 [GROUP UPDATE] Ação: ${action} em ${id} | Participantes: ${participants.length}`);

                if (action === 'add') {
                    // 0. VERIFICAÇÃO DE BLACKLIST (Banimento Permanente)
                    const allowedParticipants: string[] = [];

                    if (this.moderationSystem) {
                        for (const participant of participants) {
                            if (this.moderationSystem.isBlacklisted(participant)) {
                                this.logger.warn(`🚫 [AUTO-BAN] Usuário banido tentou entrar no grupo ${id}: ${participant}`);
                                try {
                                    await this.sock.sendMessage(id, {
                                        text: `🚫 *BANIMENTO PERMANENTE* 🚫\n\nO usuário @${participant.split('@')[0]} está na lista negra global da Akira e foi removido automaticamente.`,
                                        mentions: [participant]
                                    });
                                    await this.sock.groupParticipantsUpdate(id, [participant], 'remove');
                                } catch (e: any) {
                                    this.logger.error(`Falha ao executar auto-ban: ${e.message}`);
                                }
                            } else {
                                allowedParticipants.push(participant);
                            }
                        }
                    } else {
                        allowedParticipants.push(...participants);
                    }

                    if (allowedParticipants.length === 0) return;

                    // 1. Anti-Fake
                    const finalParticipants: string[] = [];
                    if (this.moderationSystem?.isAntiFakeActive(id)) {
                        for (const p of allowedParticipants) {
                            const resolvedJid = await this.resolveIdentity(p);
                            if (this.moderationSystem.isFakeNumber(resolvedJid, id)) {
                                this.logger.warn(`🚫 [ANTI-FAKE] ${resolvedJid} - DDD não permitido no grupo ${id}`);
                                try {
                                    await this.sock.sendMessage(id, { text: '⚠️ Número fake removido.' });
                                    await this.sock.groupParticipantsUpdate(id, [p], 'remove');
                                } catch (e) { }
                            } else {
                                finalParticipants.push(p);
                            }
                        }
                    } else {
                        finalParticipants.push(...allowedParticipants);
                    }

                    if (finalParticipants.length === 0) return;

                    // 2. Welcome Message
                    if (this.groupManagement && this.groupManagement.getWelcomeStatus(id)) {
                        this.logger.info(`👋 Enviando Welcome para ${finalParticipants.length} membros no grupo ${id}`);
                        await this.groupManagement.sendWelcomeMessage(id, finalParticipants);
                    }
                }

                if (action === 'remove' && this.groupManagement && this.groupManagement.getGoodbyeStatus(id)) {
                    this.logger.info(`👋 Enviando Goodbye para ${participants.length} membros no grupo ${id}`);
                    await this.groupManagement.sendGoodbyeMessage(id, participants);
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

            // ✅ VALIDAÇÃO RÍGIDA: Ignorar mensagens do próprio bot
            if (m.key.fromMe) {
                if (shouldLog) this.logger.debug('⏭️ Mensagem é do bot (fromMe=true)');
                return;
            }

            if (m.message.protocolMessage) return;

            if (this.connectionStartTime && m.messageTimestamp) {
                const messageTimeMs = Number(m.messageTimestamp) * 1000;
                if (messageTimeMs < this.connectionStartTime - 5000) {
                    if (shouldLog) this.logger.debug(`⏭️ Ignorado mensagem antiga (backlog): ${new Date(messageTimeMs).toISOString()}`);
                    return;
                }
            }

            if (shouldLog) this.logger.debug('🔹 [PIPELINE] Válida');

            const remoteJid = String(m.key.remoteJid || '');

            // ✅ VALIDAÇÃO CORRETA: Usar métodos Type-Safe para detectar tipo de conversa
            const ehGrupo = remoteJid.endsWith('@g.us');
            const ehStatus = remoteJid === 'status@broadcast';
            const ehNewsletter = remoteJid.endsWith('@newsletter');

            // ✅ BUG FIX: Ignorar Status e Newsletters imediatamente
            // Evita que Newsletters esgotem o rate limit do utilizador e poluem logs
            if (ehStatus) return;
            if (ehNewsletter) {
                // [NOVA FEATURE] Escuta passiva de canais para recolha de "raw data" para treino base sem despender chamadas API
                this._sniffNewsletter(m, remoteJid);
                return;
            }

            if (!this.messageProcessor) throw new Error('messageProcessor não inicializado');

            // Extrair informações ANTES de qualquer processamento
            let numero = await this.messageProcessor.extractUserNumber(m, this.sock);

            // ✅ RESOLVER LID PARA PN (UNIFICAÇÃO DE IDENTIDADE)
            if (numero && numero.includes('@lid')) {
                const resolved = await this.resolveIdentity(numero);
                if (resolved) numero = resolved;
            }

            const conversationType = this.messageProcessor.getConversationType(m);

            // ✅ VALIDAÇÃO DUPLA: Também verificar se o numero é do bot
            const botNumero = JidUtils.getNumber(String(this.config.BOT_NUMERO_REAL));
            const numeroLimpo = JidUtils.getNumber(numero);
            if (numeroLimpo === botNumero) {
                if (shouldLog) this.logger.debug(`⏭️ Ignorado: mensagem é do próprio bot (numero: ${numero})`);
                return;
            }

            // ── REGRA DE OURO: DESCARTAR SPAM/LIXO ANTES DE QUALQUER COISA ──
            const text = (this.messageProcessor.extractText(m) || '').trim();
            const prefixo = this.config.PREFIXO || '#';
            let isCommand = text.startsWith(prefixo);
            const isMention = text.includes(`@${this.BOT_JID?.split('@')[0]}`);
            const isReplyToMe = m.message?.extendedTextMessage?.contextInfo?.participant === this.BOT_JID;

            // Log de diagnóstico para o dono
            if (isCommand || !ehGrupo) {
                console.log(`📩 [RECEBIDO] De: ${numero} | Texto: "${text.substring(0, 30)}" | Cmd: ${isCommand} | Grupo: ${ehGrupo}`);
            }

            // Se for grupo e NÃO for comando/menção/reply, ignora IMEDIATAMENTE (silencioso)
            if (ehGrupo && !isCommand && !isMention && !isReplyToMe) {
                return;
            }

            // [NFA] Feedback Imediato: Marca como entregue (2 ticks cinzas) assim que entra na fila
            if (this.presenceSimulator) {
                this.presenceSimulator.simulateTicks(m, false, ehGrupo).catch(() => { });
            }

            const nome = await this._resolveUserName(m, numero, remoteJid);
            // 🔧 CRITICAL FIX: Normalize number to pure digits, removing 'lid_' prefix or any other suffix
            // Garante que numeroReal é sempre apenas dígitos puros, sem prefixos ou sufixos
            const numeroReal = JidUtils.normalizeUserNumber(numero) || 'desconhecido';
            const conversaType = conversationType;

            if (shouldLog) {
                this.logger.debug(`🔹 [PIPELINE] ${numeroReal} (${conversaType}) remoteJid=${remoteJid.substring(0, 20)} ehGrupo=${ehGrupo}`);
            }

            if (this.moderationSystem?.isBlacklisted(numeroReal)) {
                this.logger.debug(`🚫 Banido: ${nome}`);
                return;
            }

            const texto = this.messageProcessor.extractText(m);
            const temImagem = this.messageProcessor.hasImage(m);
            const temAudio = this.messageProcessor.hasAudio(m);
            const caption = this.messageProcessor.extractText(m) || '';
            const participant = m.key.participant || m.key.remoteJid;
            const replyInfo = await this.messageProcessor.extractReplyInfo(m);
            const temSticker = !!m.message?.stickerMessage;
            const textoFinal = texto || caption;

            // ✅ MODERATION CHECKS (Prioridade Máxima em Grupos)
            // Deve rodar antes de comandos e antes de qualquer decisão da IA para garantir segurança total
            if (ehGrupo && this.moderationSystem) {
                let isAdmin = false;
                try {
                    if (this.groupManagement) isAdmin = await this.groupManagement.isUserAdmin(remoteJid, participant);
                } catch (e) { isAdmin = false; }

                if (!isAdmin) {
                    // -1. Verifica se usuário está mutado (Silenciado = Apaga TUDO)
                    if (this.moderationSystem.isMuted(remoteJid, participant)) {
                        await this.sock.sendMessage(remoteJid, { delete: m.key });
                        return;
                    }

                    // 0. AntiFlood / AntiSpam
                    if (this.moderationSystem.isAntiSpamActive(remoteJid)) {
                        // Normaliza o participant para evitar erros com multi-device (:suffix)
                        const normalizedParticipant = JidUtils.normalize(participant);
                        const floodStatus = this.moderationSystem.checkFlood(remoteJid, normalizedParticipant);
                        if (floodStatus.action !== 'none') {
                            await this.handleViolation(m, `flood_${floodStatus.action}`, floodStatus);
                            return;
                        }
                    }

                    // 1. AntiLink
                    if (textoFinal && this.moderationSystem.isAntiLinkActive(remoteJid)) {
                        if (this.moderationSystem.checkLink(textoFinal, remoteJid, participant, isAdmin)) {
                            await this.handleViolation(m, 'link');
                            return;
                        }
                    }

                    // 2. AntiSticker
                    if (temSticker && this.moderationSystem.isAntiStickerActive(remoteJid)) {
                        await this.handleViolation(m, 'sticker');
                        return;
                    }

                    // 3. AntiImage
                    if (temImagem && this.moderationSystem.isAntiImageActive(remoteJid)) {
                        await this.handleViolation(m, 'imagem');
                        return;
                    }

                    // 4. AntiBadwords
                    if (textoFinal && this.moderationSystem.isAntiBadwordsActive(remoteJid)) {
                        const bwStatus = this.moderationSystem.checkBadwords(textoFinal, remoteJid, participant);
                        if (bwStatus.action !== 'none') {
                            await this.handleViolation(m, `badword_${bwStatus.action}`, bwStatus);
                            // Apaga as mensagens recentes independente da ação
                            await this._deleteRecentMessages(remoteJid, participant, 5, m.key.id);
                            return;
                        }
                    }
                }
            }

            isCommand = isCommand || this.messageProcessor.isCommand(textoFinal);

            // ═══ FILTRO DE ÁUDIO EM GRUPO ═══
            // Em grupos, áudios SEM reply ao bot são completamente ignorados:
            // não transcrevemos, não gastamos tokens Deepgram, não contamos rate limit.
            // A única forma de ativar a Akira via áudio no grupo é mandar o áudio em REPLY a ela.
            if (temAudio && ehGrupo) {
                const ehReplyAoBotParaAudio = !!replyInfo?.ehRespostaAoBot;
                if (!ehReplyAoBotParaAudio) {
                    this.logger.debug(`⏭️ [ÁUDIO GRUPO IGNORADO] ${nome}: áudio sem reply ao bot`);
                    return;
                }
            }

            if (shouldLog) this.logger.debug(`🔹 [PIPELINE] txt=${!!texto} img=${temImagem} aud=${temAudio} sticker=${temSticker}`);

            if (ehGrupo && this.moderationSystem?.isMuted(remoteJid, participant)) {
                await this.handleViolation(m, 'mute');
                return;
            }

            if (isCommand) {
                if (shouldLog) this.logger.debug(`🔹 [PIPELINE] comando detectado: ${textoFinal.substring(0, 50)}`);
                await this.handleTextMessage(m, nome, numeroReal, textoFinal, replyInfo, ehGrupo);
                return;
            }

            // 3. Decisão de resposta da IA
            const deveResponder = this.shouldRespondToAI(m, textoFinal, ehGrupo, replyInfo, nome, numeroReal);

            // ✅ XP para TODA mensagem em grupo ANTES do return ou processamento da IA
            if (ehGrupo && this.config.FEATURE_LEVELING && this.levelSystem &&
                this.groupManagement?.groupSettings[remoteJid]?.leveling) {
                // 🔧 Garantir que numeroReal é limpo sem 'lid_' prefix
                const numeroLimpoXP = JidUtils.cleanPhoneNumber(numeroReal) || numeroReal;
                const xpResult = this.levelSystem.awardXp(remoteJid, numeroLimpoXP, 10);
                if (xpResult?.leveled) {
                    this.logger.info(`🎉 [LEVEL UP] ${nome} → Nível ${xpResult.rec?.level}!`);
                    this.sock.sendMessage(remoteJid, {
                        text: `🎉 *@${numeroLimpoXP}* subiu para o *Nível ${xpResult.rec?.level}*! 🏆`,
                        mentions: [m.key.participant || remoteJid]
                    }).catch(() => { });
                } else {
                    this.logger.debug(`📈 [LEVEL] ${nome} +10 XP | total: ${xpResult?.rec?.xp}`);
                }
            }

            if (!deveResponder) {
                if (ehGrupo) {
                    this.logger.debug(`⏭️ [ESCUTA GRUPO] ${nome}: "${textoFinal.substring(0, 50)}"`);
                    const grupoNome = remoteJid.split('@')[0] || 'Grupo Desconhecido';
                    this.apiClient.listenMessage({
                        usuario: nome,
                        numero: numeroReal,
                        mensagem: textoFinal,
                        tipo_conversa: 'grupo',
                        grupo_id: remoteJid,
                        grupo_nome: grupoNome
                    }).catch(() => { });
                } else {
                    this.logger.debug(`⏭️ [IGNORADO] ${nome}: "${textoFinal.substring(0, 50)}" (genérico${ehGrupo ? ' em grupo' : ''})`);
                }
                return;
            }

            // ✅ AQUI: Mensagem está sendo tratada - VAI CONTAR no rate limit
            const tipoRateLimit = ehGrupo ? '👥 GRUPO (menção/reply/comando)' : '💬 PV (todas as msgs)';
            this.logger.info(`⏱️ [RATE LIMIT ATIVO] ${tipoRateLimit} | ${nome}: "${textoFinal.substring(0, 50)}"`);

            // [NFA] Rate Limit Check - APENAS APÓS verificar se bot vai responder
            // Passa tipoConversa corretamente: grupo ou pv
            if (this.rateLimiter) {
                const isOwner = this.config.isDono(numeroReal);
                const tipoConversa = ehGrupo ? 'grupo' : 'pv'; // ✅ BUG FIX: Passa tipo de conversa
                const isPremium = false; // ✅ BotCore não tem info de premium (cmdHandler cuida disso)
                const limitStatus = this.rateLimiter.check(numeroReal, isOwner, isPremium, tipoConversa);
                if (!limitStatus.allowed) {
                    this.logger.warn(`⏳ [RATE LIMIT BLOQUEADO] ${nome} (${numeroReal}) - ${limitStatus.reason}`);
                    if (limitStatus.reason === 'RATE_LIMIT_EXCEEDED') {
                        await this.handleViolation(m, 'rate_limit', limitStatus);
                    }
                    return;
                } else {
                    this.logger.debug(`✅ [RATE LIMIT OK] ${nome}: ${limitStatus.remaining} mensagens restantes`);
                }
            }


            if (temImagem) {
                await this.handleImageMessage(m, nome, numeroReal, replyInfo, ehGrupo);
            } else if (temAudio) {
                // ═══ LÓGICA DE ÁUDIO ═══
                // Grupo: chegou aqui = já passou pelo filtro acima (= reply ao bot) → sempre ativa áudio
                // PV: qualquer áudio ativa STT + TTS
                await this.handleAudioMessage(m, nome, numeroReal, replyInfo, ehGrupo, true);
            } else {
                // Se for texto ou qualquer outra msg com texto (sticker com legenda, etc)
                await this.handleTextMessage(m, nome, numeroReal, texto || caption, replyInfo, ehGrupo);
            }
        } catch (error: any) {
            const errMsg = error?.message || String(error) || 'erro desconhecido';
            const errStack = error?.stack ? `\n${error.stack.split('\n').slice(0, 3).join('\n')}` : '';
            this.logger.error(`❌ Erro pipeline: ${errMsg}${errStack}`);
        }
    }

    async handleImageMessage(m: any, nome: string, numeroReal: string, replyInfo: any, ehGrupo: boolean): Promise<void> {
        this.logger.info(`🖼️ [IMAGEM] ${nome}`);
        if (ehGrupo && this.config.FEATURE_LEVELING && this.levelSystem && this.groupManagement?.groupSettings[m.key.remoteJid]?.leveling) {
            const numeroLimpoXP = JidUtils.cleanPhoneNumber(numeroReal) || numeroReal;
            const xp = this.levelSystem.awardXp(m.key.remoteJid, numeroLimpoXP, 15);
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

            // Digitação e Ticks agora ocorrem após a resposta no novo fluxo para realismo
            // (Simulação de silêncio enquanto processa)

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
                    quoted_author_name: await this.resolveAuthorName(replyInfo.participantJidCitado, m.key.remoteJid),
                    quoted_author_numero: replyInfo.quotedAuthorNumero || 'desconhecido'
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

            // ✅ NOVO FLUXO: Digitação Realista iniciada agora que temos a resposta
            if (this.presenceSimulator) {
                const typingDuration = this.presenceSimulator.calculateTypingDuration(resposta);
                this.logger.info(`✍️ [TYPING] Simulando digitação por ${Math.round(typingDuration / 1000)}s...`);

                // Inicia o "Digitando..." no WhatsApp
                await this.presenceSimulator.safeSendPresenceUpdate('composing', m.key.remoteJid);

                // Aguarda o tempo real de digitação (bloqueia o envio, mas não o bot inteiro)
                await delay(typingDuration);

                // Pára e envia
                await this.presenceSimulator.stop(m.key.remoteJid);
            }

            // ✅ LÓGICA DE REPLY CONDICIONAL - CORRIGIDA:
            // - PV NORMAL: responde SEM quote (opes vazio)
            // - PV REPLY: responde COM quote (quoted: m)
            // - GRUPO: SEMPRE com quote
            const opcoes: any = {};
            if (ehGrupo) {
                // Grupo: sempre reply
                opcoes.quoted = m;
            } else if (replyInfo?.isReply) {
                // PV reply: responde em reply
                opcoes.quoted = m;
            }
            // Se PV normal: opcoes fica vazio, responde normal

            await this.sock.sendMessage(m.key.remoteJid, { text: resposta }, opcoes);
            await this.presenceSimulator.simulateTicks(m, true, ehGrupo);
        } catch (error: any) {
            this.logger.error('❌ Erro imagem:', error.message);
        }
    }

    async handleAudioMessage(m: any, nome: string, numeroReal: string, replyInfo: any, ehGrupo: boolean, ativarRespostaEmAudio: boolean = true): Promise<void> {
        this.logger.info(`🎤 [ÁUDIO] ${nome} | grupo=${ehGrupo} | responderEmAudio=${ativarRespostaEmAudio}`);
        try {
            this.logger.debug('⬇️ Baixando áudio...');
            const result = await this.mediaProcessor.downloadMedia(m.message, 'audio');
            await this.handleAudioMessage_internal(m, nome, numeroReal, replyInfo, ehGrupo, result?.buffer || null, ativarRespostaEmAudio);
        } catch (error: any) {
            this.logger.error('❌ Erro áudio:', error.message);
        }
    }

    async handleAudioMessage_internal(m: any, nome: string, numeroReal: string, replyInfo: any, ehGrupo: boolean, audioBuffer: Buffer | null, ativarRespostaEmAudio: boolean = true): Promise<void> {
        try {
            if (!audioBuffer) { this.logger.error('❌ Buffer áudio vazio'); return; }

            const jid = m.key.remoteJid;

            // ═══ STATUS: "Gravando áudio" durante a transcrição (Deepgram) ═══
            // O WhatsApp mostra "gravando áudio..." enquanto ouvimos/transcrevemos
            if (this.presenceSimulator) {
                this.presenceSimulator.startRecordingLoop(jid).catch(() => { });
            }

            // Marca como lido (ticks azuis) antes de transcrever
            if (this.presenceSimulator) {
                this.presenceSimulator.simulateTicks(m, true, ehGrupo).catch(() => { });
            }

            this.logger.info('🎧 Transcrevendo áudio com Deepgram...');
            const transcricao = await this.audioProcessor.speechToText(audioBuffer);

            // Para o "recording" após STT concluir (handleTextMessage inicia o próprio loop de TTS)
            if (this.presenceSimulator) {
                await this.presenceSimulator.stop(jid);
            }

            if (!transcricao.sucesso) {
                this.logger.warn('⚠️ Falha transcrição'); return;
            }

            this.logger.info(`📝 Transcrição: ${transcricao.texto.substring(0, 80)}`);

            // foiAudio=ativarRespostaEmAudio: handleTextMessage sabe se deve responder em voz
            await this.handleTextMessage(m, nome, numeroReal, transcricao.texto, replyInfo, ehGrupo, ativarRespostaEmAudio);
        } catch (error: any) {
            this.logger.error('❌ Erro áudio interno:', error.message);
            if (this.presenceSimulator) await this.presenceSimulator.stop(m.key.remoteJid).catch(() => { });
        }
    }

    async handleTextMessage(m: any, nome: string, numeroReal: string, texto: string, replyInfo: any, ehGrupo: boolean, foiAudio: boolean = false): Promise<void> {
        try {
            // ✅ BUG FIX #1: isDono deve receber o NOME (pushName) do usuário, NÃO o texto da mensagem.
            // O texto da mensagem nunca contém 'morema', o NOME sim.
            const isOwner = typeof this.config?.isDono === 'function'
                ? this.config.isDono(JidUtils.normalizeUserNumber(numeroReal), nome)
                : false;

            if (!isOwner && this.moderationSystem?.checkAndLimitHourlyMessages) {
                const res = this.moderationSystem.checkAndLimitHourlyMessages(numeroReal, nome, numeroReal, texto, null, isOwner);
                if (!res?.allowed) {
                    const msg = res?.reason === 'LIMITE_HORARIO_EXCEDIDO' ? '⏰ Limite por hora excedido.' : '⏰ Muitas mensagens. Aguarde.';
                    const opcoes = ehGrupo ? { quoted: m } : {};
                    await this.sock.sendMessage(m.key.remoteJid, { text: msg }, opcoes);
                    return;
                }
            } else if (!isOwner && this.moderationSystem?.checkAndLimitHourlyMessages) {
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
                            this.presenceSimulator.simulateTicks(m, true, ehGrupo).catch(() => { });
                        }
                        // XP para comandos em grupos com leveling
                        if (ehGrupo && this.config.FEATURE_LEVELING && this.levelSystem &&
                            this.groupManagement?.groupSettings[m.key.remoteJid]?.leveling) {
                            const numeroLimpoXP = JidUtils.cleanPhoneNumber(numeroReal) || numeroReal;
                            const xp = this.levelSystem.awardXp(m.key.remoteJid, numeroLimpoXP, 5);
                            if (xp) this.logger.info(`📈 [LEVEL] ${nome} +5 XP (comando)`);
                        }
                        return; // COMANDO PROCESSADO ✓
                    }
                } catch (err: any) {
                    this.logger.error(`❌ CommandHandler erro: ${err.message}`);
                }
                // Fallback: comando desconhecido continua para AI
            }

            // 3. XP para TODA mensagem de texto em grupo com leveling ativo
            // (deve ser ANTES do deveResponder para contar msgs comuns do grupo)
            if (ehGrupo && this.config.FEATURE_LEVELING && this.levelSystem &&
                this.groupManagement?.groupSettings[m.key.remoteJid]?.leveling) {
                const numeroLimpoXP = JidUtils.cleanPhoneNumber(numeroReal) || numeroReal;
                const xpResult = this.levelSystem.awardXp(m.key.remoteJid, numeroLimpoXP, 10);
                if (xpResult?.leveled) {
                    this.logger.info(`🎉 [LEVEL UP] ${nome} você foi elevado ao nível ${xpResult.rec?.level}!`);
                    // Notifica o grupo sobre o level up
                    this.sock.sendMessage(m.key.remoteJid, {
                        text: `🎉 *@${numeroReal}* subiu para o *Nível ${xpResult.rec?.level}*! 🏆`,
                        mentions: [m.key.participant || m.key.remoteJid]
                    }).catch(() => { });
                } else {
                    this.logger.debug(`📈 [LEVEL] ${nome} +10 XP | total: ${xpResult?.rec?.xp}`);
                }
            }

            // 4. Decisão de resposta da IA
            const deveResponder = this.shouldRespondToAI(m, texto, ehGrupo, replyInfo, nome, numeroReal);

            if (!deveResponder) {
                this.logger.debug(`⏭️ Ignorado: ${texto.substring(0, 50)}`);
                return;
            }

            // 5. Processar Resposta via API
            this.logger.info(`🤖 Resposta para ${nome}: ${texto.substring(0, 30)}...`);

            const replyMetadata = replyInfo ? {
                is_reply: replyInfo.isReply || true,
                reply_to_bot: replyInfo.ehRespostaAoBot,
                quoted_author_name: await this.resolveAuthorName(replyInfo.participantJidCitado, m.key.remoteJid),
                quoted_author_numero: replyInfo.quotedAuthorNumero || 'desconhecido',
                quoted_type: replyInfo.quotedType || 'texto',
                quoted_text_original: replyInfo.quotedTextOriginal || '',
                context_hint: replyInfo.contextHint || '',
                priority_level: replyInfo.priorityLevel || 2
            } : { is_reply: false, reply_to_bot: false };

            // XP já foi premiado em cima para cada mensagem do grupo

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

            // 🤫 [SILÊNCIO] O bot agora "pensa" em silêncio antes de digitar (Realismo Humano)
            // (REMOVIDO: early composing)
            const processingStart = Date.now();

            const resultado = await this.apiClient.processMessage(payload);
            if (!resultado.success) {
                if (this.presenceSimulator) await this.presenceSimulator.stop(m.key.remoteJid);
                this.logger.error('❌ Erro API:', resultado.error);

                // ✅ MESMO PADRÃO DE REPLY CONDICIONAL EM CASO DE ERRO
                const opcoes: any = {};
                if (ehGrupo) {
                    opcoes.quoted = m;
                } else if (replyInfo?.isReply) {
                    opcoes.quoted = m;
                }

                await this.sock.sendMessage(m.key.remoteJid, { text: 'Tive um problema. Tenta de novo?' }, opcoes);
                return;
            }

            const resposta = resultado.resposta || 'Sem resposta';

            if (foiAudio) {
                this.logger.info('🎤 [AUDIO RESPONSE] Gerando voz com ElevenLabs...');

                // ═══ INICIA "Gravando áudio..." EM PARALELO com o ElevenLabs ═══
                // O status fica ativo durante TODO o processamento do TTS (pode demorar 2-5s)
                // e só para EXATAMENTE quando o áudio for enviado.
                if (this.presenceSimulator) {
                    this.presenceSimulator.startRecordingLoop(m.key.remoteJid).catch(() => { });
                }

                try {
                    // TTS roda enquanto o status "Gravando..." já está ativo
                    const tts = await this.audioProcessor.textToSpeech(resposta);
                    const bufferValid = tts?.buffer && Buffer.isBuffer(tts.buffer) && tts.buffer.length > 0;

                    // Para o loop de "Gravando..." ANTES de enviar
                    if (this.presenceSimulator) await this.presenceSimulator.stop(m.key.remoteJid);

                    if (!tts.sucesso || !bufferValid) {
                        this.logger.warn('⚠️ Falha TTS — enviando texto como fallback', tts?.error || 'sem buffer');
                        await this.sock.sendMessage(m.key.remoteJid, { text: resposta }, { quoted: m });
                    } else {
                        this.logger.info(`📤 Voice Note — ${tts.fonte || 'TTS'} (${tts.size} bytes)`);
                        // Envia o áudio SEMPRE em reply ao usuário
                        await this.sock.sendMessage(
                            m.key.remoteJid,
                            {
                                audio: tts.buffer,
                                mimetype: tts.mimetype || 'audio/ogg; codecs=opus',
                                ptt: true   // voice note
                            },
                            { quoted: m }   // sempre reply
                        );
                    }
                } catch (err: any) {
                    this.logger.error(`❌ Erro TTS: ${err.message}`);
                    if (this.presenceSimulator) await this.presenceSimulator.stop(m.key.remoteJid);
                    await this.sock.sendMessage(m.key.remoteJid, { text: resposta }, { quoted: m });
                }
                if (this.presenceSimulator) await this.presenceSimulator.markAsRead(m, ehGrupo);
            } else {
                // ✅ NOVO FLUXO: Digitação Realista pós-processamento (APENAS PARA TEXTO)
                if (this.presenceSimulator) {
                    const typingDuration = this.presenceSimulator.calculateTypingDuration(resposta);
                    this.logger.info(`✍️ [TYPING] Resposta pronta. Simulando digitação (${Math.round(typingDuration / 1000)}s)...`);

                    // Inicia status visual no WhatsApp
                    await this.presenceSimulator.safeSendPresenceUpdate('composing', m.key.remoteJid);

                    // Espera o tempo humano
                    await delay(typingDuration);

                    // Finaliza status
                    await this.presenceSimulator.stop(m.key.remoteJid);
                }

                // ✅ LÓGICA DE REPLY CONDICIONAL (MESMO DO IMAGEMESSAGE):
                // - PV: responde em reply APENAS se usuario mandou em reply
                // - Grupo: SEMPRE em reply (para manter contexto)
                const opcoes: any = {};
                if (ehGrupo) {
                    opcoes.quoted = m; // Grupo: sempre reply
                } else if (replyInfo?.isReply) {
                    opcoes.quoted = m; // PV: reply apenas se user mandou em reply
                }

                await this.sock.sendMessage(m.key.remoteJid, { text: resposta }, opcoes);
                this.logger.info(`✅ [DISPATCH OK]`);

                if (this.presenceSimulator) await this.presenceSimulator.markAsRead(m, ehGrupo);
            }

            this.logger.info(`✅ [RESPONDIDO] ${resposta.substring(0, 80)}`);
        } catch (error: any) {
            // ✅ BUG FIX: Imprime o erro completo, não apenas .message (que pode ser undefined)
            const errMsg = error?.message || String(error) || 'erro desconhecido';
            const errStack = error?.stack ? `\n${error.stack.split('\n').slice(0, 3).join('\n')}` : '';
            this.logger.error(`❌ Erro texto: ${errMsg}${errStack}`);
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

    /**
     * Resolve nome real do usuário.
     * Em grupo com Cloud MD, m.pushName pode vir vazio ou genérico.
     * Tentamos groupMetadata participants lookup como fallback.
     */
    /**
     * Resolve nome real do usuário a partir de um JID.
     * Útil para mensagens diretas e para identificar autores em replies.
     */
    private async resolveAuthorName(jid: string, remoteJid: string): Promise<string> {
        if (!jid || jid === 'desconhecido') return 'Usuário';

        // 1. Verificar se é o próprio bot
        const botJid = JidUtils.normalize(this.sock?.user?.id);
        if (JidUtils.normalize(jid) === botJid) {
            return this.config.BOT_NAME || 'Akira';
        }

        // 2. Se for grupo, tentar buscar nos metadados (participantes)
        const isGroup = remoteJid.endsWith('@g.us');
        if (isGroup && this.sock) {
            try {
                const metadata = await this.sock.groupMetadata(remoteJid);
                const member = metadata.participants.find((p: any) => JidUtils.normalize(p.id) === JidUtils.normalize(jid));
                if (member && member.notify && member.notify !== 'undefined' && member.notify !== '~') {
                    return member.notify;
                }
                if (member && member.name) {
                    return member.name;
                }
            } catch (e: any) {
                this.logger?.debug(`⚠️ [NAME] Falha ao resolver nome no grupo: ${e.message}`);
            }
        }

        // 3. Fallback: onWhatsApp (apenas para números reais, não LIDs)
        if (this.sock && !jid.includes('@lid') && jid.includes('@s.whatsapp.net')) {
            try {
                const onWp = await this.sock.onWhatsApp(jid);
                if (onWp && Array.isArray(onWp) && onWp.length > 0 && onWp[0].notify) {
                    return onWp[0].notify;
                }
            } catch (e: any) {
                this.logger?.debug(`⚠️ [NAME] Falha no onWhatsApp: ${e.message}`);
            }
        }

        return 'Usuário';
    }

    private async _resolveUserName(m: any, numero: string, remoteJid: string): Promise<string> {
        // Prioridade 1: pushName da mensagem direta (mais rápido)
        const pushName = m.pushName;
        if (pushName && pushName !== 'Usuário' && pushName.trim().length > 0) {
            return pushName;
        }

        // Prioridade 2: Usar o resolver genérico
        return await this.resolveAuthorName(m.key.participant || m.key.remoteJid, remoteJid);
    }

    async handleViolation(m: any, tipo: string, limitStatus?: any): Promise<void> {
        if (!this.sock) return;
        const jid = m.key.remoteJid;
        const participant = m.key.participant || m.key.remoteJid;
        const nome = m.pushName || 'Usuário';
        const numeroReal = participant?.split('@')[0] || '';

        this.logger.warn(`🚫 [VIOLAÇÃO] ${tipo} de ${participant} (${nome})`);

        try {
            // 1. Deletar mensagem atual
            await this.sock.sendMessage(jid, { delete: m.key });

            // 2. Se for FLOOD, deletar TODAS as mensagens recentes do usuário (últimos 5 segundos)
            if (tipo.startsWith('flood_')) {
                await this._deleteRecentMessages(jid, participant, 5, m.key.id);
            }
        } catch (delError: any) {
            this.logger.debug(`Não foi possível deletar a mensagem: ${delError.message}`);
        }

        try {
            // 2. Notificar e agir com base no tipo
            if (tipo === 'link') {
                // 1. Notificar
                await this.sock.sendMessage(jid, {
                    text: `🚫 *BANIDO POR ANTILINK* 🚫\n\n@${numeroReal}, você enviou um link proibido! Foi removido do grupo e banido da Akira.`,
                    mentions: [participant]
                });

                // 2. Adicionar à Blacklist (Banimento Global)
                if (this.moderationSystem) {
                    this.moderationSystem.addToBlacklist(
                        participant,
                        nome,
                        numeroReal,
                        'Violação de AntiLink (Banimento Automático)'
                    );
                }

                // 3. Remover do grupo
                await this.sock.groupParticipantsUpdate(jid, [participant], 'remove');
            } else if (tipo === 'mute') {
                await this.sock.sendMessage(jid, { text: `🚫 *${nome} removido por falar durante o silenciamento!*` });
                await this.sock.groupParticipantsUpdate(jid, [participant], 'remove');
            } else if (tipo === 'rate_limit') {
                // MENSAGENS AGRESSIVAS BASEADO NO NÚMERO DE VIOLAÇÕES
                const violations = limitStatus?.violations || 1;
                const waitTime = limitStatus?.wait || '01:00:00';
                const resetAt = limitStatus?.resetAt || '?'; // ✅ Hora exata do reset
                let mensagem = '';

                if (violations === 1) {
                    // 1ª AVISO: Educado
                    mensagem = `⏳ *LIMITE DE MENSAGENS EXCEDIDO* ⏳\n\n@${numeroReal}, você atingiu o limite de mensagens por hora para usuários gratuitos.\n\n⏱️ *Tempo restante:* ${waitTime}\n🕐 *Acesso liberado às:* ${resetAt}\n\n_Para remover este limite, considere tornar-se Premium._`;
                } else if (violations === 2) {
                    // 2ª AVISO: Firme
                    mensagem = `⚠️ *AVISO DE SISTEMA* ⚠️\n\n@${numeroReal}, você está ignorando o tempo de espera.\n\nA Akira não responderá até o reset do seu limite para evitar spam.\n\n🕐 *Acesso liberado às:* ${resetAt}\n\n_Evite insistir para não ser bloqueado._`;
                } else if (violations >= 3) {
                    // 3ª AVISO: Bloqueio (sem ofensas)
                    mensagem = `🚫 *USUÁRIO BLOQUEADO* 🚫\n\n@${numeroReal}, devido às múltiplas violações de rate limit, seu acesso foi temporariamente suspenso.\n\n*STATUS:* Blacklist Automática\n\n_Contate o suporte se considerar isto um erro._`;
                }

                await this.sock.sendMessage(jid, {
                    text: mensagem,
                    mentions: [participant]
                });
            } else if (tipo === 'flood_mute') {
                const warnings = limitStatus?.warnings || 0;
                const muteMin = limitStatus?.muteMinutes || 5;
                const muteCount = limitStatus?.muteCount || 1;
                await this.sock.sendMessage(jid, {
                    text: `🔇 *SILENCIADO POR FLOOD* 🔇\n\n@${numeroReal}, pare de enviar mensagens tão rápido! O limite é de 2 mensagens por segundo.\n\n⏱️ *Tempo:* ${muteMin} minuto(s)\n⚠️ Aviso: *${warnings}/3*\n📊 Infração #${muteCount} hoje.\n\n_As mensagens infratoras foram apagadas._`,
                    mentions: [participant]
                });
            } else if (tipo === 'flood_kick') {
                await this.sock.sendMessage(jid, {
                    text: `🚫 *REMOVIDO POR FLOOD* 🚫\n\n@${numeroReal} foi removido por ignorar os avisos de flood e atingir o limite de avisos.`,
                    mentions: [participant]
                });
                await this.sock.groupParticipantsUpdate(jid, [participant], 'remove');
            } else if (tipo === 'badword_mute') {
                const muteMin = limitStatus?.muteMinutes || 5;
                const muteCount = limitStatus?.muteCount || 1;
                await this.sock.sendMessage(jid, {
                    text: `🔇 *SILENCIADO POR PALAVRÃO* 🔇\n\n@${numeroReal}, uso de linguagem ofensiva não é tolerado!\n\nPalavra: *${limitStatus?.word || '???'}*\n⏱️ *Silenciado por:* ${muteMin} minuto(s)\n📊 Esta é sua infração #${muteCount} hoje.\n\n_A cada infração o tempo de silenciamento dobra._`,
                    mentions: [participant]
                });
            } else if (tipo === 'badword_kick') {
                await this.sock.sendMessage(jid, {
                    text: `🚫 *BANIDO POR PALAVRÃO REINCIDENTE* 🚫\n\n@${numeroReal} foi removido do grupo por ignorar os avisos de linguagem ofensiva.`,
                    mentions: [participant]
                });
                await this.sock.groupParticipantsUpdate(jid, [participant], 'remove');
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
     * Deleta mensagens recentes de um participante em um chat específico
     */
    private async _deleteRecentMessages(jid: string, participant: string, seconds: number = 5, excludeId?: string): Promise<void> {
        try {
            if (!this.store || !this.sock) return;

            const now = Math.floor(Date.now() / 1000);

            const messages = this.store.messages[jid];
            if (!messages) return;

            const msgArray = Array.isArray(messages) ? messages : (messages as any).array || [];

            const toDelete = msgArray.filter((msg: any) => {
                const msgParticipant = msg.key.participant || msg.key.remoteJid;
                const msgTime = Number(msg.messageTimestamp);
                return msgParticipant === participant && (now - msgTime) <= seconds;
            });

            for (const msg of toDelete) {
                try {
                    if (excludeId && msg.key.id === excludeId) continue;
                    await this.sock.sendMessage(jid, { delete: msg.key });
                    await delay(100);
                } catch (e) { }
            }
        } catch (e: any) {
            this.logger.error(`❌ Erro ao deletar msgs recentes: ${e.message}`);
        }
    }

    /**
     * Lógica central de decisão de resposta da IA
     */
    shouldRespondToAI(m: any, texto: string, ehGrupo: boolean, replyInfo: any, nomeRemetente: string = '', numeroRemetente: string = ''): boolean {
        // ✅ PV: SEMPRE responde (é conversa direcionada por definição)
        // Grupo: Só responde a mencoes, replies, nome do bot, owner exclusivo
        if (!ehGrupo) {
            // ✅ Em PV, toda mensagem é direcionada a Akira
            return true;
        }

        // ═══ LÓGICA PARA GRUPOS ═══
        const textoLower = (texto || '').toLowerCase();
        const botName = (this.config.BOT_NAME || 'akira').toLowerCase();

        // 1. Responde se for menção direta ao bot (@JID)
        if (this.messageProcessor.isBotMentioned(m)) return true;

        // 1.1 Verificação extra de menção por número do bot (config.BOT_NUMERO_REAL para multi-device)
        const botNumber = JidUtils.getNumber(String(this.config.BOT_NUMERO_REAL));
        if (botNumber && (texto.includes(`@${botNumber}`) || texto.includes(botNumber))) {
            this.logger.debug(`🔍 Mention by number detected: ${botNumber} in "${texto.substring(0, 50)}"`);
            return true;
        }

        // 2. Responde se for reply ao bot
        if (replyInfo?.ehRespostaAoBot) return true;

        // 3. Responde ao nome público do bot (qualquer um pode chamar)
        if (textoLower.includes(botName)) return true;

        // 4. ✅ APELIDOS DE ATIVAÇÃO: Exclusivos do Dono
        // Se o remetente for o dono, verifica se algum dos apelidos de ativação está no texto
        const isOwner = typeof this.config?.isDono === 'function'
            ? this.config.isDono(numeroRemetente, nomeRemetente)
            : false;

        if (isOwner && Array.isArray(this.config.DONO_APELIDOS)) {
            const hasAlias = this.config.DONO_APELIDOS.some((alias: string) => textoLower.includes(alias.toLowerCase()));
            if (hasAlias) {
                this.logger.debug(`🎯 [ATIVAÇÃO] Dono chamou por apelido: "${texto.substring(0, 30)}"`);
                return true;
            }
        }

        // 5. Se for reply a outra pessoa no grupo, ignora
        if (replyInfo?.isReply && !replyInfo?.ehRespostaAoBot) return false;

        // ❌ Em grupos: mensagens genéricas NÃO são respondidas
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
            botJid: JidUtils.normalize(this.BOT_JID),
            botNumero: JidUtils.getNumber(this.BOT_JID),
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

            // ✅ NOVO: Parar de manter presença quando desconectar
            if (this.presenceSimulator) {
                this.presenceSimulator.stopMaintainingPresence();
            }

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

    /**
     * Intercepta passivamente mensagens de canais (Newsletters)
     * e guarda os dados estruturados para futuro treino da inteligência artificial.
     * Não gera respostas, logs no terminal (evitar spam) nem conta para Rate Limits.
     */
    private _sniffNewsletter(m: any, remoteJid: string): void {
        try {
            if (!m.message || !this.config) return;

            const sniffDir = path.join(this.config.DATABASE_FOLDER || './database', 'sniffed_data');
            if (!fs.existsSync(sniffDir)) fs.mkdirSync(sniffDir, { recursive: true });

            const timestamp = m.messageTimestamp ? new Date(m.messageTimestamp * 1000).toISOString() : new Date().toISOString();
            const pushName = m.pushName || 'Newsletter';
            const messageType = Object.keys(m.message)[0];

            let content = '';
            if (this.messageProcessor) {
                content = this.messageProcessor.extractText(m) || '';
            }

            // Ignorar mensagens de sistema vazias que não sejam mídia
            if (!content && messageType !== 'imageMessage' && messageType !== 'videoMessage') return;

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
        } catch (e: any) {
            // Ignorado silenciosamente para não interromper outros fluxos
        }
    }
    /**
     * Tenta descobrir o número real (JID) por trás de uma identidade (pode ser um LID)
     * Implementa 3 métodos de resolução em cascata
     */
    private async resolveIdentity(jid: string): Promise<string> {
        if (!jid) return '';
        const cleanJid = jid.split(':')[0];

        // Se já for um número real, retorna direto
        if (cleanJid.includes('@s.whatsapp.net')) return cleanJid;

        // MÉTODO 1: Consulta o Mapa Local (Memória/Disco)
        if (this.moderationSystem) {
            const resolved = this.moderationSystem.resolveRealJid(cleanJid);
            if (resolved && resolved.includes('@s.whatsapp.net')) {
                this.logger.debug(`✅ [ID RESOLVED] Mapa Local: ${cleanJid} -> ${resolved}`);
                return resolved;
            }
        }

        // MÉTODO 2: Busca Ativa no Servidor (onWhatsApp)
        try {
            if (cleanJid.includes('@lid')) {
                this.logger.debug(`🔍 [RESOLVING] Tentando onWhatsApp para LID: ${cleanJid}...`);
                const [result] = await this.sock.onWhatsApp(cleanJid);
                if (result && result.exists && result.jid.includes('@s.whatsapp.net')) {
                    if (this.moderationSystem) {
                        this.moderationSystem.updateLidMapping(cleanJid, result.jid);
                    }
                    this.logger.info(`✅ [ID RESOLVED] onWhatsApp: ${cleanJid} -> ${result.jid}`);
                    return result.jid;
                }
            }
        } catch (e: any) {
            this.logger.debug(`⚠️ Falha ao resolver JID via onWhatsApp: ${e.message}`);
        }

        // MÉTODO 3: Truque de Metadados (profilePictureUrl)
        // Pedir a foto de perfil de um LID muitas vezes força o servidor a retornar o JID real nos headers
        try {
            if (cleanJid.includes('@lid')) {
                this.logger.debug(`🔍 [RESOLVING] Tentando Metadados (PFP) para LID: ${cleanJid}...`);
                await this.sock.profilePictureUrl(jid).catch(() => null);

                // Após a chamada acima, o Baileys emite um evento 'lid-mapping.update' 
                // se o servidor retornar o mapeamento. Verificamos o mapa local novamente.
                if (this.moderationSystem) {
                    const resolved = this.moderationSystem.resolveRealJid(cleanJid);
                    if (resolved && resolved.includes('@s.whatsapp.net')) {
                        this.logger.info(`✅ [ID RESOLVED] Metadados PFP: ${cleanJid} -> ${resolved}`);
                        return resolved;
                    }
                }
            }
        } catch (e: any) {
            this.logger.debug(`⚠️ Falha ao resolver JID via PFP metadata: ${e.message}`);
        }

        // MÉTODO 4: Fallback para o JID/LID atual
        return jid;
    }
}

export default BotCore;

