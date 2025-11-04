import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import axios from 'axios';
import express from 'express';
import qrcode from 'qrcode-terminal';
import P from 'pino';
import fs from 'fs';

const AKIRA_API_URL = process.env.AKIRA_API_URL || 'https://akira-api.onrender.com/responder';
const PORT = process.env.PORT || 8080;

// ===============================================================
// 🔹 EXPRESS SERVER (para QRCode)
// ===============================================================
const app = express();
app.get('/', (req, res) => res.send('✅ Akira-Baileys está rodando.'));
app.listen(PORT, () =>
  console.log(`🌐 Servidor ativo na porta ${PORT}\n🔗 Acesse: http://localhost:${PORT}/qr`)
);

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
    printQRInTerminal: true,
    auth: state,
    logger: P({ level: 'silent' }),
    syncFullHistory: false,
    markOnlineOnConnect: true
  });

  sock.ev.on('creds.update', saveCreds);

  // ===============================================================
  // 🔹 Conexão e Log
  // ===============================================================
  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'close') {
      const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
      console.log(`⚠️ Conexão perdida (${reason}). Reconectando...`);
      if (reason !== DisconnectReason.loggedOut) startBot();
    } else if (connection === 'open') {
      console.log('✅ AKIRA BOT ONLINE!');
      console.log('BOT_JID:', sock.user.id);
      console.log('BOT_LID:', sock.user?.lid || 'sem LID');
    } else if (update.qr) {
      console.log('📱 QRCode atualizado! Acesse /qr para escanear.');
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

    // === PARTICIPANTE REAL (com prioridade correta)
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
// 🎯 ATIVAÇÃO (Reply / Menção / PV) — com fallback duplo real
// ===============================================================
async function shouldActivate(sock, msg, isGroup, text) {
  const ctx = msg.message?.extendedTextMessage?.contextInfo;
  const lowered = text.toLowerCase();

  const BOT_JID = sock.user?.id || '';
  const BOT_LID = sock.user?.lid || '';
  const mentions = ctx?.mentionedJid || [];

  if (mentions.length > 0) {
    console.log('📣 JIDs mencionados:', mentions);
  }

  // === REPLY DIRETO AO BOT (lid ou whatsapp.net)
  if (ctx?.participant && isBotJid(ctx.participant, BOT_JID, BOT_LID)) {
    console.log('↩️ Reply direto ao bot detectado via', ctx.participant);
    return true;
  }

  // === MENÇÃO AO BOT EM GRUPO
  if (isGroup) {
    const mentioned = mentions.some((jid) => isBotJid(jid, BOT_JID, BOT_LID));
    if (mentioned || lowered.includes('akira')) {
      console.log('📢 Menção ao bot detectada no grupo');
      return true;
    }
  }

  // === MENSAGEM PRIVADA
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
