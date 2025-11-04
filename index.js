// ===============================================================
// AKIRA BOT — QR via /qr + Reconexão estável + Sessão persistente
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

// ===============================================================
// ⚙️ CONFIGURAÇÕES
// ===============================================================
const logger = pino({ level: 'info' });
const AKIRA_API_URL = 'https://akra35567-akira.hf.space/api/akira';
const PORT = process.env.PORT || 8080;

let sock;
let BOT_JID = null;
let lastProcessedTime = 0;
let reconnecting = false;
let currentQR = null;

// ===============================================================
// 🔧 UTILITÁRIOS
// ===============================================================
function extractNumber(input = '') {
  if (!input) return 'desconhecido';
  const clean = input.toString();
  const match = clean.match(/2449\\d{8}/);
  if (match) return match[0];
  const local = clean.match(/9\\d{8}/);
  if (local) return `244${local[0]}`;
  return clean.replace(/\\D/g, '').slice(-12);
}

function normalizeJid(jid = '') {
  if (!jid) return null;
  jid = jid.toString().trim();
  jid = jid.replace(/[:@].*/g, '');
  if (jid.startsWith('37') || jid.startsWith('202') || jid.length < 9)
    return BOT_JID || '244952786417@s.whatsapp.net';
  if (!jid.startsWith('244') && /^9\\d{8}$/.test(jid))
    jid = '244' + jid;
  return `${jid}@s.whatsapp.net`;
}

function isBotJid(jid) {
  const norm = normalizeJid(jid);
  return norm === normalizeJid(BOT_JID);
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
    connectTimeoutMs: 60000
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
      reconnecting = false;
      currentQR = null;
      console.log('✅ AKIRA BOT ONLINE!');
      console.log('botJid detectado:', BOT_JID);
      lastProcessedTime = Date.now();
    }

    if (connection === 'close') {
      const reason = lastDisconnect?.error?.output?.statusCode || 0;
      if (reason === DisconnectReason.loggedOut) {
        console.log('🔒 Sessão expirada. Removendo auth_info_baileys...');
        fs.rmSync('auth_info_baileys', { recursive: true, force: true });
        process.exit(0);
      }
      console.log(`⚠️ Conexão perdida (reason: ${reason}). Tentando reconectar...`);
      reconnecting = false;
      setTimeout(connect, 5000);
    }
  });

  // ===============================================================
  // 💬 MENSAGENS
  // ===============================================================
  sock.ev.on('messages.upsert', async (m) => {
    const msg = m.messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const from = msg.key.remoteJid;
    const isGroup = from.endsWith('@g.us');
    if (msg.messageTimestamp && msg.messageTimestamp * 1000 < lastProcessedTime - 10000) return;

    let senderJid;
    if (isGroup) {
      senderJid =
        msg.key.participantAlt ||
        msg.key.participant ||
        msg.message?.extendedTextMessage?.contextInfo?.participant ||
        msg.key.remoteJid;
    } else {
      senderJid = msg.key.remoteJid;
    }

    const senderNumber = extractNumber(senderJid);
    const nome = msg.pushName || senderNumber;

    const text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      msg.message?.imageMessage?.caption ||
      msg.message?.videoMessage?.caption ||
      '';

    if (!text.trim()) return;

    console.log(`\\n[MENSAGEM] ${isGroup ? 'GRUPO' : 'PV'} | ${nome} (${senderNumber}): ${text}`);

    const ativar = await shouldActivate(msg, isGroup, text);
    if (!ativar) return;

    await sock.sendPresenceUpdate('composing', from);

    try {
      const res = await axios.post(AKIRA_API_URL, {
        usuario: nome,
        mensagem: text,
        numero: senderNumber
      });

      const resposta = res.data.resposta || '...';
      console.log(`[RESPOSTA] ${resposta}`);

      await delay(Math.min(resposta.length * 50, 4000));
      await sock.sendPresenceUpdate('paused', from);
      await sock.sendMessage(from, { text: resposta }, { quoted: msg });
    } catch (err) {
      console.error('⚠️ Erro na API:', err.message);
      await sock.sendMessage(from, { text: 'Erro interno. 😴' }, { quoted: msg });
    }
  });

  sock.ev.on('message-decrypt-failed', async (msgKey) => {
    console.log('⚠️ Tentando regenerar sessão perdida...');
    try {
      await sock.sendRetryRequest(msgKey.key);
    } catch (e) {
      console.log('❌ Falha ao regenerar sessão:', e.message);
    }
  });
}

// ===============================================================
// 🎯 ATIVAÇÃO
// ===============================================================
async function shouldActivate(msg, isGroup, text) {
  const context = msg.message?.extendedTextMessage?.contextInfo;
  const lowered = text.toLowerCase();

  if (context?.participant && isBotJid(normalizeJid(context.participant))) return true;
  if (isGroup) {
    const mentions = context?.mentionedJid || [];
    if (mentions.some(j => isBotJid(j)) || lowered.includes('akira')) return true;
  }
  return !isGroup;
}

// ===============================================================
// 🌐 EXPRESS SERVER (health + QR)
// ===============================================================
const app = express();

app.get('/', (req, res) => res.send('AKIRA BOT ONLINE ✅'));

app.get('/qr', (req, res) => {
  if (!currentQR) {
    res.send(`
      <html>
        <head><title>QR Code Akira</title></head>
        <body style="font-family:sans-serif;text-align:center;">
          <h2>✅ Akira já está conectado ao WhatsApp!</h2>
          <p>Se desconectar, recarregue esta página.</p>
        </body>
      </html>
    `);
    return;
  }

  const qrImg = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(currentQR)}`;
  res.send(`
    <html>
      <head>
        <meta http-equiv="refresh" content="10">
        <title>Escaneie o QR Code - Akira</title>
      </head>
      <body style="font-family:sans-serif;text-align:center;">
        <h2>📱 Escaneie este QR para conectar o Akira Bot</h2>
        <img src="${qrImg}" alt="QR Code do WhatsApp"/>
        <p style="color:gray;">Atualiza automaticamente a cada 10 segundos.</p>
      </body>
    </html>
  `);
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 Servidor ativo na porta ${PORT}`);
  console.log(`🔗 Acesse para escanear o QR: http://localhost:${PORT}/qr`);
});

// ===============================================================
// 🚀 INICIA CONEXÃO
// ===============================================================
connect();
