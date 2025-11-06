// ===============================================================
// AKIRA BOT — Baileys v6.7.8 (JSON PERFEITO + reply/menção fix)
// ===============================================================
import makeWASocket, {
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    Browsers,
    delay,
    getContentType
} from '@whiskeysockets/baileys';
import pino from 'pino';
import axios from 'axios';
import express from 'express';
import * as QRCode from 'qrcode';

// Usar pino.destination(1) para output síncrono para o console no Railway
const logger = pino({ level: 'info' }, pino.destination(1));
const AKIRA_API_URL = 'https://akra35567-akira.hf.space/api/akira';
const PORT = process.env.PORT || 8080;

let sock;
let BOT_JID = null;
let lastProcessedTime = 0;
let currentQR = null;

// Prefixos conhecidos para JID de servidor que representa o bot (Ex: 37...)
const NON_STANDARD_JID_PREFIX = '37';

// ===============================================================
// FUNÇÕES UTILITÁRIAS
// ===============================================================

/**
 * Funções de utilidade mantidas, mas a lógica de extração de JID para o "numero" 
 * será feita de forma mais direta no evento messages.upsert para garantir o JID completo.
 */
function extractNumber(input = '') {
    // Lógica original mantida para extrair APENAS o número limpo (ex: 2449xxxxxxx)
    if (!input) return 'desconhecido';
    const clean = input.toString();

    // 1. Extração de 12 dígitos (244XXXXXXXXX) se for um JID completo (2449...@s.whatsapp.net)
    const fullJidMatch = clean.match(/(\d{12})@/);
    if (fullJidMatch) return fullJidMatch[1];

    // 2. Busca o formato angolano 2449xxxxxxxxx
    const match = clean.match(/2449\d{8}/);
    if (match) return match[0];
    // 3. Busca o formato 9xxxxxxxxx e adiciona 244
    const local = clean.match(/^9\d{8}$/);
    if (local) return `244${local[0]}`;

    return clean.replace(/\D/g, '').slice(-12);
}

function normalizeJid(jid = '') {
    // Lógica original mantida.
    if (!jid) return null;
    jid = jid.toString().trim();

    // Remove o sufixo de servidor e a tag de sessão (ex: :40)
    jid = jid.replace(/@.*/, '').replace(/:\d+$/, '');

    // Se o JID for um número puro (ex: 2449...)
    if (jid.length >= 9 && jid.length <= 12) {
        if (!jid.startsWith('244') && /^9\d{8}$/.test(jid)) {
            jid = '244' + jid;
        }
        return `${jid}@s.whatsapp.net`;
    }

    // Retorna nulo se não for um JID válido ou número
    return null;
}

/**
 * Pega a parte numérica limpa de um JID para comparação (e.g., '244952786417' ou '37...').
 */
function getJidNumberPart(jid) {
    // Lógica original mantida.
    if (!jid) return '';
    jid = jid.toString().trim();

    // 1. Limpa o JID de sufixos (@s.whatsapp.net e :XX)
    const clean = jid.replace(/@.*/, '').replace(/:\d+$/, '');

    // 2. Se for o JID de servidor (37...), retorna ele mesmo.
    if (clean.startsWith(NON_STANDARD_JID_PREFIX) && clean.length > 10) {
        return clean;
    }

    // 3. Caso contrário, retorna o número de 12 dígitos.
    const extracted = extractNumber(clean);
    return extracted.length === 12 ? extracted : '';
}

/**
 * Função utilitária para extrair texto de diferentes tipos de mensagens (texto ou legenda).
 */
function getMessageText(message) {
    const messageType = getContentType(message);

    switch (messageType) {
        case 'conversation':
            return message.conversation;
        case 'extendedTextMessage':
            return message.extendedTextMessage.text;
        case 'imageMessage':
        case 'videoMessage':
            return message[messageType].caption || '';
        case 'stickerMessage':
            return 'Sticker (figurinha)';
        case 'templateButtonReplyMessage':
            return message.templateButtonReplyMessage.selectedDisplayText;
        case 'listResponseMessage':
            return message.listResponseMessage.title;
        case 'buttonsResponseMessage':
            return message.buttonsResponseMessage.selectedDisplayText;
        default:
            return '';
    }
}

// ===============================================================
// ATIVAÇÃO CORRIGIDA (AGORA RECONHECE JID 37... e Limpa JID)
// ===============================================================
function isBotJid(jid) {
    // Lógica original mantida.
    if (!BOT_JID) {
        logger.warn('BOT_JID não está definido ao verificar isBotJid.');
        return false;
    }

    // JID do bot limpo (apenas o número de 12 dígitos)
    const botNumberClean = getJidNumberPart(BOT_JID);
    // JID que está a ser verificado (o quoted JID, que pode ser 244... ou 37...)
    const checkNumberPart = getJidNumberPart(jid);

    logger.info(`[DEBUG:isBotJid] Bot Part: ${botNumberClean} | Check Part: ${checkNumberPart} | Original JID: ${jid}`);

    // CHECK 1: O número limpo do Bot coincide com o JID a verificar?
    if (botNumberClean === checkNumberPart) {
        logger.info('[DEBUG:isBotJid] MATCH: Número real coincide.');
        return true;
    }

    // CHECK 2 (FALLBACK): O JID a verificar é o JID de servidor (37...)?
    if (checkNumberPart.startsWith(NON_STANDARD_JID_PREFIX) && checkNumberPart.length > 10) {
        logger.info(`[DEBUG:isBotJid] MATCH: Fallback JID de servidor (${checkNumberPart}) coincide.`);
        return true;
    }

    logger.info('[DEBUG:isBotJid] FAIL: Nenhuma correspondência.');
    return false;
}

async function shouldActivate(msg, isGroup, text, quotedSenderJid, mensagemCitada) {
    // Lógica original mantida.
    const context = msg.message?.extendedTextMessage?.contextInfo ||
        msg.message?.imageMessage?.contextInfo ||
        msg.message?.videoMessage?.contextInfo;

    const lowered = text.toLowerCase();

    let activationReason = 'NÃO ATIVADO';

    // 1. Ativa se for Reply direto ao bot
    if (quotedSenderJid) {
        if (isBotJid(quotedSenderJid)) {
            activationReason = `REPLY ao JID: ${quotedSenderJid}`;
        }
    }

    // 2. Lógica para Grupos
    if (isGroup && activationReason === 'NÃO ATIVADO') {
        const mentions = context?.mentionedJid || [];
        const mentionMatch = mentions.some(j => isBotJid(j));

        // Ativa se mencionar o bot
        if (mentionMatch) {
            activationReason = 'MENÇÃO direta';
        }
        // Ativa se a mensagem contiver "akira"
        else if (lowered.includes('akira')) {
            activationReason = 'PALAVRA-CHAVE "akira"';
        }
    }

    // 3. Ativa sempre em chat privado
    if (!isGroup && activationReason === 'NÃO ATIVADO') {
        activationReason = 'CHAT PRIVADO';
    }

    const activate = activationReason !== 'NÃO ATIVADO';

    // LOG DE DEBUG DO REPLY
    if (quotedSenderJid) {
        logger.info(`[DEBUG:REPLY] JID citado: ${quotedSenderJid} | Mensagem citada: "${mensagemCitada.substring(0, 30)}..." | Reconhecido como Bot: ${isBotJid(quotedSenderJid)}`);
    }

    logger.info(`[ATIVAR] ${activate ? 'SIM' : 'NÃO'} | Motivo: ${activationReason} | De: ${msg.pushName} (${extractNumber(msg.key.remoteJid)}) | Mensagem: "${text.substring(0, 50)}..."`);

    return activate;
}


// ===============================================================
// CONEXÃO
// ===============================================================
async function connect() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    if (sock && sock.user) {
        logger.info('Fechando sessão antiga...');
        await sock.logout();
    }

    sock = makeWASocket({
        version,
        auth: state,
        logger,
        browser: Browsers.macOS('Desktop'),
        markOnlineOnConnect: true,
        syncFullHistory: false,
        connectTimeoutMs: 60000
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            currentQR = qr;
            console.clear();
            logger.info('ESCANEIE O QR PARA CONECTAR');
        }
        if (connection === 'open') {
            // Normaliza o JID do bot, garantindo que seja 244952786417@s.whatsapp.net
            BOT_JID = normalizeJid(sock.user.id);
            logger.info('AKIRA BOT ONLINE!');
            logger.info(`BOT_JID detectado (Normalizado): ${BOT_JID}`);
            lastProcessedTime = Date.now();
            currentQR = null;
        }
        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            logger.error(`Conexão perdida (reason: ${reason}). Reconectando em 5s...`);
            setTimeout(connect, 5000);
        }
    });

    // ===============================================================
    // EVENTO DE MENSAGEM
    // ===============================================================
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;
        const from = msg.key.remoteJid;
        const isGroup = from.endsWith('@g.us');
        if (msg.messageTimestamp && msg.messageTimestamp * 1000 < lastProcessedTime - 10000) return;

        // **RETIFICAÇÃO CRUCIAL (1): Extração do JID COMPLETO para o 'numero'**
        // O JID do remetente (chave de contexto na api.py) é:
        // - msg.key.participant para grupos (quem realmente falou)
        // - msg.key.remoteJid para chats privados
        const senderJid = msg.key.participant || msg.key.remoteJid;
        // JID COMPLETO (ex: 2449xxxxxxx@whatsapp.net)
        const numeroContexto = senderJid; 
        // Número limpo para uso em log e nome
        const numeroExtraido = extractNumber(senderJid); 

        const nome = msg.pushName || numeroExtraido;
        const contextInfo = msg.message?.extendedTextMessage?.contextInfo ||
            msg.message?.imageMessage?.contextInfo ||
            msg.message?.videoMessage?.contextInfo ||
            msg.message?.stickerMessage?.contextInfo ||
            msg.message?.listResponseMessage?.contextInfo; // Adicionar outros tipos que podem ter contextInfo

        // ===== EXTRAÇÃO DO TEXTO DA MENSAGEM ATUAL =====
        const text = getMessageText(msg.message);

        // ===== EXTRAÇÃO DA MENSAGEM CITADA (REPLY) =====
        let mensagemCitada = '';
        let quotedSenderJid = null; // JID de quem enviou a mensagem citada

        if (contextInfo?.quotedMessage) {
            const quoted = contextInfo.quotedMessage;
            // O JID do remetente citado está em contextInfo.participant
            quotedSenderJid = contextInfo.participant;

            // **RETIFICAÇÃO CRUCIAL (2): Extração perfeita da mensagem citada**
            mensagemCitada = getMessageText(quoted) || '';
            
            // Se a mensagem atual estiver vazia (apenas citou), garantimos que 'text' tenha um valor
            if (!text.trim() && mensagemCitada.trim()) {
                // A API precisa de algo em 'mensagem' para processar o comando
                // A mensagem citada será o foco da resposta, mas precisamos de 'text'
                // Se o usuário apenas citou e não escreveu, definimos 'text' para a própria mensagem citada
                // ou um marcador, mas para simplificar, a API vai processar a citada.
            }
        }
        // ==============================================================

        // Se não houver texto atual E não houver mensagem citada, ignora.
        if (!text.trim() && !mensagemCitada.trim()) return;
        
        // Se houver mensagem citada, mas não houver texto atual, passamos um 'vazio' para a mensagem atual
        const mensagemAtual = text.trim() || ' '; 
        

        const ativar = await shouldActivate(msg, isGroup, mensagemAtual, quotedSenderJid, mensagemCitada);
        if (!ativar) return;

        // ===== SIMULAÇÃO DE LEITURA (VISTO - DOIS TICKS AZUIS) =====
        try {
            await sock.readMessages([msg.key]);
            // O sendReceipt é mais robusto para marcar como lida em grupos
            await sock.sendReceipt(from, msg.key.participant, ['read']);
        } catch (e) {
            logger.warn('Falha ao enviar visto/read receipt.');
        }
        // ==========================================================

        await sock.sendPresenceUpdate('composing', from);

        try {
            // ENVIO JSON PERFEITO!
            const apiPayload = {
                usuario: nome,
                mensagem: mensagemAtual,
                // **RETIFICAÇÃO CRUCIAL (1): Usar o JID COMPLETO como 'numero'**
                numero: numeroContexto, 
                // **RETIFICAÇÃO CRUCIAL (2): Enviar a mensagem citada para contextualizar reply**
                mensagem_citada: mensagemCitada 
            };
            
            logger.info(`[PAYLOAD] Usuario: ${apiPayload.usuario} | Numero: ${apiPayload.numero} | Reply: ${!!apiPayload.mensagem_citada}`);

            const res = await axios.post(AKIRA_API_URL, apiPayload, {
                headers: {
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            });

            const resposta = res.data?.resposta || '...';
            logger.info(`[RESPOSTA API] ${resposta}`);

            await delay(Math.min(resposta.length * 50, 4000));
            await sock.sendPresenceUpdate('paused', from);

            await sock.sendMessage(from, { text: resposta }, { quoted: msg });

            // LOG DE MENSAGEM ENVIADA
            logger.info(`[AKIRA ENVIADA] Resposta enviada com sucesso para ${nome} em ${from}.`);


        } catch (err) {
            logger.error(`Erro na API: ${err.message}`);
            await sock.sendMessage(from, { text: 'Erro interno. Tenta depois.' }, { quoted: msg });
        }
    });

    sock.ev.on('message-decrypt-failed', async (msgKey) => {
        try {
            await sock.sendRetryRequest(msgKey.key);
        } catch (e) {}
    });
}

// ===============================================================
// EXPRESS SERVER (Health + QR)
// ===============================================================
const app = express();
app.get("/", (_, res) => {
    res.send(`
        <html><body style="font-family:sans-serif;text-align:center;margin-top:10%;">
            <h2>Akira Bot está online!</h2>
            <p>Acesse <a href="/qr">/qr</a> para escanear o QR Code.</p>
        </body></html>
    `);
});

app.get("/qr", async (_, res) => {
    if (!currentQR) {
        res.send(`<h2>Já conectado!</h2>`);
    } else {
        try {
            const qrBase64 = await QRCode.toDataURL(currentQR);
            res.send(`
                <html><head><meta http-equiv="refresh" content="10"></head>
                <body style="text-align:center;">
                    <h2>Escaneie o QR</h2>
                    <img src="${qrBase64}" />
                    <p>Atualiza em 10s...</p>
                </body></html>
            `);
        } catch (err) {
            res.status(500).send(`Erro: ${err.message}`);
        }
    }
});

app.listen(PORT, "0.0.0.0", () => {
    logger.info(`Servidor na porta ${PORT}`);
    logger.info(`Acesse: http://localhost:${PORT}/qr`);
});

connect();
