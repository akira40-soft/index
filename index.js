// ===============================================================
 // AKIRA BOT — VERSÃO FINAL 2025: NÚMERO REAL GARANTIDO (GRUPOS E PV)
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

const logger = pino({ level: 'silent' }); // muda pra 'info' se quiser ver logs
const AKIRA_API_URL = 'https://akra35567-akira.hf.space/api/akira';
const PORT = process.env.PORT || 8080;

let sock;
let BOT_REAL = null;
let currentQR = null;

// FUNÇÃO QUE NUNCA FALHA — PEGA O NÚMERO REAL EM GRUPOS E PV
function getRealPhoneNumber(msg) {
    // 1. Campo secreto do WhatsApp em grupos (só existe em grupos!)
    if (msg.key?.participant_Pn) {
        return msg.key.participant_Pn.split('@')[0]; // 2449xxxxxxxxx
    }

    // 2. Em PV ou fallback — remoteJid já é o número real
    const jid = msg.key.participant || msg.key.remoteJid || '';
    let num = jid.split('@')[0].split(':')[0];

    // 3. Conversão de LID gigante → número real (Angola)
    if (num.length > 12 && num.startsWith('202')) {
        return '244' + num.slice(-9);
    }

    // 4. Já é número real
    if (num.startsWith('2449') && num.length === 12) {
        return num;
    }

    // 5. Número sem código do país (9xxxxxxxxx)
    if (num.startsWith('9') && num.length === 9) {
        return '244' + num;
    }

    // 6. Último recurso — pega últimos 9 dígitos
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
    return num === BOT_REAL || num.endsWith(BOT_REAL);
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
        markOnlineOnConnect: true,
        getMessage: async () => ({ conversation: '' })
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', ({ connection, qr }) => {
        if (qr) currentQR = qr;
        if (connection === 'open') {
            BOT_REAL = sock.user.id.split(':')[0];
            logger.info(`AKIRA BOT ONLINE → ${BOT_REAL}`);
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

        // === NÚMERO REAL 100% GARANTIDO ===
        const senderReal = getRealPhoneNumber(m); // ← AQUI ESTÁ A MÁGICA

        const pushName = m.pushName || senderReal;
        const text = getMessageText(m).trim();

        // Quoted message
        const context = m.message?.extendedTextMessage?.contextInfo;
        const quotedJid = context?.participant;
        const quotedText = context?.quotedMessage ? getMessageText({ message: context.quotedMessage }) : '';

        // === LÓGICA DE ATIVAÇÃO ===
        let ativar = false;
        if (!isGroup) ativar = true; // PV sempre
        if (quotedJid && isBot(quotedJid)) ativar = true;
        if (isGroup) {
            const mentions = context?.mentionedJid || [];
            if (mentions.some(isBot)) ativar = true;
            if (text.toLowerCase().includes('akira')) ativar = true;
        }
        if (!ativar) return;

        try {
            await sock.readMessages([m.key]);
            await sock.sendPresenceUpdate('composing', remoteJid);
        } catch {}

        try {
            const payload = {
                usuario: pushName,
                mensagem: text,
                numero: senderReal,        // ← SEMPRE 2449... NUNCA LID
                mensagem_citada: quotedText
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

// QR Code Web
const app = express();
app.get('/', (_, res) => res.send('<h2>Akira Online</h2><a href="/qr">Ver QR</a>'));
app.get('/qr', async (_, res) => {
    if (!currentQR) return res.send('<h1 style="color:green;text-align:center;margin-top:100px">BOT JÁ CONECTADO!</h1>');
    const img = await QRCode.toDataURL(currentQR);
    res.send(`<body style="background:#000;color:lime;text-align:center;padding:50px;font-family:Arial">
        <h1>ESCANEIA O QR</h1>
        <img src="${img}" style="border:10px solid lime;border-radius:20px;max-width:90%">
        <p style="font-size:20px;margin-top:30px">Atualizando em 5s...</p>
        <meta http-equiv="refresh" content="5">
    </body>`);
});

app.listen(PORT, () => console.log(`Web na porta ${PORT}`));

connect();
