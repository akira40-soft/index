// ===============================================================
// AKIRA BOT — versão estável Render + correção QR + sessão de grupo
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
const QRCode = require('qrcode');
const fs = require('fs');

const logger = pino({ level: 'info' });
const AKIRA_API_URL = 'https://akra35567-akira.hf.space/api/akira';
const PORT = process.env.PORT || 3000;

let sock;
let BOT_JID = null;
let lastProcessedTime = 0;

// ===============================================================
// 🔧 FUNÇÕES BASE
// ===============================================================
function normalizeJid(jid = '') {
  if (!jid) return null;
  jid = jid.toString().trim();
  jid = jid.replace(/[:@].*/g, '');
  if (jid.startsWith('37')) return BOT_JID || '244952786417@s.whatsapp.net';
  if (!jid.startsWith('244') && /^9\d{8}$/.test(jid)) jid = '244' + jid;
  return `${jid}@s.whatsapp.net`;
}

function extractNumber(input = '') {
  if (!input) return 'desconhecido';
  const clean = input.toString();
  const match = clean.match(/2449\d{8}/);
  if (match) return match[0];
  const matchLocal = clean.match(/9\d{8}/);
  if (matchLocal) return `244${matchLocal[0]}`;
  return clean.replace(/\D/g, '').slice(-12);
}

function isBotJid(jid) {
  const norm = normalizeJid(jid);
  return norm === normalizeJid(BOT_JID);
}

// ===============================================================
// ⚙️ CONEXÃO PRINCIPAL
// ===============================================================
async function connect() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger,
    browser: Browsers.macOS('AkiraBot'),
    markOnlineOnConnect: true,
    syncFullHistory: false,
    connectTimeoutMs: 60000
  });

  sock.ev.on('creds.update', saveCreds);

  // ===============================================================
  // 🔳 QR CODE — otimizado para Render (fundo sólido)
  // ===============================================================
  sock.ev.on('connection.update', async (update) => {
    const { connection, qr } = update;

    if (qr) {
      console.clear();
      console.log('\n==============================');
      console.log('📱 ESCANEIE O QR ABAIXO PARA CONECTAR:\n');
      try {
        const qrString = await QRCode.toString(qr, {
          type: 'terminal',
          margin: 1,
          scale: 1,
          small: true
        });
        console.log(qrString);
      } catch (err) {
        console.log('Erro ao gerar QR:', err.message);
      }
      console.log('\n==============================\n');
    }

    if (connection === 'open') {
      BOT_JID = normalizeJid(sock.user.id);
      console.log('✅ AKIRA BOT ONLINE!');
      console.log('botJid detectado:', BOT_JID);
      lastProcessedTime = Date.now();
    }

    if (connection === 'close') {
      console.log('⚠️ Conexão perdida. Tentando reconectar...');
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

    let sender = msg.key.participant || msg.participant || from;
    let senderNumber = extractNumber(sender);
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
      console.log('[IGNORADO] Não ativado (não reply/nem menção/nem PV).');
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

      await delay(Math.min(resposta.length * 50, 5000));
      await sock.sendPresenceUpdate('paused', from);

      await sock.sendMessage(from, { text: resposta }, { quoted: msg });
      if (!isGroup) return;
    } catch (err) {
      console.error('⚠️ Erro na API:', err.message);
      await sock.sendMessage(from, { text: 'Erro interno. 😴' }, { quoted: msg });
    }
  });

  // ===============================================================
  // 🔒 RECUPERAÇÃO DE SESSÕES CORROMPIDAS
  // ===============================================================
  sock.ev.on('message-decrypt-failed', async (msgKey) => {
    try {
      const jid = msgKey?.key?.remoteJid;
      if (!jid) return;
      console.warn(`⚠️ Falha ao descriptografar mensagem de ${jid}. Tentando re-sincronizar...`);
      await sock.sendRetryRequest(msgKey.key).catch(() => {});
      if (sock.store?.sessions) delete sock.store.sessions[jid];
      await sock.presenceSubscribe(jid).catch(() => {});
    } catch (e) {
      console.error('Erro ao tentar recuperar sessão perdida:', e?.message || e);
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

  // Menção direta
  if (isGroup) {
    const mentions = context?.mentionedJid || [];
    const mentionMatch = mentions.some(j => isBotJid(j) || j.startsWith('37') || j.includes(BOT_JID.split('@')[0]));
    if (lowered.includes('akira') || mentionMatch) {
      console.log('[ATIVAÇÃO] Menção direta a Akira detectada.');
      return true;
    }
  }

  // PV sempre responde
  if (!isGroup) return true;

  return false;
}

// ===============================================================
// 🩹 PATCH CONTRA ERROS DE GRUPO (senderMessageKeys)
// ===============================================================
process.on('uncaughtException', async (err) => {
  if (err?.message?.includes("senderMessageKeys") || err?.message?.includes("No SenderKeyRecord")) {
    console.log("⚠️ Erro de sessão corrompida detectado. Reinicializando chaves de grupo...");
    try {
      const authDir = './auth_info_baileys';
      fs.readdirSync(authDir).forEach(f => {
        if (f.includes('sender-key') || f.includes('app-state-sync')) {
          fs.unlinkSync(`${authDir}/${f}`);
        }
      });
      console.log("🔑 Chaves de grupo limpas com sucesso. Reconectando...");
      setTimeout(() => connect(), 4000);
    } catch (e) {
      console.error("Erro ao limpar cache:", e.message);
      process.exit(1);
    }
  } else {
    console.error("⚠️ Erro inesperado:", err);
  }
});

// ===============================================================
// 🌐 HEALTH CHECK SERVER
// ===============================================================
const app = express();
app.get('/', (req, res) => res.send('AKIRA BOT ONLINE ✅'));
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Health check na porta ${server.address().port}`);
});

connect();
