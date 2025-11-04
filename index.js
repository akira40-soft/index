// ===============================================================
// AKIRA BOT — Complete Index.js para Railway com QR HTML
// ===============================================================

const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers,
  delay
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const axios = require('axios');
const express = require('express');
const qrcode = require('qrcode-terminal');

const logger = pino({ level: 'info' });
const AKIRA_API_URL = 'https://akra35567-akira.hf.space/api/akira';
const PORT = process.env.PORT || 8080;

let sock;
let BOT_JID = null;
let lastProcessedTime = 0;
let latestQRCodeData = null;

// ===============================================================
// 🔧 UTILITÁRIOS
// ===============================================================

function extractNumber(input = '') {
  if (!input) return 'desconhecido';
  const clean = input.toString();
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
  if (jid.startsWith('37') || jid.startsWith('202') || jid.length < 9)
    return BOT_JID || '244952786417@s.whatsapp.net';
  if (!jid.startsWith('244') && /^9\d{8}$/.test(jid))
    jid = '244' + jid;
  return `${jid}@s.whatsapp.net`;
}

function isBotJid(jid) {
  const norm = normalizeJid(jid);
  return norm === normalizeJid(BOT_JID);
}

// ===============================================================
// 🔹 FUNÇÃO: Enviar "Dois Tickets Azuis" simulados + marcar como lido
// ===============================================================
async function sendBlueTickets(to, quotedMsg) {
  if (!sock) return;

  const msg1 = await sock.sendMessage(to, {
    text: '🎫 Ticket Azul #1',
    viewOnce: false
  }, { quoted: quotedMsg });

  await sock.readMessages([msg1.key]);
  await delay(500);

  const msg2 = await sock.sendMessage(to, {
    text: '🎫 Ticket Azul #2',
    viewOnce: false
  }, { quoted: quotedMsg });

  await sock.readMessages([msg2.key]);
  await delay(500);

  console.log('✅ Dois Tickets Azuis enviados e marcados como vistos.');
}

// ===============================================================
// ⚙️ CONEXÃO
// ===============================================================
async function connect() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
  const { version } = await fetchLatestBaileysVersion();

  if (sock && sock.user) {
    console.log('🔄 Fechando sessão antiga...');
    await sock.logout();
  }

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
      latestQRCodeData = qr;

      // Console QR
      qrcode.generate(qr, { small: true });
      console.log('\n📱 ESCANEIE O QR PARA CONECTAR\n');

      // HTML QR
      const html = `
        <html>
          <head><title>AKIRA BOT - QR Code</title></head>
          <body style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh;">
            <h2>📱 Escaneie este QR Code no WhatsApp</h2>
            <img src="https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qr)}" />
          </body>
        </html>
      `;
      latestQRCodeHTML = html;
    }

    if (connection === 'open') {
      BOT_JID = normalizeJid(sock.user.id);
      console.log('✅ AKIRA BOT ONLINE!');
      console.log('botJid detectado:', BOT_JID);
      lastProcessedTime = Date.now();
    }

    if (connection === 'close') {
      const reason = lastDisconnect?.error?.output?.statusCode;
      console.log(`⚠️ Conexão perdida (reason: ${reason}). Reconectando em 5s...`);
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

    console.log(`\n[MENSAGEM] ${isGroup ? 'GRUPO' : 'PV'} | ${nome} (${senderNumber}): ${text}`);

    const ativar = await shouldActivate(msg, isGroup, text);
    if (!ativar) {
      console.log('[IGNORADO] Não ativado para responder (não reply ou não menção).');
      return;
    }

    await sock.sendPresenceUpdate('composing', from);

    try {
      if (text.toLowerCase().includes('tickets')) {
        await sendBlueTickets(from, msg);
      }

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
// 🎯 ATIVAÇÃO (reply / menção / PV)
// ===============================================================
async function shouldActivate(msg, isGroup, text) {
  const context = msg.message?.extendedTextMessage?.contextInfo;
  const lowered = text.toLowerCase();

  if (context?.participant) {
    const quoted = normalizeJid(context.participant);
    if (isBotJid(quoted)) {
      console.log(`[ATIVAÇÃO] Reply ao bot detectado (${BOT_JID})`);
      return true;
    }
  }

  if (isGroup) {
    const mentions = context?.mentionedJid || [];
    const mentionMatch = mentions.some(
      j => isBotJid(j) || j.includes(BOT_JID.split('@')[0])
    );
    if (lowered.includes('akira') || mentionMatch) {
      console.log('[ATIVAÇÃO] Menção direta a Akira detectada.');
      return true;
    }
  }

  if (!isGroup) return true;
  return false;
}

// ===============================================================
// 🌐 HEALTH CHECK + QR PAGE
// ===============================================================
const app = express();

app.get('/', (req, res) => res.send('AKIRA BOT ONLINE ✅'));
app.get('/qr', (req, res) => {
  if (latestQRCodeHTML) return res.send(latestQRCodeHTML);
  return res.send('QR Code ainda não gerado.');
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Health check na porta ${server.address().port}`);
});

// ===============================================================
// 🚀 INICIA CONEXÃO
// ===============================================================
connect();
