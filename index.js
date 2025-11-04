// ===============================================================
// AKIRA BOT — Stable Baileys + Session Fix + Reply PV/Group Logic
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
const qrcode = require('qrcode-terminal');
const fs = require('fs');

// ===============================================================
// 🔧 CONFIGURAÇÕES
// ===============================================================
const logger = pino({ level: 'info' });
const AKIRA_API_URL = 'https://akra35567-akira.hf.space/api/akira';
const PORT = process.env.PORT || 3000;

let sock;
let BOT_JID = null;
let lastProcessedTime = 0;
let reconnecting = false;

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
// ⚙️ CONEXÃO ESTÁVEL COM RECONEXÃO AUTOMÁTICA
// ===============================================================
async function connect() {
  if (reconnecting) return; // evita reconexões múltiplas simultâneas
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
      qrcode.generate(qr, { small: true });
      console.log('\n📱 ESCANEIE O QR PARA CONECTAR\n');
    }

    if (connection === 'open') {
      BOT_JID = normalizeJid(sock.user.id);
      reconnecting = false;
      console.log('✅ AKIRA BOT ONLINE!');
      console.log('botJid detectado:', BOT_JID);
      lastProcessedTime = Date.now();
    }

    if (connection === 'close') {
      const reason = lastDisconnect?.error?.output?.statusCode || 0;

      // Se foi logout manual (ex: escaneou outro QR), apagar sessão
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

    // ===== EXTRAÇÃO DO NÚMERO =====
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

  // ===============================================================
  // 🔄 RECUPERAÇÃO DE SESSÃO PERDIDA
  // ===============================================================
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

  // Reply ao bot
  if (context?.participant) {
    const quoted = normalizeJid(context.participant);
    if (isBotJid(quoted)) {
      console.log(`[ATIVAÇÃO] Reply ao bot detectado (${BOT_JID})`);
      return true;
    }
  }

  // Menção direta no grupo
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

  // PV → sempre responde
  if (!isGroup) return true;
  return false;
}

// ===============================================================
// 🌐 HEALTH CHECK
// ===============================================================
const app = express();
app.get('/', (req, res) => res.send('AKIRA BOT ONLINE ✅'));
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Health check na porta ${server.address().port}`);
});

// ===============================================================
// 🚀 INICIA CONEXÃO
// ===============================================================
connect();
