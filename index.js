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

// ===============================================================
// CONFIGURAÇÕES
// ===============================================================

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

function extractNumber(input = '') {
    if (!input) return 'desconhecido';
    const clean = input.toString();

    // 1. Extração de 12 dígitos (244XXXXXXXXX)
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
    if (!jid) return null;
    jid = jid.toString().trim();
    jid = jid.replace(/@.*/, '').replace(/:\d+$/, '');

    if (jid.length >= 9 && jid.length <= 12) {
        if (!jid.startsWith('244') && /^9\d{8}$/.test(jid)) {
            jid = '244' + jid;
        }
        return `${jid}@s.whatsapp.net`;
    }

    return null;
}

function getJidNumberPart(jid) {
    if (!jid) return '';
    jid = jid.toString().trim();
    const clean = jid.replace(/@.*/, '').replace(/:\d+$/, '');

    if (clean.startsWith(NON_STANDARD_JID_PREFIX) && clean.length > 10) {
        return clean;
    }

    const extracted = extractNumber(clean);
    return extracted.length === 12 ? extracted : '';
}

function getMessageText(message) {
    const messageType = getContentType(message);

    switch (messageType) {
        case 'conversation': return message.conversation;
        case 'extendedTextMessage': return message.extendedTextMessage.text;
        case 'imageMessage':
        case 'videoMessage':
            return message[messageType].caption || '';
        case 'stickerMessage': return 'Sticker (figurinha)';
        case 'templateButtonReplyMessage': return message.templateButtonReplyMessage.selectedDisplayText;
        case 'listResponseMessage': return message.listResponseMessage.title;
        case 'buttonsResponseMessage': return message.buttonsResponseMessage.selectedDisplayText;
        default: return '';
    }
}

function isBotJid(jid) {
    if (!BOT_JID) {
        logger.warn('BOT_JID não está definido ao verificar isBotJid.');
        return false;
    }

    const botNumberClean = getJidNumberPart(BOT_JID);
    const checkNumberPart = getJidNumberPart(jid);

    logger.info(`[DEBUG:isBotJid] Bot Part: ${botNumberClean} | Check Part: ${checkNumberPart} | Original JID: ${jid}`);

    if (botNumberClean === checkNumberPart) {
        logger.info('[DEBUG:isBotJid] MATCH: Número real coincide.');
        return true;
    }

    if (checkNumberPart.startsWith(NON_STANDARD_JID_PREFIX) && checkNumberPart.length > 10) {
        logger.info(`[DEBUG:isBotJid] MATCH: Fallback JID de servidor (${checkNumberPart}) coincide.`);
        return true;
    }

    logger.info('[DEBUG:isBotJid] FAIL: Nenhuma correspondência.');
    return false;
}

async function shouldActivate(msg, isGroup, text, quotedSenderJid, mensagemCitada) {
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

        if (mentionMatch) {
            activationReason = 'MENÇÃO direta';
        } else if (lowered.includes('akira')) {
            activationReason = 'PALAVRA-CHAVE "akira"';
        }
    }

    // 3. Ativa sempre em chat privado
    if (!isGroup && activationReason === 'NÃO ATIVADO') {
        activationReason = 'CHAT PRIVADO';
    }

    const activate = activationReason !== 'NÃO ATIVADO';

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

        const senderJid = msg.key.participant || msg.key.remoteJid;
        const numeroContexto = senderJid;
        const numeroExtraido = extractNumber(senderJid);
        const nome = msg.pushName || numeroExtraido;

        const contextInfo = msg.message?.extendedTextMessage?.contextInfo ||
                            msg.message?.imageMessage?.contextInfo ||
                            msg.message?.videoMessage?.contextInfo ||
                            msg.message?.stickerMessage?.contextInfo ||
                            msg.message?.listResponseMessage?.contextInfo;

        const text = getMessageText(msg.message);

        let mensagemCitada = '';
        let quotedSenderJid = null;

        if (contextInfo?.quotedMessage) {
            const quoted = contextInfo.quotedMessage;
            quotedSenderJid = contextInfo.participant;
            mensagemCitada = getMessageText(quoted) || '';
        }

        if (!text.trim() && !mensagemCitada.trim()) return;

        const mensagemAtual = text.trim() || ' ';
        const ativar = await shouldActivate(msg, isGroup, mensagemAtual, quotedSenderJid, mensagemCitada);
        if (!ativar) return;

        // Simulação de leitura
        try {
            await sock.readMessages([msg.key]);
            await sock.sendReceipt(from, msg.key.participant, ['read']);
        } catch (e) {
            logger.warn('Falha ao enviar visto/read receipt.');
        }

        await sock.sendPresenceUpdate('composing', from);

        try {
            const apiPayload = {
                usuario: nome,
                mensagem: mensagemAtual,
                numero: numeroContexto,
                mensagem_citada: mensagemCitada
            };

            logger.info(`[PAYLOAD] Usuario: ${apiPayload.usuario} | Numero: ${apiPayload.numero} | Reply: ${!!apiPayload.mensagem_citada}`);

            const res = await axios.post(AKIRA_API_URL, apiPayload, {
                headers: { 'Content-Type': 'application/json' },
                timeout: 300000
            });

            const resposta = res.data?.resposta || '...';
            logger.info(`[RESPOSTA API] ${resposta}`);

            await delay(Math.min(resposta.length * 50, 4000));
            await sock.sendPresenceUpdate('paused', from);
            await sock.sendMessage(from, { text: resposta }, { quoted: msg });

            logger.info(`[AKIRA ENVIADA] Resposta enviada com sucesso para ${nome} em ${from}.`);
        } catch (err) {
            logger.error(`Erro na API: ${err.message}`);
            await sock.sendMessage(from, { text: 'Erro interno. Tenta depois.' }, { quoted: msg });
        }
    });

    sock.ev.on('message-decrypt-failed', async (msgKey) => {
        try { await sock.sendRetryRequest(msgKey.key); } catch (e) {}
    });
}

// ===============================================================
// EXPRESS SERVER (Health + QR)
// ===============================================================

const app = express();

app.get("/", (_, res) => {
    res.send(`
        <html>
        <body style="font-family:sans-serif;text-align:center;margin-top:10%;">
            <h2>Akira Bot está online!</h2>
            <p>Acesse <a href="/qr">/qr</a> para escanear o QR Code.</p>
        </body>
        </html>
    `);
});

app.get("/qr", async (_, res) => {
    if (!currentQR) {
        res.send(`<h2>Já conectado!</h2>`);
    } else {
        try {
            const qrBase64 = await QRCode.toDataURL(currentQR);
            res.send(`
                <html>
                <head><meta http-equiv="refresh" content="10"></head>
                <body style="text-align:center;">
                    <h2>Escaneie o QR</h2>
                    <img src="${qrBase64}" />
                    <p>Atualiza em 10s...</p>
                </body>
                </html>
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

// ===============================================================
// INICIALIZAÇÃO
// ===============================================================

connect();
