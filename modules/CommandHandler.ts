
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * COMMAND HANDLER - AKIRA BOT V21 - ENTERPRISE EDITION
 * ═══════════════════════════════════════════════════════════════════════════
 * ✅ Sistema completo de comandos com permissões por tier
 * ✅ Rate limiting inteligente e proteção contra abuso
 * ✅ Menus profissionais e formatados em ASCII art
 * ✅ Funcionalidades enterprise-grade
 * ✅ Logging de ações administrativas
 * ✅ Simulações realistas de presença (digitação, gravação, ticks)
 * ═══════════════════════════════════════════════════════════════════════════
 */

import fs from 'fs';
import path from 'path';
import axios from 'axios';

// Módulos Core
import PresenceSimulator from './PresenceSimulator.js';
import StickerViewOnceHandler from './StickerViewOnceHandler.js';
import MediaProcessor from './MediaProcessor.js';

// Ferramentas Enterprise

import SubscriptionManager from './SubscriptionManager.js';


// Novos módulos
import GroupManagement from './GroupManagement.js';
import UserProfile from './UserProfile.js';
import BotProfile from './BotProfile.js';
import ImageEffects from './ImageEffects.js';
import PermissionManager from './PermissionManager.js';
import RegistrationSystem from './RegistrationSystem.js';
import LevelSystem from './LevelSystem.js';
import EconomySystem from './EconomySystem.js';
import GameSystem from './GameSystem.js';
import GridTacticsGame from './GridTacticsGame.js';
import ModerationSystem from './ModerationSystem.js';
import JidUtils from './JidUtils.js';

// Sistema de rate limiting para features premium (1x a cada 3 meses para users)



// O PresenceSimulator é gerenciado via instância do BotCore ou localmente

class CommandHandler {
    public sock: any;
    public config: any;
    public bot: any;
    public messageProcessor: any;
    public permissionManager: any;
    public registrationSystem: any;
    public levelSystem: any;
    public economySystem: any;
    public stickerHandler: any;
    public mediaProcessor: any;
    public subscriptionManager: any;
    public moderationSystem: any;
    public gameSystem: any;
    public groupManagement: any;
    public userProfile: any;
    public botProfile: any;
    public imageEffects: any;
    public presenceSimulator: any;
    public rateLimiter: any;
    public securityLogger: any;
    public logger: any;
    public gridTacticsGame: any;
    async initAsyncModules() {
        try {
            this.rateLimiter = this.bot?.rateLimiter ?? new (await import('./RateLimiter.js')).default(this.config);
            this.securityLogger = this.bot?.securityLogger ?? new (await import('./SecurityLogger.js')).default(this.config);
        } catch (error: any) {
            this.logger.warn(`⚠️ Erro ao carregar módulos async: ${error.message}`);
            this.rateLimiter = this.bot?.rateLimiter;
            this.securityLogger = this.bot?.securityLogger;
        }
    }

    constructor(sock: any, config: any, bot: any = null, messageProcessor: any = null) {
        this.logger = config?.logger || bot?.logger || console;
        this.sock = sock;
        this.config = config;
        this.bot = bot;
        this.messageProcessor = messageProcessor || bot?.messageProcessor;

        // Inicializa sistemas - prefere injeção do BotCore
        const RegistrationClass = (RegistrationSystem as any).default || RegistrationSystem;
        const LevelClass = (LevelSystem as any).default || LevelSystem;
        const EconomyClass = (EconomySystem as any).default || EconomySystem;
        const MediaClass = (MediaProcessor as any).default || MediaProcessor;

        this.permissionManager = bot?.permissionManager ?? new PermissionManager(this.logger, bot?.registrationSystem ?? null);
        this.registrationSystem = bot?.registrationSystem ?? new RegistrationClass(this.logger);
        this.levelSystem = bot?.levelSystem ?? new LevelClass(this.logger);
        this.economySystem = bot?.economySystem ?? new EconomyClass(this.logger);

        // Handlers de mídia
        this.mediaProcessor = bot?.mediaProcessor || new MediaClass(this.logger);

        // Módulos async serão inicializados depois (RateLimiter, SecurityLogger)
        this.rateLimiter = bot?.rateLimiter;
        this.securityLogger = bot?.securityLogger;

        // Ferramentas Enterprise
        this.subscriptionManager = bot?.subscriptionManager || new SubscriptionManager(this.config);
        this.moderationSystem = bot?.moderationSystem ?? new ModerationSystem(this.logger);
        this.gameSystem = bot?.gameSystem ?? null;
        this.gridTacticsGame = bot?.gridTacticsGame ?? null;

        // Inicializa módulos dependentes de sock
        if (sock) {
            this.stickerHandler = bot?.stickerViewOnceHandler ?? new StickerViewOnceHandler(sock, this.config);
            this.groupManagement = bot?.groupManagement ?? new GroupManagement(sock, this.config, this.moderationSystem!, this.mediaProcessor!, this.levelSystem!);
            this.userProfile = bot?.userProfile ?? new UserProfile(sock, this.logger, this.config);
            this.botProfile = bot?.botProfile ?? new BotProfile(sock, this.logger, this.config);
            this.imageEffects = bot?.imageEffects ?? new ImageEffects(this.config);
            this.presenceSimulator = bot?.presenceSimulator ?? new PresenceSimulator(sock);
        } else {
            // Fallback for when sock is null
            this.imageEffects = bot?.imageEffects ?? new ImageEffects(this.config);
        }
    }

    public setSocket(sock: any): void {
        this.sock = sock;

        // ✅ Propaga o socket para TODOS os sub-módulos que já existem
        if (this.groupManagement?.setSocket) this.groupManagement.setSocket(sock);
        if (this.stickerHandler?.setSocket) this.stickerHandler.setSocket(sock);
        if (this.userProfile?.setSocket) this.userProfile.setSocket(sock);
        if (this.botProfile?.setSocket) this.botProfile.setSocket(sock);
        if (this.presenceSimulator) this.presenceSimulator.sock = sock;

        // Inicializa módulos que dependem de socket se ainda não existirem
        if (!this.stickerHandler) this.stickerHandler = new StickerViewOnceHandler(sock, this.config);
        if (!this.presenceSimulator) this.presenceSimulator = new PresenceSimulator(sock);
        if (!this.userProfile) this.userProfile = new UserProfile(sock, this.logger, this.config);
        if (!this.botProfile) this.botProfile = new BotProfile(sock, this.logger, this.config);
        if (!this.groupManagement) {
            this.groupManagement = new GroupManagement(sock, this.config, this.moderationSystem!, this.mediaProcessor!, this.levelSystem!);
        }
    }

    public async handle(m: any, meta: any): Promise<boolean | void> {
        // meta: { nome, numeroReal, texto, replyInfo, ehGrupo }
        try {
            const { nome, numeroReal, texto, replyInfo, ehGrupo } = meta;
            // make replyInfo available to downstream modules (GroupManagement etc.)
            if (replyInfo) {
                // attach under a private property to avoid conflict with Baileys
                (m as any)._replyInfo = replyInfo;
                // also expose as simple property for convenience
                (m as any).replyInfo = replyInfo;
            }
            // Extrai comando e argumentos
            let mp = this.messageProcessor || this.bot?.messageProcessor;

            if (!mp) {
                // Tentativa desesperada de recuperar do bot
                if (this.bot?.messageProcessor) {
                    this.messageProcessor = this.bot.messageProcessor;
                    mp = this.messageProcessor;
                }
            }

            if (!mp) {
                console.error(`❌ [CRITICAL] messageProcessor não acessível.`);
                return false;
            }

            // ✅ BUG FIX: Recupera groupManagement do bot se a instância local está null
            // Isso acontece quando o socket é atualizado mas a referência não propagou
            if (!this.groupManagement && this.bot?.groupManagement) {
                this.groupManagement = this.bot.groupManagement;
                this.logger?.debug('🔄 [CommandHandler] groupManagement recuperado do BotCore');
            }

            const chatJid = m.key.remoteJid;
            const senderId = numeroReal;

            // ═══════════════════════════════════════════════════════════════════════
            // INTERCEPTAÇÃO DE JOGADAS ATIVAS (SEM PREFIXO OU VIA REPLY)
            // ═══════════════════════════════════════════════════════════════════════
            const isGameReply = replyInfo && replyInfo.isReplyToGame;
            const gameType = replyInfo?.gameType;
            const msgTexto = (texto || '').trim();

            // Se for reply a uma mensagem de jogo OU se for um input que parece jogada em chat ativo (RESTRITO A REPLY E JOGADORES TTT/GRID)
            if (isGameReply && /^\d+$/.test(msgTexto)) {
                const gameModule = this.gameSystem;
                if (gameModule) {
                    // Verifica se o usuário é um dos jogadores do jogo ativo no chat
                    const gameData = gameModule.games.get(chatJid) || gameModule.games.get(`${chatJid}_gridtactics`);
                    const normSender = (gameModule as any)._normalizeId(senderId);

                    if (gameData && (gameData.players?.includes(normSender) || gameData.player === normSender)) {
                        const gameRes = await gameModule.processActiveGameInput(chatJid, senderId, msgTexto, replyInfo);
                        if (gameRes) {
                            await this._reply(m, gameRes.text, { mentions: [senderId] });
                            return true;
                        }
                    }
                }
            }

            const parsed = mp.parseCommand(texto ?? '');
            if (!parsed) return false;

            const command = parsed.comando.toLowerCase();
            const args = parsed.args;
            const fullArgs = parsed.textoCompleto;
            const isOwner = this.config.isDono(senderId, nome);
            const isPremium = this.subscriptionManager?.isPremium?.(senderId) ?? false;
            const CYBER_OSINT_COMMANDS = ['shodan', 'cve', 'nmap', 'sqlmap', 'hydra', 'nuclei', 'nikto', 'masscan', 'whois', 'dns', 'geo', 'commix', 'searchsploit', 'socialfish', 'blackeye', 'theharvester', 'sherlock', 'holehe', 'netexec', 'winrm', 'impacket', 'dork', 'email', 'phone', 'username'];

            if (CYBER_OSINT_COMMANDS.includes(command) && !isOwner && !isPremium) {
                await this.bot.reply(m, '🔒 *PREMIUM REQUIRED*\n\nCybersecurity/OSINT tools são exclusivos para usuários Premium.\n\n#premium para verificar status ou #buy vip_7d');
                return true;
            }

            // Rate limiting (owner/premium bypass)
            // TIPO_CONVERSA: Se é grupo, não aplica rate limit
            if (this.rateLimiter && !isOwner) {
                const tipoConversa = ehGrupo ? 'grupo' : 'pv'; // ✅ BUG FIX #2: Diferencia grupo vs PV
                const rlStatus = this.rateLimiter.checkPremium(senderId, isPremium, tipoConversa);
                if (!rlStatus.allowed) {
                    const resetAt = rlStatus.resetAt ? `\n🕐 *Acesso em:* ${rlStatus.resetAt}` : '';
                    await this.bot.reply(m, `⏳ *LIMITE EXEDIDO* (${rlStatus.reason})${resetAt}`);
                    return true;
                }
            }

            // Log de comando
            // this.logger?.debug(`[CMD] ${command} por ${nome} em ${chatJid}`);

            // ✅ BUG FIX: Comandos NÃO devem ter delay de digitação
            // O 'ping' e todos os outros comandos devem ser instantâneos
            // O markAsRead (ticks azuis) é tratado no BotCore após `handled = true`
            // Não fazer NADA aqui para não adicionar delay

            // ═══════════════════════════════════════════════════════════════════════
            // DETECÇÃO DE JOGADAS VIA REPLY
            // Se o usuário responde em reply a uma mensagem de jogo com uma jogada válida
            // processa como jogada automaticamente sem enviar para a IA
            // ═══════════════════════════════════════════════════════════════════════

            // Detecta se é uma resposta a uma mensagem de jogo (re-uso de variáveis acima)
            if (isGameReply && fullArgs && command !== 'ping') {
                // Verifica se o texto é uma jogada válida
                const trimmedArgs = fullArgs.trim();

                // TTT - números 1-9
                if ((gameType === 'ttt' || (gameType === 'ttt' && /^[1-9]$/.test(trimmedArgs)))) {
                    try {
                        const gameRes = await this.gameSystem?.handleTicTacToe(chatJid, senderId, trimmedArgs, undefined);
                        return await this._reply(m, gameRes.text, { mentions: [senderId] });
                    } catch (e) {
                        console.error('Erro no TTT via reply:', e);
                    }
                }

                // Grid Tactics - números
                if (gameType === 'grid' && /^\d+$/.test(trimmedArgs)) {
                    try {
                        const parts = trimmedArgs.split(/\s+/);
                        const gameRes = await this.gridTacticsGame?.handleGridTactics(chatJid, senderId, parts[0], parts.slice(1));
                        return await this._reply(m, gameRes.text);
                    } catch (e) {
                        console.error('Erro no Grid via reply:', e);
                    }
                }

                // RPS - pedra, papel, tesoura
                if (gameType === 'rps' && ['pedra', 'papel', 'tesoura'].includes(trimmedArgs.toLowerCase())) {
                    try {
                        const gameRes = await this.gameSystem?.handleGame(chatJid, senderId, 'rps', [trimmedArgs.toLowerCase()], undefined);
                        return await this._reply(m, gameRes.text, { mentions: [senderId] });
                    } catch (e) {
                        console.error('Erro no RPS via reply:', e);
                    }
                }

                // Guess - números
                if (gameType === 'guess' && /^\d+$/.test(trimmedArgs)) {
                    try {
                        const gameRes = await this.gameSystem?.handleGame(chatJid, senderId, 'guess', [trimmedArgs]);
                        return await this._reply(m, gameRes.text);
                    } catch (e) {
                        console.error('Erro no Guess via reply:', e);
                    }
                }

                // Forca - letras
                if (gameType === 'hangman' && /^[a-zA-Z]$/.test(trimmedArgs)) {
                    try {
                        const gameRes = await this.gameSystem?.handleGame(chatJid, senderId, 'forca', [trimmedArgs.toLowerCase()]);
                        return await this._reply(m, gameRes.text);
                    } catch (e) {
                        console.error('Erro no Hangman via reply:', e);
                    }
                }
            }

            // Verifica permissões de dono
            const userId = m.key.participant || senderId;

            // VERIFICAÇÃO DE REGISTRO GLOBAL - APENAS NO PV, NÃO EM GRUPOS
            // Grupos permitem usuários não registrados usarem comandos
            const isReg = this.registrationSystem.isRegistered(userId);
            const publicCommands = ['registrar', 'register', 'reg', 'menu', 'help', 'ajuda', 'comandos', 'dono', 'owner', 'criador', 'creator', 'ping',
                'level', 'lvl', 'nivel', 'rank', 'ranking', 'top'];

            // Only require registration in private chats (PV), not in groups
            if (!isReg && !isOwner && !ehGrupo && !publicCommands.includes(command.toLowerCase())) {
                await this.bot.reply(m, '❌ *ACESSO NEGADO!*\n\nVocê precisa se registrar para usar os comandos do bot.\n\nUse: *#registrar SeuNome|SuaIdade*');
                return true;
            }

            // NOVO: Verifica se o usuário é admin do grupo
            let isAdminUsers = false;
            if (ehGrupo) {
                const gm = this.groupManagement || this.bot?.groupManagement;
                if (gm) {
                    try {
                        isAdminUsers = await gm.isUserAdmin(chatJid, userId);
                    } catch (e) { isAdminUsers = false; }
                } else {
                    this.logger?.warn('[CommandHandler] GroupManagement não disponível para verificar admin');
                }
            }

            // ══════════════════════════════════════════
            // VERIFICAÇÃO DE PERMISSÕES
            // ══════════════════════════════════════════
            const groupJid = ehGrupo ? chatJid : null;

            const permissionCheck = this.permissionManager.canExecuteCommand(
                command,
                userId,
                nome,
                ehGrupo,
                groupJid,
                isAdminUsers
            );

            if (!permissionCheck.allowed) {
                await this.bot.reply(m, permissionCheck.reason);
                return true;
            }

            // ══════════════════════════════════════════
            // DESPACHO DE COMANDOS
            // ══════════════════════════════════════════

            switch (command) {
                case 'ping': {
                    // if user mentioned or replied to someone, show latency to that target as a mention
                    let targetText = '';
                    const extractTargets = (msg: any): string[] => {
                        const mentioned: string[] = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
                        if (mentioned.length) return mentioned;
                        const replyInfoLocal = msg.replyInfo || msg._replyInfo;
                        if (replyInfoLocal && replyInfoLocal.quemEscreveuCitacaoJid) return [replyInfoLocal.quemEscreveuCitacaoJid];
                        if (msg.message?.extendedTextMessage?.contextInfo?.participant) {
                            return [msg.message.extendedTextMessage.contextInfo.participant];
                        }
                        return [];
                    };
                    const targets = extractTargets(m);
                    if (targets.length > 0) {
                        targetText = ` para @${JidUtils.getNumber(targets[0])}`;
                    }

                    const uptimeSeconds = Math.floor(process.uptime());

                    const months = Math.floor(uptimeSeconds / (30 * 24 * 3600));
                    const days = Math.floor((uptimeSeconds % (30 * 24 * 3600)) / (24 * 3600));
                    const hours = Math.floor((uptimeSeconds % (24 * 3600)) / 3600);
                    const minutes = Math.floor((uptimeSeconds % 3600) / 60);
                    const seconds = uptimeSeconds % 60;

                    let uptimeStr = '';
                    if (months > 0) uptimeStr += `${months}m `;
                    if (days > 0) uptimeStr += `${days}d `;
                    uptimeStr += `${hours}h ${minutes}m ${seconds}s`;

                    const stats = this.bot?.getStats?.() || { api: {}, message: {}, audio: {} };
                    const latencia = Date.now() - (m.messageTimestamp * 1000 || Date.now());

                    const statusMsg = `🏓 *PONG!*${targetText} \n\n` +
                        `⚡ *Latência:* ${Math.abs(latencia)}ms\n` +
                        `📡 *Uptime:* ${uptimeStr}\n` +
                        `🤖 *Bot:* ${this.config.BOT_NAME} V${this.config.BOT_VERSION}\n` +
                        `📊 *Status:* Online e Operacional\n` +
                        `🔗 *API:* ${stats.api?.error ? '⚠️ Offline' : '✅ Conectada'}\n` +
                        `🎤 *STT/TTS:* ${stats.audio?.error ? '⚠️ Inativo' : '✅ Ativo'}\n\n` +
                        `_Sistema respondendo normalmente!_`;

                    const replyOpts: any = {};
                    if (targets.length) replyOpts.mentions = [targets[0]];
                    await this.bot.reply(m, statusMsg, replyOpts);
                    return true;
                }

                case 'registrar':
                case 'register':
                case 'reg':
                    return await this._handleRegister(m, fullArgs, userId);

                case 'level':
                case 'lvl':
                case 'nivel':
                    try {
                        return await this._handleLevel(m, userId, chatJid, ehGrupo);
                    } catch (e: any) {
                        console.error('[CommandHandler] Erro no comando level:', e.message);
                        await this._reply(m, '❌ Erro ao processar comando de nível. Tente novamente.');
                        return true;
                    }

                case 'rank':
                case 'ranking':
                case 'top':
                    return await this._handleRank(m, chatJid, ehGrupo);

                case 'daily':
                case 'diario':
                    return await this._handleDaily(m, userId);

                case 'atm':
                case 'banco':
                case 'saldo':
                case 'balance':
                    return await this._handleATM(m, userId);

                case 'transfer':
                case 'transferir':
                case 'pagar':
                    return await this._handleTransfer(m, userId, args, fullArgs);

                case 'deposit':
                case 'depositar':
                    return await this._handleDeposit(m, userId, args);

                case 'withdraw':
                case 'sacar':
                    return await this._handleWithdraw(m, userId, args);

                case 'transacoes':
                case 'transactions':
                    return await this._handleTransactions(m, userId);

                case 'menu':
                case 'help':
                case 'ajuda':
                case 'comandos':
                    return await this._showMenu(m, args[0]);

                // SUBMENU ALIASES - Fix for "submenus não estão funcionando"
                case 'menucyber':
                case 'menumedia':
                case 'menuconta':
                case 'menudiversao':
                case 'menujogos':
                case 'menugrupo':
                case 'menuadm':
                case 'menuinfo':
                case 'menupremium':
                case 'menuosint':
                case 'menuaudio':
                case 'menuimagem':
                    // Extract submenu from command (remove "menu" prefix)
                    const subMenu = command.substring(4).toLowerCase(); // "menucyber" -> "cyber"
                    return await this._showMenu(m, subMenu);

                case 'cyber':
                case 'grupos':
                case 'grupo':
                case 'admin':
                case 'moderacao':
                case 'diversao':
                case 'fun':
                case 'jogos':
                case 'game':
                case 'osint':
                case 'inteligencia':
                case 'informacoes':
                case 'about':
                case 'extras':
                    return await this._showMenu(m, command);

                case 'pinterest':
                case 'image':
                case 'img':
                    return await this._handlePinterest(m, fullArgs, args);

                case 'ship':
                    return await this._handleShip(m);

                case 'dado':
                case 'moeda':
                case 'caracoroa':
                case 'slot':
                case 'chance':
                case 'gay':
                    return await this._handleGames(m, command, args);

                case 'ttt':
                case 'tictactoe':
                case 'jogodavelha': {
                    const mentioned = m.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                    // Modo IA: se não mencionar ninguém, joga contra a IA
                    try {
                        const gameRes = await this.gameSystem?.handleTicTacToe(chatJid, userId, args[0] || 'start', mentioned);
                        return await this._reply(m, gameRes.text, { mentions: [userId, ...(mentioned ? [mentioned] : [])] });
                    } catch (e) {
                        console.error('Erro no TTT:', e);
                        await this._reply(m, '❌ Erro ao iniciar o jogo. Tente novamente!');
                        return true;
                    }
                }

                case 'rps':
                case 'ppt':
                case 'pedrapapeltesoura': {
                    const mentioned = m.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                    const gameRes = await this.gameSystem?.handleGame(chatJid, userId, 'rps', args, mentioned);
                    return await this._reply(m, gameRes.text, { mentions: [userId, ...(mentioned ? [mentioned] : [])] });
                }

                case 'guess':
                case 'adivinhe':
                case 'advinha': {
                    const gameRes = await this.gameSystem?.handleGame(chatJid, userId, 'guess', args);
                    return await this._reply(m, gameRes.text);
                }

                case 'forca':
                case 'hangman': {
                    const gameRes = await this.gameSystem?.handleGame(chatJid, userId, 'forca', args);
                    return await this._reply(m, gameRes.text);
                }

                case 'gridtactics':
                case 'grid': {
                    try {
                        const action = args[0] || 'start';
                        const gameArgs = args.slice(1);
                        const gameRes = await this.gridTacticsGame?.handleGridTactics(chatJid, userId, action, gameArgs);
                        return await this._reply(m, gameRes.text);
                    } catch (e) {
                        console.error('Erro no Grid Tactics:', e);
                        await this._reply(m, '❌ Erro no jogo Grid Tactics. Tente: #gridtactics start');
                        return true;
                    }
                }

                case 'tagall':
                case 'hidetag':
                case 'totag':
                    if (!isOwner && !isAdminUsers) {
                        await this.bot.reply(m, '🚫 Este comando requer privilégios de administrador.');
                        return true;
                    }
                    return await this._handleTagAll(m, fullArgs, command === 'hidetag');

                case 'welcome':
                case 'bemvindo':
                case 'setwelcome':
                case 'setgoodbye':
                case 'goodbye':
                    if (!isOwner && !isAdminUsers) {
                        await this.bot.reply(m, '🚫 Este comando requer privilégios de administrador.');
                        return true;
                    }
                    return await this._handleWelcome(m, command, args, fullArgs);

                case 'broadcast':
                    if (!isOwner) {
                        await this.bot.reply(m, '🚫 Este comando requer privilégios de administrador.');
                        return true;
                    }
                    return await this._handleBroadcast(m, fullArgs);

                case 'hd':
                case 'upscale':
                case 'remini':
                case 'enhance':
                    return await this._handleImageEffect(m, 'hd', args);

                case 'removebg':
                case 'bg':
                case 'rmbg':
                    return await this._handleImageEffect(m, 'removebg', args);

                case 'wasted':
                case 'jail':
                case 'triggered':
                case 'communism':
                case 'sepia':
                case 'grey':
                case 'invert':
                case 'mission':
                case 'angola':
                case 'addbg':
                    return await this._handleImageEffect(m, command, args);

                case 'sticker':
                case 's':
                case 'fig':
                    return await this._handleSticker(m, nome);

                case 'take':
                case 'roubar':
                    return await this._handleTakeSticker(m, fullArgs, nome);

                case 'toimg':
                    return await this._handleStickerToImage(m);

                case 'play':
                case 'p':
                    return await this._handlePlay(m, fullArgs);

                case 'video':
                case 'playvid':
                case 'ytmp4':
                    return await this._handleVideo(m, fullArgs);

                case 'tomp3':
                case 'mp3':
                    return await this._handleVideoToAudio(m);

                case 'nightcore':
                case 'slow':
                case 'bass':
                case 'bassboost':
                case 'deep':
                case 'robot':
                case 'reverse':
                case 'squirrel':
                case 'echo':
                case '8d':
                    return await this._handleAudioEffect(m, command);

                case 'perfil':
                case 'profile':
                case 'info':
                    return await this._handleProfile(m, meta);

                case 'del':
                case 'apagar':
                case 'delete':
                    return await this._handleDelete(m, isOwner || isAdminUsers);

                case 'dono':
                case 'owner':
                case 'criador':
                case 'creator':
                    return await this._handleDono(m);

                case 'report':
                case 'bug':
                case 'reportar':
                    return await this._handleReport(m, fullArgs, nome, senderId, ehGrupo);

                case 'premium':
                case 'vip':
                    return await this._handlePremiumInfo(m, senderId);

                case 'addpremium':
                case 'addvip':
                    if (!isOwner) {
                        await this.securityLogger?.logAdminAction({
                            user: numeroReal,
                            command,
                            args: args.join(' '),
                            chatJid,
                            action: 'addpremium',
                            isOwner: false
                        });
                        await this.bot.reply(m, '🚫 Este comando requer privilégios de administrador.');
                        return true;
                    }
                    await this.securityLogger?.logAdminAction({
                        user: numeroReal,
                        command,
                        args: args.join(' '),
                        chatJid,
                        action: 'addpremium',
                        isOwner: true
                    });
                    return await this._handleAddPremium(m, args);

                case 'delpremium':
                case 'delvip':
                    if (!isOwner) {
                        await this.securityLogger?.logAdminAction({
                            user: numeroReal,
                            command,
                            args: args.join(' '),
                            chatJid,
                            action: 'delpremium',
                            isOwner: false
                        });
                        await this.bot.reply(m, '🚫 Este comando requer privilégios de administrador.');
                        return true;
                    }
                    await this.securityLogger?.logAdminAction({
                        user: numeroReal,
                        command,
                        args: args.join(' '),
                        chatJid,
                        action: 'delpremium',
                        isOwner: true
                    });
                    return await this._handleDelPremium(m, args);


                case 'donate':
                case 'doar':
                case 'buy':
                case 'comprar':
                    return await this._handlePaymentCommand(m, args);

                case 'shodan':
                case 'cve':
                case 'nmap':
                case 'sqlmap':
                case 'hydra':
                case 'nuclei':
                case 'nikto':
                case 'masscan':
                case 'whois':
                case 'dns':
                case 'geo':
                case 'commix':
                case 'searchsploit':
                case 'socialfish':
                case 'blackeye':
                case 'theharvester':
                case 'sherlock':
                case 'holehe':
                case 'netexec':
                case 'winrm':
                case 'impacket':
                    if (!isOwner) {
                        await this.bot.reply(m, '🚫 Este comando requer privilégios de administrador.');
                        return true;
                    }
                    await this._reply(m, '❌ Sistema de cibersegurança não disponível no momento.');
                    return true;

                case 'setoolkit':
                    if (!isOwner) {
                        await this.bot.reply(m, '🚫 Este comando requer privilégios de administrador.');
                        return true;
                    }
                    return await this._handleSetoolkit(m, fullArgs);

                case 'metasploit':
                    if (!isOwner) {
                        await this.bot.reply(m, '🚫 Este comando requer privilégios de administrador.');
                        return true;
                    }
                    return await this._handleMetasploit(m, fullArgs);

                case 'dork':
                case 'email':
                case 'phone':
                case 'username':
                    if (!isOwner) {
                        await this.bot.reply(m, '🚫 Este comando requer privilégios de administrador.');
                        return true;
                    }
                    await this._reply(m, '❌ Sistema OSINT não disponível no momento.');
                    return true;

                case 'mute':
                case 'desmute':
                case 'unmute':
                case 'kick':
                case 'ban':
                case 'add':
                case 'promote':
                case 'demote': {
                    // ✅ Permitir: Dono OU Admin do grupo OU Usuário na lista #except
                    let podeExecutar = isOwner;

                    // Se não for dono e estiver em grupo, verifica se é admin ou excepted
                    if (!isOwner && ehGrupo) {
                        const isAdminInGroup = await this.groupManagement?.isUserAdmin(m.key.remoteJid, senderId);
                        const isExcepted = this.moderationSystem?.isUserExcepted(m.key.remoteJid, senderId);
                        podeExecutar = isAdminInGroup || isExcepted;
                    }

                    if (!podeExecutar) {
                        if (ehGrupo) {
                            await this.bot.reply(m, '🚫 *COMANDO RESTRITO!*\n\nApenas administradores ou usuários autorizados podem usar este comando.');
                        } else {
                            await this.bot.reply(m, '🚫 *COMANDO RESTRITO!*\n\nApenas o proprietário do bot pode usar este comando.');
                        }
                        return true;
                    }

                    // 🛡️ PROTEÇÃO DO DONO: Impedir ações contra o dono (mesmo por admins/excepted)
                    // (O GroupManagement já deve ter essa trava, mas reforçamos aqui se possível)

                    // Verifica se groupManagement está disponível
                    if (!this.groupManagement) {
                        console.error('[CommandHandler] GroupManagement não inicializado');
                        await this._reply(m, '❌ Sistema de gerenciamento de grupo não disponível.');
                        return true;
                    }

                    try {
                        return await this.groupManagement.handleCommand(m, command, args);
                    } catch (e: any) {
                        console.error(`[CommandHandler] Erro no comando ${command}:`, e.message);
                        // Não mostra mensagem de erro técnica para o usuário
                        return true;
                    }
                }

                // COMANDOS DE GRUPO — APENAS O DONO PODE USAR
                case 'fechar':
                case 'close':
                case 'abrir':
                case 'open':
                case 'fixar':
                case 'pin':
                case 'desafixar':
                case 'unpin':
                case 'reagir':
                case 'react':
                case 'link':
                case 'revlink':
                case 'revogar':
                case 'setdesc':
                case 'descricao':
                case 'setfoto':
                case 'fotodogrupo': {
                    if (!isOwner && !isAdminUsers) {
                        await this.bot.reply(m, '🚫 *COMANDO RESTRITO!*\n\nApenas admins ou o proprietário do bot podem usar este comando.');
                        return true;
                    }

                    if (!this.groupManagement) {
                        console.error('[CommandHandler] GroupManagement não inicializado');
                        await this._reply(m, '❌ Sistema de gerenciamento de grupo não disponível.');
                        return true;
                    }

                    try {
                        return await this.groupManagement.handleCommand(m, command, args);
                    } catch (e: any) {
                        console.error(`[CommandHandler] Erro no comando ${command}:`, e.message);
                        return true;
                    }
                }

                case 'blacklist':
                    if (!isOwner) return false;
                    return await this._handleBlacklist(m, args, fullArgs);

                case 'mutelist':
                case 'silenciados':
                    if (!isOwner && !isAdminUsers) return false;
                    const mlReport = this.moderationSystem.getMutedReport(chatJid);
                    return await this._reply(m, mlReport);


                // INFO DO GRUPO — QUALQUER MEMBRO REGISTRADO
                case 'groupinfo':
                case 'infogrupo':
                case 'ginfo': {
                    if (!ehGrupo) { await this.bot.reply(m, '❌ Este comando só funciona em grupos.'); return true; }
                    const isReg3 = this.registrationSystem?.isRegistered?.(userId);
                    if (!isReg3 && !isOwner) { await this.bot.reply(m, '❌ Use *#registrar Nome|Idade* primeiro!'); return true; }
                    return await this.groupManagement.handleCommand(m, 'groupinfo', args);
                }

                case 'listar':
                case 'membros': {
                    if (!ehGrupo) { await this.bot.reply(m, '❌ Este comando só funciona em grupos.'); return true; }
                    if (!isOwner && !isAdminUsers) { await this.bot.reply(m, '🚫 Apenas admins podem listar membros.'); return true; }
                    return await this.groupManagement.handleCommand(m, 'listar', args);
                }

                case 'admins':
                case 'listadmins': {
                    if (!ehGrupo) { await this.bot.reply(m, '❌ Este comando só funciona em grupos.'); return true; }
                    const isReg4 = this.registrationSystem?.isRegistered?.(userId);
                    if (!isReg4 && !isOwner) { await this.bot.reply(m, '❌ Use *#registrar Nome|Idade* primeiro!'); return true; }
                    return await this.groupManagement.handleCommand(m, 'admins', args);
                }


                // DIVERSÃO & UTILIDADES — REQUER REGISTRO
                case 'enquete':
                case 'poll': {
                    const isReg5 = this.registrationSystem?.isRegistered?.(userId);
                    if (!isReg5 && !isOwner) { await this.bot.reply(m, '❌ Use *#registrar Nome|Idade* primeiro!'); return true; }
                    return await this._handlePoll(m, fullArgs);
                }

                case 'sortear':
                case 'raffle':
                case 'sorteio': {
                    if (!ehGrupo) { await this.bot.reply(m, '❌ Este comando só funciona em grupos.'); return true; }
                    if (!isOwner && !isAdminUsers) { await this.bot.reply(m, '🚫 Apenas admins podem fazer sorteios.'); return true; }
                    return await this._handleRaffle(m, chatJid, args);
                }

                case 'tts': {
                    const isReg6 = this.registrationSystem?.isRegistered?.(userId);
                    if (!isReg6 && !isOwner) { await this.bot.reply(m, '❌ Use *#registrar Nome|Idade* primeiro!'); return true; }
                    return await this._handleTTSCommand(m, args, fullArgs);
                }

                case 'piada':
                case 'joke': {
                    const isReg7 = this.registrationSystem?.isRegistered?.(userId);
                    if (!isReg7 && !isOwner) { await this.bot.reply(m, '❌ Use *#registrar Nome|Idade* primeiro!'); return true; }
                    return await this._handleFun(m, 'piada');
                }

                case 'frases':
                case 'quote':
                case 'motivar': {
                    const isReg8 = this.registrationSystem?.isRegistered?.(userId);
                    if (!isReg8 && !isOwner) { await this.bot.reply(m, '❌ Use *#registrar Nome|Idade* primeiro!'); return true; }
                    return await this._handleFun(m, 'frase');
                }

                case 'fatos':
                case 'curiosidade': {
                    const isReg9 = this.registrationSystem?.isRegistered?.(userId);
                    if (!isReg9 && !isOwner) { await this.bot.reply(m, '❌ Use *#registrar Nome|Idade* primeiro!'); return true; }
                    return await this._handleFun(m, 'fato');
                }

                case 'setbotphoto':
                case 'setbotpic':
                case 'setphoto':
                    if (!isOwner) return false;
                    return await this._handleSetBotPhoto(m);

                case 'setbotname':
                case 'setname':
                    if (!isOwner) return false;
                    return await this._handleSetBotName(m, fullArgs);

                case 'setbotstatus':
                case 'setbio':
                    if (!isOwner) return false;
                    return await this._handleSetBotStatus(m, fullArgs);

                case 'getprofile':
                case 'getuser':
                    if (!isOwner) return false;
                    return await this._handleGetProfileAdmin(m, args);

                case 'antilink':
                case 'antispam':
                case 'antifake':
                case 'antiimage':
                case 'antisticker':
                case 'antipalavrao':
                case 'antipalavras':
                case 'antibadwords':
                    // SEGURANÇA: Apenas o DONO ou ADMINS podem usar comandos de moderação/config
                    if (!isOwner && !isAdminUsers) {
                        await this.bot.reply(m, '🚫 *COMANDO RESTRITO!*\n\nApenas admins ou o proprietário do bot podem usar este comando.');
                        return true;
                    }
                    if (!this.moderationSystem) {
                        console.error('[CommandHandler] ModerationSystem não inicializado');
                        await this._reply(m, '❌ Sistema de moderação não disponível.');
                        return true;
                    }
                    try {
                        if (['welcome', 'goodbye', 'setwelcome', 'setgoodbye', 'antipalavrao', 'antipalavras', 'antibadwords', 'antispam'].includes(command)) {
                            return await this.groupManagement.handleCommand(m, command, args);
                        }
                        return await this._handleToggleModeration(m, command, args);
                    } catch (e: any) {
                        console.error(`[CommandHandler] Erro no comando ${command}:`, e.message);
                        return true;
                    }

                case 'warn':
                    if (!isOwner && !isAdminUsers) return false;
                    return await this._handleManualWarn(m, args);

                case 'unwarn':
                case 'resetwarns':
                    if (!isOwner && !isAdminUsers) return false;
                    return await this._handleResetWarns(m, args);

                case 'except':
                case 'excep':
                    if (!isOwner && !isAdminUsers) {
                        await this.bot.reply(m, '🚫 *COMANDO RESTRITO!*\n\nApenas admins ou o proprietário do bot podem gerenciar a lista de exceções.');
                        return true;
                    }
                    return await this._handleExceptCommand(m, args);

                case 'restart':
                    if (!isOwner) return false;
                    await this.bot.reply(m, '🔄 Reiniciando sistemas Akira...');
                    process.exit(0);
                    return true;

                case 'reset':
                case 'resetar':
                case 'limparmemoria': {
                    try {
                        await this.bot.reply(m, '🧹 Limpando memória da conversa...');
                        const resultado = await this.bot.apiClient.reset(senderId);
                        if (resultado?.success) {
                            await this.bot.reply(m, `✅ Memória limpa com sucesso!${resultado.message ? `\n${resultado.message}` : ''}`);
                        } else {
                            await this.bot.reply(m, `⚠️ Não foi possível limpar a memória. Tente novamente mais tarde.`);
                        }
                    } catch (err) {
                        console.error('❌ Erro ao resetar memória:', err);
                        await this.bot.reply(m, '❌ Falha ao limpar memória da conversa.');
                    }
                    return true;
                }

                default: {
                    return false;
                }
            }

        } catch (error) {
            console.error('❌ Erro no handlesCommand:', error);
            return false;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // MÉTODOS AUXILIARES DE COMANDO
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Cria uma seção visual padronizada para os menus
     */
    private createMenuSection(emoji: string, title: string): string {
        return `\n${emoji} *${title}*\n────────────────────────────`;
    }

    public async _reply(m: any, text: string, options: any = {}): Promise<any> {
        const jid = m.key?.remoteJid;
        const errorPrefix = `🔴 [_REPLY] Para ${jid}:`;

        try {
            // FALLBACK 1: Preferir sock (mais confiável)
            if (this.sock) {
                try {
                    console.log(`🟢 [_REPLY] Enviando via sock.sendMessage() para ${jid}`);
                    const result = await this.sock.sendMessage(jid, { text, ...options }, { quoted: m });
                    console.log(`✅ [_REPLY] Mensagem enviada com sucesso. ID:`, result?.key?.id || 'desconhecido');
                    return result;
                } catch (sockErr: any) {
                    console.error(`${errorPrefix} sock.sendMessage() falhou: ${sockErr.message}`);
                    // Não retorna aqui, tenta o fallback
                }
            } else {
                console.warn(`${errorPrefix} this.sock é null/undefined`);
            }

            // FALLBACK 2: Tentar bot.reply
            if (this.bot && typeof this.bot.reply === 'function') {
                try {
                    console.log(`🟡 [_REPLY] Sock failed, tentando bot.reply() para ${jid}`);
                    const result = await this.bot.reply(m, text, options);
                    console.log(`✅ [_REPLY] Mensagem enviada via bot.reply(). ID:`, result?.key?.id || 'desconhecido');
                    return result;
                } catch (botErr: any) {
                    console.error(`${errorPrefix} bot.reply() falhou: ${botErr.message}`);
                }
            } else {
                console.error(`${errorPrefix} bot.reply não disponível`);
            }

            // Se chegou aqui, AMBOS falharam
            const errMsg = `FALHA crítica ao enviar resposta para ${jid}. sock=${!!this.sock}, bot.reply=${typeof this.bot?.reply}`;
            console.error(`${errorPrefix} ${errMsg}`);
            throw new Error(errMsg);

        } catch (error: any) {
            console.error(`${errorPrefix} Exceção não tratada:`, error.message);
            throw error; // Re-lança para que o caller saiba que falhou
        }
    }

    public async _showMenu(m: any, subArg?: string): Promise<boolean> {
        const P = this.config.PREFIXO;
        const sub = (subArg || '').toLowerCase().trim();

        // ── Menu principal (sem argumento) ──
        if (!sub) {
            const sections = [
                {
                    title: "👤 PESSOAL & ECONOMIA",
                    rows: [
                        { title: "Perfil & Conta", rowId: `${P}menu conta`, description: "Nível, XP, Rank e Banco" },
                        { title: "Premium", rowId: `${P}menu premium`, description: "Status VIP e Planos" }
                    ]
                },
                {
                    title: "🎨 MÍDIA & CRIAÇÃO",
                    rows: [
                        { title: "Mídia & Downloads", rowId: `${P}menu media`, description: "Stickers, Músicas, Vídeos e Pinterest" },
                        { title: "Efeitos de Áudio", rowId: `${P}menu audio`, description: "Efeitos de voz e TTS" },
                        { title: "Efeitos de Imagem", rowId: `${P}menu imagem`, description: "HD, RemoveBG e Filtros" }
                    ]
                },
                {
                    title: "🛡️ ADMINISTRAÇÃO & SEGURANÇA",
                    rows: [
                        { title: "Gestão de Grupos", rowId: `${P}menu grupos`, description: "Moderação e Admin" },
                        { title: "Cybersecurity", rowId: `${P}menu cyber`, description: "Ferramentas Pentest (Owner/VIP)" },
                        { title: "OSINT", rowId: `${P}menu osint`, description: "Inteligência de Fontes Abertas" }
                    ]
                },
                {
                    title: "🎮 ENTRETENIMENTO",
                    rows: [
                        { title: "Diversão & Jogos", rowId: `${P}menu diversao`, description: "TTT, RPS, Grid, Cassino e mais" },
                        { title: "Informações", rowId: `${P}menu info`, description: "Status do bot e Contato" }
                    ]
                }
            ];

            const listMessage = {
                text: `✨ *AKIRA OMNI-BOT V21* ✨\n💎 *PREMIUM EDITION*\n\nSeja bem-vindo ao painel de controle. Selecione uma categoria abaixo para explorar minhas funcionalidades.\n\n` +
                    `📂 *CATEGORIAS DISPONÍVEIS:*\n` +
                    `1️⃣ 👤 *#menu conta* — Perfil & Economia\n` +
                    `2️⃣ 🎨 *#menu media* — Downloads & Stickers\n` +
                    `3️⃣ 🎤 *#menu audio* — Efeitos & TTS\n` +
                    `4️⃣ 🖼️ *#menu imagem* — HD & Filtros\n` +
                    `5️⃣ 👥 *#menu grupos* — Gestão & Admin\n` +
                    `6️⃣ 🛡️ *#menu cyber* — Pentest & OSINT\n` +
                    `7️⃣ 🎮 *#menu diversao* — Jogos & Lazer\n` +
                    `8️⃣ ℹ️ *#menu info* — Status & Contato\n\n` +
                    `💡 _Dica: Clique no botão abaixo ou digite o comando desejado._`,
                footer: "© 2026 Isaac Quarenta • Enterprise Edition",
                title: "📂 MENU DE COMANDOS",
                buttonText: "ABRIR LISTA DE CATEGORIAS",
                sections
            };

            await this.sock.sendMessage(m.key.remoteJid, listMessage, { quoted: m });

            // Adiciona seção dinâmica com comandos detectados mas não mostrados no menu
            try {
                const srcPath = path.join(process.cwd(), 'modules', 'CommandHandler.ts');
                const src = await fs.promises.readFile(srcPath, 'utf8');
                const caseRe = /case\\s+'([^']+)'/g;
                const menuRe = /\\$\\{P\\}\\s*([a-zA-Z0-9_\\-]+)/g;
                const impl = new Set();
                const men = new Set();
                let mm;
                while ((mm = caseRe.exec(src)) !== null) impl.add(mm[1].toLowerCase());
                while ((mm = menuRe.exec(src)) !== null) men.add(mm[1].toLowerCase());
                const missing = Array.from(impl).filter(c => !men.has(c));
                if (missing.length) {
                    const sample = missing.slice(0, 40).map(x => `• ${P}${x}`).join('\n');
                    const extrasText = `\n🔎 *Comandos detectados mas não mostrados no menu*\n${sample}${missing.length > 40 ? `\n...e mais ${missing.length - 40} comandos` : ''}`;
                    await this._reply(m, extrasText);
                }
            } catch (e) {
                console.error('Erro ao auditar menu dinamicamente:', e);
            }

            if (this.presenceSimulator) await this.presenceSimulator.markAsRead(m);
            return true;
        }

        // ── Submenus por categoria ──
        const menus: Record<string, string> = {
            conta:
                `👤 *CONTA & PERFIL* 👤
────────────────────────────
✨ *IDENTIDADE*
• ${P}registrar Nome|Idade 
• ${P}perfil — Seus dados
• ${P}level 🔒 — Nível/XP
• ${P}rank 🔒 — Top 10

💰 *ECONOMIA*
• ${P}daily 🔒 — Diário
• ${P}atm 🔒 — Saldo
• ${P}transfer @user 🔒
• ${P}deposit [valor] 🔒
• ${P}withdraw [valor] 🔒
• ${P}transacoes 🔒`,

            media:
                `🎨 *MÍDIA & CRIAÇÃO* 🎨
────────────────────────────
✨ *STIKERS*
• ${P}sticker | ${P}s
• ${P}take — Roubar fig.
• ${P}toimg — Fig → Img

🎵 *DOWNLOADS*
• ${P}play [nome] 🔒 — Música
• ${P}video [nome] 🔒 — Vídeo
• ${P}tomp3 — Vídeo → MP3
• ${P}pinterest [busca] 🔒`,

            audio:
                `🎤 *EFEITOS DE ÁUDIO* 🎤
────────────────────────────
• ${P}nightcore • ${P}slow
• ${P}bass • ${P}deep
• ${P}robot • ${P}reverse
• ${P}squirrel • ${P}echo • ${P}8d

🗣️ *TTS (VOZ)*
• ${P}tts [texto] — Google
• ${P}tiktok [texto] — TikTok
• ${P}belmira [texto] — Especial`,

            imagem:
                `🖼️ *EFEITOS DE IMAGEM* 🖼️
────────────────────────────
✨ *MELHORIA*
• ${P}hd | ${P}upscale — Alta def.
• ${P}removebg — Tirar fundo

🎭 *FILTROS*
• ${P}wasted • ${P}jail
• ${P}triggered • ${P}gay
• ${P}sepia • ${P}grey • ${P}invert
• ${P}angola • ${P}communism`,

            grupos:
                `👥 *ADMINISTRAÇÃO DE GRUPOS* 👥
────────────────────────────
🛡️ *SEGURANÇA*
• ${P}antilink on/off 👑
• ${P}antispam on/off 👑
• ${P}antifake on/off 👑
• ${P}antiimage on/off 👑
• ${P}antisticker on/off 👑
• ${P}antipalavrao on/off 👑

🔧 *GERENCIAMENTO*
• ${P}add @user 👑
• ${P}kick @user 👑
• ${P}promote @user 👑
• ${P}demote @user 👑
• ${P}mute/unmute 👑
• ${P}tagall — Marcar todos
• ${P}hidetag — Tag invisível
• ${P}link — Link do grupo
• ${P}revlink — Revogar link
• ${P}setdesc — Descrição 👑
• ${P}setfoto — Foto 👑`,

            diversao:
                `🎮 *DIVERSAÕES*
────────────────────────────
• ${P}ship @user @user — Compatibilidade
• ${P}slot — Máquina de cassino
• ${P}dado | ${P}moeda — Sorteio
• ${P}chance [pergunta] — Probabilidade
• ${P}gay — Medidor
• ${P}ttt | ${P}jogodavelha — Jogo da Velha
• ${P}rps | ${P}ppt — Pedra, Papel, Tesoura
• ${P}gridtactics | ${P}grid — Grid Tactics (4x4)
• ${P}guess | ${P}adivinhe — Adivinhe o número
• ${P}forca | ${P}hangman — Jogo da Forca
• ${P}piada 🔒 — Piada aleatória
• ${P}frases | ${P}motivar 🔒
• ${P}fatos | ${P}curiosidade 🔒`,

            cyber:
                `🛡️ *CYBERSECURITY (DONO)*
────────────────────────────
• ${P}nmap [alvo] 👑 — Port scanning
• ${P}sqlmap [url] 👑 — SQL injection test
• ${P}nuclei [alvo] 👑 — Vulnerability scanning
• ${P}hydra [alvo] 👑 — Brute force
• ${P}masscan [alvo] 👑 — Ultra-fast port scan
• ${P}nikto [url] 👑 — Web server scanner
• ${P}commix [url] 👑 — Command injection
• ${P}searchsploit [vuln] 👑 — Exploit database
• ${P}whois | ${P}dns | ${P}geo [ip] 👑 — Info lookup
• ${P}shodan [ip] 👑 — Shodan search
• ${P}cve [termo] 👑 — CVE database search
• ${P}socialfish 👑 — Phishing tool (SET alternative)
• ${P}blackeye 👑 — Phishing tool alternative
• ${P}netexec [alvo] 👑 — Network exploitation
• ${P}winrm [alvo] [user] [pass] 👑 — Windows remote shell
• ${P}impacket [tool] [alvo] 👑 — Impacket tools

${P}menu osint — Comandos OSINT avançados`,

            osint:
                `🔍 *OSINT & INTELIGÊNCIA*
────────────────────────────
• ${P}dork [query] 👑 — Google Dorking
• ${P}email [email] 👑 — Verificar vazamentos
• ${P}phone [numero] 👑 — Pesquisar número
• ${P}username [user] 👑 — Buscar username
• ${P}sherlock [user] 👑 — Social media search
• ${P}holehe [email] 👑 — Email reconnaissance
• ${P}theharvester [domain] 👑 — Email/DNS harvesting
• ${P}shodan [ip] 👑 — Shodan InternetDB search
• ${P}cve [termo] 👑 — CVE vulnerability search
• ${P}whois [dominio] 👑 — WHOIS lookup
• ${P}dns [dominio] 👑 — DNS lookup
• ${P}geo [ip] 👑 — Geolocalização de IP`,

            info:
                `ℹ️ *INFORMAÇÕES*
────────────────────────────
• ${P}dono | ${P}owner — Contato do bot
• ${P}ping — Latência e status
• ${P}perfil — Ver seu perfil
• ${P}premium — Status VIP
• ${P}report [bug] — Reportar erro`,

            premium:
                `💎 *PLANOS VIP*
────────────────────────────
• ${P}premium — Ver seu status VIP
• ${P}buy vip_7d — VIP Semanal (R$5)
• ${P}buy vip_30d — VIP Mensal (R$15)

✅ *Vantagens VIP:*
  • Ferramentas de Cybersecurity
  • Comandos OSINT avançados
  • Prioridade no processamento
  • Suporte VIP

🪨 Cripto: 0xdb5f66e7707de55859b253adbee167e2e8594ba6
☕ Ko-fi: https://ko-fi.com/${this.bot?.paymentManager?.payConfig?.kofiPage || 'suporte'}`
        };

        // Submenu adicional: comandos detectados no código mas não listados estaticamente
        menus.extras = `🔧 *COMANDOS ADICIONAIS AGRUPADOS*
────────────────────────────
*Conta & Economia*
• balance  • banco  • depositar  • diario  • lvl  • mp3  • nivel  • pagar  • profile  • ranking  • reg  • register  • sacar  • saldo  • top  • transferir

*Mídia & Video*
• image  • img  • p  • playvid  • ytmp4

*Áudio & Efeitos*
• enhance  • remini

*Imagem & Efeitos*
• addbg  • bg  • fotodogrupo  • rmbg

*Grupos & Administração*
• close  • desafixar  • fixar  • ginfo  • hidetag  • listadmins  • membros  • open  • pin  • revogar  • setbotphoto  • totag  • unmute  • unpin

*Diversão & Jogos*
• advinha  • caracoroa  • joke  • pedrapapeltesoura  • quote  • raffle  • sorteio  • tictactoe

*Cybersecurity & Pentest*
• blackeye  • cve  • impacket  • shodan  • socialfish  • winrm

*Moderação & Segurança*
• antifake  • antiimage  • antisticker  • resetwarns

*Configuração & Bot*
• creator  • criador  • setbio  • setbotname  • setbotpic  • setbotstatus  • setgoodbye  • setname  • setphoto  • setwelcome

*Pagamento & Premium*
• addpremium  • addvip  • comprar  • delpremium  • delvip  • doar  • donate  • vip

*Utilitários & Admin*
• ajuda  • apagar  • bug  • comandos  • del  • delete  • getprofile  • getuser  • help  • info  • infogrupo  • reportar  • restart

*Outros*
• bemvindo  • broadcast  • descricao  • fig  • goodbye  • poll  • react  • reagir  • roubar

💡 Use *${P}menu [categoria]* para ver detalhes de cada comando.`;
        // Alias comuns - FIX: Added missing aliases for submenu commands
        const alias: Record<string, string> = {
            // Conta/Economia
            contas: 'conta', conta: 'conta', level: 'conta', lvl: 'conta', nivel: 'conta', economia: 'conta',
            // Mídia
            musica: 'media', midia: 'media', media: 'media', video: 'media', sticker: 'media', stickers: 'media',
            // Áudio
            efeito: 'audio', efeitos: 'audio', audio: 'audio', tts: 'audio', voz: 'audio', som: 'audio',
            // Imagem
            img: 'imagem', imagem: 'imagem', foto: 'imagem', image: 'imagem', fotos: 'imagem',
            // Grupos
            grupo: 'grupos', grupos: 'grupos', admin: 'grupos', moderacao: 'grupos', adm: 'grupos', gerenciamento: 'grupos',
            // Diversão
            fun: 'diversao', jogos: 'diversao', game: 'diversao', games: 'diversao', diversao: 'diversao', entretenimento: 'diversao',
            // Cyber
            sec: 'cyber', hacking: 'cyber', security: 'cyber', pentest: 'cyber', cyber: 'cyber', cybersecurity: 'cyber', hack: 'cyber',
            // Premium
            vip: 'premium', planos: 'premium', buy: 'premium', comprar: 'premium', premium: 'premium', pagamento: 'premium', doar: 'premium',
            // OSINT
            osint: 'osint', inteligencia: 'osint', reconnaissance: 'osint', investigacao: 'osint', spy: 'osint',
            // Info
            info: 'info', informacoes: 'info', informações: 'info', about: 'info', sobre: 'info', ajuda: 'info', help: 'info',
            // Extras
            extras: 'extras', extra: 'extras', comandos: 'extras', commands: 'extras', todos: 'extras', all: 'extras'
        };

        const key = alias[sub] || sub;
        const content = menus[key];

        if (content) {
            // Se for um submenu, envia com botões de retorno ao menu principal
            const buttons = [
                { buttonId: `${P}menu`, buttonText: { displayText: '📂 Menu Principal' }, type: 1 },
                { buttonId: `${P}ping`, buttonText: { displayText: '⚡ Status/Ping' }, type: 1 }
            ];

            const buttonMessage = {
                text: content + `\n\n────────────────────────\n💡 _Dica: Use os botões abaixo para navegar ou digite *${P}menu* para voltar._`,
                footer: "Akira Bot V21 • Enterprise Edition",
                buttons: buttons,
                headerType: 1
            };

            await this.sock.sendMessage(m.key.remoteJid, buttonMessage, { quoted: m });
        } else {
            await this.sock.sendMessage(m.key.remoteJid, {
                text: `⚠️ Categoria *"${sub}"* não encontrada.\n\nUse o comando *${P}menu* para ver todas as categorias disponíveis.`,
                buttons: [{ buttonId: `${P}menu`, buttonText: { displayText: '📂 Abrir Menu' }, type: 1 }]
            }, { quoted: m });
        }

        if (this.presenceSimulator) await this.presenceSimulator.markAsRead(m);
        return true;
    }


    public async _handleSticker(m: any, nome: string): Promise<boolean> {
        try {
            const quoted = m.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            const targetMessage = quoted || m.message;

            if (!targetMessage) {
                await this._reply(m, '❌ Responda a uma imagem ou vídeo curto para criar o sticker.');
                return true;
            }

            const packName = 'akira-bot';
            const author = nome || 'Akira-Bot';

            const isVideo = !!(targetMessage.videoMessage || targetMessage.viewOnceMessageV2?.message?.videoMessage);
            const isImage = !!(targetMessage.imageMessage || targetMessage.viewOnceMessageV2?.message?.imageMessage);

            if (!isImage && !isVideo) {
                const bufInfo = await this.mediaProcessor.downloadMedia(targetMessage, 'image');
                if (bufInfo && bufInfo.buffer) {
                    const res = await this.mediaProcessor.createStickerFromImage(bufInfo.buffer, { packName, author });
                    if (res && res.sucesso && res.buffer) {
                        await this.sock.sendMessage(m.key.remoteJid, { sticker: res.buffer }, { quoted: m });
                        return true;
                    }
                }
                await this._reply(m, '❌ Conteúdo de mídia não encontrado ou formato não suportado.');
                return true;
            }

            let res;
            if (isImage) {
                const bufInfo = await this.mediaProcessor.downloadMedia(targetMessage, 'image');
                if (bufInfo && bufInfo.buffer) {
                    res = await this.mediaProcessor.createStickerFromImage(bufInfo.buffer, { packName, author });
                }
            } else if (isVideo) {
                const bufInfo = await this.mediaProcessor.downloadMedia(targetMessage, 'video');
                if (bufInfo && bufInfo.buffer) {
                    res = await this.mediaProcessor.createAnimatedStickerFromVideo(bufInfo.buffer, 10, { packName, author });
                }
            }

            if (res && res.sucesso && res.buffer) {
                await this.sock.sendMessage(m.key.remoteJid, { sticker: res.buffer }, { quoted: m });
            } else {
                await this._reply(m, `❌ Erro ao criar sticker: ${res?.error || 'falha interna'} `);
            }
        } catch (e: any) {
            console.error('Erro em _handleSticker:', e);
            await this._reply(m, '❌ Erro no processamento do sticker.');
        }
        return true;
    }

    public async _handleTakeSticker(m: any, args: string, nome: string): Promise<boolean> {
        try {
            const quoted = m.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            const targetMessage = quoted || m.message;

            if (!targetMessage) {
                await this._reply(m, '❌ Responda a uma figurinha para usar o *take.');
                return true;
            }

            const bufInfo = await this.mediaProcessor.downloadMedia(targetMessage, 'sticker');
            if (!bufInfo || !bufInfo.buffer) {
                await this._reply(m, '❌ Não foi possível baixar a figurinha.');
                return true;
            }

            // Em vez de converter para imagem, rouba a figurinha regerando com addStickerMetadata
            const outBuf = await this.mediaProcessor.addStickerMetadata(
                bufInfo.buffer,
                nome.split(' ')[0], // Pack
                'Akira-Bot V21'     // Author
            );

            if (outBuf) {
                await this.sock.sendMessage(m.key.remoteJid, {
                    sticker: outBuf
                }, { quoted: m });
            } else {
                await this._reply(m, `❌ Erro ao processar os metadados da figurinha.`);
            }
        } catch (e: any) {
            console.error('Erro em _handleTakeSticker:', e);
            await this._reply(m, '❌ Erro ao processar o take.');
        }
        return true;
    }

    public async _handleStickerToImage(m: any): Promise<boolean> {
        try {
            const quoted = m.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            const targetMessage = quoted || m.message;

            if (!targetMessage) {
                await this._reply(m, '❌ Responda a uma figurinha para converter em imagem.');
                return true;
            }

            const mediaRes = await this.mediaProcessor.downloadMedia(targetMessage, 'sticker');
            if (!mediaRes || !mediaRes.buffer) {
                await this._reply(m, '❌ Não foi possível baixar a figurinha.');
                return true;
            }

            const res = await this.mediaProcessor.convertStickerToImage(mediaRes.buffer);

            if (res.sucesso && res.buffer) {
                await this.sock.sendMessage(m.key.remoteJid, {
                    image: res.buffer,
                    caption: '✅ Figurinha convertida em imagem!'
                }, { quoted: m });
            } else {
                await this._reply(m, `❌ Erro na conversão: ${res.error || 'falha interna'} `);
            }
        } catch (e: any) {
            console.error('Erro em _handleStickerToImage:', e);
            await this._reply(m, '❌ Erro ao converter sticker para imagem.');
        }
        return true;
    }


    public async _handlePlay(m: any, query: string): Promise<boolean> {
        if (!query) {
            await this._reply(m, `❌ Uso: ${this.config.PREFIXO}play <nome da música ou link>`);
            return true;
        }

        // ── Interceptor Spotify ────────────────────────────────────────────────
        // O Spotify usa DRM. Quando o usuário cola um link Spotify, convertemos
        // para uma busca normal no YouTube usando o nome que está na URL.
        let finalQuery = query.trim();
        if (finalQuery.includes('open.spotify.com') || finalQuery.includes('spotify.com/track')) {
            // Extrai o ID do track do link e usa como termo de busca
            const spMatch = finalQuery.match(/track\/([A-Za-z0-9]+)/);
            if (spMatch) {
                // Não temos o nome, então buscamos pelo ID — o yt-dlp sabe lidar
                // Mas é melhor avisar o usuário e pedir o nome
                await this._reply(m, '🎵 _Link do Spotify detectado! Buscando no YouTube..._');
                finalQuery = finalQuery.replace(/https?:\/\/open\.spotify\.com\/[^\s]+/, '').trim();
                if (!finalQuery) {
                    await this._reply(m, '❌ Para músicas do Spotify, envie o *nome da música* ao invés do link.\nEx: `*play nome da música - artista`');
                    return true;
                }
            }
        }
        // ──────────────────────────────────────────────────────────────────────

        await this._reply(m, '⏳ baixando...');

        try {
            const res = await this.mediaProcessor.downloadYouTubeAudio(finalQuery);

            if (!res.sucesso || res.error) {
                await this._reply(m, `❌ ${res.error || 'Erro desconhecido ao baixar áudio.'}`);
                return true;
            }

            // Extrai metadados do resultado do download
            const metadata = res.metadata || {};
            const titulo = metadata.titulo || 'Música';
            const canal = metadata.canal || 'Desconhecido';
            const duracao = metadata.duracao || 0;
            const thumbnail = metadata.thumbnail;
            const visualizacoes = metadata.visualizacoes || 'N/A';
            const curtidas = metadata.curtidas || 'N/A';
            const dataPublicacao = metadata.dataPublicacao || 'N/A';

            // Enviar thumbnail e metadados se disponíveis
            if (thumbnail) {
                const thumbBuf = await this.mediaProcessor.fetchBuffer(thumbnail).catch((): any => null);
                if (thumbBuf) {
                    const duracaoMin = duracao ? `${Math.floor(duracao / 60)}:${(duracao % 60).toString().padStart(2, '0')}` : '??';
                    const caption = `🎵 *${titulo}*\n\n` +
                        `👤 *Canal:* ${canal}\n` +
                        `👁️ *Visualizações:* ${visualizacoes}\n` +
                        `👍 *Curtidas:* ${curtidas}\n` +
                        `📅 *Lançamento:* ${dataPublicacao}\n` +
                        `⏱️ *Duração:* ${duracaoMin}\n\n` +
                        `🎧 _Enviando áudio..._`;

                    await this.sock.sendMessage(m.key.remoteJid, {
                        image: thumbBuf,
                        caption: caption
                    }, { quoted: m });
                }
            }

            // Verifica se temos buffer
            if (!res.buffer || res.buffer.length === 0) {
                await this._reply(m, '❌ Erro interno: Áudio não baixado corretamente.');
                return true;
            }

            // Salva buffer em arquivo temporário
            const tempFile = this.mediaProcessor.generateRandomFilename('mp3');
            await fs.promises.writeFile(tempFile, res.buffer);

            const fileSizeMB = (res.buffer.length / (1024 * 1024)).toFixed(1);
            const isLargeFile = res.buffer.length > 64 * 1024 * 1024;

            if (isLargeFile) {
                this.logger?.info(`📄 Áudio grande(${fileSizeMB}MB), enviando como documento para evitar erro de limite.`);
                await this.sock.sendMessage(m.key.remoteJid, {
                    document: { url: tempFile },
                    fileName: `${titulo}.mp3`,
                    mimetype: 'audio/mpeg',
                    caption: `🎵 *${titulo}*\n📦 *Tamanho:* ${fileSizeMB} MB\n\n💡 _Enviado como documento devido ao tamanho._`
                }, { quoted: m });
            } else {
                await this.sock.sendMessage(m.key.remoteJid, {
                    audio: { url: tempFile },
                    mimetype: 'audio/mpeg',
                    ptt: false,
                    fileName: `${titulo}.mp3`
                }, { quoted: m });
            }

            // Delay cleanup para dar tempo do Baileys ler/streamar o arquivo
            const cleanupDelay = isLargeFile ? 60000 : 20000;
            setTimeout(() => {
                this.mediaProcessor.cleanupFile(tempFile).catch(console.error);
            }, cleanupDelay);

        } catch (e: any) {
            console.error('Erro no play:', e);
            await this._reply(m, `❌ Erro crítico ao processar o comando play: ${e.message}`);
        }
        return true;
    }

    public async _handleProfile(m: any, meta: any): Promise<boolean> {
        const { nome, numeroReal } = meta;
        const uid = m.key.participant || m.key.remoteJid;

        try {
            if (!this.levelSystem) {
                throw new Error('LevelSystem não inicializado');
            }
            // Obtém dados do levelSystem
            const record = this.levelSystem.getGroupRecord(m.key.remoteJid, uid, true);

            // Obtém dados extras do UserProfile (Bio, Foto, etc)
            const userInfo = await this.userProfile.getUserInfo(uid);

            let msg = `👤 *PERFIL DE USUÁRIO* 👤\n\n`;
            msg += `📝 *Nome:* ${nome}\n`;
            msg += `📱 *Número:* ${numeroReal}\n`;
            msg += `🎮 *Nível:* ${record.level || 0}\n`;
            msg += `⭐ *XP:* ${record.xp || 0}\n`;
            msg += `📜 *Bio:* ${userInfo.status || 'Sem biografia'}\n\n`;

            msg += `🏆 *CONQUISTAS:* ${record.level > 10 ? '🎖️ Veterano' : '🐣 Novato'}\n`;
            msg += `💎 *Status:* ${this.subscriptionManager.isPremium(uid) ? 'PREMIUM 💎' : 'FREE'}\n`;

            if (userInfo.photoUrl) {
                await this.sock.sendMessage(m.key.remoteJid, {
                    image: { url: userInfo.photoUrl },
                    caption: msg
                }, { quoted: m });
            } else {
                await this._reply(m, msg);
            }
        } catch (e: any) {
            console.error('Erro no _handleProfile:', e);
            await this._reply(m, '❌ Erro ao carregar perfil.');
        }
        return true;
    }



    public async _handleDono(m: any): Promise<boolean> {
        const donos = this.config.DONO_USERS;
        if (!donos || donos.length === 0) {
            await this._reply(m, '❌ Nenhum dono configurado.');
            return true;
        }

        // Prioriza o número solicitado pelo usuário: 244937035662
        const principal = donos.find((d: any) => d.numero === '244937035662') || donos[0];

        // Envia contato (VCard)
        const vcard = 'BEGIN:VCARD\n' + // metadata of the contact card
            'VERSION:3.0\n' +
            `FN:${principal.nomeExato}\n` + // full name
            `ORG:Akira Enterprise;\n` + // the organization of the contact
            `TEL;type=CELL;type=VOICE;waid=${principal.numero}:${principal.numero}\n` + // WhatsApp ID + phone number
            'END:VCARD';

        await this.sock.sendMessage(m.key.remoteJid, {
            contacts: {
                displayName: principal.nomeExato,
                contacts: [{ vcard }]
            }
        }, { quoted: m });

        // Mensagem de texto de apoio com link wa.me explícito
        await this._reply(m, `👑 *DONO DO BOT*\n\nDesenvolvido por: *${principal.nomeExato}*\n📱 *Contato Direto:* https://wa.me/${principal.numero}\n\nPowered by: *Akira V21 Ultimate*`);
        return true;
    }

    public async _handleReport(m: any, fullArgs: string, nome: string, senderId: string, ehGrupo: boolean): Promise<boolean> {
        if (!fullArgs) {
            await this._reply(m, `❌ Uso: ${this.config.PREFIXO}report <bug/sugestão>`);
            return true;
        }

        const reportId = Math.random().toString(36).substring(7).toUpperCase();
        const timestamp = new Date().toLocaleString('pt-BR');

        // ✅ Resolução LID → Número Real:
        // Em Baileys cloud, m.key.participant pode vir como "202391978787009:NN@lid"
        // que NÃO é um número de telefone real. Para obter o número real, tentamos:
        //   1. m.message.extendedTextMessage.contextInfo.participant (se reply)
        //   2. contextInfo.mentionedJid (se menção)
        //   3. sock.onWhatsApp — retorna JID real com @s.whatsapp.net
        //   4. groupMetadata.participants — busca todos membros do grupo
        let numeroReal = 'desconhecido';
        try {
            // Tentar contextInfo (reply menciona número real do autor original)
            const ctx = m.message?.extendedTextMessage?.contextInfo
                || m.message?.imageMessage?.contextInfo
                || m.message?.conversation ? null : null;
            if (ctx?.participant) {
                const ctxNum = JidUtils.getNumber(ctx.participant);
                if (ctxNum && ctxNum.length > 5 && ctxNum.length < 18) {
                    numeroReal = JidUtils.cleanPhoneNumber(ctxNum);
                }
            }

            // Tentar mentions
            if (numeroReal === 'desconhecido') {
                const mentions = ctx?.mentionedJid || [];
                if (mentions.length > 0) {
                    const mNum = JidUtils.getNumber(mentions[0]);
                    if (mNum && mNum.length > 5 && mNum.length < 18) {
                        numeroReal = JidUtils.cleanPhoneNumber(mNum);
                    }
                }
            }

            // Tentar resolver participant via onWhatsApp
            if (numeroReal === 'desconhecido' && this.sock?.onWhatsApp) {
                const partRaw = m.key.participant || '';
                const partNum = JidUtils.getNumber(partRaw);
                if (partNum && partNum.length > 5 && partNum.length < 18) {
                    // Ainda pode ser LID, verificar comprimento (LIDs são enormes)
                    numeroReal = JidUtils.cleanPhoneNumber(partNum);
                }
            }

            // Último: usar senderId como fallback
            if (numeroReal === 'desconhecido') {
                const sNum = JidUtils.cleanPhoneNumber(senderId.split('@')[0]);
                if (sNum && sNum.length > 5 && sNum.length < 18) {
                    numeroReal = sNum;
                }
            }
        } catch (e) {
            numeroReal = 'desconhecido';
        }

        // Se ainda é desconhecido, tentar obter número real do grupo via groupMetadata
        if (numeroReal === 'desconhecido' && ehGrupo) {
            try {
                const partRaw = String(m.key.participant || '');
                const groupMeta = await this.sock.groupMetadata(m.key.remoteJid);
                const participant = groupMeta.participants?.find(
                    (p: any) => p.id === partRaw
                );
                if (participant) {
                    const pNum = JidUtils.getNumber(participant.id);
                    if (pNum && pNum.length > 5 && pNum.length < 18) {
                        numeroReal = JidUtils.cleanPhoneNumber(pNum);
                    }
                }
            } catch (e) {
                // Sem permissão ou grupo indisponível
            }
        }

        // ✅ CORREÇÃO: Buscar nome real do grupo e link de convite
        let origem: string;
        let grupoLink = '';
        if (ehGrupo) {
            try {
                const groupMeta = await this.sock.groupMetadata(m.key.remoteJid);
                const groupName = groupMeta.subject || 'Grupo Desconhecido';
                origem = `Grupo: *${groupName}*`;

                // Tenta obter o link de convite
                try {
                    const inviteCode = await this.sock.groupInviteCode(m.key.remoteJid);
                    if (inviteCode) {
                        grupoLink = `🔗 https://chat.whatsapp.com/${inviteCode}`;
                    }
                } catch {
                    // Sem permissão para obter link de convite
                }
            } catch {
                origem = `Grupo (${m.key.remoteJid.split('@')[0]})`;
            }
        } else {
            origem = 'Privado (PV)';
        }

        const reportMsg = `🚨 *NOVO REPORT [${reportId}]* 🚨\n\n` +
            `👤 *De:* ${nome}\n` +
            `📱 *Número:* ${numeroReal}\n` +
            `📍 *Origem:* ${origem}\n` +
            `${grupoLink ? grupoLink + '\n' : ''}` +
            `🕒 *Data:* ${timestamp}\n\n` +
            `📝 *Conteúdo:*\n${fullArgs}`;

        // Envia sempre para o dono principal: 244937035662
        const donoJid = '244937035662@s.whatsapp.net';
        try {
            await this.sock.sendMessage(donoJid, { text: reportMsg });
            await this._reply(m, `✅ *Report enviado com sucesso!*\nID: #${reportId}\n\nObrigado por colaborar.`);
        } catch (err: any) {
            await this._reply(m, '⚠️ Erro ao enviar report. Tenta contactar o dono directamente.');
            console.warn(`[REPORT FALHO] ${reportMsg}`, err.message);
        }
        return true;
    }



    public async _handlePremiumInfo(m: any, senderId: string): Promise<boolean> {
        const info = this.subscriptionManager.getSubscriptionInfo(senderId);
        let msg = `💎 *STATUS PREMIUM*\n\n`;
        msg += `🏷️ Nível: ${info.tier}\n`;
        msg += `📊 Status: ${info.status}\n`;
        msg += `📅 Expira em: ${info.expiraEm || 'N/A'}\n\n`;
        msg += `✨ *Recursos:* \n${info.recursos.join('\n')}`;

        await this._reply(m, msg);
        return true;
    }

    public async _handleAddPremium(m: any, args: string[]): Promise<boolean> {
        if (args.length < 2) {
            await this._reply(m, `❌ Uso: ${this.config.PREFIXO}addpremium <numero> <dias>`);
            return true;
        }

        let targetUser = args[0].replace(/\D/g, '');
        let days = parseInt(args[1]);

        if (!targetUser || isNaN(days)) {
            await this._reply(m, '❌ Formato inválido.');
            return true;
        }

        // Adiciona sufixo se necessário para a chave do mapa (embora o SubscriptionManager use apenas o ID geralmente, vamos padronizar)
        // O SubscriptionManager usa a chave que passamos. Se passarmos só numero, ele usa só numero.
        // O senderId vem como numero@s.whatsapp.net. Vamos manter consistência.
        const targetJid = targetUser + '@s.whatsapp.net';

        const res = this.subscriptionManager.subscribe(targetJid, days);

        if (res.sucesso) {
            await this._reply(m, `✅ Premium adicionado para ${targetUser} por ${days} dias.\nExpira em: ${res.expiraEm}`);
        } else {
            await this._reply(m, `❌ Erro: ${res.erro}`);
        }
        return true;
    }

    public async _handleDelPremium(m: any, args: string[]): Promise<boolean> {
        if (args.length < 1) {
            await this._reply(m, `❌ Uso: ${this.config.PREFIXO}delpremium <numero>`);
            return true;
        }

        let targetUser = args[0].replace(/\D/g, '');
        const targetJid = targetUser + '@s.whatsapp.net';

        const res = this.subscriptionManager.unsubscribe(targetJid);

        if (res.sucesso) {
            await this._reply(m, `✅ Premium removido de ${targetUser}`);
        } else {
            await this._reply(m, `❌ Erro: ${res.erro}`);
        }
        return true;
    }





    public async _handleVideo(m: any, query: string): Promise<boolean> {
        if (!query) {
            await this._reply(m, `❌ Uso: ${this.config.PREFIXO}video <nome ou link>`);
            return true;
        }
        await this._reply(m, '🎬 Baixando vídeo... (Arquivos grandes podem demorar)');
        try {
            const res = await this.mediaProcessor.downloadYouTubeVideo(query);

            if (!res.sucesso || res.error) {
                await this._reply(m, `❌ ${res.error || 'Erro ao baixar vídeo.'}`);
                return true;
            }

            // Extrai metadados do resultado
            const metadata = res.metadata || {};
            const titulo = metadata.titulo || 'Vídeo';
            const canal = metadata.canal || 'Desconhecido';
            const thumbnail = metadata.thumbnail;
            const visualizacoes = metadata.visualizacoes || 'N/A';
            const curtidas = metadata.curtidas || 'N/A';
            const dataPublicacao = metadata.dataPublicacao || 'N/A';

            let thumbBuf = null;
            if (thumbnail) {
                thumbBuf = await this.mediaProcessor.fetchBuffer(thumbnail).catch((): any => null);
            }

            // Verifica se temos buffer
            if (!res.buffer || res.buffer.length === 0) {
                await this._reply(m, '❌ Erro interno: Vídeo não baixado corretamente.');
                return true;
            }

            // Salva buffer em arquivo temporário
            const tempFile = this.mediaProcessor.generateRandomFilename('mp4');
            await fs.promises.writeFile(tempFile, res.buffer);

            const fileSizeMB = (res.buffer.length / (1024 * 1024)).toFixed(1);
            const caption = `🎬 *${titulo}*\n` +
                `👤 *Canal:* ${canal}\n` +
                `👁️ *Visualizações:* ${visualizacoes}\n` +
                `👍 *Curtidas:* ${curtidas}\n` +
                `📅 *Lançamento:* ${dataPublicacao}\n` +
                `📦 *Tamanho:* ${fileSizeMB}MB`;

            const isLargeFile = res.buffer.length > 64 * 1024 * 1024;

            if (isLargeFile) {
                this.logger?.info(`📄 Arquivo grande (${fileSizeMB}MB), enviando como documento para evitar erro de limite.`);
                await this.sock.sendMessage(m.key.remoteJid, {
                    document: { url: tempFile },
                    fileName: `${titulo}.mp4`,
                    mimetype: 'video/mp4',
                    caption: caption + '\n\n💡 _Enviado como documento para manter a qualidade e evitar limites do WhatsApp._'
                }, { quoted: m });
            } else {
                await this.sock.sendMessage(m.key.remoteJid, {
                    video: { url: tempFile },
                    caption: caption,
                    mimetype: 'video/mp4',
                    jpegThumbnail: thumbBuf || undefined
                }, { quoted: m });
            }

            // Delay cleanup para dar tempo do Baileys ler/streamar o arquivo
            const cleanupDelay = isLargeFile ? 60000 : 15000;
            setTimeout(() => {
                this.mediaProcessor.cleanupFile(tempFile).catch((e: any) => console.error('Erro no cleanup tardio:', e.message));
            }, cleanupDelay);

        } catch (e: any) {
            console.error('Erro no video:', e);
            await this._reply(m, `❌ Erro ao processar vídeo: ${e.message}`);
        }
        return true;
    }


    public async _handlePaymentCommand(m: any, args: string[]): Promise<boolean> {
        // Se usuario quer ver info
        if (args.length === 0) {
            const plans = this.bot.paymentManager?.getPlans() || {};

            let msg = `✨ *AKIRA PREMIUM & APOIO* ✨\n`;
            msg += `_Sua contribuição mantém o bot online e evoluindo!_\n`;

            msg += this.createMenuSection('🎁', 'VALORES SUGERIDOS (VIP)');

            // Nova conversão baseada em USD (1 USD = 1.000 Kz | 1 USD = 5.00 BRL)
            const convertToKz = (usd: number) => Math.round(usd * 1000).toLocaleString('pt-AO');
            const convertToBrl = (usd: number) => (usd * 5.00).toFixed(2);

            for (const [key, plan] of Object.entries(plans) as [string, any][]) {
                msg += `\n🏷️ *${plan.name}*\n`;
                msg += `💰 Valor: *${convertToKz(plan.price)} Kz* (R$ ${convertToBrl(plan.price)})\n`;
                msg += `📅 Duração: ${plan.days} dias\n`;
                msg += `👉 Comprar: *${this.config.PREFIXO}buy ${key}*\n`;
            }

            msg += this.createMenuSection('🎉', 'BENEFÍCIOS DO APOIADOR');
            msg += `\n✨ Badge especial *"Apoiador"* no perfil\n`;
            msg += `✨ Acesso a ferramentas de *Cybersecurity & OSINT*\n`;
            msg += `✨ Remoção de limites de uso (Rate Limit)\n`;
            msg += `✨ Prioridade máxima no processamento\n`;
            msg += `✨ Suporte técnico direto via WhatsApp\n`;
            msg += `✨ Acesso antecipado a novas features\n`;

            msg += this.createMenuSection('📊', 'IMPACTO DA SUA DOAÇÃO');
            msg += `\n💵 *5.000 Kz* (R$ 25,00) = 1 dia online [5 USD]\n`;
            msg += `\n💵 *20.000 Kz* (R$ 100,00) = 1 semana online [20 USD]\n`;
            msg += `\n💵 *50.000 Kz* (R$ 250,00) = 1 mês online [50 USD]\n`;
            msg += `\n💵 *100.000 Kz+* (R$ 500,00+) = 3 meses + feature nova [100 USD]\n`;

            msg += this.createMenuSection('💳', 'MÉTODOS DE PAGAMENTO');
            msg += `\n*☕ KO-FI (INTERNACIONAL)*\nhttps://ko-fi.com/isaacquarenta\n`;
            msg += `\n*💳 PAYPAL*\nhttps://paypal.me/isaacquarenta\n`;
            msg += `\n*✉️ EMAIL PARA CONTATO*\n_softedgecorporation@gmail.com_\n`;

            msg += this.createMenuSection('📲', 'CONTATO & SUPORTE');
            msg += `\nWhatsApp: *+244 937 035 662*\n`;
            msg += `Email: _softedgecorporation@gmail.com_\n`;

            msg += `\n*Obrigado por apoiar um projeto feito com ❤️ paixão!*\n`;
            msg += `_Cada real faz diferença no futuro do Akira Bot_`;

            await this._reply(m, msg);
            return true;
        }

        const planKey = args[0].toLowerCase().trim();
        const userId = m.key.participant || m.key.remoteJid;

        // Gera link
        const res = this.bot.paymentManager.generatePaymentLink(userId, planKey);

        if (res.success) {
            await this._reply(m, `⏳ *Gerando Pagamento...*`);

            // Envia QR Code se disponível
            await this._reply(m, `✅ *Pedido Criado!*\n\n${res.message}\n\n_Assim que o pagamento for confirmado, seu plano será ativado automaticamente._`);
        } else {
            await this._reply(m, `❌ ${res.message}`);
        }
        return true;
    }

    public async _handleVideoToAudio(m: any): Promise<boolean> {
        const quoted = m.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        const targetMessage = quoted || m.message;

        if (!targetMessage) {
            await this._reply(m, '❌ Responda a um vídeo para converter para MP3.');
            return true;
        }

        await this._reply(m, '🎵 Convertendo para MP3...');
        try {
            const mediaRes = await this.mediaProcessor.downloadMedia(targetMessage, 'video');
            if (!mediaRes || !mediaRes.buffer) throw new Error('Falha ao baixar vídeo.');

            const res = await this.mediaProcessor.convertVideoToAudio(mediaRes.buffer);

            if (res.sucesso && res.buffer) {
                await this.sock.sendMessage(m.key.remoteJid, { audio: res.buffer, mimetype: 'audio/mp4', ptt: false }, { quoted: m });
            } else {
                await this._reply(m, `❌ Erro: ${res.error}`);
            }
        } catch (e: any) {
            await this._reply(m, '❌ Erro ao converter para MP3.');
            console.error(e);
        }
        return true;
    }

    public async _handleSetBotPhoto(m: any): Promise<boolean> {
        const quoted = m.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        const targetMessage = quoted || m.message;
        const chatJid = m.key.remoteJid;
        const ehGrupo = chatJid.endsWith('@g.us');

        if (!targetMessage) {
            await this._reply(m, `❌ Responda a uma imagem para definir como foto do ${ehGrupo ? 'grupo' : 'bot'}.`);
            return true;
        }

        await this._reply(m, `📸 Atualizando foto do ${ehGrupo ? 'grupo' : 'bot'}...`);
        try {
            const mediaRes = await this.mediaProcessor.downloadMedia(targetMessage, 'image');
            if (!mediaRes || !mediaRes.buffer) throw new Error('Falha ao baixar imagem.');

            const buffer = mediaRes.buffer;

            let res;
            if (ehGrupo) {
                res = await this.groupManagement.setGroupPhotoDirect(chatJid, buffer);
            } else {
                res = await this.botProfile.setBotPhoto(buffer);
            }

            if (res.success) {
                await this._reply(m, `✅ Foto do ${ehGrupo ? 'grupo' : 'bot'} atualizada com sucesso!`);
            } else {
                await this._reply(m, `❌ Erro ao atualizar foto: ${res.error}`);
            }
        } catch (e: any) {
            await this._reply(m, '❌ Erro ao processar foto.');
            console.error(e);
        }
        return true;
    }

    public async _handleSetBotName(m: any, name: string): Promise<boolean> {
        const chatJid = m.key.remoteJid;
        const ehGrupo = chatJid.endsWith('@g.us');

        if (!name) {
            await this._reply(m, `❌ Uso: ${this.config.PREFIXO}${ehGrupo ? 'setname' : 'setbotname'} <nome>`);
            return true;
        }

        await this._reply(m, `📛 Alterando nome do ${ehGrupo ? 'grupo' : 'sistema'} para: ${name}`);

        let res;
        if (ehGrupo) {
            res = await this.groupManagement.setGroupName(chatJid, name);
        } else {
            res = await this.botProfile.setBotName(name);
        }

        if (res.success) {
            await this._reply(m, `✅ Nome do ${ehGrupo ? 'grupo' : 'bot'} atualizado!`);
        } else {
            await this._reply(m, `❌ Erro: ${res.error}`);
        }
        return true;
    }

    public async _handleSetBotStatus(m: any, status: string): Promise<boolean> {
        const chatJid = m.key.remoteJid;
        const ehGrupo = chatJid.endsWith('@g.us');

        if (!status) {
            await this._reply(m, `❌ Uso: ${this.config.PREFIXO}${ehGrupo ? 'setdesc' : 'setbotstatus'} <texto>`);
            return true;
        }

        await this._reply(m, `📝 Alterando ${ehGrupo ? 'descrição' : 'bio'} para: ${status}`);

        let res;
        if (ehGrupo) {
            try {
                await this.sock.groupUpdateDescription(chatJid, status);
                res = { success: true };
            } catch (err: any) {
                res = { success: false, error: err.message || 'Erro ao atualizar descrição' };
            }
        } else {
            res = await this.botProfile.setBotStatus(status);
        }

        if (res.success) {
            await this._reply(m, `✅ ${ehGrupo ? 'Descrição' : 'Bio'} atualizada!`);
        } else {
            await this._reply(m, `❌ Erro: ${res.error}`);
        }
        return true;
    }


    // ═══════════════════════════════════════════════════════════════════════
    // NOVOS COMANDOS (DIVERSÃO & GESTÃO)
    // ═══════════════════════════════════════════════════════════════════════

    public async _handlePinterest(m: any, query: string, args: string[]): Promise<boolean> {
        // ─── Detecta busca visual (reply a uma imagem) ───
        const quotedMsg = m.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        const isRepliedToImage = !!(
            quotedMsg?.imageMessage ||
            quotedMsg?.viewOnceMessage?.message?.imageMessage ||
            quotedMsg?.viewOnceMessageV2?.message?.imageMessage
        );

        if (isRepliedToImage && !query) {
            // ───  MODO VISUAL SEARCH  ───
            return await this._pinterestVisualSearch(m, 3);
        }

        if (!query) {
            await this._reply(m, `🔎 Uso: *${this.config.PREFIXO}pinterest* <busca> | <quantidade 1-5>\n📸 Ou responda a uma *foto* com *${this.config.PREFIXO}pinterest* para busca visual`);
            return true;
        }

        const parts = query.split('|');
        const searchTerm = parts[0].trim();
        const count = Math.min(Math.max(parseInt(parts[1] || '1', 10) || 1, 1), 5);

        await this._reply(m, `🔎 Buscando "${searchTerm}" no Pinterest...`);

        try {
            const searchUrl = `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(searchTerm)}`;
            const response = await axios.get(searchUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0.3 Mobile/15E148 Safari/604.1',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-us'
                }
            });

            const html = response.data as string;
            const urlRegex = /https:\/\/i\.pinimg\.com\/[^\s\"\'\\]+/g;
            const rawMatches = html.match(urlRegex) || [];

            // Normalizar todas as URLs para 736x (máxima resolução acessível server-side)
            // /originals/ retorna 403 quando acessado sem sessão de browser real
            let images: string[] = rawMatches
                .filter(url => /\.(jpg|png|gif|webp)$/i.test(url))
                .map(url => {
                    if (url.includes('/videos/thumbnails/')) return url;
                    return url.replace(/\/([0-9]+x[0-9]*|[0-9]+x|originals)\//, '/736x/');
                });

            // Remove duplicatas
            images = [...new Set(images)];

            if (images.length === 0) {
                await this._reply(m, '❌ Não consegui encontrar imagens no Pinterest no momento. Tente novamente mais tarde.');
                return true;
            }

            const uniqueImages = images.slice(0, count);

            const downloadHeaders = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://www.pinterest.com/',
                'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
                'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache',
                'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
                'Sec-Ch-Ua-Mobile': '?0',
                'Sec-Ch-Ua-Platform': '"Windows"',
                'Sec-Fetch-Dest': 'image',
                'Sec-Fetch-Mode': 'no-cors',
                'Sec-Fetch-Site': 'cross-site'
            };

            for (const imageUrl of uniqueImages) {
                try {
                    const imgRes = await axios.get(imageUrl, {
                        responseType: 'arraybuffer',
                        timeout: 15000,
                        headers: downloadHeaders
                    });
                    const buffer = Buffer.from(imgRes.data);
                    if (buffer.length > 0) {
                        await this.sock.sendMessage(m.key.remoteJid, {
                            image: buffer,
                            caption: `🔎 *Busca:* ${searchTerm}\n📌 *Pinterest*`
                        }, { quoted: m });
                    }
                } catch (e: any) {
                    this.logger?.warn(`⚠️ [Pinterest] Falha ao baixar: ${imageUrl} — ${e.message}`);
                }
            }
        } catch (e: any) {
            await this._reply(m, '❌ Erro ao acessar o serviço de busca.');
            console.error(e);
        }
        return true;
    }

    /** Busca visual no Pinterest: baixa a imagem citada, envia diretamente para o Google
     *  Reverse Image Search (sem precisar de host externo) e retorna pins similares */
    private async _pinterestVisualSearch(m: any, count: number): Promise<boolean> {
        try {
            const quotedMsg = m.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!quotedMsg) {
                await this._reply(m, '⚠️ Responda a uma foto com *#pinterest* para busca visual.');
                return true;
            }

            await this._reply(m, '🔍 Analisando imagem e buscando similares no Pinterest...');

            // 1) Baixar a imagem citada
            const mediaRes = await this.mediaProcessor.downloadMedia(quotedMsg, 'image');
            if (!mediaRes?.buffer || mediaRes.buffer.length === 0) {
                await this._reply(m, '❌ Não consegui baixar a imagem. Tente novamente.');
                return true;
            }

            // 2) POST direto para Google Reverse Image Search (sem precisar de host externo)
            const { default: FormData } = await import('form-data');
            const form = new FormData();
            form.append('encoded_image', mediaRes.buffer, {
                filename: 'image.jpg',
                contentType: 'image/jpeg'
            });

            let googleHtml = '';
            try {
                const googleRes = await axios.post(
                    'https://www.google.com/searchbyimage/upload',
                    form,
                    {
                        headers: {
                            ...form.getHeaders(),
                            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0.3 Mobile/15E148 Safari/604.1',
                            'Referer': 'https://www.google.com/',
                            'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8'
                        },
                        maxRedirects: 5,
                        timeout: 25000
                    }
                );
                googleHtml = googleRes.data as string;
            } catch (googleErr: any) {
                this.logger?.warn(`⚠️ [Pinterest Visual] Google search falhou: ${googleErr.message}`);
            }

            // 3) Extrai URLs do Pinterest dos resultados do Google
            let pinterestImgUrls: string[] = [];
            if (googleHtml) {
                pinterestImgUrls = (googleHtml.match(/https:\/\/i\.pinimg\.com\/[^\s\"\'<>\\]+\.(?:jpg|png|gif|webp)/gi) || [])
                    .map((url: string) => url.replace(/\/([0-9]+x[0-9]*|[0-9]+x|originals)\//, '/736x/'))
                    .filter((url: string) => url.includes('/736x/'));
            }

            // 4) Fallback: extrai uma label de pesquisa da página do Google e busca no Pinterest por texto
            if (pinterestImgUrls.length === 0 && googleHtml) {
                const labelMatch = googleHtml.match(/<title>([^<]+)<\/title>/i);
                const rawLabel = labelMatch ? labelMatch[1].replace(/ - Google.*/i, '').trim() : '';
                if (rawLabel && rawLabel.length > 2) {
                    this.logger?.info(`📷 [Pinterest Visual] Fallback com label: "${rawLabel}"`);
                    const searchUrl = `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(rawLabel)}`;
                    const pRes = await axios.get(searchUrl, {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0.3 Mobile/15E148 Safari/604.1',
                            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                        }
                    });
                    const rawMatches = (pRes.data as string).match(/https:\/\/i\.pinimg\.com\/[^\s\"\'\\]+/g) || [];
                    pinterestImgUrls = rawMatches
                        .filter((u: string) => /\.(jpg|png|gif|webp)$/i.test(u))
                        .map((u: string) => u.replace(/\/([0-9]+x[0-9]*|[0-9]+x|originals)\//, '/736x/'))
                        .filter((u: string) => u.includes('/736x/'));
                    if (pinterestImgUrls.length > 0) {
                        await this._reply(m, `📌 Mostrando resultados similares para: *${rawLabel}*`);
                    }
                }
            }

            const uniqueResults = [...new Set(pinterestImgUrls)].slice(0, count);

            if (uniqueResults.length === 0) {
                await this._reply(m, '🔍 Nenhuma imagem similar encontrada no Pinterest.\n💡 Tente com uma foto mais nítida ou use *#pinterest <texto>* para busca por palavras.');
                return true;
            }

            const dlHeaders = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://www.pinterest.com/',
                'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
                'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
                'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
                'Sec-Ch-Ua-Mobile': '?0',
                'Sec-Ch-Ua-Platform': '"Windows"',
                'Sec-Fetch-Dest': 'image',
                'Sec-Fetch-Mode': 'no-cors',
                'Sec-Fetch-Site': 'cross-site'
            };

            let sentCount = 0;
            for (const imgUrl of uniqueResults) {
                try {
                    const imgRes = await axios.get(imgUrl, {
                        responseType: 'arraybuffer',
                        timeout: 15000,
                        headers: dlHeaders
                    });
                    const buf = Buffer.from(imgRes.data);
                    if (buf.length > 0) {
                        await this.sock.sendMessage(m.key.remoteJid, {
                            image: buf,
                            caption: `📌 *Pinterest* — Busca visual\n🔍 Imagem similar #${sentCount + 1}`
                        }, { quoted: m });
                        sentCount++;
                    }
                } catch (e: any) {
                    this.logger?.warn(`⚠️ [Pinterest Visual] Falha ao baixar: ${imgUrl} — ${e.message}`);
                }
            }

            if (sentCount === 0) {
                await this._reply(m, '❌ Encontrei resultados mas não consegui baixar as imagens. Tente novamente.');
            }

        } catch (e: any) {
            this.logger?.error('❌ [Pinterest Visual] Erro:', e.message);
            await this._reply(m, '❌ Erro na busca visual. Tente novamente mais tarde.');
        }
        return true;
    }

    public async _handleShip(m: any): Promise<boolean> {
        try {
            const ctx = m.message?.extendedTextMessage?.contextInfo;
            const mentioned = ctx?.mentionedJid || [];

            if (mentioned.length < 2) {
                await this._reply(m, '💞 Uso: *ship @pessoa1 @pessoa2');
                return true;
            }

            const percent = Math.floor(Math.random() * 101);
            let comment = '';
            if (percent > 80) comment = '💖 Casal perfeito! Casem logo.';
            else if (percent > 50) comment = '😊 Tem chance, hein?';
            else comment = '😬 Vish, melhor ficarem só na amizade.';

            const msg = `💞 *COMPATIBILIDADE* 💞\n\n@${mentioned[0].split('@')[0]} + @${mentioned[1].split('@')[0]}\n🔥 *Chance:* ${percent}%\n\n${comment}`;

            await this.sock.sendMessage(m.key.remoteJid, {
                text: msg,
                contextInfo: { mentionedJid: mentioned }
            }, { quoted: m });
        } catch (e: any) {
            await this._reply(m, '❌ Erro no cálculo de compatibilidade.');
        }
        return true;
    }

    public async _handleGames(m: any, command: string, args: string[]): Promise<boolean> {
        try {
            switch (command) {
                case 'dado': {
                    const dado = Math.floor(Math.random() * 6) + 1;
                    await this._reply(m, `🎲 Você tirou: *${dado}*`);
                    break;
                }
                case 'moeda':
                case 'caracoroa': {
                    const moeda = Math.random() < 0.5 ? 'CARA' : 'COROA';
                    await this._reply(m, `🪙 Resultado: *${moeda}*`);
                    break;
                }
                case 'slot': {
                    const items = ['🍒', '🍋', '🍇', '🍉', '🍎', '🍍', '🥝', '🍑'];
                    const a = items[Math.floor(Math.random() * items.length)];
                    const b = items[Math.floor(Math.random() * items.length)];
                    const c = items[Math.floor(Math.random() * items.length)];
                    const win = (a === b && b === c);
                    const slotMsg = `🎰 *SLOT MACHINE* 🎰\n\n[ ${a} | ${b} | ${c} ]\n\n${win ? '🎉 *PARABÉNS! VOCÊ GANHOU!*' : '😔 Não foi dessa vez...'}`;
                    await this._reply(m, slotMsg);
                    break;
                }
                case 'chance': {
                    if (args.length === 0) {
                        await this._reply(m, `📊 Uso: ${this.config.PREFIXO}chance <pergunta>`);
                        break;
                    }
                    const percent = Math.floor(Math.random() * 101);
                    await this._reply(m, `📊 A chance de *${args.join(' ')}* é de *${percent}%*`);
                    break;
                }
                case 'gay': {
                    const gayPercent = Math.floor(Math.random() * 101);
                    await this._reply(m, `🏳️🌈 Você é *${gayPercent}%* gay`);
                    break;
                }
            }
        } catch (e: any) {
            await this._reply(m, '❌ Erro ao processar o jogo.');
        }
        return true;
    }

    // _handleTagAll: ver implementação completa abaixo (linha ~1969)

    // _handleWelcome: ver implementação completa abaixo (linha ~1933)

    public async _handleBroadcast(m: any, text: string): Promise<boolean> {
        if (!text) {
            await this._reply(m, `📢 Uso: ${this.config.PREFIXO}broadcast <mensagem>\n📢 Com exceções: ${this.config.PREFIXO}broadcast --exc "Grupo A", "Grupo B" <mensagem>`);
            return true;
        }

        let messageText = text;
        const excludedNames: string[] = [];

        // Parse --exc flag: remove exceptions from beginning of text
        const excMatch = text.match(/^--exc\s+((?:"[^"]*"|[^,])+)/i);
        if (excMatch) {
            const excBlock = excMatch[1];
            // Extract quoted strings and unquoted names
            const quoted = [...excBlock.matchAll(/"([^"]+)"/g)].map(x => x[1]);
            const unquoted = excBlock.replace(/"([^"]+)"/g, '').split(',').map(s => s.trim()).filter(Boolean);
            excludedNames.push(...quoted, ...unquoted);
            messageText = text.substring(excMatch[0].length).trim();
        }

        if (!messageText) {
            await this._reply(m, `📢 Mensagem vazia. Uso: ${this.config.PREFIXO}broadcast --exc "Grupo A" <mensagem>`);
            return true;
        }

        await this._reply(m, `🚀 Enviando transmissão global...${excludedNames.length > 0 ? `\n🚫 Excluindo: ${excludedNames.join(', ')}` : ''}`);
        try {
            const groups: any = await this.sock.groupFetchAllParticipating();
            const jids = Object.keys(groups);

            let success = 0;
            let skipped = 0;
            const skippedNames: string[] = [];

            for (const jid of jids) {
                const groupName = groups[jid]?.subject || '';

                // Check if group name matches any exclusion
                if (excludedNames.length > 0) {
                    const matched = excludedNames.some(exName =>
                        groupName.toLowerCase().includes(exName.toLowerCase())
                    );
                    if (matched) {
                        skipped++;
                        skippedNames.push(groupName);
                        continue;
                    }
                }

                try {
                    await this.sock.sendMessage(jid, { text: `📢 *AVISO GLOBAL:* \n\n${messageText}` });
                    success++;
                    await new Promise(r => setTimeout(r, 1000)); // Delay p/ evitar ban
                } catch (err: any) { }
            }

            let resultMsg = `✅ Transmissão concluída!\n📤 Enviado para ${success} grupo(s).`;
            if (skipped > 0) {
                resultMsg += `\n🚫 ${skipped} grupo(s) excluído(s): ${skippedNames.join(', ')}`;
            }
            await this._reply(m, resultMsg);
        } catch (e: any) {
            await this._reply(m, '❌ Erro na transmissão.');
        }
        return true;
    }

    public async _handleBlacklist(m: any, args: string[], fullArgs: string): Promise<boolean> {
        const action = args[0]?.toLowerCase();

        if (!action || action === 'list') {
            const blReport = this.moderationSystem?.getBlacklistReport ? this.moderationSystem.getBlacklistReport() : '❌ Blacklist não disponível';
            return await this._reply(m, blReport);
        }

        let targets: string[] = [];
        try {
            if (typeof (this as any).handle?.extractTargets === 'function') {
                targets = (this as any).handle.extractTargets(m);
            }
        } catch (e) { }

        let targetId = targets[0];
        if (!targetId && args[1]) {
            const num = args[1].replace(/\D/g, '');
            if (num) targetId = `${num}@s.whatsapp.net`;
        }

        // Try getting mentioned from context
        if (!targetId) {
            const mentioned = m.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
            if (mentioned.length > 0) targetId = mentioned[0];
        }

        // Try getting from replied message
        if (!targetId) {
            const replyCtx = m.message?.extendedTextMessage?.contextInfo;
            if (replyCtx && replyCtx.participant) targetId = replyCtx.participant;
        }

        if (!targetId) {
            await this._reply(m, '❌ Marque alguém, responda a uma mensagem ou digite o número.\nExemplo: #blacklist add @user');
            return true;
        }

        if (action === 'add') {
            const reason = args.slice(2).join(' ') || 'Adicionado manualmente pelo dono';
            const res = this.moderationSystem?.addToBlacklist ? this.moderationSystem.addToBlacklist(targetId, targetId.split('@')[0], targetId.split('@')[0], reason) : { success: false, message: 'Função indisponível' };
            await this._reply(m, res.success ? `✅ Usuário ${targetId.split('@')[0]} adicionado à blacklist.` : `❌ Erro: ${res.message}`);
        } else if (action === 'remove' || action === 'del') {
            const success = this.moderationSystem?.removeFromBlacklist ? this.moderationSystem.removeFromBlacklist(targetId) : false;
            await this._reply(m, success ? `✅ Usuário ${targetId.split('@')[0]} removido da blacklist.` : `❌ Usuário não encontrado na blacklist.`);
        } else {
            await this._reply(m, '❌ Ação inválida. Use add, remove ou list.');
        }

        return true;
    }

    // ═════════════════════════════════════════════════════════════════
    // SISTEMA DE REGISTRO
    // ═════════════════════════════════════════════════════════════════

    /**
     * Processa comando #registrar Nome|Idade
     */
    public async _handleRegister(m: any, fullArgs: string, userId: string): Promise<boolean> {
        try {
            // Verifica se já está registrado
            if (this.registrationSystem.isRegistered(userId)) {
                const profile = this.registrationSystem.getProfile(userId);

                await this.bot.reply(m,
                    `✅ **Você já está registrado!**\n\n` +
                    `📝 **Nome:** ${profile.nome}\n` +
                    `🎂 **Idade:** ${profile.idade} anos\n` +
                    `🔑 **Serial:** \`${profile.serial}\`\n` +
                    `🔗 **Link:** ${profile.link}\n` +
                    `📅 **Registrado em:** ${new Date(profile.registeredAt).toLocaleDateString('pt-BR')}`
                );
                return true;
            }

            // Valida formato
            if (!fullArgs || !fullArgs.includes('|')) {
                await this.bot.reply(m,
                    `❌ **Formato Incorreto**\n\n` +
                    `Use: \`#registrar Nome|Idade\`\n\n` +
                    `**Exemplos:**\n` +
                    `• \`#registrar João Silva|25\`\n` +
                    `• \`#registrar Maria Santos|30\`\n\n` +
                    `⚠️ A idade deve estar entre 13 e 99 anos.`
                );
                return true;
            }

            // Extrai nome e idade
            const parts = fullArgs.split('|');
            const nomeRegistro = parts[0].trim();
            const idadeStr = parts[1].trim();
            const idade = parseInt(idadeStr);

            // Valida nome
            if (!nomeRegistro || nomeRegistro.length < 3) {
                await this.bot.reply(m, '❌ O nome deve ter pelo menos 3 caracteres.');
                return true;
            }

            if (nomeRegistro.length > 50) {
                await this.bot.reply(m, '❌ O nome não pode ter mais de 50 caracteres.');
                return true;
            }

            // Valida idade
            if (isNaN(idade) || idade < 13 || idade > 99) {
                await this.bot.reply(m, '❌ A idade deve ser um número entre 13 e 99.');
                return true;
            }

            // Registra usuário
            const result = this.registrationSystem.register(userId, nomeRegistro, idade);

            if (result.success) {
                await this.bot.reply(m,
                    `🎉 **Registro Concluído com Sucesso!**\n\n` +
                    `📝 **Nome:** ${result.user.nome}\n` +
                    `🎂 **Idade:** ${result.user.idade} anos\n` +
                    `🔑 **Serial Único:** \`${result.user.serial}\`\n` +
                    `🔗 **Seu Link:** ${result.user.link}\n\n` +
                    `✅ Agora você tem acesso a todos os comandos do bot!\n` +
                    `Use \`#menu\` para ver os comandos disponíveis.`
                );
            } else {
                await this.bot.reply(m, `❌ Erro ao registrar: ${result.error}`);
            }

            return true;

        } catch (error: any) {
            console.error('Erro no registro:', error);
            await this.bot.reply(m, `❌ Erro ao processar registro: ${error.message}`);
            return true;
        }
    }

    /**
     * Comando #level - Ver nível do usuário
     */
    public async _handleLevel(m: any, userId: string, chatJid: string, ehGrupo: boolean): Promise<boolean> {
        try {
            const texto = m.message?.conversation || m.message?.extendedTextMessage?.text || '';
            const args = texto.split(' ').slice(1);
            const subCommand = args[0]?.toLowerCase();

            // Ativação/Desativação por grupo (Requer admin)
            if (ehGrupo && (subCommand === 'on' || subCommand === 'off')) {
                const isAdmin = await this.groupManagement.isUserAdmin(chatJid, m.key.participant);
                const isOwner = this.config.isDono(userId);

                if (!isAdmin && !isOwner) {
                    await this.bot.reply(m, '🚫 Apenas administradores podem ativar/desativar o sistema de níveis.');
                    return true;
                }

                return await this.groupManagement.toggleSetting(m, 'leveling', subCommand);
            }

            // allow checking other user by mention or reply
            const extractTargets = (msg: any): string[] => {
                const mentioned: string[] = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
                if (mentioned.length) return mentioned;
                const replyInfoLocal = msg.replyInfo || msg._replyInfo;
                if (replyInfoLocal && replyInfoLocal.quemEscreveuCitacaoJid) return [replyInfoLocal.quemEscreveuCitacaoJid];
                if (msg.message?.extendedTextMessage?.contextInfo?.participant) {
                    return [msg.message.extendedTextMessage.contextInfo.participant];
                }
                return [];
            };
            // ✅ CRÍTICO: Normaliza userId para número puro (sem @s.whatsapp.net, sem :device, sem 'lid_' prefix)
            // BotCore grava XP com 'numeroReal' (número puro), mas CommandHandler recebe o JID completo.
            // Sem normalizar, os registros nunca batem e o #level sempre mostra 0.
            // 🔧 Usa JidUtils.normalizeUserNumber() para máxima consistência
            const normalizeUid = (uid: string) => JidUtils.normalizeUserNumber(uid);
            userId = normalizeUid(userId);

            const targets = extractTargets(m);
            if (targets.length > 0) {
                userId = normalizeUid(targets[0]);
            }

            const groupId = ehGrupo ? chatJid : 'global';

            // Verifica se está ativo para o grupo
            if (ehGrupo && !this.groupManagement.groupSettings[chatJid]?.leveling) {
                await this.bot.reply(m, '📊 O sistema de níveis está *DESATIVADO* neste grupo.\n\nUse: *#level on* para ativar (Apenas Admins).');
                return true;
            }

            const rec = this.levelSystem.getGroupRecord(groupId, userId, true);
            const patente = this.levelSystem.getPatente(rec.level || 0);
            const xpNeeded = this.levelSystem.requiredXp(rec.level || 0);
            const xpAtual = rec.xp || 0;
            const progress = (xpNeeded > 0 && isFinite(xpNeeded))
                ? ((xpAtual / xpNeeded) * 100).toFixed(1)
                : '100.0';
            const faltam = (isFinite(xpNeeded) && xpNeeded > xpAtual)
                ? xpNeeded - xpAtual
                : 0;

            await this.bot.reply(m,
                `📊 *Seu Nível*\n\n` +
                `🏅 *Patente:* ${patente}\n` +
                `🏆 *Level:* ${rec.level || 0}\n` +
                `⭐ *XP:* ${xpAtual}/${isFinite(xpNeeded) ? xpNeeded : '∞'}\n` +
                `📈 *Progresso:* ${progress}%\n\n` +
                `🎯 Faltam *${faltam} XP* para o próximo nível!`
            );

            return true;
        } catch (error: any) {
            console.error('Erro no comando level:', error);
            await this.bot.reply(m, '❌ Erro ao obter informações de level.');
            return true;
        }
    }

    /**
     * Comando #rank - Top 10 do grupo (Nível ou Economia)
     */
    public async _handleRank(m: any, chatJid: string, ehGrupo: boolean): Promise<boolean> {
        try {
            if (!ehGrupo) {
                await this.bot.reply(m, '📵 Este comando só funciona em grupos.');
                return true;
            }

            const fullText = m.message?.conversation || m.message?.extendedTextMessage?.text || '';
            const args = fullText.split(' ').slice(1);
            const sub = (args[0] || '').toLowerCase();

            // 💰 RANKING DE ECONOMIA
            if (sub === 'money' || sub === 'economia' || sub === 'grana' || sub === 'riqueza') {
                const ranking = this.economySystem.getRanking(10);
                if (ranking.length === 0) {
                    await this.bot.reply(m, '📊 Nenhum dado de economia registrado ainda.');
                    return true;
                }

                let texto = '💰 *TOP 10 — MAIS RICOS DO GRUPO* 💰\n\n';
                const mentions: string[] = [];

                ranking.forEach((user: any, index: number) => {
                    const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}º`;
                    const numero = JidUtils.getNumber(user.userId);
                    texto += `${medal} @${numero}\n`;
                    texto += `   💵 total: ${user.total} moedas\n\n`;
                    mentions.push(user.userId);
                });

                await this.sock.sendMessage(chatJid, { text: texto, mentions }, { quoted: m });
                return true;
            }

            // ⭐ RANKING DE NÍVEL (Padrão)
            const allData = this.levelSystem.data || [];
            const groupData = allData
                .filter((r: any) => r.gid === chatJid)
                .sort((a: any, b: any) => (b.level - a.level) || (b.xp - a.xp))
                .slice(0, 10);

            if (groupData.length === 0) {
                await this.bot.reply(m, '📊 Nenhum usuário com XP registrado ainda neste grupo.');
                return true;
            }

            let texto = '🏆 *TOP 10 — RANKING DE NÍVEIS* 🏆\n\n';
            const mentions: string[] = [];

            groupData.forEach((user: any, index: number) => {
                const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}º`;
                const numero = user.uid.split('@')[0];
                const patente = this.levelSystem.getPatente(user.level || 0);
                texto += `${medal} @${numero}\n`;
                texto += `   📊 ${patente} • Level ${user.level} • ${user.xp} XP\n\n`;
                mentions.push(user.uid);
            });

            await this.sock.sendMessage(chatJid, { text: texto, mentions }, { quoted: m });

            return true;
        } catch (error: any) {
            console.error('Erro no comando rank:', error);
            await this.bot.reply(m, '❌ Erro ao gerar ranking.');
            return true;
        }
    }

    // ═════════════════════════════════════════════════════════════════
    // SISTEMA DE ECONOMIA (V21)
    // ═════════════════════════════════════════════════════════════════

    /**
     * Comando #daily - Recompensa diária
     */
    public async _handleDaily(m: any, userId: string): Promise<boolean> {
        try {
            const result = this.economySystem.daily(userId);

            if (result.success) {
                await this.bot.reply(m,
                    `🎁 **Recompensa Diária Coletada!**\n\n` +
                    `💰 **Recebido:** ${result.amount} moedas\n` +
                    `💼 **Saldo Total:** ${result.newBalance} moedas\n\n` +
                    `⏰ Volte amanhã para coletar novamente!`
                );
            } else {
                const timeLeft = this.economySystem.getDailyTimeLeft(userId);
                const hours = Math.floor(timeLeft / 3600000);
                const minutes = Math.floor((timeLeft % 3600000) / 60000);

                await this.bot.reply(m,
                    `⏰ **Daily Já Coletado**\n\n` +
                    `Você já coletou sua recompensa diária.\n` +
                    `Volte em: **${hours}h ${minutes}m**`
                );
            }

            return true;
        } catch (error: any) {
            console.error('Erro no comando daily:', error);
            await this.bot.reply(m, '❌ Erro ao processar daily.');
            return true;
        }
    }

    /**
     * Comando #atm - Ver saldo
     */
    public async _handleATM(m: any, userId: string): Promise<boolean> {
        try {
            const balance = this.economySystem.getBalance(userId);

            await this.bot.reply(m,
                `🏦 **Seu Saldo Bancário**\n\n` +
                `💵 **Carteira:** ${balance.wallet} moedas\n` +
                `🏛️ **Banco:** ${balance.bank} moedas\n` +
                `💰 **Total:** ${balance.total} moedas\n\n` +
                `Use \`#daily\` para ganhar moedas diárias!`
            );

            return true;
        } catch (error: any) {
            console.error('Erro no comando atm:', error);
            await this.bot.reply(m, '❌ Erro ao obter saldo.');
            return true;
        }
    }

    /**
     * Comando #transfer - Transferir dinheiro
     */
    public async _handleTransfer(m: any, userId: string, args: string[], fullArgs: string): Promise<boolean> {
        try {
            const target = m.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!target) {
                await this.bot.reply(m,
                    `❌ **Formato Incorreto**\n\n` +
                    `Use: \`#transfer @usuario valor\`\n` +
                    `Exemplo: \`#transfer @amigo 100\``
                );
                return true;
            }

            const amount = parseInt(args[args.length - 1]);
            if (isNaN(amount) || amount <= 0) {
                await this.bot.reply(m, '❌ Valor inválido. Use apenas números positivos.');
                return true;
            }

            if (target === userId) {
                await this.bot.reply(m, '❌ Você não pode transferir para si mesmo.');
                return true;
            }

            const result = this.economySystem.transfer(userId, target, amount);

            if (result.success) {
                const targetNum = target.split('@')[0];
                await this.bot.reply(m,
                    `✅ **Transferência Realizada!**\n\n` +
                    `💸 **Enviado:** ${amount} moedas\n` +
                    `👤 **Para:** @${targetNum}\n` +
                    `💰 **Seu Saldo:** ${result.senderBalance} moedas`,
                    { mentions: [target] }
                );
            } else {
                await this.bot.reply(m, `❌ ${result.error}`);
            }

            return true;
        } catch (error: any) {
            console.error('Erro no comando transfer:', error);
            await this.bot.reply(m, '❌ Erro ao transferir.');
            return true;
        }
    }

    /**
     * Comando #deposit - Depositar no banco
     */
    public async _handleDeposit(m: any, userId: string, args: string[]): Promise<boolean> {
        try {
            const amount = args[0] === 'all' ? this.economySystem.getBalance(userId).wallet : parseInt(args[0]);
            if (isNaN(amount) || amount <= 0) {
                await this.bot.reply(m, '❌ Valor inválido para depósito.');
                return true;
            }

            const result = this.economySystem.deposit(userId, amount);
            if (result.success) {
                await this.bot.reply(m, `✅ Depósito de ${amount} realizado!\n💰 Carteira: ${result.wallet}\n🏦 Banco: ${result.bank}`);
            } else {
                await this.bot.reply(m, `❌ ${result.error}`);
            }
            return true;
        } catch (e) {
            return true;
        }
    }

    /**
     * Comando #withdraw - Sacar do banco
     */
    public async _handleWithdraw(m: any, userId: string, args: string[]): Promise<boolean> {
        try {
            const amount = args[0] === 'all' ? this.economySystem.getBalance(userId).bank : parseInt(args[0]);
            if (isNaN(amount) || amount <= 0) {
                await this.bot.reply(m, '❌ Valor inválido para saque.');
                return true;
            }

            const result = this.economySystem.withdraw(userId, amount);
            if (result.success) {
                await this.bot.reply(m, `✅ Saque de ${amount} realizado!\n💰 Carteira: ${result.wallet}\n🏦 Banco: ${result.bank}`);
            } else {
                await this.bot.reply(m, `❌ ${result.error}`);
            }
            return true;
        } catch (e) {
            return true;
        }
    }

    /**
     * Comando #transactions - Ver histórico
     */
    public async _handleTransactions(m: any, userId: string): Promise<boolean> {
        try {
            const txs = this.economySystem.getTransactions(userId);
            if (!txs || txs.length === 0) {
                await this.bot.reply(m, '📭 Nenhuma transação encontrada.');
                return true;
            }

            let text = '🧾 **SUAS ÚLTIMAS TRANSAÇÕES**\n\n';
            txs.forEach((tx: any, i: number) => {
                const date = new Date(tx.timestamp).toLocaleString('pt-BR');
                const type = tx.type === 'daily' ? '🎁 Daily' :
                    tx.type === 'transfer_in' ? '📩 Recebido' :
                        tx.type === 'transfer_out' ? '📤 Enviado' : tx.type;
                text += `${i + 1}. [${date}] ${type}: ${tx.amount} moedas\n`;
            });

            await this.bot.reply(m, text);
            return true;
        } catch (e) {
            return true;
        }
    }

    // ═════════════════════════════════════════════════════════════════
    // EFEITOS DE ÁUDIO
    // ═════════════════════════════════════════════════════════════════

    /**
     * Processa comandos de efeitos de áudio
     */
    public async _handleAudioEffect(m: any, effect: string): Promise<boolean> {
        try {
            const quoted = m.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            const targetMessage = quoted || m.message;

            const hasAudio = !!(targetMessage?.audioMessage ||
                targetMessage?.videoMessage ||
                targetMessage?.viewOnceMessage?.message?.audioMessage ||
                targetMessage?.viewOnceMessageV2?.message?.audioMessage);

            if (!quoted && !hasAudio) {
                await this._showAudioEffectUsage(m, effect);
                return true;
            }

            await this._reply(m, `⏳ Aplicando efeito *${effect}*... Aguarde.`);

            const mediaRes = await this.mediaProcessor.downloadMedia(targetMessage, 'audio');

            if (!mediaRes || !mediaRes.buffer || mediaRes.buffer.length === 0) {
                await this._reply(m, '❌ Não consegui baixar o áudio. Certifique-se de responder a um áudio ou enviar um com o comando na legenda.');
                return true;
            }

            const audioBuffer = mediaRes.buffer;

            const audioProcessor = this.bot?.audioProcessor;
            if (!audioProcessor) {
                await this._reply(m, '❌ Processador de áudio não disponível.');
                return true;
            }

            const result = await audioProcessor.applyAudioEffect(audioBuffer, effect);

            if (!result.sucesso) {
                await this._reply(m, `❌ Erro ao aplicar efeito: ${result.error || 'falha desconhecida'}`);
                return true;
            }

            await this.sock.sendMessage(m.key.remoteJid, {
                audio: result.buffer,
                mimetype: result.mimetype || 'audio/mpeg',
                ptt: true,
                fileName: `${effect}_${Date.now()}.ogg`
            }, { quoted: m });

            return true;

        } catch (error: any) {
            console.error(`Erro no efeito ${effect}:`, error);
            await this._reply(m,
                `❌ *Erro ao aplicar efeito*\n\nDetalhes: ${error.message}\n\nTente novamente com um áudio diferente.`
            );
            return true;
        }
    }

    public async _showAudioEffectUsage(m: any, effect: string): Promise<void> {
        await this.bot.reply(m,
            `🎵 **Como Usar Efeitos de Áudio**\n\n` +
            `1️⃣ Envie um áudio com a legenda \`#${effect}\`\n` +
            `2️⃣ Ou responda a um áudio com \`#${effect}\`\n\n` +
            `**Efeitos disponíveis:**\n` +
            `🎶 #nightcore - Rápido + agudo\n` +
            `🐌 #slow - Lento + grave\n` +
            `🔊 #bass - Graves intensos\n` +
            `🗣️ #deep - Voz profunda\n` +
            `🤖 #robot - Efeito robótico\n` +
            `⏮️ #reverse - Áudio reverso\n` +
            `🐿️ #squirrel - Voz de esquilo\n` +
            `📢 #echo - Eco\n` +
            `🎧 #8d - Áudio 8D`
        );
    }


    public async _handleGetProfileAdmin(m: any, args: string[]): Promise<boolean> {
        const target = this.userProfile.extractUserJidFromMessage(m.message, m) || m.key.participant || m.key.remoteJid;
        const userInfo = await this.userProfile.getUserInfo(target);

        if (!userInfo.success) {
            await this._reply(m, `❌ Erro ao obter perfil: ${userInfo.error}`);
            return true;
        }

        const msg = this.userProfile.formatUserDataMessage(userInfo);

        if (userInfo.hasPhoto && userInfo.photoUrl) {
            await this.sock.sendMessage(m.key.remoteJid, {
                image: { url: userInfo.photoUrl },
                caption: msg
            }, { quoted: m });
        } else {
            await this._reply(m, msg);
        }
        return true;
    }

    public async _handleToggleModeration(m: any, command: string, args: string[]): Promise<boolean> {
        const jid = m.key.remoteJid;
        const enable = args[0] === 'on' || args[0] === '1';
        const actionStr = enable ? 'ATIVADO' : 'DESATIVADO';

        if (!this.moderationSystem) return true;

        switch (command) {
            case 'antilink':
                this.moderationSystem.toggleAntiLink(jid, enable);
                await this._reply(m, `✅ Anti-Link ${actionStr} para este grupo.`);
                break;
            case 'antifake':
                if (args[0] === 'add' && args[1]) {
                    const ddd = args[1].replace('+', '');
                    this.moderationSystem.addAntiFakeException(jid, ddd);
                    const exceptions = this.moderationSystem.getAntiFakeExceptions(jid);
                    await this._reply(m, `✅ DDD +${ddd} adicionado à lista de exceções.\n📋 DDDs permitidos: 244, ${exceptions.join(', ')}`);
                } else if (args[0] === 'remove' && args[1]) {
                    const ddd = args[1].replace('+', '');
                    this.moderationSystem.removeAntiFakeException(jid, ddd);
                    const exceptions = this.moderationSystem.getAntiFakeExceptions(jid);
                    await this._reply(m, `❌ DDD +${ddd} removido. Restantes: 244${exceptions.length > 0 ? ', ' + exceptions.join(', ') : ''}`);
                } else if (args[0] === 'list') {
                    const exceptions = this.moderationSystem.getAntiFakeExceptions(jid);
                    await this._reply(m, `📋 DDDs permitidos neste grupo:\n- 244 (Angola - padrão)${exceptions.length > 0 ? '\n- ' + exceptions.join('\n- ') : ''}`);
                } else {
                    this.moderationSystem.toggleAntiFake(jid, enable);
                    await this._reply(m, `✅ Anti-Fake (+244) ${actionStr} para este grupo.\n📌 Use: ${this.config.PREFIXO}antifake add 55 (adicionar exceção)\n📌 Use: ${this.config.PREFIXO}antifake list (ver exceções)`);
                }
                break;
            case 'antiimage':
                this.moderationSystem.toggleAntiImage(jid, enable);
                await this._reply(m, `✅ Anti-Imagem ${actionStr} para este grupo.`);
                break;
            case 'antisticker':
                this.moderationSystem.toggleAntiSticker(jid, enable);
                await this._reply(m, `✅ Anti-Sticker ${actionStr} para este grupo.`);
                break;
        }
        return true;
    }

    private async _handleExceptCommand(m: any, args: string[]): Promise<boolean> {
        const chatJid = m.key.remoteJid;
        const subCommand = (args[0] || '').toLowerCase();

        if (subCommand === 'add') {
            const targets = this.groupManagement?._extractTargets(m, args.slice(1));
            const target = targets?.[0];
            if (!target) {
                await this._reply(m, '❌ Marque um usuário, responda a uma mensagem ou digite o número para adicionar às exceções.');
                return true;
            }
            this.moderationSystem.addAntiLinkException(chatJid, target);
            await this._reply(m, `✅ Usuário @${target.split('@')[0]} adicionado à lista de confiança deste grupo.`, { mentions: [target] });
            return true;
        }

        if (subCommand === 'remove' || subCommand === 'del') {
            const targets = this.groupManagement?._extractTargets(m, args.slice(1));
            const target = targets?.[0];
            if (!target) {
                await this._reply(m, '❌ Marque um usuário, responda a uma mensagem ou digite o número para remover das exceções.');
                return true;
            }
            const removed = this.moderationSystem.removeAntiLinkException(chatJid, target);
            if (removed) {
                await this._reply(m, `✅ Usuário @${target.split('@')[0]} removido da lista de confiança deste grupo.`, { mentions: [target] });
            } else {
                await this._reply(m, '❌ Este usuário não está na lista de confiança deste grupo.');
            }
            return true;
        }

        if (subCommand === 'list') {
            const list = this.moderationSystem.getAntiLinkExceptions(chatJid);
            if (list.length === 0) {
                await this._reply(m, '📝 A lista de confiança deste grupo está vazia.');
                return true;
            }
            let text = '📝 *USUÁRIOS CONFIÁVEIS (ANTILINK)*\n\n';
            list.forEach((num: string, i: number) => {
                text += `${i + 1}. @${num}\n`;
            });
            await this._reply(m, text, { mentions: list.map((n: string) => `${n}@s.whatsapp.net`) });
            return true;
        }

        await this._reply(m, '❓ Uso: *#except add/remove/list*');
        return true;
    }

    public async _handleManualWarn(m: any, args: string[]): Promise<boolean> {
        const target = this.userProfile.extractUserJidFromMessage(m.message, m);
        if (!target) {
            await this._reply(m, `⚠️ Marque ou responda a alguém para dar um aviso.`);
            return true;
        }

        const reason = args.join(' ') || 'Sem motivo especificado';

        if (this.bot?.handleWarning) {
            await this.bot.handleWarning(m, reason);
        } else if (this.moderationSystem) {
            const warningCount = this.moderationSystem.addWarning(m.key.remoteJid, target, reason);
            const maxWarnings = 3;
            const shouldKick = warningCount >= maxWarnings;

            await this._reply(m, `⚠️ *AVISO APLICADO* ⚠️\n\n👤 Usuário: @${target.split('@')[0]}\n📝 Motivo: ${reason}\n📊 Avisos: ${warningCount}/${maxWarnings}\n\n${shouldKick ? '❌ Usuário banido por atingir o limite!' : '⚠️ Evite violar as regras para não ser banido.'}`, { mentions: [target] });

            if (shouldKick && this.bot?.groupRemoveMember) {
                try {
                    await this.bot.groupRemoveMember(m.key.remoteJid, [target]);
                } catch (e) {
                    console.error('Erro ao remover membro:', e);
                }
            }
        }
        return true;
    }

    public async _handleResetWarns(m: any, args: string[]): Promise<boolean> {
        const target = this.userProfile.extractUserJidFromMessage(m.message, m);
        if (!target) {
            await this._reply(m, `⚠️ Marque ou responda a alguém para resetar os avisos.`);
            return true;
        }

        if (this.moderationSystem) {
            this.moderationSystem.resetWarnings(m.key.remoteJid, target);
            await this._reply(m, `✅ Avisos resetados para o usuário.`);
        }
        return true;
    }

    public async _handleDelete(m: any, hasPermission: boolean): Promise<boolean> {
        const quotedMsg = m.message?.extendedTextMessage?.contextInfo;
        if (!quotedMsg) {
            await this._reply(m, '❌ Responda a uma mensagem para apagá-la.');
            return true;
        }

        const isMe = quotedMsg.participant === this.sock.user?.id || (this.bot?.userJid && quotedMsg.participant === this.bot.userJid);

        if (isMe || hasPermission) {
            try {
                await this.sock.sendMessage(m.key.remoteJid, {
                    delete: {
                        remoteJid: m.key.remoteJid,
                        fromMe: isMe,
                        id: quotedMsg.stanzaId,
                        participant: quotedMsg.participant
                    }
                });
            } catch (e: any) {
                await this._reply(m, `❌ Erro ao apagar mensagem: ${e.message}`);
            }
        } else {
            await this._reply(m, '🚫 Você não tem permissão para apagar mensagens de outros usuários.');
        }
        return true;
    }

    public async _handleWelcome(m: any, command: string, args: string[], fullArgs: string): Promise<boolean> {
        if (!this.groupManagement) return true;

        const groupJid = m.key.remoteJid;
        const subCommand = command.toLowerCase();

        switch (subCommand) {
            case 'welcome':
            case 'bemvindo':
                // Check for status command
                if (args[0] === 'status') {
                    const welcomeOn = this.groupManagement.getWelcomeStatus(groupJid);
                    const welcomeMsg = this.groupManagement.getCustomMessage(groupJid, 'welcome');
                    await this._reply(m,
                        `📝 *STATUS - BOAS-VINDAS*\n\n` +
                        `✅ Status: ${welcomeOn ? 'ATIVADO' : 'DESATIVADO'}\n` +
                        `💬 Mensagem: ${welcomeMsg || 'Padrão do sistema'}\n\n` +
                        `⚙️ *Comandos:*\n` +
                        `• #welcome on - Ativar\n` +
                        `• #welcome off - Desativar\n` +
                        `• #welcome status - Ver status\n` +
                        `• #setwelcome [texto] - Personalizar mensagem`
                    );
                    return true;
                }
                if (args[0] === 'on' || args[0] === 'off') {
                    await this.groupManagement.toggleSetting(m, 'welcome', args[0]);
                } else {
                    await this._reply(m, `💡 Use *#welcome on/off* para ligar/desligar ou *#setwelcome Texto* para configurar.`);
                }
                return true;

            case 'setwelcome':
                // ✅ FIX: Permitir personalização quando não há args (responder com help)
                if (!fullArgs || fullArgs.trim() === '') {
                    await this._reply(m,
                        `📝 *Como usar #setwelcome:*\n\n` +
                        `Use: *#setwelcome Seu texto aqui*\n\n` +
                        `📌 *Variáveis disponíveis:*\n` +
                        `• [username] - Nome do novo membro\n` +
                        `• [group] - Nome do grupo\n` +
                        `• [date] - Data de entrada\n` +
                        `• [desc] - Descrição do grupo\n` +
                        `• [links] - Link de convite do grupo\n\n` +
                        `📝 *Exemplo:*\n` +
                        `#setwelcome Bem-vindo/a [username] ao [group]! 🎉 Leia a descrição!`
                    );
                    return true;
                }
                await this.groupManagement.setCustomMessage(groupJid, 'welcome', fullArgs);
                await this._reply(m, `✅ Mensagem de boas-vindas personalizada salva!\n\n_Novas mensagens usarão esse texto._`);
                return true;

            case 'setgoodbye':
                // ✅ FIX: Permitir personalização quando não há args (responder com help)
                if (!fullArgs || fullArgs.trim() === '') {
                    await this._reply(m,
                        `📝 *Como usar #setgoodbye:*\n\n` +
                        `Use: *#setgoodbye Seu texto aqui*\n\n` +
                        `📌 *Variáveis disponíveis:*\n` +
                        `• [username] - Nome do membro que saiu\n` +
                        `• [group] - Nome do grupo\n` +
                        `• [date] - Data de saída\n` +
                        `• [desc] - Descrição do grupo\n` +
                        `• [links] - Link de convite do grupo\n\n` +
                        `📝 *Exemplo:*\n` +
                        `#setgoodbye Tchau [username]! Volte sempre! 👋`
                    );
                    return true;
                }
                await this.groupManagement.setCustomMessage(groupJid, 'goodbye', fullArgs);
                await this._reply(m, `✅ Mensagem de saída personalizada salva!\n\n_Novas saídas usarão esse texto._`);
                return true;

            case 'goodbye':
                // Check for status command
                if (args[0] === 'status') {
                    const goodbyeOn = this.groupManagement.getGoodbyeStatus(groupJid);
                    const goodbyeMsg = this.groupManagement.getCustomMessage(groupJid, 'goodbye');
                    await this._reply(m,
                        `📝 *STATUS - DESPEDIDA*\n\n` +
                        `✅ Status: ${goodbyeOn ? 'ATIVADO' : 'DESATIVADO'}\n` +
                        `💬 Mensagem: ${goodbyeMsg || 'Padrão do sistema'}\n\n` +
                        `⚙️ *Comandos:*\n` +
                        `• #goodbye on - Ativar\n` +
                        `• #goodbye off - Desativar\n` +
                        `• #goodbye status - Ver status\n` +
                        `• #setgoodbye [texto] - Personalizar mensagem`
                    );
                    return true;
                }
                if (args[0] === 'on' || args[0] === 'off') {
                    await this.groupManagement.toggleSetting(m, 'goodbye', args[0]);
                } else {
                    await this._reply(m, `💡 Use *#goodbye on/off* para ligar/desligar ou *#setgoodbye Texto* para configurar.`);
                }
                return true;
        }
        return true;
    }


    public async _handlePoll(m: any, fullArgs: string): Promise<boolean> {
        try {
            if (!fullArgs || !fullArgs.includes('|')) {
                await this._reply(m,
                    `📊 *Como usar o comando enquete:*\n\n` +
                    `*#enquete Pergunta | Opção1 | Opção2*\n\n` +
                    `📝 _Exemplo:_\n#enquete Qual sua cor favorita? | Azul | Vermelho | Verde`
                );
                return true;
            }

            const partes = fullArgs.split('|').map((p: any) => p.trim()).filter(Boolean);
            if (partes.length < 3) {
                await this._reply(m, '❌ Preciso de pelo menos *1 pergunta* e *2 opções*.\n\nExemplo: #enquete Qual? | A | B');
                return true;
            }

            const pergunta = partes[0];
            const opcoes = partes.slice(1, 13); // Máximo 12 opções no WhatsApp

            await this.sock.sendMessage(m.key.remoteJid, {
                poll: {
                    name: pergunta,
                    values: opcoes,
                    selectableCount: 1
                }
            }, { quoted: m });

            return true;
        } catch (e: any) {
            console.error('Erro em _handlePoll:', e);
            await this._reply(m, `❌ Erro ao criar enquete: ${e.message}`);
            return true;
        }
    }

    public async _handleTagAll(m: any, text: string, hide: boolean = false): Promise<boolean> {
        if (!this.sock) return true;
        try {
            const groupMetadata = await this.sock.groupMetadata(m.key.remoteJid);
            const participants = groupMetadata.participants.map((p: any) => p.id);

            if (hide) {
                const msgText = text || '📢 Chamando todos...';
                await this.sock.sendMessage(m.key.remoteJid, {
                    text: msgText,
                    mentions: participants
                }, { quoted: m });
            } else {
                let msg = `📢 *Tagueando Todos* 📢\n\n`;
                if (text) msg += `📝 *Mensagem:* ${text}\n\n`;

                for (const part of groupMetadata.participants) {
                    msg += `• @${part.id.split('@')[0]}\n`;
                }

                await this.sock.sendMessage(m.key.remoteJid, {
                    text: msg,
                    mentions: participants
                }, { quoted: m });
            }
        } catch (e: any) {
            await this._reply(m, `❌ Erro ao taguear: ${e.message}`);
        }
        return true;
    }

    public async _handleRaffle(m: any, chatJid: string, args: string[]): Promise<boolean> {
        try {
            const meta = await this.sock.groupMetadata(chatJid);
            let pool = meta.participants;

            const mentioned = m.message?.extendedTextMessage?.contextInfo?.mentionedJid;
            if (mentioned && mentioned.length > 1) {
                pool = pool.filter((p: any) => mentioned.includes(p.id));
            } else {
                const botId = this.sock.user?.id?.split(':')[0] + '@s.whatsapp.net';
                pool = pool.filter((p: any) => p.id !== botId);
            }

            if (!pool.length) {
                await this._reply(m, '❌ Sem participantes para sortear.');
                return true;
            }

            const vencedor = pool[Math.floor(Math.random() * pool.length)];
            const num = vencedor.id.split('@')[0];
            const tag = vencedor.admin ? '👑' : '🎉';

            await this.sock.sendMessage(chatJid, {
                text:
                    `🎰 *SORTEIO AKIRA!*\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `${tag} O vencedor é:\n\n` +
                    `🎊 *@${num}* 🎊\n\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━\n` +
                    `_Participantes: ${pool.length} | Sorteado por Akira Bot_`,
                mentions: [vencedor.id]
            }, { quoted: m });

            return true;
        } catch (e: any) {
            console.error('Erro em _handleRaffle:', e);
            await this._reply(m, `❌ Erro no sorteio: ${e.message}`);
            return true;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // NOVO: DIVERSÃO (PIADAS, FRASES, FATOS)
    // ═══════════════════════════════════════════════════════════════════════

    public async _handleFun(m: any, tipo: string): Promise<boolean> {
        const piadas = [
            '😂 Por que o computador foi ao médico?\nPorque estava com vírus!',
            '😄 O que o zero disse pro oito?\nQue cinto bonito!',
            '🤣 Por que os programadores preferem o lado escuro?\nPorque no lado claro há bugs demais!',
            '😆 Por que o café foi preso?\nEle estava sendo *espresso* demais!',
            '😁 Qual é o animal mais antigo do mundo?\nA zebra — ainda está em preto e branco!',
            '🤭 Por que o livro de matemática ficou triste?\nTinha muitos problemas!',
            '😂 O que o oceano disse para a praia?\nNada, só deu uma onda!',
            '😄 Por que o smartphone foi ao psicólogo?\nTinha muitas notificações de ansiedade!',
            '🤣 Qual é o prato favorito do programador?\nBytes com ketchup!',
            '😆 Por que o Node.js foi para a escola?\nPara aprender a fazer async/await!',
        ];

        const frases = [
            '💡 *"O sucesso é a soma de pequenos esforços repetidos dia após dia."*\n— Robert Collier',
            '🌟 *"Não espere por uma crise para descobrir o que é importante em sua vida."*\n— Platão',
            '🚀 *"O único lugar onde sucesso vem antes de trabalho é no dicionário."*\n— Vidal Sassoon',
            '🎯 *"Acredite que você pode e você já está no meio do caminho."*\n— Theodore Roosevelt',
            '🔥 *"Não tenha medo de desistir do bom para ir atrás do ótimo."*\n— John D. Rockefeller',
            '💪 *"A diferença entre o possível e o impossível está na determinação."*\n— Tommy Lasorda',
            '🌈 *"Seja a mudança que você quer ver no mundo."*\n— Mahatma Gandhi',
            '⭐ *"O futuro pertence àqueles que acreditam na beleza dos seus sonhos."*\n— Eleanor Roosevelt',
            '🏆 *"Não meça seu sucesso pelas riquezas que você acumula, mas pelo bem que você faz."*\n— Anónimo',
            '🎓 *"Educação não é aprender fatos, mas treinar a mente para pensar."*\n— Albert Einstein',
        ];

        const fatos = [
            '🧠 *FATO CURIOSO:*\nOs polvos têm três corações e sangue azul!',
            '🌍 *FATO CURIOSO:*\nA Groenlândia é tecnicamente uma ilha, não um continente — mas é a maior ilha do mundo!',
            '🐘 *FATO CURIOSO:*\nOs elefantes são os únicos animais que não conseguem pular!',
            '⚡ *FATO CURIOSO:*\nOs relâmpagos são 5 vezes mais quentes que a superfície do Sol!',
            '🍌 *FATO CURIOSO:*\nBananas são tecnicamente berries, mas morangos não são!',
            '🧬 *FATO CURIOSO:*\nOs humanos compartilham 50% do DNA com as bananas!',
            '🌊 *FATO CURIOSO:*\nO oceano tem mais artefatos históricos do que todos os museus do mundo juntos!',
            '🦋 *FATO CURIOSO:*\nAs borboletas saboreiam com os pés!',
            '🌙 *FATO CURIOSO:*\nA lua se afasta da Terra cerca de 3,8 cm por ano!',
            '🐝 *FATO CURIOSO:*\nUma abelha rainha pode viver até 5 anos e produz 2.000 ovos por dia!',
        ];

        const banco = tipo === 'piada' ? piadas : tipo === 'frase' ? frases : fatos;
        const item = banco[Math.floor(Math.random() * banco.length)];

        await this._reply(m, item);
        return true;
    }

    public async _handleTTSCommand(m: any, args: string[], fullArgs: string): Promise<boolean> {
        try {
            if (!fullArgs) {
                await this._reply(m,
                    `🔊 *Como usar o TTS:*\n\n` +
                    `*#tts [idioma] texto*\n\n` +
                    `📝 _Exemplos:_\n` +
                    `• #tts olá, como você está?\n` +
                    `• #tts en hello world\n` +
                    `• #tts es hola mundo`
                );
                return true;
            }

            const idiomasValidos = ['pt', 'en', 'es', 'fr', 'de', 'it', 'ja', 'zh', 'ar'];
            let lang = 'pt-BR';
            let texto = fullArgs;

            if (args.length > 1 && idiomasValidos.includes(args[0].toLowerCase())) {
                const codigo = args[0].toLowerCase();
                const mapa: any = { pt: 'pt-BR', en: 'en-US', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', it: 'it-IT', ja: 'ja-JP', zh: 'zh-CN', ar: 'ar-SA' };
                lang = mapa[codigo] || 'pt-BR';
                texto = args.slice(1).join(' ');
            }

            if (!texto.trim()) {
                await this._reply(m, '❌ Escreva o texto que deseja converter.');
                return true;
            }

            if (texto.length > 500) {
                await this._reply(m, '❌ Texto muito longo. Máximo 500 caracteres.');
                return true;
            }

            const audioProcessor = this.bot?.audioProcessor;
            if (!audioProcessor || typeof audioProcessor.generateTTS !== 'function') {
                await this._reply(m, '❌ Serviço de TTS não disponível no momento.');
                return true;
            }

            await this.sock.sendPresenceUpdate('recording', m.key.remoteJid);
            // generateTTS já converte códigos curtos (pt, en, es) para o formato correto (pt-BR, en-US, etc)
            const result = await audioProcessor.generateTTS(texto, lang);
            await this.sock.sendPresenceUpdate('paused', m.key.remoteJid);

            if (!result?.sucesso) {
                await this._reply(m, `❌ Erro ao gerar áudio: ${result?.error || 'falha no TTS'}`);
                return true;
            }

            if (!result?.buffer || !Buffer.isBuffer(result.buffer) || result.buffer.length === 0) {
                await this._reply(m, `❌ Erro ao gerar áudio: buffer inválido.`);
                return true;
            }

            await this.sock.sendMessage(m.key.remoteJid, {
                audio: result.buffer,
                mimetype: result.mimetype || 'audio/ogg; codecs=opus',
                ptt: true,
            }, { quoted: m });

            return true;
        } catch (e: any) {
            console.error('Erro em _handleTTSCommand:', e);
            await this._reply(m, `❌ Erro no TTS: ${e.message}`);
            return true;
        }
    }
    /**
     * Handlers OSINT (Proxy para OSINTFramework)
     */

    public async _handleSetoolkit(m: any, fullArgs: string): Promise<boolean> {
        try {
            const info = `🛡️ *SOCIAL ENGINEERING TOOLKIT (SET)*\n\n` +
                `Ferramenta poderosa para testes de segurança.\n\n` +
                `📋 *Opções disponíveis:*\n` +
                `1. Phishing\n` +
                `2. Credential Harvester\n` +
                `3. Tabnabbing\n` +
                `4. Man-in-the-Middle (MITM)\n\n` +
                `⚠️ *AVISO LEGAL:* Use apenas em ambientes autorizados para teste de segurança.\n\n` +
                `💡 Acesse: https://github.com/trustedsec/social-engineer-toolkit`;

            await this._reply(m, info);
            return true;
        } catch (error: any) {
            await this._reply(m, `❌ Erro ao processar comando setoolkit: ${error.message}`);
            return true;
        }
    }

    public async _handleMetasploit(m: any, fullArgs: string): Promise<boolean> {
        try {
            const info = `⚔️ *METASPLOIT FRAMEWORK*\n\n` +
                `Framework de penetration testing mais poderoso do mundo.\n\n` +
                `🎯 *Funcionalidades principais:*\n` +
                `• Exploit Development\n` +
                `• Vulnerability Assessment\n` +
                `• Payload Generation\n` +
                `• Post-Exploitation\n` +
                `• Persistence & Lateral Movement\n\n` +
                `⚠️ *AVISO LEGAL:* Use apenas em ambientes autorizados.\n\n` +
                `📖 Documentação: https://metasploit.help/\n` +
                `💻 Repositório: https://github.com/rapid7/metasploit-framework`;

            await this._reply(m, info);
            return true;
        } catch (error: any) {
            await this._reply(m, `❌ Erro ao processar comando metasploit: ${error.message}`);
            return true;
        }
    }

    /**
     * Processa comandos de efeitos de imagem
     */
    public async _handleImageEffect(m: any, effect: string, args: string[]): Promise<boolean> {
        try {
            const quoted = m.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            const targetMessage = quoted || m.message;

            const hasImage = !!(targetMessage?.imageMessage ||
                targetMessage?.viewOnceMessage?.message?.imageMessage ||
                targetMessage?.viewOnceMessageV2?.message?.imageMessage);

            if (!hasImage) {
                await this.bot.reply(m, `💡 Responda a uma imagem com *#${effect}* para aplicar o efeito.`);
                return true;
            }

            await this._reply(m, `⏳ Aplicando efeito *${effect}*... Aguarde.`);

            // Download da imagem
            const mediaRes = await this.mediaProcessor.downloadMedia(targetMessage, 'image');

            if (!mediaRes || !mediaRes.buffer || mediaRes.buffer.length === 0) {
                await this._reply(m, '❌ Não consegui baixar a imagem. Tente novamente.');
                return true;
            }

            const imageBuffer = mediaRes.buffer;

            // Módulo de efeitos
            if (!this.imageEffects) {
                await this._reply(m, '❌ Módulo de efeitos de imagem não inicializado.');
                return true;
            }

            // Processamento
            const options: any = {};
            if (args.length > 0) options.color = args[0];

            const result = await this.imageEffects.processImage(imageBuffer, effect, options);

            if (!result.success) {
                await this._reply(m, `❌ Erro ao processar imagem: ${result.error || 'falha desconhecida'}`);
                return true;
            }

            // Envio do resultado
            await this.sock.sendMessage(m.key.remoteJid, {
                image: result.buffer,
                caption: `✅ Efeito *${effect}* aplicado com sucesso! \n_Akira Bot V21_`
            }, { quoted: m });

            return true;
        } catch (error: any) {
            console.error(`Erro no efeito de imagem ${effect}:`, error);
            await this._reply(m, `❌ Erro crítico ao processar efeito: ${error.message}`);
            return true;
        }
    }
}
export default CommandHandler;
