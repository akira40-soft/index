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

// Prefixos conhecidos
const NON_STANDARD_JID_PREFIX = '37';

// ===============================================================
// FUNÇÕES UTILITÁRIAS
// ===============================================================

function extractNumber(input = '') {
    if (!input) return 'desconhecido';
    const clean = input.toString();

    const fullJidMatch = clean.match(/(\d{12})@/);
    if (fullJidMatch) return fullJidMatch[1];

    const match = clean.match(/2449\d{8}/);
    if (match) return match[0];

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

// ===============================================================
// FUNÇÃO NOVA (fixada)
// APENAS considera reply válido se o JID citado == BOT_JID
// ===============================================================

function isReplyDirectoAoBot(jid) {
    if (!jid || !BOT_JID) return false;

    const botNorm = BOT_JID;
    const quotedNorm = normalizeJid(jid);

    if (!quotedNorm) return false;

    return quotedNorm === botNorm;
}

async function shouldActivate(msg, isGroup, text, quotedSenderJid, mensagemCitada) {
    const context = msg.message?.extendedTextMessage?.contextInfo ||
                    msg.message?.imageMessage?.contextInfo ||
                    msg.message?.videoMessage?.contextInfo;

    const lowered = text.toLowerCase();
    let activationReason = 'NÃO ATIVADO';

    // ✔ FIXADO: resposta só com reply se for EXACTAMENTE ao bot
    if (quotedSenderJid) {
        if (isReplyDirectoAoBot(quotedSenderJid)) {
            activationReason = `REPLY ao BOT`;
        }
    }

    if (isGroup && activationReason === 'NÃO ATIVADO') {
        const mentions = context?.mentionedJid || [];
        const mentionMatch = mentions.some(j => isReplyDirectoAoBot(j));

        if (mentionMatch) {
            activationReason = 'MENÇÃO direta';
        } else if (lowered.includes('akira')) {
            activationReason = 'PALAVRA-CHAVE "akira"';
        }
    }

    if (!isGroup && activationReason === 'NÃO ATIVADO') {
        activationReason = 'CHAT PRIVADO';
    }

    logger.info(`[ATIVAR] ${activationReason !== 'NÃO ATIVADO' ? 'SIM' : 'NÃO'} | Motivo: ${activationReason}`);
    return activationReason !== 'NÃO ATIVADO';
}

// ===============================================================
// CONEXÃO
// ===============================================================

async function connect() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    if (sock && sock.user) {
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

    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
        if (qr) {
            currentQR = qr;
            console.clear();
            logger.info('ESCANEIE O QR PARA CONECTAR');
        }

        if (connection === 'open') {
            BOT_JID = normalizeJid(sock.user.id);
            logger.info(`BOT_JID detectado: ${BOT_JID}`);
            lastProcessedTime = Date.now();
            currentQR = null;
        }

        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            logger.error(`Conexão caída (${reason}). Tentando reconectar...`);
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

        try {
            await sock.readMessages([msg.key]);
            await sock.sendReceipt(from, msg.key.participant, ['read']);
        } catch { }

        await sock.sendPresenceUpdate('composing', from);

        try {
            const apiPayload = {
                usuario: nome,
                mensagem: mensagemAtual,
                numero: numeroContexto,
                mensagem_citada: mensagemCitada
            };

            logger.info(`[PAYLOAD] Usuario: ${apiPayload.usuario} | Numero: ${apiPayload.numero}`);

            const res = await axios.post(AKIRA_API_URL, apiPayload, {
                headers: { 'Content-Type': 'application/json' },
                timeout: 300000
            });

            const resposta = res.data?.resposta || '...';

            await delay(Math.min(resposta.length * 50, 3000));
            await sock.sendPresenceUpdate('paused', from);
            await sock.sendMessage(from, { text: resposta }, { quoted: msg });

        } catch (err) {
            await sock.sendMessage(from, { text: 'Erro interno. Tenta depois.' }, { quoted: msg });
        }
    });
}

// ===============================================================
// EXPRESS SERVER
// ===============================================================

const app = express();

app.get("/", (_, res) => {
    res.send(`<h2>Akira Bot Online</h2>`);
});

app.get("/qr", async (_, res) => {
    if (!currentQR) {
        res.send(`<h2>Já conectado!</h2>`);
    } else {
        const qrBase64 = await QRCode.toDataURL(currentQR);
        res.send(`
            <h2>Escaneie o QR</h2>
            <img src="${qrBase64}" />
        `);
    }
});

app.listen(PORT, "0.0.0.0", () => {
    logger.info(`Servidor na porta ${PORT}`);
});

connect();
