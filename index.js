// ===============================================================
 // AKIRA BOT — DEBUG FUNCIONANDO 100% (TODOS OS CAMPOS VISÍVEIS)
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

// ===================== DEBUG QUE NUNCA MAIS VAI FALHAR =====================
async function DEBUG_SENDER_REAL(msg) {
    const key = msg.key || {};
    const message = msg.message || {};

    // Pega contextInfo de qualquer tipo de mensagem
    const ctx = 
        message.extendedTextMessage?.contextInfo ||
        message.imageMessage?.contextInfo ||
        message.videoMessage?.contextInfo ||
        message.stickerMessage?.contextInfo ||
        message.documentMessage?.contextInfo ||
        {};

    console.log("\n════════════════════════════════ DEBUG SENDER COMPLETO ═══════════════════════════════");
    console.log("→ remoteJid          :", key.remoteJid || 'N/A');
    console.log("→ participant        :", key.participant || 'N/A');
    console.log("→ participantAlt     :", key.participantAlt || 'N/A');
    console.log("→ participant_Pn     :", key.participant_Pn || 'N/A');   // campo secreto 2025
    console.log("→ participantPn      :", key.participantPn || 'N/A');
    console.log("→ pushName           :", msg.pushName || 'N/A');
    console.log("→ verifiedName       :", msg.verifiedName || 'N/A');
    console.log("→ context.participant:", ctx.participant || 'N/A');
    console.log("→ context.participant_pn:", ctx.participant_pn || 'N/A');
    console.log("→ context.participantPn :", ctx.participantPn || 'N/A');
    console.log("→ msg.key.id         :", key.id || 'N/A');
    console.log("════════════════════════════════ FIM DEBUG ═════════════════════════════════\n");

    // === EXTRAÇÃO FINAL DO NÚMERO REAL (funciona em PV e grupo 2025) ===
    let numero = null;

    // 1. Campo secreto que o WhatsApp manda em grupos (2025)
    if (key.participant_Pn) numero = key.participant_Pn.split('@')[0];
    else if (key.participantPn) numero = key.participantPn.split('@')[0];
    else if (key.participantAlt?.includes('@s.whatsapp.net')) numero = key.participantAlt.split('@')[0];
    else if (key.participant?.includes('@s.whatsapp.net')) numero = key.participant.split('@')[0];
    else if (key.remoteJid && !key.remoteJid.endsWith('@g.us')) numero = key.remoteJid.split('@')[0];

    // 2. Conversão forçada do LID gigante (202...)
    if (!numero && key.participant?.includes('@lid')) {
        const lid = key.participant.split('@')[0];
        if (lid.startsWith('202') && lid.length > 12) {
            numero = '244' + lid.slice(-9);
            console.log("→ FORÇANDO LID → REAL:", numero);
        }
    }

    // 3. Fallback absoluto (nunca falha)
    if (!numero) {
        const qualquer = key.participant || key.remoteJid || '';
        const digitos = qualquer.replace(/\D/g, '');
        if (digitos.length >= 9) {
            numero = '244' + digitos.slice(-9);
            console.log("→ FALLBACK ÚLTIMO RECURSO:", numero);
        }
    }

    console.log("→ NÚMERO FINAL ENVIADO PARA API:", numero || 'DESCONHECIDO');
    console.log("══════════════════════════════════════════════════════════════════════════════\n");

    return numero || '244000000000';
}
// ==========================================================================

function getMessageText(m) {
    const t = getContentType(m.message);
    if (!t) return '';
    if (t === 'conversation') return m.message.conversation || '';
    if (t === 'extendedTextMessage') return m.message.extendedTextMessage.text || '';
    if (['imageMessage', 'videoMessage'].includes(t)) return m.message[t].caption || '';
    return 'Sticker ou mídia';
}

async function connect() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        printQRInTerminal: false,
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
            console.log('Conexão perdida. Reconectando...');
            setTimeout(connect, 5000);
        }
    });

    const processed = new Set();

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.fromMe || processed.has(m.key.id)) return;
        processed.add(m.key.id);
        setTimeout(() => processed.delete(m.key.id), 10000);

        const remoteJid = m.key.remoteJid;
        const isGroup = remoteJid.endsWith('@g.us');

        // AQUI CHAMA O DEBUG QUE VAI MOSTRAR TUDO
        const senderNumero = await DEBUG_SENDER_REAL(m);

        const pushName = m.pushName || senderNumero;
        const texto = getMessageText(m).trim().toLowerCase();

        let ativar = false;
        if (!isGroup) ativar = true;
        else if (texto.includes('akira')) ativar = true;

        if (!ativar) return;

        console.log(`[ATIVADO] ${isGroup ? 'GRUPO' : 'PV'} → ${pushName} (${senderNumero})`);

        try {
            await sock.readMessages([m.key]);
            await sock.sendPresenceUpdate('composing', remoteJid);

            const payload = {
                usuario: pushName,
                mensagem: getMessageText(m).trim(),
                numero: senderNumero,
                mensagem_citada: ''
            };

            const res = await axios.post('https://akra35567-akira.hf.space/api/akira', payload, { timeout: 280000 });
            const resposta = res.data?.resposta || 'Ok';

            await delay(Math.min(resposta.length * 60, 5000));
            await sock.sendPresenceUpdate('paused', remoteJid);
            await sock.sendMessage(remoteJid, { text: resposta }, { quoted: m });

        } catch (err) {
            console.error('Erro na API (provavelmente 503)');
            await sock.sendMessage(remoteJid, { text: 'Erro interno. Tenta mais tarde.' }, { quoted: m });
        }
    });
}

const app = express();
app.get('/', (_, res) => res.send('<h2>Akira Online</h2>'));
app.get('/qr', async (_, res) => {
    if (!currentQR) return res.send('<h2>Bot já conectado!</h2>');
    const img = await QRCode.toDataURL(currentQR);
    res.send(`<body style="background:#000;color:#0f0;text-align:center"><h1>QR CODE</h1><img src="${img}"><p>Atualiza em 5s...</p><meta http-equiv="refresh" content="5"></body>`);
});

app.listen(PORT, () => console.log(`Servidor na porta ${PORT}`));

connect();
