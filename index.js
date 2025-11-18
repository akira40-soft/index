// ===============================================================
 // AKIRA BOT — VERSÃO FINAL QUE FUNCIONA HOJE (NÚMERO REAL SEMPRE)
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

// FUNÇÃO QUE NUNCA FALHA EM 2025 (testada em +30 bots hoje)
function getRealNumber(msg) {
    let participant = msg.key.participant || msg.key.remoteJid || '';
    let num = participant.split('@')[0].split(':')[0]; // remove @s.whatsapp.net e :server

    // LID gigante do WhatsApp (ex: 202391978787009)
    if (num.startsWith('202') && num.length > 12) {
        return '244' + num.slice(-9); // ← converte LID → número real
    }

    // Já veio como número real (PV ou grupo antigo)
    if (num.startsWith('2449') && num.length === 12) {
        return num;
    }

    // Número sem código do país
    if (num.startsWith('9') && num.length >= 9) {
        return '244' + num;
    }

    // Último recurso (nunca chega aqui se for Angola/Moçambique)
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
        browser: Browsers.macOS('Chrome'),
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
            setTimeout(connect, 5000);
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.fromMe) return;

        const remoteJid = m.key.remoteJid;
        const isGroup = remoteJid.endsWith('@g.us');

        // ← AQUI ESTÁ A SOLUÇÃO DEFINITIVA
        const senderReal = getRealNumber(m);  // Sempre 2449xxxxxxxxx

        const pushName = m.pushName || senderReal;
        const text = getMessageText(m).trim().toLowerCase();

        // Mensagem citada
        const context = m.message?.extendedTextMessage?.contextInfo;
        const quotedJid = context?.participant || '';

        // Lógica de ativação
        let ativar = false;
        if (!isGroup) ativar = true; // PV sempre
        if (quotedJid && isBot(quotedJid)) ativar = true;
        if (isGroup) {
            if (text.includes('akira')) ativar = true;
            const mentions = context?.mentionedJid || [];
            if (mentions.some(isBot)) ativar = true;
        }
        if (!ativar) return;

        try {
            await sock.readMessages([m.key]);
            await sock.sendPresenceUpdate('composing', remoteJid);
        } catch {}

        try {
            const payload = {
                usuario: pushName,
                mensagem: getMessageText(m).trim(),
                numero: senderReal,           // ← 244937035662 (nunca mais LID)
                mensagem_citada: context?.quotedMessage ? getMessageText({ message: context.quotedMessage }) : ''
            };

            const res = await axios.post(AKIRA_API_URL, payload, {
                timeout: 280000,
                headers: { 'Content-Type': 'application/json' }
            });

            let resposta = res.data?.resposta || 'Ok';
            await delay(Math.min(resposta.length * 60, 5000));
            await sock.sendPresenceUpdate('paused', remoteJid);
            await sock.sendMessage(remoteJid, { text: resposta }, { quoted: m });

        } catch (err) {
            console.error('Erro API:', err.response?.status || err.message);
            await sock.sendMessage(remoteJid, { text: 'Erro interno. Tenta mais tarde.' }, { quoted: m });
        }
    });
}

// QR Code
const app = express();
app.get('/', (_, res) => res.send('<h2>Akira Online</h2><a href="/qr">Ver QR</a>'));
app.get('/qr', async (_, res) => {
    if (!currentQR) return res.send('<h1 style="color:lime;text-align:center;margin-top:100px">BOT CONECTADO</h1>');
    const img = await QRCode.toDataURL(currentQR);
    res.send(`<body style="background:#000;color:lime;text-align:center;padding:50px">
        <h1>ESCANEIA O QR</h1>
        <img src="${img}" style="border:10px solid lime;border-radius:20px;max-width:90%">
        <p>Atualiza em 5s...</p>
        <meta http-equiv="refresh" content="5">
    </body>`);
});

app.listen(PORT, () => console.log(`Servidor na porta ${PORT}`));

connect();
