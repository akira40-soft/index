/**
 * ═══════════════════════════════════════════════════════════════════════
 * CLASSE: MessageProcessor
 * ═══════════════════════════════════════════════════════════════════════
 * Processamento inteligente de mensagens: análise, detecção de reply, contexto
 * Extração de informações de grupos e usuários
 * ═══════════════════════════════════════════════════════════════════════
 */

import { getContentType } from '@whiskeysockets/baileys';
import ConfigManager from './ConfigManager.js';

let parsePhoneNumberFromString: any = null;
try {
    // optional modern phone parsing if available
    const libphonenumber = await import('libphonenumber-js');
    parsePhoneNumberFromString = libphonenumber.parsePhoneNumberFromString;
} catch (e) {
    // lib not installed — graceful fallback to simple digit extraction
}

class MessageProcessor {
    public config: any;
    public logger: any;
    public rateLimitMap: Map<string, number[]> = new Map();

    constructor(logger: any = null) {
        this.config = ConfigManager.getInstance();
        this.logger = logger || console;
    }

    /**
    * Extrai o JID real do participante (limpo de sufixos de dispositivo)
    * Garantindo funcionamento em grupos no Railway
    */
    extractParticipantJid(message: any): string {
        try {
            const remoteJid = message.key?.remoteJid || '';
            const isGroup = String(remoteJid).endsWith('@g.us');

            // Em grupos, o sender está em participant. Em PV, é o próprio remoteJid
            const participant = isGroup
                ? (message.key?.participant || message.participant)
                : remoteJid;

            if (!participant) return '';

            const jidStr = String(participant);
            // Remove sufixos de dispositivo (:1, :2) mantendo o domínio @s.whatsapp.net ou @lid
            const [userPart, domainPart] = jidStr.split('@');
            if (!userPart || !domainPart) return jidStr;

            const cleanUser = userPart.split(':')[0];
            return `${cleanUser}@${domainPart}`;
        } catch (e: any) {
            this.logger?.error('Erro ao extrair JID real:', e.message);
            return '';
        }
    }

    /**
    * Extrai número real do usuário
    */
    extractUserNumber(message: any) {
        try {
            return 'desconhecido';

        } catch (e: any) {
            this.logger?.error('Erro ao extrair número:', e.message);
            return 'desconhecido';
        }
    }

    /**
    * Extrai texto de mensagem
    */
    extractText(message: any) {
        try {
            const tipo = getContentType(message.message);
            if (!tipo) return '';

            let msg = message.message;

            // Suporte a viewOnceMessage (aninhada)
            if (tipo === 'viewOnceMessage' || tipo === 'viewOnceMessageV2') {
                msg = msg[tipo].message;
                const subTipo = getContentType(msg);
                if (!subTipo) return '';

                switch (subTipo) {
                    case 'imageMessage': return msg.imageMessage.caption || '';
                    case 'videoMessage': return msg.videoMessage.caption || '';
                    default: return '';
                }
            }

            switch (tipo) {
                case 'conversation':
                    return msg.conversation || '';
                case 'extendedTextMessage':
                    return (msg.extendedTextMessage && msg.extendedTextMessage.text) || '';
                case 'imageMessage':
                    return (msg.imageMessage && msg.imageMessage.caption) || '';
                case 'videoMessage':
                    return (msg.videoMessage && msg.videoMessage.caption) || '';
                case 'audioMessage':
                    return '[mensagem de voz]';
                case 'stickerMessage':
                    return '[figurinha]';
                case 'documentMessage':
                    return (msg.documentMessage && msg.documentMessage.caption) || '[documento]';
                default:
                    return '';
            }
        } catch (e: any) {
            return '';
        }
    }

    /**
    * Detecta tipo de conversa (PV ou Grupo)
    */
    getConversationType(message: any): 'grupo' | 'pv' {
        const remoteJid = message.key?.remoteJid || '';
        return String(remoteJid).endsWith('@g.us') ? 'grupo' : 'pv';
    }

    /**
    * Extrai hint de contexto baseado no texto citado e mensagem atual
    * Adaptado de reply_context_handler.py
    */
    extractContextHint(quotedText: string, mensagemAtual: string): string {
        const hints = [];
        const quotedLower = (quotedText || '').toLowerCase();
        const mensagemLower = (mensagemAtual || '').toLowerCase();

        // Detecta tipo de reply
        if (quotedLower.includes('akira') || quotedLower.includes('bot') ||
            quotedLower.includes('você') || quotedLower.includes('vc') || quotedLower.includes('tu')) {
            hints.push('pergunta_sobre_akira');
        }

        // Pergunta factual
        if (quotedLower.match(/\b(oq|o que|qual|quanto|onde|quando|como|quem|por que|pq)\b/)) {
            hints.push('pergunta_factual');
        }

        // Ironia/deboche detectado
        if (quotedLower.match(/(kkk|haha|😂|🤣|eita|lol|mdr)/)) {
            hints.push('tom_irreverente');
        }

        // Expressão de opinião
        if (quotedLower.match(/\b(acho|penso|creio|imagino|acredito)\b/)) {
            hints.push('expressao_opiniao');
        }

        // Pergunta curta detectada
        const wordCount = mensagemAtual ? mensagemAtual.split(/\s+/).length : 0;
        const hasQuestion = mensagemLower.includes('?') ||
            mensagemLower.match(/\b(qual|quais|quem|como|onde|quando|por que|pq|oq)\b/);
        if (wordCount <= 5 && hasQuestion) {
            hints.push('pergunta_curta');
        }

        return hints.join(' | ') || 'contexto_geral';
    }

    /**
    * Calcula nível de prioridade do reply
    * Adaptado de reply_context_handler.py
    * Returns: 1=normal, 2=reply, 3=reply_to_bot, 4=reply_to_bot_short_question
    */
    calculateReplyPriority(isReply: boolean, replyToBot: boolean, mensagemAtual: string): number {
        const PRIORITY_NORMAL = 1;
        const PRIORITY_REPLY = 2;
        const PRIORITY_REPLY_TO_BOT = 3;
        const PRIORITY_REPLY_TO_BOT_SHORT_QUESTION = 4;
        const PERGUNTA_CURTA_LIMITE = 5;

        if (!isReply) return PRIORITY_NORMAL;

        // Reply para o bot
        if (replyToBot) {
            const wordCount = mensagemAtual ? mensagemAtual.split(/\s+/).length : 0;
            const hasQuestion = mensagemAtual && (
                mensagemAtual.includes('?') ||
                mensagemAtual.toLowerCase().match(/\b(qual|quais|quem|como|onde|quando|por que|pq|oq|o que)\b/)
            );

            // Pergunta curta = prioridade máxima
            if (wordCount <= PERGUNTA_CURTA_LIMITE && hasQuestion) {
                return PRIORITY_REPLY_TO_BOT_SHORT_QUESTION;
            }
            return PRIORITY_REPLY_TO_BOT;
        }

        // Reply normal
        return PRIORITY_REPLY;
    }

    /**
    * Extrai informações de reply
    * Enhanced version adapted from akira's reply_context_handler.py
    */
    extractReplyInfo(message: any): any {
        try {
            const context = message.message?.extendedTextMessage?.contextInfo;
            if (!context || !context.quotedMessage) return null;

            const quoted = context.quotedMessage;
            const tipo = getContentType(quoted);

            // Extrai texto da mensagem citada
            let textoMensagemCitada = '';
            let tipoMidia = 'texto';
            let quotedTextOriginal = '';

            if (tipo === 'conversation') {
                quotedTextOriginal = quoted.conversation || '';
                textoMensagemCitada = quotedTextOriginal;
                tipoMidia = 'texto';
            } else if (tipo === 'extendedTextMessage') {
                quotedTextOriginal = quoted.extendedTextMessage?.text || '';
                textoMensagemCitada = quotedTextOriginal;
                tipoMidia = 'texto';
            } else if (tipo === 'imageMessage') {
                quotedTextOriginal = quoted.imageMessage?.caption || '';
                textoMensagemCitada = (quotedTextOriginal ? quotedTextOriginal + ' ' : '') + '[imagem enviada]';
                tipoMidia = 'imagem';
            } else if (tipo === 'videoMessage') {
                quotedTextOriginal = quoted.videoMessage?.caption || '';
                textoMensagemCitada = (quotedTextOriginal ? quotedTextOriginal + ' ' : '') + '[vídeo enviado]';
                tipoMidia = 'video';
            } else if (tipo === 'audioMessage') {
                quotedTextOriginal = '[áudio]';
                textoMensagemCitada = '[mensagem de áudio]';
                tipoMidia = 'audio';
            } else if (tipo === 'stickerMessage') {
                quotedTextOriginal = '[figurinha]';
                textoMensagemCitada = '[figurinha enviada]';
                tipoMidia = 'sticker';
            } else if (tipo === 'documentMessage') {
                quotedTextOriginal = (quoted.documentMessage && quoted.documentMessage.caption) || '';
                textoMensagemCitada = (quotedTextOriginal ? quotedTextOriginal + ' ' : '') + '[documento enviado]';
                tipoMidia = 'documento';
            } else {
                quotedTextOriginal = '[conteúdo]';
                textoMensagemCitada = '[conteúdo de mídia]';
                tipoMidia = 'outro';
            }

            // Try to get participant from context or from quoted message key
            let participantJidCitado = context.participant || context.remoteJid || null;

            // Em PV, não há participant explícito às vezes. 
            // Se for resposta ao bot, inferimos
            if (!participantJidCitado) {
                const isPV = !String(message.key?.remoteJid || '').endsWith('@g.us');
                if (isPV) {
                    // Se a mensagem citada veio de nós (bot), o autor é o bot
                    if (context.fromMe) {
                        participantJidCitado = `${this.config.BOT_NUMERO_REAL}@s.whatsapp.net`;
                    } else {
                        // Senão é a pessoa com quem estamos a falar
                        participantJidCitado = message.key.remoteJid;
                    }
                }
            }

            // Extract author number and name if available (name limited at API layer)
            let quotedAuthorNumero = 'desconhecido';
            if (participantJidCitado) {
                quotedAuthorNumero = this.extractUserNumber({ key: { participant: participantJidCitado } });
            }

            // Check if reply is to bot
            const ehRespostaAoBot = this.isReplyToBot(participantJidCitado);

            // ═══════════════════════════════════════════════════════════════════
            // DETECÇÃO DE REPLY A MENSAGEM DE JOGO
            // Verifica se a mensagem citada é uma mensagem de jogo do bot
            // ═══════════════════════════════════════════════════════════════════
            const isGameReply = this.detectGameMessage(quotedTextOriginal, textoMensagemCitada);

            // Texto atual para hints e prioridade
            const currentMessageText = this.extractText(message);
            const contextHint = this.extractContextHint(quotedTextOriginal, currentMessageText);
            const priorityLevel = this.calculateReplyPriority(true, ehRespostaAoBot, currentMessageText);

            // Construção no formato esperado por CommandHandler/GroupManagement e API
            return {
                // Compatível com GroupManagement._extractTargets
                quemEscreveuCitacaoJid: participantJidCitado,

                // Compatível com CommandHandler (uso geral)
                textoMensagemCitada, // texto completo amigável
                tipoMidiaCitada: tipoMidia,
                textoCitadoResumido: quotedTextOriginal,

                // Metadados
                participantJidCitado,
                ehRespostaAoBot,
                quemEscreveuCitacao: quotedAuthorNumero,
                quemEscreveuCitacaoName: context.pushName || 'Usuário',
                quotedAuthorNumero: quotedAuthorNumero,
                quotedType: tipoMidia,
                quotedTextOriginal: quotedTextOriginal,
                contextHint: contextHint,
                priorityLevel: priorityLevel,
                isReply: true,
                // Novas propriedades para detecção de jogos
                isReplyToGame: isGameReply.isGame,
                gameType: isGameReply.gameType
            };

        } catch (e: any) {
            this.logger?.error('Erro ao extrair reply info:', e.message);
            return null;
        }
    }

    /**
    * Verifica se a mensagem é direcionada à Akira
    */
    isDirectedToBot(message: any): boolean {
        try {
            const isGroup = this.getConversationType(message) === 'grupo';

            // Em PV, tudo é direcionado ao bot
            if (!isGroup) return true;

            const text = this.extractText(message);

            // 1. É um comando (prefixo)
            if (this.isCommand(text)) return true;

            // 2. Bot foi mencionado
            if (this.isBotMentioned(message)) return true;

            // 3. É uma resposta ao bot
            const replyInfo = this.extractReplyInfo(message);
            if (replyInfo && replyInfo.ehRespostaAoBot) return true;

            return false;
        } catch (e: any) {
            return false;
        }
    }

    /**
    * Detecta se a mensagem citada é uma mensagem de jogo
    * Retorna o tipo de jogo se for uma mensagem de jogo
    */
    detectGameMessage(quotedText: string, fullQuotedText: string): { isGame: boolean; gameType: string | null } {
        const text = (quotedText || '').toLowerCase();
        const fullText = (fullQuotedText || '').toLowerCase();

        // Padrões de mensagem de Jogo da Velha
        const tttPatterns = [
            'jogo da velha',
            'tic-tac-toe',
            'ttt',
            'jogodavelha',
            'vez de:',
            'sua vez',
            'vez do',
            'jogou na posição',
            'tabuleiro'
        ];

        // Padrões de mensagem de Grid Tactics
        const gridPatterns = [
            'grid tactics',
            'grid tactics -',
            'posição (ex:',
            'gridtactics'
        ];

        // Padrões de mensagem de Pedra, Papel, Tesoura
        const rpsPatterns = [
            'pedra, papel, tesoura',
            'rps',
            'escolha:',
            'escolheu!'
        ];

        // Padrões de mensagem de Advinha o Número
        const guessPatterns = [
            'advinha o número',
            'advinhe o número',
            'tentativas:',
            'número é'
        ];

        // Padrões de mensagem de Forca
        const hangmanPatterns = [
            'jogo da forca',
            'hangman',
            'forca',
            'letras usadas',
            'palavra:'
        ];

        // Verifica padrões de jogo
        for (const pattern of tttPatterns) {
            if (text.includes(pattern.toLowerCase()) || fullText.includes(pattern.toLowerCase())) {
                return { isGame: true, gameType: 'ttt' };
            }
        }

        for (const pattern of gridPatterns) {
            if (text.includes(pattern.toLowerCase()) || fullText.includes(pattern.toLowerCase())) {
                return { isGame: true, gameType: 'grid' };
            }
        }

        for (const pattern of rpsPatterns) {
            if (text.includes(pattern.toLowerCase()) || fullText.includes(pattern.toLowerCase())) {
                return { isGame: true, gameType: 'rps' };
            }
        }

        for (const pattern of guessPatterns) {
            if (text.includes(pattern.toLowerCase()) || fullText.includes(pattern.toLowerCase())) {
                return { isGame: true, gameType: 'guess' };
            }
        }

        for (const pattern of hangmanPatterns) {
            if (text.includes(pattern.toLowerCase()) || fullText.includes(pattern.toLowerCase())) {
                return { isGame: true, gameType: 'hangman' };
            }
        }

        return { isGame: false, gameType: null };
    }

    /**
    * Verifica se é reply ao bot
    */
    isReplyToBot(jid: string | null | undefined): boolean {
        if (!jid) return false;

        const jidStr = String(jid).toLowerCase();
        const jidNumero = jidStr.split('@')[0].split(':')[0];
        const botNumero = String(this.config.BOT_NUMERO_REAL).toLowerCase();

        return jidNumero === botNumero || jidStr.includes(botNumero);
    }

    /**
    * Detecta se tem áudio
    */
    hasAudio(message: any): boolean {
        try {
            const tipo = getContentType(message.message);
            if (tipo === 'audioMessage') return true;

            if (tipo === 'viewOnceMessage' || tipo === 'viewOnceMessageV2') {
                const subMsg = message.message[tipo].message;
                return getContentType(subMsg) === 'audioMessage';
            }
            return false;
        } catch (e: any) {
            return false;
        }
    }

    /**
    * Detecta se tem imagem
    */
    hasImage(message: any): boolean {
        try {
            const tipo = getContentType(message.message);
            if (tipo === 'imageMessage') return true;

            if (tipo === 'viewOnceMessage' || tipo === 'viewOnceMessageV2') {
                const subMsg = message.message[tipo].message;
                return getContentType(subMsg) === 'imageMessage';
            }
            return false;
        } catch (e: any) {
            return false;
        }
    }

    /**
    * Detecta se tem vídeo
    */
    hasVideo(message: any): boolean {
        try {
            const tipo = getContentType(message.message);
            if (tipo === 'videoMessage') return true;

            if (tipo === 'viewOnceMessage' || tipo === 'viewOnceMessageV2') {
                const subMsg = message.message[tipo].message;
                return getContentType(subMsg) === 'videoMessage';
            }
            return false;
        } catch (e: any) {
            return false;
        }
    }


    /**
    * Detecta se tem documento
    */
    hasDocument(message: any): boolean {
        try {
            const tipo = getContentType(message.message);
            return tipo === 'documentMessage' || tipo === 'documentWithCaptionMessage';
        } catch (e: any) {
            return false;
        }
    }

    /**
    * Detecta tipo de mídia
    */
    getMediaType(message: any): string {
        try {
            const tipo = getContentType(message.message);

            const mimeMap: { [key: string]: string } = {
                'imageMessage': 'imagem',
                'videoMessage': 'video',
                'audioMessage': 'audio',
                'stickerMessage': 'sticker',
                'documentMessage': 'documento'
            };

            return mimeMap[tipo] || 'texto';
        } catch (e: any) {
            return 'texto';
        }
    }

    /**
    * Verifica se é menção do bot
    */
    isBotMentioned(message: any): boolean {
        try {
            const mentions = message.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
            return mentions.some((jid: string) => this.isReplyToBot(jid));
        } catch (e: any) {
            return false;
        }
    }

    /**
    * Extrai menções
    */
    extractMentions(message: any): string[] {
        try {
            return message.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        } catch (e: any) {
            return [];
        }
    }

    /**
    * Verifica se é comando
    */
    isCommand(text: string | null | undefined): boolean {
        if (!text) return false;
        const prefix = this.config.PREFIXO || '*';
        return text.trim().startsWith(prefix);
    }

    parseCommand(text: string | null | undefined): any {
        if (!this.isCommand(text)) return null;

        const prefix = this.config.PREFIXO || '*';
        const args = text.trim().slice(prefix.length).trim().split(/ +/);
        const comando = args.shift().toLowerCase();

        return {
            comando,
            args,
            textoCompleto: args.join(' ')
        };
    }

    /**
    * Valida taxa de requisições
    */
    checkRateLimit(userId: string, windowSeconds: number | null = null, maxCalls: number | null = null): boolean {
        const window = windowSeconds || this.config.RATE_LIMIT_WINDOW;
        const max = maxCalls || this.config.RATE_LIMIT_MAX_CALLS;

        if (!this.rateLimitMap) {
            this.rateLimitMap = new Map();
        }

        const now = Date.now();
        const rec = this.rateLimitMap.get(userId) || [];
        const filtered = rec.filter(t => (now - t) < window * 1000);

        if (filtered.length >= max) {
            return false;
        }

        filtered.push(now);
        this.rateLimitMap.set(userId, filtered);
        return true;
    }

    /**
    * Sanitiza texto para segurança
    */
    sanitizeText(text: string | null | undefined, maxLength: number = 2000): string {
        if (!text) return '';

        let sanitized = String(text)
            .trim()
            .substring(0, maxLength);

        // Remove caracteres de controle perigosos
        sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

        return sanitized;
    }

    /**
    * Limpa cache
    */
    clearCache() {
        if (this.rateLimitMap) {
            this.rateLimitMap.clear();
        }
        this.logger?.info('💾 Cache de processamento limpo');
    }

    /**
    * Retorna estatísticas
    */
    getStats() {
        return {
            rateLimitEntries: (this.rateLimitMap && this.rateLimitMap.size) || 0,
            prefixo: this.config.PREFIXO
        };
    }

    public getGroupMetadata(jid: string): any {
        return this.config.groups?.[jid] || {};
    }
}

export default MessageProcessor;
