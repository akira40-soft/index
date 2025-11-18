// ===============================================================
 // AKIRA BOT — VERSÃO FINAL 2025 (PERFEITA E LIMPA)
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

const logger = pino({ level: 'silent' });
const AKIRA_API_URL = 'https://akra35567-akira.hf.space/api/akira';
const PORT = process.env.PORT || 8080;

let sock;
let BOT_REAL = null;
let currentQR = null;

// CONVERSÃO LID → NÚMERO REAL (FUNCIONA 100% EM 2025)
function getRealNumber(msg) {
    let jid = msg.key.participant || msg.key.remoteJid || '';
    let num = jid.split('@')[0].split(':')[0];

    if (num.startsWith('202') && num.length > 12) {
        return '244' + num.slice(-9);
    }
    if (num.startsWith('2449') && num.length === 12) return num;
    if (num.startsWith('9') && num.length >= 9) return '244' + num;

    const digits = num.replace(/\D/g, '');
    return digits.length >= 9 ? '244' + digits.slice(-9) : num;
}

function getMessageText(m) {
    const type = getContentType(m.message);
    if (!type) return '';
    if (type === 'conversation') return m.message.conversation || '';
    if (type === 'extendedTextMessage') return m.message.extendedTextMessage.text || '';
    if (['imageMessage', 'videoMessage'].includes(type)) return m.message[type].caption || '';
    if (type === 'stickerMessage') return 'Sticker';
    return '';
}

function isBot(jid) {
    if (!jid || !BOT_REAL) return false;
    const num = jid.split('@')[0].split(':')[0];
    return num === BOT_REAL || (num.length > 12 && num.slice(-9) === BOT_REAL.slice(-9));
}

async function connect() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        logger,
        auth: state,
        browser: Browsers.macOS('Desktop'),  // ← VOLTOU COMO ERA ANTES
        syncFullHistory: false,
        markOnlineOnConnect: true
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', ({ connection, qr }) => {
        if (qr) currentQR = qr;
        if (connection === 'open') {
            BOT_REAL = sock.user.id.split(':')[0];
            console.log(`AKIRA BOT ONLINE → ${BOT_REAL}`);
            currentQR = null;
        }
        if (connection === 'close') {
            console.log('Conexão perdida. Reconectando em 5s...');
            setTimeout(connect, 5000);
        }
    });

    // === CONTROLE PARA NÃO RESPONDER DUPLICADO ===
    const processedMessages = new Set();

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.fromMe) return;

        const msgId = m.key.id;
        if (processedMessages.has(msgId)) return;  // ← EVITA RESPOSTA DUPLA
        processedMessages.add(msgId);
        setTimeout(() => processedMessages.delete(msgId), 10000); // limpa após 10s

        const remoteJid = m.key.remoteJid;
        const isGroup = remoteJid.endsWith('@g.us');
        const senderReal = getRealNumber(m);
        const pushName = m.pushName || senderReal;
        const text = getMessageText(m).trim();
        const lowerText = text.toLowerCase();

        const context = m.message?.extendedTextMessage?.contextInfo;
        const quotedJid = context?.participant || '';
        const mentions = context?.mentionedJid || [];

        // === LÓGICA DE ATIVAÇÃO (SÓ UMA VEZ) ===
        let motivo = '';

        if (!isGroup) {
            motivo = 'CHAT PRIVADO';
        } else if (quotedJid && isBot(quotedJid)) {
            motivo = 'REPLY AO BOT';
        } else if (mentions.some(isBot)) {
            motivo = 'MENÇÃO AO BOT';
        } else if (lowerText.includes('akira')) {
            motivo = 'PALAVRA "akira"';
        }

        if (!motivo) {
            console.log(`[IGNORADO] De: ${pushName} (${senderReal}) | Msg: "${text}"`);
            return;
        }

        console.log(`[ATIVADO] ${motivo} | De: ${pushName} (${senderReal}) | Msg: "${text}"`);

        try {
            await sock.readMessages([m.key]);
            await sock.sendPresenceUpdate('composing', remoteJid);
        } catch (e) {}

        try {
            const payload = {
                usuario: pushName,
                mensagem: text,
                numero: senderReal,
                mensagem_citada: context?.quotedMessage ? getMessageText({ message: context.quotedMessage }) : ''
            };

            const res = await axios.post(AKIRA_API_URL, payload, {
                timeout: 280000,
                headers: { 'Content-Type': 'application/json' }
            });

            const resposta = res.data?.resposta || 'Ok';
            await delay(Math.min(resposta.length * 60, 5000));
            await sock.sendPresenceUpdate('paused', remoteJid);
            await sock.sendMessage(remoteJid, { text: resposta }, { quoted: m });

        } catch (err) {
            console.error('Erro na API: 503 ou timeout');
            await sock.sendMessage(remoteJid, { text: 'Erro interno. Tenta mais tarde.' }, { quoted: m });
        }
    });
}

// QR Code (bonitinho como antes)
const app = express();
app.get('/', (_, res) => res.send('<h2>Akira Bot Online</h2><a href="/qr">Ver QR</a>'));
app.get('/qr', async (_, res) => {
    if (!currentQR) return res.send('<h1 style="color:#0f0;text-align:center;margin-top:100px">BOT JÁ CONECTADO!</h1>');
    const img = await QRCode.toDataURL(currentQR);
    res.send(`
        <body style="background:#000;color:#0f0;text-align:center;padding:50px;font-family:Arial">
            <h1>ESCANEIA O QR CODE</h1>
            <img src="${img}" style="border:10px solid #0f0;border-radius:20px;max-width:90%">
            <p style="font-size:20px;margin-top:30px">Atualizando em 5 segundos...</p>
            <meta http-equiv="refresh" content="5">
        </body>
    `);
});

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
    console.log(`Acesse: http://localhost:${PORT}/qr`);
});

connect();
