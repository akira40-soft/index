// ===============================================================
// AKIRA BOT — Baileys + QR HTML + Sessão Persistente + Reconexão
// ===============================================================

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  Browsers
} = require('@whiskeysockets/baileys');
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const qrcodeTerminal = require('qrcode-terminal'); // ✅ gera QR no terminal
const pino = require('pino');

const PORT = process.env.PORT || 8080;
const AKIRA_API_URL = process.env.AKIRA_API_URL || 'https://akira-api-production.up.railway.app/responder';

let sock;
let BOT_JID = null;
let currentQR = null;
let reconnecting = false;

// ===============================================================
// 🔧 FUNÇÕES AUXILIARES
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
  if (!jid.startsWith('244') && /^9\d{8}$/.test(jid)) jid = '244' + jid;
  return `${jid}@s.whatsapp.net`;
}

function isBotJid(jid) {
  return normalizeJid(jid) === normalizeJid(BOT_JID);
}

// ===============================================================
// 🔗 CONEXÃO PRINCIPAL
// ===============================================================
async function connect() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

  sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    browser: Browsers.macOS('Desktop'),
    markOnlineOnConnect: true,
    syncFullHistory: false,
    printQRInTerminal: false // Desligado para usar nosso QR personalizado
  });

  sock.ev.on('creds.update', saveCreds);

  // ===============================================================
  // 🧠 EVENTOS DE CONEXÃO
  // ===============================================================
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      currentQR = qr;
      console.log('📲 Escaneie o QR exibido no terminal ou em /qr');
      qrcodeTerminal.generate(qr, { small: true }); // ✅ QR no terminal
    }

    if (connection === 'open') {
      BOT_JID = sock.user?.id;
      currentQR = null;
      console.log('✅ AKIRA BOT ONLINE!');
      console.log('🧠 botJid detectado:', BOT_JID);
    }

    if (connection === 'close') {
      const reason = lastDisconnect?.error?.output?.statusCode || 0;
      if (reason === DisconnectReason.loggedOut) {
        console.log('🔒 Sessão expirada. Limpando auth...');
        fs.rmSync('auth_info_baileys', { recursive: true, force: true });
        process.exit(0);
      }
      console.log(`⚠️ Conexão perdida (reason: ${reason}). Tentando reconectar...`);
      reconnecting = false;
      setTimeout(connect, 5000);
    }
  });

  // ===============================================================
  // 💬 RECEBIMENTO DE MENSAGENS
  // ===============================================================
  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const from = msg.key.remoteJid;
    const isGroup = from.endsWith('@g.us');

    let senderJid;
    if (isGroup) {
      const alt = msg.key.participantAlt || '';
      const main = msg.key.participant || '';
      const ctx = msg.message?.extendedTextMessage?.contextInfo?.participant || '';
      senderJid =
        [alt, main, ctx].find(j => j && j.includes('@whatsapp.net')) ||
        alt || main || ctx || from;
    } else {
      senderJid = msg.key.remoteJid;
    }

    const senderNumber = extractNumber(senderJid);
    const nome = msg.pushName || 'Usuário';
    const text =
      msg.message.conversation ||
      msg.message?.extendedTextMessage?.text ||
      msg.message?.imageMessage?.caption ||
      '';

    if (!text.trim()) return;

    console.log(`\n[MENSAGEM] ${isGroup ? 'GRUPO' : 'PV'} | ${nome} (${senderNumber}): ${text}`);

    const ativar = await shouldActivate(msg, isGroup, text);
    if (!ativar) return;

    try {
      await sock.sendPresenceUpdate('composing', from);
      await sock.readMessages([msg.key]);
    } catch (e) {
      console.log('⚠️ Falha ao marcar leitura:', e.message);
    }

    // ===== Envio da mensagem para API Akira =====
    try {
      const res = await axios.post(AKIRA_API_URL, {
        usuario: nome,
        mensagem: text,
        numero: senderNumber,
        grupo: isGroup
      });

      const resposta = res.data?.resposta || '⚠️ Erro na resposta da Akira.';
      await sock.sendMessage(from, { text: resposta }, { quoted: msg });
    } catch (err) {
      console.error('❌ Erro ao comunicar com a Akira API:', err.message);
      await sock.sendMessage(from, { text: '❌ Erro temporário na IA Akira.' }, { quoted: msg });
    }
  });

  sock.ev.on('message-decrypt-failed', async () => {
    console.log('⚠️ Mensagem não descriptografada — tentando regenerar sessão...');
    await connect();
  });
}

// ===============================================================
// 🎯 ATIVAÇÃO (Reply / Menção / PV)
// ===============================================================
async function shouldActivate(msg, isGroup, text) {
  const context = msg.message?.extendedTextMessage?.contextInfo;
  const lowered = text.toLowerCase();

  if (context?.participant && isBotJid(context.participant)) return true;
  if (isGroup) {
    const mentions = context?.mentionedJid || [];
    if (mentions.some(j => isBotJid(j)) || lowered.includes('akira')) return true;
    return false;
  }
  return true;
}

// ===============================================================
// 🌐 EXPRESS SERVER — Health + QR Web
// ===============================================================
const app = express();

app.get('/', (_, res) => res.send('✅ Akira Bot está online!'));

app.get('/qr', (_, res) => {
  if (!currentQR) {
    return res.send(`
      <html><body style="text-align:center;font-family:sans-serif;">
        <h2>✅ Akira já está conectado ao WhatsApp!</h2>
        <p>Se desconectar, recarregue esta página.</p>
      </body></html>
    `);
  }

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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 Servidor ativo na porta ${PORT}`);
  console.log(`🔗 Acesse para escanear o QR: http://localhost:${PORT}/qr`);
});

// ===============================================================
// 🚀 Inicializa Conexão
// ===============================================================
connect();
