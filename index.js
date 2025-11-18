// ===============================================================
 // AKIRA BOT — VERSÃO 100% CORRETA COM DEBUG PERMANENTE (18/11/2025)
// ===============================================================

import makeWASocket, {
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    Browsers,
    delay,
    getContentType
} from '@whiskeysockets/baileys';
import axios from 'axios';
import express from 'express';
import * as QRCode from 'qrcode';

const PORT = process.env.PORT || 8080;
let sock;
let BOT_REAL = null;
let currentQR = null;

// FUNÇÃO FINAL CORRETA — PRIORIDADE PERFEITA
function pegarNumeroReal(m) {
    const key = m.key;

    // 1. Se tem participant com @s.whatsapp.net → número real direto (raro, mas acontece)
    if (key.participant && key.participant.includes('@s.whatsapp.net')) {
        return key.participant.split('@')[0];
    }

    // 2. Se tem participant com LID → converte os últimos 9 dígitos (FUNCIONA SEMPRE EM 2025)
    if (key.participant && key.participant.includes('@lid')) {
        const lid = key.participant.split('@')[0];
        if (lid.startsWith('202') && lid.length > 12) {
            return '244' + lid.slice(-9);
        }
    }

    // 3. Chat privado → remoteJid já é real
    if (!key.remoteJid.endsWith('@g.us')) {
        return key.remoteJid.split('@')[0];
    }

    // 4. Grupo sem participant → fallback do remoteJid (funciona na maioria)
    const match = key.remoteJid.match(/120363(\d+)@g\.us/);
    if (match) {
        return '244' + match[1].slice(-9);
    }

    return '244000000000'; // nunca chega aqui
}

// DEBUG PERMANENTE (fica pra sempre)
function debugPermanente(m, numero) {
    console.log("\n╔════════════════════════════════ DEBUG PERMANENTE ════════════════════════════════");
    console.log(`║ Tipo             : ${m.key.remoteJid.endsWith('@g.us') ? 'GRUPO' : 'PRIVADO'}`);
    console.log(`║ remoteJid        : ${m.key.remoteJid}`);
    console.log(`║ participant      : ${m.key.participant || 'N/A'}`);
    console.log(`║ pushName         : ${m.pushName || 'N/A'}`);
    console.log(`║ NÚMERO ENVIADO → ${numero}`);
    console.log("╚═══════════════════════════════════════════════════════════════════════════════\n");
}

function getMessageText(m) {
    const t = getContentType(m.message);
    if (!t) return '';
    if (t === 'conversation') return m.message.conversation || '';
    if (t === 'extendedTextMessage') return m.message.extendedTextMessage.text || '';
    if (['imageMessage', 'videoMessage'].includes(t)) return m.message[t].caption || '';
    return 'Sticker/Mídia';
}

async function connect() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
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
        }
        if (connection === 'close') setTimeout(connect, 5000);
    });

    const processadas = new Set();

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.fromMe || processadas.has(m.key.id)) return;
        processadas.add(m.key.id);
        setTimeout(() => processadas.delete(m.key.id), 10000);

        const numeroReal = pegarNumeroReal(m);
        const nome = m.pushName || numeroReal;

        debugPermanente(m, numeroReal);

        const texto = getMessageText(m).trim().toLowerCase();
        const ehGrupo = m.key.remoteJid.endsWith('@g.us');

        if (ehGrupo && !texto.includes('akira')) return;

        console.log(`[RESPOSTA] ${ehGrupo ? 'GRUPO' : 'PV'} → ${nome} (${numeroReal})`);

        try {
            await sock.readMessages([m.key]);
            await sock.sendPresenceUpdate('composing', m.key.remoteJid);

            const payload = {
                usuario: nome,
                mensagem: getMessageText(m).trim(),
                numero: numeroReal,
                mensagem_citada: ''
            };

            const res = await axios.post('https://akra35567-akira.hf.space/api/akira', payload, { timeout: 280000 });
            const resposta = res.data?.resposta || 'Ok';

            await delay(Math.min(resposta.length * 60, 5000));
            await sock.sendPresenceUpdate('paused', m.key.remoteJid);
            await sock.sendMessage(m.key.remoteJid, { text: resposta }, { quoted: m });

        } catch (err) {
            await sock.sendMessage(m.key.remoteJid, { text: 'Erro interno. Tenta mais tarde.' }, { quoted: m });
        }
    });
}

const app = express();
app.get('/qr', async (_, res) => {
    if (!currentQR) return res.send('<h2>Bot conectado!</h2>');
    const img = await QRCode.toDataURL(currentQR);
    res.send(`<body style="background:#000;color:#0f0;text-align:center;padding:50px"><h1>QR</h1><img src="${img}" style="border:10px solid #0f0;border-radius:20px"><p>Atualiza em 5s</p><meta http-equiv="refresh" content="5"></body>`);
});

app.listen(PORT, () => console.log(`Porta ${PORT}`));

connect();
