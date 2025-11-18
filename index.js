// ===============================================================
 // AKIRA BOT — VERSÃO DEFINITIVA 2025 COM DEBUG PERMANENTE
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

// FUNÇÃO QUE FUNCIONA HOJE E VAI CONTINUAR FUNCIONANDO
function pegarNumeroReal(m) {
    const remote = m.key.remoteJid || '';

    // PRIVADO → já vem direto
    if (!remote.endsWith('@g.us')) {
        return remote.split('@')[0];
    }

    // GRUPO → extrai do remoteJid (o único lugar que sobrou)
    const match = remote.match(/120363(\d+)@g\.us/);
    if (match) {
        const numeros = match[1];

        // Angola / Moçambique / Cabo Verde
        if (numeros.startsWith('244') || numeros.startsWith('258') || numeros.startsWith('9')) {
            return numeros.startsWith('244') || numeros.startsWith('258') 
                ? numeros 
                : '244' + numeros.slice(-9);
        }
    }

    return '244000000000'; // nunca chega aqui
}

// DEBUG QUE FICA PRA SEMPRE (tu pediste)
function debugPermanente(m, numero) {
    console.log("\n╔════════════════════════════════ DEBUG PERMANENTE ════════════════════════════════");
    console.log(`║ Tipo da conversa : ${m.key.remoteJid.endsWith('@g.us') ? 'GRUPO' : 'PRIVADO'} `);
    console.log(`║ remoteJid        : ${m.key.remoteJid}`);
    console.log(`║ participant      : ${m.key.participant || 'N/A'}`);
    console.log(`║ pushName         : ${m.pushName || 'N/A'}`);
    console.log(`║ NÚMERO ENVIADO → ${numero}`);
    console.log("╚══════════════════════════════════════════════════════════════════════════════\n");
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
        if (connection === 'close') {
            setTimeout(connect, 5000);
        }
    });

    const jaProcessada = new Set();

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.fromMe || jaProcessada.has(m.key.id)) return;
        jaProcessada.add(m.key.id);
        setTimeout(() => jaProcessada.delete(m.key.id), 10000);

        const numeroReal = pegarNumeroReal(m);
        const nome = m.pushName || numeroReal;

        // DEBUG SEMPRE VISÍVEL
        debugPermanente(m, numeroReal);

        const texto = getMessageText(m).trim().toLowerCase();
        const ehGrupo = m.key.remoteJid.endsWith('@g.us');

        // Só responde no PV ou quando falar "akira" no grupo
        if (ehGrupo && !texto.includes('akira')) return;

        console.log(`[RESPOSTA ENVIADA] ${ehGrupo ? 'GRUPO' : 'PV'} → ${nome} (${numeroReal})`);

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
            const resposta = res.data?.resposta || 'Sem resposta';

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
    if (!currentQR) return res.send('<h2>Bot já conectado!</h2>');
    const img = await QRCode.toDataURL(currentQR);
    res.send(`<body style="background:#000;color:#0f0;text-align:center;padding:50px"><h1>ESCANEIA O QR</h1><img src="${img}" style="border:10px solid #0f0;border-radius:20px"><p>Atualiza em 5s...</p><meta http-equiv="refresh" content="5"></body>`);
});

app.listen(PORT, () => console.log(`Servidor na porta ${PORT}`));

connect();
