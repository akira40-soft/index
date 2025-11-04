// ===============================================================
// AKIRA BOT — Reply Context + Participant Fix + Dual JID Unify
// ===============================================================

const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers,
  delay,
  DisconnectReason
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const axios = require('axios');
const express = require('express');
const fs = require('fs');

const logger = pino({ level: 'info' });
const AKIRA_API_URL = 'https://akra35567-akira.hf.space/api/akira';
const PORT = process.env.PORT || 8080;

let sock;
let BOT_JID = null;
let BOT_LID = null;
let currentQR = null;
let reconnecting = false;

// ===============================================================
// 🧩 UTILITÁRIOS
// ===============================================================
function extractNumber(jid = '') {
  if (!jid) return 'desconhecido';
  const clean = jid.toString();
  const match = clean.match(/2449\d{8}/);
  if (match) return match[0];
  const local = clean.match(/9\d{8}/);
  if (local) return `244${local[0]}`;
  return clean.replace(/\D/g, '').slice(-12);
}

function normalizeJid(jid = '') {
  if (!jid) return null;
  jid = jid.toString().trim();
  jid = jid.replace(/[:@].*/g, '');
  if (!jid.startsWith('244') && /^9\d{8}$/.test(jid)) jid = '244' + jid;
  return `${jid}@s.whatsapp.net`;
}

function isBotJid(jid = '') {
  if (!jid) return false;
  jid = jid.toString();
  return (
    normalizeJid(jid) === normalizeJid(BOT_JID) ||
    jid.includes(BOT_LID?.split('@')[0])
  );
}

// ===============================================================
// ⚙️ CONEXÃO PRINCIPAL
// ===============================================================
async function connect() {
  if (reconnecting) return;
  reconnecting = true;

  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger,
    browser: Browsers.macOS('Desktop'),
    markOnlineOnConnect: true,
    syncFullHistory: false,
    connectTimeoutMs: 60000,
    printQRInTerminal: false
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      currentQR = qr;
      console.log('📱 QRCode atualizado! Acesse /qr para escanear.');
    }

    if (connection === 'open') {
      BOT_JID = normalizeJid(sock.user.id);
      BOT_LID = sock.user?.lid || BOT_JID.replace('s.whatsapp.net', 'lid');
      reconnecting = false;
      currentQR = null;
      console.log('✅ AKIRA BOT ONLINE!');
      console.log('BOT_JID:', BOT_JID);
      console.log('BOT_LID:', BOT_LID);
    }

    if (connection === 'close') {
      const reason = lastDisconnect?.error?.output?.statusCode || 0;
      if (reason === DisconnectReason.loggedOut) {
        console.log('🔒 Sessão expirada. Limpando auth...');
        fs.rmSync('auth_info_baileys', { recursive: true, force: true });
        process.exit(0);
      }
      console.log(`⚠️ Conexão perdida (${reason}). Reconectando...`);
      reconnecting = false;
      setTimeout(connect, 4000);
    }
  });

  // ===============================================================
  // 💬 MENSAGENS
  // ===============================================================
  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const from = msg.key.remoteJid;
    const isGroup = from.endsWith('@g.us');

    // === CORRIGE PARTICIPANTE REAL ===
    let senderJid =
      msg.key.participant_pn ||
      msg.key.participantAlt ||
      msg.key.participant ||
      msg.message?.extendedTextMessage?.contextInfo?.participant ||
      from;

    const senderNumber = extractNumber(senderJid);
    const nome = msg.pushName || senderNumber;

    // === MENSAGEM E CONTEÚDO ===
    const text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      msg.message?.imageMessage?.caption ||
      msg.message?.videoMessage?.caption ||
      '';

    // === MENSAGEM CITADA (REPLY) ===
    const quoted =
      msg.message?.extendedTextMessage?.contextInfo?.quotedMessage ||
      msg.message?.contextInfo?.quotedMessage;

    let replyText = '';
    if (quoted) {
      // tenta extrair o conteúdo textual da citação
      replyText =
        quoted.conversation ||
        quoted.extendedTextMessage?.text ||
        quoted.imageMessage?.caption ||
        quoted.videoMessage?.caption ||
        '';
    }

    if (!text.trim()) return;

    console.log(
      `\n[MENSAGEM] ${isGroup ? 'GRUPO' : 'PV'} | ${nome} (${senderNumber}): ${text}`
    );

    const ativar = await shouldActivate(msg, isGroup, text);
    if (!ativar) return;

    try {
      await sock.sendPresenceUpdate('composing', from);
      await sock.readMessages([msg.key]); // ✔✔ azul
    } catch (_) {}

    // === PREPARA PAYLOAD COM CONTEXTO DO REPLY ===
    const payload = {
      usuario: nome,
      mensagem: text,
      numero: senderNumber
    };

    if (replyText)
      payload.mensagem += `\n\n🗨️ *Resposta a:* "${replyText.trim()}"`;

    // === ENVIA PARA API ===
    try {
      const res = await axios.post(AKIRA_API_URL, payload);
      const resposta = res.data.resposta || '...';

      console.log(`[RESPOSTA] ${resposta}`);

      await delay(Math.min(resposta.length * 40, 4000));
      await sock.sendPresenceUpdate('paused', from);
      await sock.sendMessage(from, { text: resposta }, { quoted: msg });
    } catch (err) {
      console.error('⚠️ Erro na API:', err.message);
      await sock.sendMessage(from, { text: 'Erro interno. 😴' }, { quoted: msg });
    }
  });
}

// ===============================================================
// 🎯 ATIVAÇÃO (Reply / Menção / PV)
// ===============================================================
async function shouldActivate(msg, isGroup, text) {
  const ctx = msg.message?.extendedTextMessage?.contextInfo;
  const lowered = text.toLowerCase();

  // === REPLY AO BOT (lid ou whatsapp.net) ===
  if (ctx?.participant && isBotJid(ctx.participant)) return true;

  // === MENÇÃO EM GRUPO ===
  if (isGroup) {
    const mentions = ctx?.mentionedJid || [];
    if (mentions.some(isBotJid) || lowered.includes('akira')) return true;
  }

  // === PV ===
  return !isGroup;
}

// ===============================================================
// 🌐 EXPRESS SERVER (Health + QR)
// ===============================================================
const app = express();

app.get('/', (_, res) => res.send('✅ Akira Bot está online e funcional!'));

app.get('/qr', (_, res) => {
  if (!currentQR)
    return res.send(`
      <html><body style="text-align:center;font-family:sans-serif;">
        <h2>✅ Akira já está conectado ao WhatsApp!</h2>
        <p>Se desconectar, recarregue esta página.</p>
      </body></html>
    `);

  const qrImg = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(currentQR)}`;
  res.send(`
    <html><head><meta http-equiv="refresh" content="10"></head>
    <body style="text-align:center;font-family:sans-serif;">
      <h2>📱 Escaneie o QR abaixo para conectar o Akira Bot</h2>
      <img src="${qrImg}" alt="QR Code" />
      <p style="color:gray;">Atualiza automaticamente a cada 10 segundos.</p>
    </body></html>
  `);
});

app.listen(PORT, '0.0.0.0', () =>
  console.log(`🌐 Servidor ativo na porta ${PORT}`)
);

// ===============================================================
// 🚀 INICIA CONEXÃO
// ===============================================================
connect();
