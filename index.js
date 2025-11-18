// ===============================================================
 // AKIRA BOT — VERSÃO DEBUG ULTRA DETALHADO (NÚMERO REAL 100% GARANTIDO)
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

// Logger com nível WARN pra ver o debug bem claro
const logger = pino({ level: 'warn' });
const AKIRA_API_URL = 'https://akra35567-akira.hf.space/api/akira';
const PORT = process.env.PORT || 8080;

let sock;
let BOT_REAL = null;
let currentQR = null;

// ===================== DEBUG ULTRA DETALHADO =====================
async function DEBUG_DUMP_SENDER(sock, msg) {
    const key = msg.key || {};
    
    const contextInfo = 
        msg.message?.extendedTextMessage?.contextInfo ||
        msg.message?.imageMessage?.contextInfo ||
        msg.message?.videoMessage?.contextInfo ||
        msg.message?.stickerMessage?.contextInfo ||
        msg.message?.listResponseMessage?.contextInfo ||
        msg.message?.buttonsResponseMessage?.contextInfo ||
        null;

    const sources = {
        participantAlt: key.participantAlt || 'N/A',
        participant: key.participant || 'N/A',
        context_participant: contextInfo?.participant || 'N/A',
        context_participant_pn: contextInfo?.participant_pn || 'N/A',
        remoteJid: key.remoteJid || 'N/A',
        pushName: msg.pushName || 'N/A'
    };

    // Função agressiva que tenta TODAS as formas possíveis
    let resolvedJid = null;
    let numeric = null;
    let source = 'unknown';

    // 1. participantAlt (campo mais novo que às vezes tem o real)
    if (key.participantAlt && key.participantAlt.includes('@s.whatsapp.net')) {
        resolvedJid = key.participantAlt;
        numeric = resolvedJid.split('@')[0];
        source = 'participantAlt';
    }
    // 2. participant normal (pode ser LID ou real)
    else if (key.participant && key.participant.includes('@s.whatsapp.net')) {
        resolvedJid = key.participant;
        numeric = resolvedJid.split('@')[0];
        source = 'participant (real)';
    }
    // 3. LID gigante → conversão forçada
    else if (key.participant && key.participant.includes('@lid')) {
        const lid = key.participant.split('@')[0];
        if (lid.startsWith('202') && lid.length > 12) {
            numeric = '244' + lid.slice(-9);
            resolvedJid = numeric + '@s.whatsapp.net';
            source = 'LID → 244 + últimos 9';
        }
    }
    // 4. remoteJid (sempre real em PV)
    else if (key.remoteJid && !key.remoteJid.endsWith('@g.us')) {
        resolvedJid = key.remoteJid;
        numeric = resolvedJid.split('@')[0];
        source = 'remoteJid (PV)';
    }

    logger.warn("\n==================== DEBUG SENDER ====================");
    logger.warn("RAW msg.key:", JSON.stringify(key, null, 2));
    logger.warn("RAW contextInfo:", contextInfo ? JSON.stringify(contextInfo, null, 2) : 'N/A');
    logger.warn("TODAS AS FONTES POSSÍVEIS:", sources);
    logger.warn("→ RESOLVED JID:", resolvedJid);
    logger.warn("→ NÚMERO FINAL:", numeric);
    logger.warn("→ FONTE USADA:", source);

    // Tenta onWhatsApp pra confirmar se existe
    if (sock.onWhatsApp && numeric) {
        try {
            const check = await sock.onWhatsApp(numeric + '@s.whatsapp.net');
            logger.warn("→ onWhatsApp confirma:", check);
        } catch (e) {
            logger.warn("→ onWhatsApp erro:", e.message);
        }
    }

    logger.warn("================= FIM DEBUG SENDER ==================\n");

    return { resolvedJid, numeric, source };
}
// ================================================================

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
    const num = jid.split('@')[0];
    return num === BOT_REAL || num.slice(-9) === BOT_REAL.slice(-9);
}

async function connect() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        logger,
        auth: state,
        browser: Browsers.macOS('Desktop'),
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
            console.log('Conexão perdida. Reconectando...');
            setTimeout(connect, 5000);
        }
    });

    // Evita respostas duplicadas
    const processed = new Set();

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.fromMe) return;
        if (processed.has(m.key.id)) return;
        processed.add(m.key.id);
        setTimeout(() => processed.delete(m.key.id), 10000);

        const remoteJid = m.key.remoteJid;
        const isGroup = remoteJid.endsWith('@g.us');

        // === AQUI VEM O DEBUG + RESOLUÇÃO FINAL ===
        const { numeric: senderNumeric } = await DEBUG_DUMP_SENDER(sock, m);

        const pushName = m.pushName || senderNumeric || 'Desconhecido';
        const text = getMessageText(m).trim();
        const lowerText = text.toLowerCase();

        const context = m.message?.extendedTextMessage?.contextInfo || {};
        const quotedJid = context.participant || '';
        const mentions = context.mentionedJid || [];

        let motivo = '';
        if (!isGroup) motivo = 'CHAT PRIVADO';
        else if (quotedJid && isBot(quotedJid)) motivo = 'REPLY AO BOT';
        else if (mentions.some(isBot)) motivo = 'MENÇÃO';
        else if (lowerText.includes('akira')) motivo = 'PALAVRA akira';

        if (!motivo) return;

        console.log(`[ATIVADO] ${motivo} → ${pushName} (${senderNumeric})`);

        try {
            await sock.readMessages([m.key]);
            await sock.sendPresenceUpdate('composing', remoteJid);
        } catch {}

        try {
            const payload = {
                usuario: pushName,
                mensagem: text,
                numero: senderNumeric || '244000000000',
                mensagem_citada: context.quotedMessage ? getMessageText({ message: context.quotedMessage }) : ''
            };

            const res = await axios.post(AKIRA_API_URL, payload, { timeout: 280000 });
            const resposta = res.data?.resposta || 'Ok';

            await delay(Math.min(resposta.length * 60, 5000));
            await sock.sendPresenceUpdate('paused', remoteJid);
            await sock.sendMessage(remoteJid, { text: resposta }, { quoted: m });

        } catch (err) {
            console.error('Erro na API (503/timeout)');
            await sock.sendMessage(remoteJid, { text: 'Erro interno. Tenta mais tarde.' }, { quoted: m });
        }
    });
}

// QR
const app = express();
app.get('/', (_, res) => res.send('<h2>Akira Online</h2><a href="/qr">QR</a>'));
app.get('/qr', async (_, res) => {
    if (!currentQR) return res.send('<h1 style="color:#0f0;text-align:center;margin-top:100px">CONECTADO</h1>');
    const img = await QRCode.toDataURL(currentQR);
    res.send(`<body style="background:#000;color:#0f0;text-align:center;padding:50px"><h1>QR CODE</h1><img src="${img}" style="border:10px solid #0f0;border-radius:20px"><p>Atualiza em 5s...</p><meta http-equiv="refresh" content="5"></body>`);
});

app.listen(PORT, () => console.log(`Servidor na porta ${PORT}`));

connect();
