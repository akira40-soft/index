import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import axios from 'axios';
import express from 'express';
import qrcode from 'qrcode';
import P from 'pino';
import fs from 'fs';
import { Boom } from '@hapi/boom';

const AKIRA_API_URL = process.env.AKIRA_API_URL || 'https://akira-api.onrender.com/responder';
const PORT = process.env.PORT || 8080;

// ===============================================================
// 🔹 EXPRESS SERVER (rota para QRCode visível no Railway)
// ===============================================================
const app = express();
let qrCodeData = null; // armazena o último QR gerado

app.get('/', (req, res) => {
  res.send(`<h1>✅ Akira-Baileys ativo!</h1>
            <p>Acesse <a href="/qr">/qr</a> para escanear o QRCode do WhatsApp.</p>`);
});

app.get('/qr', async (req, res) => {
  if (!qrCodeData) {
    return res.send('<h2>⏳ Nenhum QRCode disponível no momento. Aguarde...</h2>');
  }
  try {
    const qrImage = await qrcode.toDataURL(qrCodeData);
    res.send(`
      <html>
      <head><title>QR Code Akira</title></head>
      <body style="text-align:center; font-family:sans-serif; background:#111; color:#eee;">
        <h1>📱 Escaneie o QRCode abaixo:</h1>
        <img src="${qrImage}" style="width:300px; border:8px solid #333; border-radius:20px;" />
        <p>Atualize esta página se o código expirar.</p>
      </body>
      </html>
    `);
  } catch (err) {
    res.send('Erro ao gerar QRCode.');
  }
});

app.listen(PORT, () => {
  console.log(`🌐 Servidor ativo na porta ${PORT}`);
  console.log(`🔗 Acesse: http://localhost:${PORT}/qr`);
});

// ===============================================================
// 🔹 Funções auxiliares
// ===============================================================
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
function extractNumber(jid = '') {
  return jid.replace(/\D/g, '').replace(/@.*/, '');
}
function normalizeJid(jid = '') {
  return jid.toString().replace('@s.whatsapp.net', '').replace('@lid', '').replace(/\D/g, '');
}

// ===============================================================
// 🔹 Inicialização do Baileys
// ===============================================================
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    printQRInTerminal: false, // desativa QR no terminal
    auth: state,
    logger: P({ level: 'silent' }),
    syncFullHistory: false,
    markOnlineOnConnect: true
  });

  sock.ev.on('creds.update', saveCreds);

  // ===============================================================
  // 🔹 Atualiza QR em tempo real
  // ===============================================================
  sock.ev.on('connection.update', (update) => {
    const { connection, qr, lastDisconnect } = update;

    if (qr) {
      qrCodeData = qr;
      console.log('📱 QRCode atualizado! Acesse /qr para escanear.');
    }

    if (connection === 'open') {
      qrCodeData = null;
      console.log('✅ AKIRA BOT ONLINE!');
      console.log('BOT_JID:', sock.user.id);
      console.log('BOT_LID:', sock.user?.lid || 'sem LID');
    }

    if (connection === 'close') {
      const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
      console.log(`⚠️ Conexão perdida (${reason}). Reconectando...`);
      if (reason !== DisconnectReason.loggedOut) startBot();
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

    // === PARTICIPANTE REAL (prioridade correta)
    let senderJid =
      msg.key.participantAlt ||
      msg.key.participant_pn ||
      msg.key.participant ||
      msg.message?.extendedTextMessage?.contextInfo?.participant ||
      from;

    const senderNumber = extractNumber(senderJid);
    const nome = msg.pushName || senderNumber;

    // === CONTEÚDO PRINCIPAL
    const text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      msg.message?.imageMessage?.caption ||
      msg.message?.videoMessage?.caption ||
      '';

    // === MENSAGEM CITADA (REPLY)
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

    if (!text.trim()) return;

    console.log(
      `\n[MENSAGEM] ${isGroup ? 'GRUPO' : 'PV'} | ${nome} (${senderNumber}): ${text}`
    );

    // === ATIVAÇÃO (verifica menções e replies)
    const ativar = await shouldActivate(sock, msg, isGroup, text);
    if (!ativar) return;

    try {
      await sock.sendPresenceUpdate('composing', from);
      await sock.readMessages([msg.key]);
    } catch (_) {}

    // === ENVIA PARA API COM CONTEXTO
    const payload = {
      usuario: nome,
      mensagem: text,
      numero: senderNumber
    };

    if (replyText)
      payload.mensagem += `\n\n🗨️ *Resposta a:* "${replyText.trim()}"`;

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

  return sock;
}

// ===============================================================
// 🎯 ATIVAÇÃO (Reply / Menção / PV)
// ===============================================================
async function shouldActivate(sock, msg, isGroup, text) {
  const ctx = msg.message?.extendedTextMessage?.contextInfo;
  const lowered = text.toLowerCase();

  const BOT_JID = sock.user?.id || '';
  const BOT_LID = sock.user?.lid || '';
  const mentions = ctx?.mentionedJid || [];

  if (mentions.length > 0) console.log('📣 JIDs mencionados:', mentions);

  // Reply direto ao bot
  if (ctx?.participant && isBotJid(ctx.participant, BOT_JID, BOT_LID)) {
    console.log('↩️ Reply direto ao bot detectado via', ctx.participant);
    return true;
  }

  // Menção ao bot em grupo
  if (isGroup) {
    const mentioned = mentions.some((jid) => isBotJid(jid, BOT_JID, BOT_LID));
    if (mentioned || lowered.includes('akira')) {
      console.log('📢 Menção ao bot detectada no grupo');
      return true;
    }
  }

  // Mensagem privada
  return !isGroup;
}

// ===============================================================
// 🧩 Comparador de JIDs com fallback simultâneo
// ===============================================================
function isBotJid(jid = '', botJid = '', botLid = '') {
  if (!jid) return false;
  jid = jid.toString();

  const normalized = normalizeJid(jid);
  const botNet = normalizeJid(botJid);
  const botLidNum = botLid?.split('@')[0] || '';

  if (normalized === botNet || jid.includes(botLidNum)) return true;

  const numA = extractNumber(jid);
  const numB = extractNumber(botJid);
  return numA === numB;
}

// ===============================================================
startBot();
