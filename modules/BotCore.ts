/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CLASSE: BotCore V21 - SOCKET INSTANT + RAILWAY OK
 * ═══════════════════════════════════════════════════════════════════════════
 */

/// <reference path="./declarations.d.ts" />
import { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, delay, Browsers, getContentType } from '@whiskeysockets/baileys';
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
import LevelSystem from './LevelSystem.js';
import RegistrationSystem from './RegistrationSystem.js';
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
import RateLimiter from './RateLimiter.js';

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
    public economySystem: any;
    public userProfile: any;
    public botProfile: any;
    public groupManagement: any;
    public imageEffects: any;
    public permissionManager: any;
    public stickerViewOnceHandler: any;
    public rateLimiter: any;

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
            this.config.logConfig();
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
            this.logger.warn(`⚠️ [yt-dlp] Não foi possível atualizar: ${err.message?.substring(0, 80)}`);
        }
    }

    async initializeComponents() {
        try {
            this.logger.debug('🔧 Inicializando componentes..');

            this._selfUpdateYtdlp().catch(() => { });

            this.apiClient = new APIClient(this.logger);

            // Teste de conectividade inicial (Não bloqueante)
            this.apiClient.healthCheck().then((health: any) => {
                if (health.success) {
                    this.logger.info('✅ [API] Teste de conectividade: OK!');
                } else {
                    this.logger.warn(`⚠️ [API] Teste de conectividade: API offline ou inacessível (${health.error || 'Status ' + health.status})`);
                }
            }).catch((e: any) => {
                this.logger.error(`🚨 [API] Falha crítica de rede no startup: ${e.message}`);
            });
            this.audioProcessor = new AudioProcessor(this.logger);
            this.mediaProcessor = new MediaProcessor(this.logger);
            this.messageProcessor = new MessageProcessor(this.logger);
            this.moderationSystem = ModerationSystem.getInstance(this.logger);
            this.levelSystem = LevelSystem.getInstance(this.logger);
            this.registrationSystem = RegistrationSystem.getInstance(this.logger);
            this.subscriptionManager = new SubscriptionManager(this.config);
            this.userProfile = new UserProfile(this.sock, this.config);
            this.botProfile = new BotProfile(this.sock, this.logger);
            this.groupManagement = new GroupManagement(this.sock, this.config, this.moderationSystem);
            this.imageEffects = new ImageEffects(this.logger);
            this.permissionManager = new PermissionManager(this.logger);
            this.stickerViewOnceHandler = new StickerViewOnceHandler(this.sock, this.config);
            this.rateLimiter = new RateLimiter({
                pvLimit: this.config.RATE_LIMIT_PV,
                groupLimit: this.config.RATE_LIMIT_GROUP,
                maxViolations: this.config.MAX_VIOLATIONS
            });

            this.paymentManager = new PaymentManager(this, this.subscriptionManager);
            this.presenceSimulator = new PresenceSimulator(this.sock || null, this.logger);
            this.economySystem = EconomySystem.getInstance(this.logger);

            try {
                this.commandHandler = new CommandHandler(this.sock, this.config, this, this.messageProcessor);
                this.commandHandler.economySystem = this.economySystem;
                this.commandHandler.gameSystem = await import('./GameSystem.js').then(mod => mod.default);
                this.logger.debug('✅ CommandHandler inicializado');
            } catch (err: any) {
                this.logger.warn(`⚠️ CommandHandler: ${err.message}`);
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
            this.logger.info('🔄 Atualizando socket...');
            if (this.commandHandler?.setSocket) this.commandHandler.setSocket(sock);
            if (this.groupManagement?.setSocket) this.groupManagement.setSocket(sock);
            if (this.stickerViewOnceHandler?.setSocket) this.stickerViewOnceHandler.setSocket(sock);
            if (this.botProfile?.setSocket) this.botProfile.setSocket(sock);
            if (this.userProfile?.setSocket) this.userProfile.setSocket(sock);
            if (this.presenceSimulator) this.presenceSimulator.sock = sock;
            this.logger.info('✅ Socket atualizado');
        } catch (e: any) {
            this.logger.error('❌ Erro socket:', e);
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
                connectTimeoutMs: 120000,
                defaultQueryTimeoutMs: 120000,
                keepAliveIntervalMs: 15000,
                markOnlineOnConnect: true,
                emitOwnEvents: false,
                retryRequestDelayMs: 500,
                shouldIgnoreJid: (jid: string) => jid === 'status@broadcast'
            };

            const agent = HFCorrections.createHFAgent();
            if (agent) {
                socketConfig.agent = agent;
                this.logger.info('🌐 Agente HTTP personalizado');
            }

            this.sock = makeWASocket(socketConfig);

            if (this.commandHandler?.setSocket) this.commandHandler.setSocket(this.sock);
            if (this.presenceSimulator) this.presenceSimulator.sock = this.sock;

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
                    let shouldReconnect = reason !== DisconnectReason.loggedOut;
                    if (reason === 401) {
                        this.logger.warn('🔄 401 → Clearing auth');
                        this._cleanAuthOnError();
                        shouldReconnect = true;
                        this.reconnectAttempts = 0;
                    } else if (reason === 500) {
                        this.logger.warn('🔄 500 Internal Server Error → Force Reconnect without clearing auth');
                        shouldReconnect = true;
                        this.reconnectAttempts = 0;
                    }
                    this.logger.warn(`🔴 Conexão fechada. Motivo: ${reason}. Reconectar: ${shouldReconnect}`);

                    if (this.eventListeners.onDisconnected) this.eventListeners.onDisconnected(reason);

                    if (shouldReconnect) {
                        if (this.reconnectAttempts < this.MAX_RECONNECT_ATTEMPTS) {
                            this.reconnectAttempts++;
                            const baseDelay = Math.min(Math.pow(1.8, this.reconnectAttempts) * 1000, 300000);
                            const delayMs = Math.floor(baseDelay + Math.random() * 5000);
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
                    this.logger.info(`🤖 Logado como: ${this.BOT_JID} | Socket INSTANT para GroupManagement`);
                    if (this.eventListeners.onConnected) this.eventListeners.onConnected(this.BOT_JID);
                }
            });

            this.sock.ev.on('creds.update', saveCreds);

            this.sock.ev.on('messages.upsert', async ({ messages, type }: any) => {
                if (type !== 'notify') return;
                // Processa mensagens em paralelo para evitar que uma mensagem lenta (ex: vídeo) trave as outras (ex: *ping)
                Promise.all(messages.map((m: any) => this.processMessage(m))).catch(err => {
                    this.logger.error('❌ Erro no processamento paralelo:', err.message);
                });
            });

            this.sock.ev.on('group-participants.update', async (update: any) => {
                const { id, participants, action } = update;
                if (!id || !participants || participants.length === 0) return;

                // Limpa todos os JIDs de participantes (remove :1, :2 etc)
                const cleanParticipants = participants.map((p: string) => {
                    const [user, domain] = p.split('@');
                    return `${user.split(':')[0]}@${domain || 's.whatsapp.net'}`;
                });

                let validParticipants = [...cleanParticipants];

                // Anti-Fake Check
                if (action === 'add' && this.moderationSystem?.isAntiFakeActive(id)) {
                    const fakeParticipants = validParticipants.filter((p: string) => this.moderationSystem.isFakeNumber(p));
                    validParticipants = validParticipants.filter((p: string) => !this.moderationSystem.isFakeNumber(p));

                    if (fakeParticipants.length > 0) {
                        for (const p of fakeParticipants) {
                            this.logger.warn(`🚫 [ANTI-FAKE] Removendo ${p} de ${id}`);
                            try {
                                await this.sock.groupParticipantsUpdate(id, [p], 'remove');
                            } catch (e: any) {
                                this.logger.error(`Erro ao remover fake: ${e.message}`);
                            }
                        }
                        await this.sock.sendMessage(id, { text: '⚠️ Números não-autorizados removidos (Anti-Fake ativo).' }).catch(() => { });
                    }
                }

                // Welcome Trigger
                if (action === 'add' && this.groupManagement && validParticipants.length > 0) {
                    try {
                        const isWelcomeOn = this.groupManagement.getWelcomeStatus(id);
                        if (isWelcomeOn) {
                            for (const p of validParticipants) {
                                const template = this.groupManagement.getCustomMessage(id, 'welcome') || 'Olá @user, bem-vindo ao @group!';
                                const formatted = await this.groupManagement.formatMessage(id, p, template);
                                await this.sock.sendMessage(id, { text: formatted, mentions: [p] }).catch(() => { });
                            }
                        }
                    } catch (e: any) {
                        this.logger.error(`Erro no Welcome: ${e.message}`);
                    }
                }

                // Goodbye Trigger
                if (action === 'remove' && this.groupManagement && cleanParticipants.length > 0) {
                    try {
                        const isGoodbyeOn = this.groupManagement.getGoodbyeStatus(id);
                        if (isGoodbyeOn) {
                            for (const p of cleanParticipants) {
                                const template = this.groupManagement.getCustomMessage(id, 'goodbye') || 'Adeus @user!';
                                const formatted = await this.groupManagement.formatMessage(id, p, template);
                                await this.sock.sendMessage(id, { text: formatted, mentions: [p] }).catch(() => { });
                            }
                        }
                    } catch (e: any) {
                        this.logger.error(`Erro no Goodbye: ${e.message}`);
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
            if (!m || !m.message || m.key.fromMe || m.message.protocolMessage) return;

            const remoteJid = m.key.remoteJid;
            const ehGrupo = remoteJid.endsWith('@g.us');
            if (remoteJid === 'status@broadcast') return;

            if (!this.messageProcessor) return;

            const nome = m.pushName || 'Usuário';
            const participantJid = this.messageProcessor.extractParticipantJid(m);
            const numeroReal = this.messageProcessor.extractUserNumber(m);

            if (this.moderationSystem?.isBlacklisted(numeroReal)) return;

            // ═══ BLACKLIST CHECK ═══
            if (this.rateLimiter?.isBlacklisted(numeroReal)) return;


            if (ehGrupo && this.moderationSystem?.isMuted(remoteJid, participantJid)) {
                // MUTE VIOLATION: Delete message and autoban user
                this.logger.warn(`🔇 MUTE VIOLATION: @${participantJid.split('@')[0]} falou enquanto mutado. BANINDO.`);
                try {
                    await this.sock.sendMessage(remoteJid, {
                        delete: { remoteJid, fromMe: false, id: m.key.id!, participant: participantJid }
                    });

                    // Remove participant immediately as requested
                    await this.sock.groupParticipantsUpdate(remoteJid, [participantJid], 'remove');
                    await this.sock.sendMessage(remoteJid, {
                        text: `🚫 @${participantJid.split('@')[0]} foi removido por falar durante o período de Mute!`,
                        mentions: [participantJid]
                    });
                } catch (e) { }
                return;
            }

            const texto = this.messageProcessor.extractText(m);
            const temImagem = this.messageProcessor.hasImage(m);
            const temAudio = this.messageProcessor.hasAudio(m);
            const temVideo = this.messageProcessor.hasVideo(m);
            const temDoc = this.messageProcessor.hasDocument(m);

            if (ehGrupo && texto && this.moderationSystem) {
                let isAdmin = false;
                try {
                    if (this.groupManagement) isAdmin = await this.groupManagement.isUserAdmin(remoteJid, participantJid);
                } catch (e) { }

                // Antilink rigoroso (apenas para não-admins)
                if (!isAdmin && this.moderationSystem.isAntiLinkActive(remoteJid) && this.moderationSystem.isLink(texto)) {
                    this.logger.warn(`🔗 ANTI-LINK DETECTADO: @${participantJid}`);
                    try {
                        // 1. Deleta a mensagem com o link imediatamente
                        await this.sock.sendMessage(remoteJid, {
                            delete: { remoteJid, fromMe: false, id: m.key.id!, participant: participantJid }
                        });

                        // 2. Remove o membro conforme pedido
                        await this.sock.groupParticipantsUpdate(remoteJid, [participantJid], 'remove');

                        // 3. Notifica o grupo
                        await this.sock.sendMessage(remoteJid, {
                            text: `🚫 @${participantJid.split('@')[0]} foi expulso e seu rasto apagado por enviar link proibido!`,
                            mentions: [participantJid]
                        });
                    } catch (e: any) {
                        this.logger.error(`Erro ao aplicar Anti-Link: ${e.message}`);
                    }
                    return;
                }
            }
            const replyInfo = this.messageProcessor.extractReplyInfo(m);

            // ═══ GANHO DE XP POR MENSAGEM (SISTEMA DE NÍVEIS) ═══
            const levelingAtivo = ehGrupo && this.groupManagement?.groupSettings?.[remoteJid]?.leveling === true;
            if (levelingAtivo && this.levelSystem) {
                try {
                    const resultXp = this.levelSystem.awardXp(remoteJid, participantJid, 10);
                    if (resultXp.leveled) {
                        const newLevel = resultXp.rec.level;
                        const patente = this.levelSystem.getPatente(newLevel);
                        const msgLvl = `🎉 LEVEL UP! 🔥\n\n@${participantJid.split('@')[0]} subiu para o Nível ${newLevel}!\n\n👑 *Nova Patente:* ${patente}`;
                        await this.sock.sendMessage(remoteJid, { text: msgLvl, mentions: [participantJid] });

                        // Verifica Auto-ADM
                        if (newLevel >= this.levelSystem.maxLevel) {
                            const resultPromo = this.levelSystem.registerMaxLevelUser(
                                remoteJid,
                                participantJid,
                                m.pushName || 'Usuário',
                                this.sock
                            );
                            if (resultPromo && resultPromo.message) {
                                await this.sock.sendMessage(remoteJid, { text: resultPromo.message, mentions: [participantJid] });
                            }
                        }
                    }
                } catch (e: any) {
                    this.logger.error(`Erro no LevelSystem: ${e.message}`);
                }
            }

            // ═══ NOVO RATE LIMIT CHECK (SELETIVO) ═══
            if (this.rateLimiter) {
                const isDirected = this.messageProcessor.isDirectedToBot(m);
                if (isDirected) {
                    const isOwner = this.config.isDono(numeroReal);

                    // 1. Check Command Spam (Rapid Fire) - Se ativo no grupo
                    if (ehGrupo && this.groupManagement && this.moderationSystem) {
                        const settings = this.groupManagement.groupSettings?.[remoteJid] || {};
                        if (settings.antispam && !isOwner) {
                            if (this.moderationSystem.checkSpam(numeroReal)) {
                                this.logger.warn(`🚫 [COMMAND-SPAM] ${numeroReal} bloqueado por rapid-fire em ${remoteJid}`);
                                return;
                            }
                        }
                    }

                    // 2. Check Hourly Rate Limit (Avisos Progressivos)
                    const rateCheck = this.rateLimiter.check(numeroReal, ehGrupo, isOwner, nome);

                    if (!rateCheck.allowed) {
                        if (rateCheck.message) {
                            await this.sock.sendMessage(remoteJid, { text: rateCheck.message }, { quoted: m });
                        }
                        this.logger.warn(`🛑 [RATE-LIMIT] ${numeroReal} interceptado (${ehGrupo ? 'Grupo' : 'PV'})`);
                        return;
                    }
                }
            }

            // ═══ BARREIRA ANTI-MODERAÇÃO DE MÍDIA ═══
            // Executa para qualquer mídia em grupos, desde que o sender NÃO seja admin
            if (ehGrupo && this.moderationSystem && this.groupManagement) {
                let senderIsAdmin = false;
                try {
                    senderIsAdmin = await this.groupManagement.isUserAdmin(remoteJid, participantJid);
                } catch (e) { }

                const deletarMídia = async (motivo: string, aviso: string) => {
                    this.logger.warn(`🛡️ [ANTI-MEDIA] ${motivo}: ${participantJid}`);
                    try {
                        await this.sock.sendMessage(remoteJid, {
                            delete: { remoteJid, fromMe: false, id: m.key.id!, participant: participantJid }
                        });
                        await this.sock.sendMessage(remoteJid, {
                            text: aviso,
                            mentions: [participantJid]
                        });
                    } catch (e) { }
                };

                if (!senderIsAdmin) {
                    // Anti-Image
                    const settings = this.groupManagement.groupSettings?.[remoteJid] || {};
                    if (temImagem && settings.antiimage) {
                        await deletarMídia('ANTI-IMAGE', `🚫 @${participantJid.split('@')[0]} — Envio de imagens está desactivado neste grupo.`);
                        return;
                    }
                    // Anti-Video
                    if (temVideo && (settings.antivideo || this.moderationSystem.isAntiVideoActive?.(remoteJid))) {
                        await deletarMídia('ANTI-VIDEO', `🚫 @${participantJid.split('@')[0]} — Envio de vídeos está desactivado neste grupo.`);
                        return;
                    }
                    // Anti-Sticker (detectamos via messageType)
                    const msgType = this.messageProcessor?.getMessageType?.(m) || Object.keys(m.message || {})[0];
                    if (msgType === 'stickerMessage' && (settings.antisticker || this.moderationSystem.isAntiStickerActive?.(remoteJid))) {
                        await deletarMídia('ANTI-STICKER', `🚫 @${participantJid.split('@')[0]} — Envio de stickers está desactivado neste grupo.`);
                        return;
                    }
                    // Anti-Audio/PTT
                    if (temAudio && settings.antiaudio) {
                        await deletarMídia('ANTI-AUDIO', `🚫 @${participantJid.split('@')[0]} — Envio de áudios está desactivado neste grupo.`);
                        return;
                    }
                    // Anti-Doc
                    if (temDoc && settings.antidoc) {
                        await deletarMídia('ANTI-DOC', `🚫 @${participantJid.split('@')[0]} — Envio de documentos está desactivado neste grupo.`);
                        return;
                    }
                }
            }

            if (temImagem) {
                await this.handleImageMessage(m, nome, numeroReal, participantJid, replyInfo, ehGrupo);
            } else if (temVideo) {
                await this.handleVideoMessage(m, nome, numeroReal, participantJid, replyInfo, ehGrupo);
            } else if (temDoc) {
                await this.handleDocumentMessage(m, nome, numeroReal, participantJid, replyInfo, ehGrupo);
            } else if (temAudio) {
                await this.handleAudioMessage(m, nome, numeroReal, participantJid, replyInfo, ehGrupo);
            } else if (texto) {
                await this.handleTextMessage(m, nome, numeroReal, participantJid, texto, replyInfo, ehGrupo);
            }
        } catch (error: any) {
            this.logger.error('❌ Erro pipeline:', error?.message);
        }
    }

    async handleImageMessage(m: any, nome: string, numeroReal: string, participantJid: string, replyInfo: any, ehGrupo: boolean): Promise<void> {
        const caption = this.messageProcessor.extractText(m) || '';
        const allowed = await this.handleRateLimitAndBlacklist(m, nome, numeroReal, caption || '<IMAGEM>', ehGrupo);
        if (!allowed) return;

        this.logger.info(`🖼️ [IMAGEM] ${nome}`);
        // Leveling...
        try {
            // CommandHandler primeiro - Comandos respondem INSTANTANEAMENTE sem delay
            if (this.commandHandler && this.messageProcessor.isCommand(caption)) {
                const handled = await this.commandHandler.handle(m, { nome, numeroReal, participantJid, texto: caption, replyInfo, ehGrupo });
                if (handled) return;
            }

            // BARREIRA ANTI-TAGARELICE
            if (!this.shouldRespondToAI(m, caption, replyInfo, ehGrupo)) {
                return;
            }

            if (this.presenceSimulator) {
                await this.presenceSimulator.simulateTicks(m, replyInfo, ehGrupo);
            }

            // API análise imagem...
            let grupo_nome = '';
            if (ehGrupo) {
                grupo_nome = await this._getGrupoNome(m.key.remoteJid);
            }

            const resultado = await this.apiClient.processMessage({
                usuario: nome,
                numero: numeroReal,
                mensagem: caption,
                tipo_conversa: ehGrupo ? 'grupo' : 'pv',
                tipo_mensagem: 'imagem',
                reply_metadata: replyInfo,
                grupo_id: ehGrupo ? m.key.remoteJid : '',
                grupo_nome: grupo_nome,
                imagem_dados: {
                    m: m // O APIClient vai baixar se necessário
                }
            });
            if (!resultado.success) {
                await this.sock.sendMessage(m.key.remoteJid, { text: 'Não consegui analisar a imagem.' });
                return;
            }

            const resposta = resultado.resposta || 'Sem resposta.';
            if (this.presenceSimulator) {
                await this.presenceSimulator.simulateFullResponse(this.sock, m, resposta);
            }
            await this.sock.sendMessage(m.key.remoteJid, { text: resposta }, ehGrupo ? { quoted: m } : {});
        } catch (error: any) {
            this.logger.error('❌ Erro imagem:', error.message);
        }
    }

    async handleVideoMessage(m: any, nome: string, numeroReal: string, participantJid: string, replyInfo: any, ehGrupo: boolean): Promise<void> {
        // Similar a imagem, stub completo
        this.logger.info(`🎥 [VIDEO] ${nome}`);
        try {
            const caption = this.messageProcessor.extractText(m) || '';

            if (this.commandHandler && this.messageProcessor.isCommand(caption)) {
                const handled = await this.commandHandler.handle(m, { nome, numeroReal, participantJid, texto: caption, replyInfo, ehGrupo });
                if (handled) return;
            }

            if (!this.shouldRespondToAI(m, caption, replyInfo, ehGrupo)) {
                return;
            }

            if (this.presenceSimulator) {
                await this.presenceSimulator.simulateTicks(m, replyInfo, ehGrupo);
            }

            let grupo_nome = '';
            if (ehGrupo) {
                grupo_nome = await this._getGrupoNome(m.key.remoteJid);
            }

            const resultado = await this.apiClient.processMessage({
                usuario: nome,
                numero: numeroReal,
                mensagem: this.messageProcessor.extractText(m) || '',
                tipo_conversa: ehGrupo ? 'grupo' : 'pv',
                tipo_mensagem: 'video',
                reply_metadata: replyInfo,
                grupo_id: ehGrupo ? m.key.remoteJid : '',
                grupo_nome: grupo_nome,
                video_dados: { m: m }
            });
            const resposta = resultado.resposta || 'Vídeo recebido.';
            if (this.presenceSimulator) {
                await this.presenceSimulator.simulateFullResponse(this.sock, m, resposta);
            }
            await this.sock.sendMessage(m.key.remoteJid, { text: resposta }, { quoted: m });
        } catch (e) { }
    }

    async handleDocumentMessage(m: any, nome: string, numeroReal: string, participantJid: string, replyInfo: any, ehGrupo: boolean): Promise<void> {
        this.logger.info(`📄 [DOC] ${nome}`);
        try {
            const caption = this.messageProcessor.extractText(m) || '';

            if (this.commandHandler && this.messageProcessor.isCommand(caption)) {
                const handled = await this.commandHandler.handle(m, { nome, numeroReal, participantJid, texto: caption, replyInfo, ehGrupo });
                if (handled) return;
            }

            if (!this.shouldRespondToAI(m, caption, replyInfo, ehGrupo)) {
                return;
            }

            if (this.presenceSimulator) {
                await this.presenceSimulator.simulateTicks(m, replyInfo, ehGrupo);
            }

            let grupo_nome = '';
            if (ehGrupo) {
                grupo_nome = await this._getGrupoNome(m.key.remoteJid);
            }

            const resultado = await this.apiClient.processMessage({
                usuario: nome,
                numero: numeroReal,
                mensagem: this.messageProcessor.extractText(m) || '',
                tipo_conversa: ehGrupo ? 'grupo' : 'pv',
                tipo_mensagem: 'documento',
                reply_metadata: replyInfo,
                grupo_id: ehGrupo ? m.key.remoteJid : '',
                grupo_nome: grupo_nome,
                documento_dados: { m: m }
            });
            const resposta = resultado.resposta || 'Doc recebido.';
            if (this.presenceSimulator) {
                await this.presenceSimulator.simulateFullResponse(this.sock, m, resposta);
            }
            await this.sock.sendMessage(m.key.remoteJid, { text: resposta }, { quoted: m });
        } catch (e) { }
    }

    async handleAudioMessage(m: any, nome: string, numeroReal: string, participantJid: string, replyInfo: any, ehGrupo: boolean): Promise<void> {
        this.logger.info(`🎤 [AUDIO] ${nome}`);
        try {
            const transcricao = await this.audioProcessor.speechToText(await this.mediaProcessor.downloadMedia(m.message, 'audio'));
            if (transcricao.sucesso) {
                await this.handleTextMessage(m, nome, numeroReal, transcricao.texto, replyInfo, ehGrupo, true);
            }
        } catch (e) { }
    }

    private shouldRespondToAI(m: any, texto: string, replyInfo: any, ehGrupo: boolean): boolean {
        if (!ehGrupo) return true; // PV sempre responde

        const textoLower = texto.toLowerCase();
        const isReplyToBot = replyInfo?.ehRespostaAoBot || false;
        const hasAkiraMention = textoLower.includes('akira') || textoLower.includes('bot');

        const mentions = m.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        const isMentioned = mentions.some((jid: string) => jid === this.BOT_JID);

        return isReplyToBot || hasAkiraMention || isMentioned;
    }

    async handleTextMessage(m: any, nome: string, numeroReal: string, participantJid: string, texto: string, replyInfo: any, ehGrupo: boolean, foiAudio = false): Promise<void> {
        try {
            if (this.commandHandler) {
                // Comandos não devem ter delay de presença (ex: *ping deve ser instantâneo)
                const handled = await this.commandHandler.handle(m, { nome, numeroReal, participantJid, texto, replyInfo, ehGrupo });
                if (handled) return;
            }

            // BARREIRA ANTI-TAGARELICE
            if (!this.shouldRespondToAI(m, texto, replyInfo, ehGrupo)) {
                return;
            }

            if (this.presenceSimulator) {
                await this.presenceSimulator.simulateTicks(m, replyInfo, ehGrupo);
            }

            let grupo_nome = '';
            if (ehGrupo) {
                grupo_nome = await this._getGrupoNome(m.key.remoteJid);
            }

            const resultado = await this.apiClient.processMessage({
                usuario: nome,
                numero: numeroReal,
                mensagem: texto,
                tipo_conversa: ehGrupo ? 'grupo' : 'pv',
                tipo_mensagem: foiAudio ? 'audio' : 'texto',
                reply_metadata: replyInfo,
                grupo_id: ehGrupo ? m.key.remoteJid : '',
                grupo_nome: grupo_nome
            });
            if (!resultado.success) return;

            const resposta = resultado.resposta || 'OK';
            if (this.presenceSimulator) {
                await this.presenceSimulator.simulateFullResponse(this.sock, m, resposta);
            }
            await this.sock.sendMessage(m.key.remoteJid, { text: resposta }, ehGrupo ? { quoted: m } : {});
        } catch (e) { }
    }

    async handleRateLimitAndBlacklist(m: any, nome: string, numeroReal: string, texto: string, ehGrupo: boolean): Promise<boolean> {
        // Stub - sempre true para teste
        return true;
    }

    private _cleanAuthOnError(): void {
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
            features: this.config.FEATURES || {}
        };
    }

    async disconnect(): Promise<void> {
        try {
            this.logger.info('🔴 Desconectando...');
            if (this.sock) {
                this.sock.ev.removeAllListeners();
                this.sock.ws?.close();
            }
            this.isConnected = false;
            this.currentQR = null;
            this.BOT_JID = null;
        } catch (error: any) {
            this.logger.error('❌ Erro desconectar:', error.message);
        }
    }

    async reply(m: any, text: string, options: any = {}): Promise<any> {
        try {
            if (!this.sock) return false;
            return await this.sock.sendMessage(m.key.remoteJid, { text, ...options }, { quoted: m });
        } catch (error: any) {
            this.logger.error('❌ Erro reply:', error.message);
            return false;
        }
    }

    private async _getGrupoNome(remoteJid: string): Promise<string> {
        try {
            if (!remoteJid || !remoteJid.endsWith('@g.us')) return '';

            // Tenta via GroupManagement (cache interno dele)
            if (this.groupManagement) {
                const meta = await this.groupManagement._getGroupMetadata(remoteJid);
                if (meta?.subject) return meta.subject;
            }

            // Tenta via socket cache (Baileys nativo)
            const socketCache = this.sock?.groupMetadataCache?.[remoteJid];
            if (socketCache?.subject) return socketCache.subject;

            // Fallback: Nome genérico ou JID parcial
            return 'Grupo';
        } catch (e) {
            return 'Grupo';
        }
    }
}

export default BotCore;

