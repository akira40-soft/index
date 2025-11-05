// ===============================================================
// AKIRA BOT — Debug detalhado + Visualização + Fix PV duplicado
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
const qrcodeTerminal = require('qrcode-terminal');

const logger = pino({ level: 'info' });
const AKIRA_API_URL = 'https://akra35567-akira.hf.space/api/akira';
const PORT = process.env.PORT || 8080;

let sock;
let BOT_JID = null;
let currentQR = null;
let lastProcessedTime = 0;

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
// ⚙️ CONEXÃO
// ===============================================================
async function connect() {
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
      qrcodeTerminal.generate(qr, { small: true });
      console.log('\n📱 ESCANEIE O QR PARA CONECTAR\n');
    }

    if (connection === 'open') {
      BOT_JID = normalizeJid(sock.user.id);
      console.log('✅ AKIRA BOT ONLINE!');
      console.log('BOT_JID detectado:', BOT_JID);
      lastProcessedTime = Date.now();
      currentQR = null;
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
    const timestamp = msg.messageTimestamp * 1000;

    // Evita resposta duplicada no PV ao conectar
    if (timestamp < lastProcessedTime - 5000) return;

    // ===== DEBUG DETALHADO =====
    console.log('\n====================== MENSAGEM RECEBIDA ======================');
    console.log(JSON.stringify({
      remoteJid: msg.key.remoteJid,
      fromMe: msg.key.fromMe,
      participant: msg.key.participant,
      participantAlt: msg.key.participantAlt,
      participant_pn: msg.participant_pn,
      pushName: msg.pushName,
      messageType: Object.keys(msg.message)[0],
      contextInfo: msg.message?.extendedTextMessage?.contextInfo
    }, null, 2));
    console.log('===============================================================\n');

    // ===== IDENTIFICA O REMETENTE =====
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

    // ===== TEXTO E CONTEXTO DO REPLY =====
    const text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      msg.message?.imageMessage?.caption ||
      msg.message?.videoMessage?.caption ||
      '';

    const quotedText =
      msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.conversation ||
      msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.extendedTextMessage?.text ||
      null;

    if (!text.trim()) return;

    console.log(`\n💬 ${isGroup ? 'GRUPO' : 'PV'} | ${nome} (${senderNumber}): ${text}`);
    if (quotedText) console.log(`↪️ (Em resposta a): "${quotedText}"`);

    const ativar = await shouldActivate(msg, isGroup, text);
    if (!ativar) {
      console.log('[IGNORADO] Não ativado (sem menção ou reply).');
      return;
    }

    await sock.sendPresenceUpdate('composing', from);

    try {
      const payload = {
        usuario: nome,
        mensagem: text,
        numero: senderNumber,
        contexto: quotedText || null
      };

      const res = await axios.post(AKIRA_API_URL, payload);
      const resposta = res.data.resposta || '...';

      console.log(`[RESPOSTA] → ${resposta}`);

      // Simula tempo de digitação + double tick azul
      await delay(Math.min(resposta.length * 50, 3000));
      await sock.sendPresenceUpdate('paused', from);
      await sock.readMessages([msg.key]); // marca como lida (✔️✔️ azul)

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
    const mentionMatch = mentions.some(j => isBotJid(j) || j.includes(BOT_JID.split('@')[0]));
    if (lowered.includes('akira') || mentionMatch) {
      console.log('[ATIVAÇÃO] Menção direta a Akira detectada.');
      return true;
    }
  }

  // PV → sempre ativo
  if (!isGroup) return true;
  return false;
}

// ===============================================================
// 🌐 SERVIDOR EXPRESS — Health + QR HTML
// ===============================================================
const app = express();

app.get('/', (_, res) => {
  res.send(`
    <html><body style="font-family:sans-serif;text-align:center;margin-top:10%;">
      <h2>✅ Akira Bot está online!</h2>
      <p>Acesse <a href="/qr">/qr</a> para escanear o QR Code, se necessário.</p>
    </body></html>
  `);
});

app.get('/qr', async (_, res) => {
  if (!currentQR) {
    res.send(`
      <html><body style="font-family:sans-serif;text-align:center;margin-top:10%;">
        <h2>✅ Akira já está conectado ao WhatsApp!</h2>
        <p>Recarregue esta página se desconectar.</p>
      </body></html>
    `);
  } else {
    try {
      const qrBase64 = await QRCode.toDataURL(currentQR);
      res.send(`
        <html><head><meta http-equiv="refresh" content="10"></head>
        <body style="font-family:sans-serif;text-align:center;margin-top:10%;">
          <h2>📱 Escaneie este QR Code no WhatsApp</h2>
          <img src="${qrBase64}" alt="QR Code" />
          <p style="color:gray;">Atualiza automaticamente a cada 10 segundos.</p>
        </body></html>
      `);
    } catch (err) {
      res.status(500).send(`<p>Erro ao gerar QR: ${err.message}</p>`);
    }
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 Servidor ativo na porta ${PORT}`);
  console.log(`🔗 Acesse: http://localhost:${PORT}/qr`);
});

connect();
