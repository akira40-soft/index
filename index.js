import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers
} from '@whiskeysockets/baileys';
import express from 'express';
import axios from 'axios';
import qrcode from 'qrcode';
import P from 'pino';

const AKIRA_API_URL = process.env.AKIRA_API_URL || 'https://akra35567-akira.hf.space/api/akira';
const PORT = process.env.PORT || 8080;

let sock;
let BOT_JID = null;
let lastProcessedTime = 0;
let qrCodeData = null;

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
// 🌐 EXPRESS SERVER / QR
// ===============================================================
const app = express();

app.get('/', (req, res) => {
  res.send(`<h1>✅ Akira-Baileys ativo!</h1><p>/qr para escanear WhatsApp</p>`);
});

app.get('/qr', async (req, res) => {
  if (!qrCodeData) return res.send('<h2>⏳ Nenhum QRCode disponível. Aguarde...</h2>');
  const qrImage = await qrcode.toDataURL(qrCodeData);
  res.send(`<img src="${qrImage}" style="width:300px;"/>`);
});

app.listen(PORT, () => console.log(`🌐 Servidor ativo na porta ${PORT}`));

// ===============================================================
// ⚙️ INICIALIZAÇÃO DO BOT
// ===============================================================
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger: P({ level: 'silent' }),
    browser: Browsers.macOS('Desktop'),
    markOnlineOnConnect: true,
    syncFullHistory: false,
    printQRInTerminal: false
  });

  sock.ev.on('creds.update', saveCreds);

  // ===============================================================
  // 🔹 CONEXÃO E QR
  sock.ev.on('connection.update', (update) => {
    const { connection, qr, lastDisconnect } = update;

    if (qr) {
      qrCodeData = qr;
      console.log('📱 QRCode atualizado! /qr');
    }

    if (connection === 'open') {
      qrCodeData = null;
      BOT_JID = normalizeJid(sock.user?.id);
      lastProcessedTime = Date.now();
      console.log('✅ AKIRA BOT ONLINE!', BOT_JID);
    }

    if (connection === 'close') {
      const reason = lastDisconnect?.error?.output?.statusCode;
      console.log(`⚠️ Conexão perdida (${reason}). Reconectando...`);
      if (reason !== DisconnectReason.loggedOut) setTimeout(startBot, 5000);
    }
  });

  // ===============================================================
  // 💬 MENSAGENS
  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const from = msg.key.remoteJid;
    const isGroup = from.endsWith('@g.us');

    // ===== EXTRAÇÃO DO REMETENTE
    let senderJid = msg.key.remoteJid;
    if (isGroup) {
      senderJid =
        msg.key.participantAlt ||
        msg.key.participant ||
        msg.message?.extendedTextMessage?.contextInfo?.participant ||
        msg.key.remoteJid;
    }
    const senderNumber = extractNumber(senderJid);
    const nome = msg.pushName || senderNumber;

    // ===== MENSAGEM
    const text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      msg.message?.imageMessage?.caption ||
      msg.message?.videoMessage?.caption ||
      '';
    if (!text.trim()) return;

    // ===== REPLY
    const quoted =
      msg.message?.extendedTextMessage?.contextInfo?.quotedMessage ||
      msg.message?.contextInfo?.quotedMessage;
    let replyText = '';
    if (quoted) {
      replyText =
        quoted.conversation ||
        quoted.extendedTextMessage?.text ||
        quoted.imageMessage?.caption ||
        quoted.videoMessage?.caption ||
        '';
    }

    console.log(`\n[MENSAGEM] ${isGroup ? 'GRUPO' : 'PV'} | ${nome} (${senderNumber}): ${text}`);

    const ativar = await shouldActivate(msg, isGroup, text);
    if (!ativar) return;

    await sock.sendPresenceUpdate('composing', from);

    try {
      const payload = {
        usuario: nome,
        mensagem: text + (replyText ? `\n\n🗨️ *Resposta a:* "${replyText.trim()}"` : ''),
        numero: senderNumber
      };

      const res = await axios.post(AKIRA_API_URL, payload);
      const resposta = res.data.resposta || '...';

      console.log(`[RESPOSTA] ${resposta}`);
      await sock.sendPresenceUpdate('paused', from);
      await sock.sendMessage(from, { text: resposta }, { quoted: msg });
    } catch (err) {
      console.error('⚠️ Erro na API:', err.message);
      await sock.sendMessage(from, { text: 'Erro interno. 😴' }, { quoted: msg });
    }
  });
}

// ===============================================================
// 🎯 ATIVAÇÃO (reply / menção / PV)
async function shouldActivate(msg, isGroup, text) {
  const ctx = msg.message?.extendedTextMessage?.contextInfo;
  const lowered = text.toLowerCase();

  // Reply ao bot
  if (ctx?.participant) {
    if (isBotJid(ctx.participant)) {
      console.log('[ATIVAÇÃO] Reply ao bot detectado.');
      return true;
    }
  }

  // Menção direta no grupo
  if (isGroup) {
    const mentions = ctx?.mentionedJid || [];
    if (mentions.some(j => isBotJid(j)) || lowered.includes('akira')) {
      console.log('[ATIVAÇÃO] Menção direta a Akira detectada.');
      return true;
    }
  }

  // PV → sempre responde
  if (!isGroup) return true;
  return false;
}

// ===============================================================
// 🚀 INICIA BOT
startBot();
