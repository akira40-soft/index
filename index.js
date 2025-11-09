// ===============================================================
// AKIRA BOT — Baileys v6.7.8 (fix: número real, visto, entregue)
// ===============================================================
import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers,
  delay,
  getContentType
} from '@whiskeysockets/baileys';
import pino from 'pino';
import axios from 'axios';
import express from 'express';
import * as QRCode from 'qrcode';

const logger = pino({ level: 'info' }, pino.destination(1));
const AKIRA_API_URL = 'https://akra35567-akira.hf.space/api/akira';
const PORT = process.env.PORT || 8080;

let sock;
let BOT_JID = null;
let lastProcessedTime = 0;
let currentQR = null;

// ===============================================================
// FUNÇÕES AUXILIARES
// ===============================================================

function extractNumber(input = '') {
  if (!input) return 'desconhecido';
  const match = input.match(/(\d{12})/);
  return match ? match[1] : input.replace(/\D/g, '').slice(-12);
}

function normalizeJid(jid = '') {
  if (!jid) return null;
  jid = jid.toString().trim().replace(/[:@].*/g, '');
  if (!jid.startsWith('244') && /^9\d{8}$/.test(jid)) jid = '244' + jid;
  return `${jid}@s.whatsapp.net`;
}

function getMessageText(message) {
  const messageType = getContentType(message);
  switch (messageType) {
    case 'conversation':
      return message.conversation;
    case 'extendedTextMessage':
      return message.extendedTextMessage.text;
    case 'imageMessage':
    case 'videoMessage':
      return message[messageType].caption || '';
    case 'stickerMessage':
      return 'Sticker (figurinha)';
    default:
      return '';
  }
}

function getJidNumberPart(jid) {
  if (!jid) return '';
  return jid.replace(/@.*/, '').replace(/:\d+$/, '');
}

function isBotJid(jid) {
  if (!BOT_JID) return false;
  const botClean = getJidNumberPart(BOT_JID);
  const checkClean = getJidNumberPart(jid);
  return botClean === checkClean;
}

// ===============================================================
// ATIVAÇÃO
// ===============================================================
async function shouldActivate(msg, isGroup, text, quotedSenderJid, mensagemCitada) {
  const context =
    msg.message?.extendedTextMessage?.contextInfo ||
    msg.message?.imageMessage?.contextInfo ||
    msg.message?.videoMessage?.contextInfo;
  const lowered = text.toLowerCase();
  let activationReason = 'NÃO ATIVADO';

  if (quotedSenderJid && isBotJid(quotedSenderJid))
    activationReason = `REPLY ao JID: ${quotedSenderJid}`;
  else if (isGroup) {
    const mentions = context?.mentionedJid || [];
    if (mentions.some((j) => isBotJid(j))) activationReason = 'MENÇÃO direta';
    else if (lowered.includes('akira')) activationReason = 'PALAVRA-CHAVE "akira"';
  } else activationReason = 'CHAT PRIVADO';

  const ativar = activationReason !== 'NÃO ATIVADO';
  logger.info(`[ATIVAR] ${ativar ? 'SIM' : 'NÃO'} | Motivo: ${activationReason}`);
  return ativar;
}

// ===============================================================
// CONEXÃO
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
      console.clear();
      logger.info('📱 ESCANEIE O QR PARA CONECTAR');
    }
    if (connection === 'open') {
      BOT_JID = normalizeJid(sock.user.id);
      logger.info(`✅ AKIRA BOT ONLINE! BOT_JID: ${BOT_JID}`);
      currentQR = null;
      lastProcessedTime = Date.now();
    }
    if (connection === 'close') {
      const reason = lastDisconnect?.error?.output?.statusCode;
      logger.error(`⚠️ Conexão perdida (${reason}). Reconectando...`);
      setTimeout(connect, 5000);
    }
  });

  // ===============================================================
  // MENSAGENS
  // ===============================================================
  sock.ev.on('messages.upsert', async (m) => {
    const msg = m.messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const from = msg.key.remoteJid;
    const isGroup = from.endsWith('@g.us');
    if (msg.messageTimestamp && msg.messageTimestamp * 1000 < lastProcessedTime - 10000) return;

    let senderJid = msg.key.participant || msg.key.remoteJid;

    // ======================= NOVO: LID → JID REAL =======================
    if (senderJid.endsWith('@lid')) {
      try {
        const lookup = await sock.onWhatsApp(senderJid);
        if (lookup && lookup[0]?.jid) {
          senderJid = lookup[0].jid;
          logger.info(`🔍 LID convertido para JID real: ${senderJid}`);
        }
      } catch {
        logger.warn(`⚠️ Falha ao converter LID (${senderJid})`);
      }
    }
    // ====================================================================

    const numeroContexto = senderJid;
    const numeroExtraido = extractNumber(senderJid);
    const nome = msg.pushName || numeroExtraido;
    const text = getMessageText(msg.message);

    const contextInfo =
      msg.message?.extendedTextMessage?.contextInfo ||
      msg.message?.imageMessage?.contextInfo ||
      msg.message?.videoMessage?.contextInfo;
    let quotedSenderJid = null;
    let mensagemCitada = '';

    if (contextInfo?.quotedMessage) {
      quotedSenderJid = contextInfo.participant;
      mensagemCitada = getMessageText(contextInfo.quotedMessage);
    }

    if (!text.trim() && !mensagemCitada.trim()) return;

    logger.info(`\n====================== MENSAGEM RECEBIDA ======================
{
  "remoteJid": "${from}",
  "fromMe": ${msg.key.fromMe},
  "pushName": "${msg.pushName || 'Desconhecido'}",
  "participant": "${msg.key.participant || 'N/A'}",
  "contextInfo_participant": "${contextInfo?.participant || 'N/A'}",
  "messageType": "${getContentType(msg.message)}",
  "textContent": "${text}",
  "quotedText": "${mensagemCitada || ''}"
}
===============================================================`);

    const ativar = await shouldActivate(msg, isGroup, text, quotedSenderJid, mensagemCitada);
    if (!ativar) return;

    // ===== SIMULAÇÃO DE LEITURA =====
    try {
      await sock.readMessages([msg.key]);
      await sock.sendReceipt(from, msg.key.participant || from, ['read']);
      if (isGroup) {
        await sock.sendMessage(from, { text: '👁️ Visto por Akira' }, { quoted: msg });
        await delay(500);
        await sock.sendMessage(from, { text: '📬 Entregue a Akira' }, { quoted: msg });
      }
    } catch (e) {
      logger.warn('Falha ao enviar visto ou confirmação.');
    }

    await sock.sendPresenceUpdate('composing', from);

    try {
      const apiPayload = {
        usuario: nome,
        mensagem: text,
        numero: numeroContexto,
        mensagem_citada: mensagemCitada
      };

      logger.info(`[PAYLOAD] Usuario: ${nome} | Numero: ${numeroContexto} | Reply: ${!!mensagemCitada}`);

      const res = await axios.post(AKIRA_API_URL, apiPayload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000
      });

      const resposta = res.data?.resposta || '...';
      logger.info(`[RESPOSTA API] ${resposta}`);

      await delay(Math.min(resposta.length * 50, 4000));
      await sock.sendPresenceUpdate('paused', from);
      await sock.sendMessage(from, { text: resposta }, { quoted: msg });

      logger.info(`[AKIRA ENVIADA] Resposta enviada para ${nome} (${numeroExtraido}).`);
    } catch (err) {
      logger.error(`⚠️ Erro na API: ${err.message}`);
      await sock.sendMessage(from, { text: 'Erro interno. 😴' }, { quoted: msg });
    }
  });
}

// ===============================================================
// EXPRESS SERVER — Health + QR
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
    res.send(`<h2>✅ Já conectado!</h2>`);
  } else {
    try {
      const qrBase64 = await QRCode.toDataURL(currentQR);
      res.send(`
        <html><head><meta http-equiv="refresh" content="10"></head>
        <body style="text-align:center;">
          <h2>📱 Escaneie o QR</h2>
          <img src="${qrBase64}" />
          <p>Atualiza automaticamente a cada 10 segundos.</p>
        </body></html>
      `);
    } catch (err) {
      res.status(500).send(`Erro: ${err.message}`);
    }
  }
});

app.listen(PORT, '0.0.0.0', () => {
  logger.info(`🌐 Servidor ativo na porta ${PORT}`);
  logger.info(`🔗 Acesse: http://localhost:${PORT}/qr`);
});

connect();
