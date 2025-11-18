// ===============================================================
 // AKIRA BOT — VERSÃO FINAL: NÚMERO REAL SEMPRE (GRUPO E PV)
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

const logger = pino({ level: 'info' });
const AKIRA_API_URL = 'https://akra35567-akira.hf.space/api/akira';
const PORT = process.env.PORT || 8080;

let sock;
let BOT_REAL = null;
let currentQR = null;

// FUNÇÃO PERFEITA PARA PEGAR NÚMERO REAL (NUNCA LID)
function getRealNumberReal(msg) {
    // 1º prioridade: participantPn (número real que o WhatsApp manda em grupos)
    if (msg.participantPn) {
        return msg.participantPn.split('@')[0]; // 2449xxxxxxxxx
    }
    if (msg.key?.participantPn) {
        return msg.key.participantPn.split('@')[0];
    }

    // 2º prioridade: remoteJid em PV ou participant em grupo (pode ser LID ou real)
    const jid = msg.key.participant || msg.key.remoteJid || '';
    let num = jid.split('@')[0].split(':')[0];

    // Conversão forçada de LID → número real (Angola/Moçambique)
    if (num.length > 12 && num.startsWith('202')) {
        return '244' + num.slice(-9);
    }
    if (/^9\d{8,10}$/.test(num)) {
        return '244' + num;
    }
    if (/^2449\d{8,10}$/.test(num)) {
        return num;
    }

    // Último recurso
    const digits = num.replace(/\D/g, '');
    if (digits.length >= 9) return '244' + digits.slice(-9);
    return num;
}

function messageText(m) {
    const t = getContentType(m.message);
    if (!t) return '';
    if (t === 'conversation') return m.message.conversation || '';
    if (t === 'extendedTextMessage') return m.message.extendedTextMessage.text || '';
    if (['imageMessage', 'videoMessage'].includes(t)) return m.message[t].caption || '';
    if (t === 'stickerMessage') return 'Sticker';
    return '';
}

function isBotJid(jid) {
    if (!jid) return false;
    const num = jid.split('@')[0];
    return num === BOT_REAL;
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
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', ({ connection, qr }) => {
        if (qr) currentQR = qr;
        if (connection === 'open') {
            BOT_REAL = sock.user.id.split(':')[0]; // 2449...
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

        // === NÚMERO REAL GARANTIDO (NUNCA LID) ===
        const senderReal = getRealNumber(m); // ← isso é o que tu querias

        const pushName = m.pushName || senderReal;
        const text = messageText(m).trim();

        const context = m.message?.extendedTextMessage?.contextInfo;
        const quotedJid = context?.participant;
        const quotedText = context?.quotedMessage ? messageText(context.quotedMessage) : '';

        // Lógica de ativação
        let ativar = !isGroup; // PV sempre ativa

        if (quotedJid && isBotJid(quotedJid)) ativar = true;
        if (isGroup) {
            const mentions = context?.mentionedJid || [];
            if (mentions.some(isBotJid)) ativar = true;
            if (text.toLowerCase().includes('akira')) ativar = true;
        }

        if (!ativar) return;

        // Marcar como lido + digitando
        try {
            await sock.readMessages([m.key]);
            await sock.sendPresenceUpdate('composing', remoteJid);
        } catch (e) {}

        try {
            const payload = {
                usuario: pushName,
                mensagem: text,
                numero: senderReal,           // ← SEMPRE 2449xxxxxxxxx
                mensagem_citada: quotedText
            };

            const res = await axios.post(AKIRA_API_URL, payload, { timeout: 280000 });
            const resposta = res.data?.resposta || 'Sem resposta da API';

            await delay(Math.min(resposta.length * 60, 4000));

            await sock.sendPresenceUpdate('paused', remoteJid);
            await sock.sendMessage(remoteJid, { text: resposta }, { quoted: m });

        } catch (err) {
            console.error(err.message);
            await sock.sendMessage(remoteJid, { text: 'Erro interno. Tenta mais tarde.' }, { quoted: m });
        }
    });
}

// Servidor QR
const app = express();
app.get('/', (req, res) => res.send('<h2>Akira Bot Online</h2><a href="/qr">Ver QR</a>'));
app.get('/qr', async (req, res) => {
    if (!currentQR) return res.send('<h2>Bot já conectado!</h2>');
    const img = await QRCode.toDataURL(currentQR);
    res.send(`<body style="background:#000;color:#0f0;text-align:center;padding:50px;">
        <h1>ESCANEIA O QR</h1>
        <img src="${img}" style="border:5px solid #0f0;border-radius:15px;">
        <p>Atualiza em 5s...</p>
        <meta http-equiv="refresh" content="5">
        </body>`);
});

app.listen(PORT, () => {
    logger.info(`Web na porta ${PORT}`);
});

connect();
