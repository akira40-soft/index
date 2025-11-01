// index.js
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
const qrcode = require('qrcode');

const logger = pino({ level: 'silent' });
const AKIRA_API_URL = process.env.AKIRA_API_URL || 'https://akra35567-akira.hf.space/api/akira';
const BOT_REAL_JID = process.env.BOT_REAL_JID || '37839265886398@lid';
const PORT = process.env.PORT || 3000;

let sock;
let lastProcessedTime = 0;
let healthInterval;
let isConnecting = false;
let currentQR = null;

// SERVIDOR WEB
const app = express();
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Health check na porta ${server.address().port}`);
});

app.get('/', (req, res) => {
  if (currentQR) {
    qrcode.toDataURL(currentQR, { scale: 8 }, (err, url) => {
      if (err) {
        res.send(`<h1>AKIRA BOT ONLINE</h1><p>QR Code em carregamento...</p>`);
        return;
      }
      res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>Akira Bot QR</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: sans-serif; text-align: center; padding: 20px; background: #f0f0f0; }
    .qr { margin: 30px auto; max-width: 300px; }
    .status { font-size: 1.2em; margin: 20px; }
    .online { color: green; }
    .offline { color: red; }
  </style>
</head>
<body>
  <h1>🤖 AKIRA BOT</h1>
  <div class="status online">🟢 ONLINE</div>
  <p>Escaneie o QR Code com o WhatsApp:</p>
  <div class="qr"><img src="${url}" alt="QR Code"></div>
  <p><small>Link: <a href="${req.protocol}://${req.get('host')}">${req.protocol}://${req.get('host')}</a></small></p>
</body>
</html>
      `);
    });
  } else {
    res.send(`
<!DOCTYPE html>
<html>
<head><title>Akira Bot</title></head>
<body>
  <h1>🤖 AKIRA BOT</h1>
  <p>Conectando... QR Code será exibido em segundos.</p>
  <script>setTimeout(() => location.reload(), 5000);</script>
</body>
</html>
    `);
  }
});

async function connect() {
  if (isConnecting) return;
  isConnecting = true;

  try {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      version,
      auth: state,
      logger,
      browser: Browsers.macOS('Desktop'),
      markOnlineOnConnect: true,
      keepAliveIntervalMs: 30000,
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      printQRInTerminal: false,
      getMessage: async () => ({ conversation: '' }),
      shouldSyncHistoryMessage: () => false,
      patchMessageBeforeSending: (msg) => {
        if (msg.text) return { text: msg.text };
        return msg;
      }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        currentQR = qr;
        console.log(`[QR CODE] Atualizado na web: ${req.protocol}://${req.get('host')}`);
      }

      if (connection === 'open') {
        currentQR = null;
        console.log('AKIRA BOT ONLINE! (Multi-device ativo)');
        console.log('botJid:', BOT_REAL_JID);
        lastProcessedTime = Date.now();
        startHealthCheck();
        isConnecting = false;
      }

      if (connection === 'close') {
        isConnecting = false;
        const reason = lastDisconnect?.error?.output?.statusCode;

        if (reason === DisconnectReason.loggedOut) {
          console.log('Sessão encerrada. Escaneie novo QR.');
          return;
        }

        const delay = [428, 440].includes(reason) ? 45000 : 15000;
        console.log(`Reconectando em ${delay/1000}s... (código: ${reason})`);
        setTimeout(connect, delay);
      }
    });

    sock.ev.on('messages.upsert', async (m) => {
      try {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;
        if (msg.messageStubType || msg.message.protocolMessage) return;
        if (msg.messageTimestamp * 1000 < lastProcessedTime - 10000) return;

        const from = msg.key.remoteJid;
        const isGroup = from.endsWith('@g.us');

        let numero = 'desconhecido';
        if (isGroup && msg.key.participant) {
          numero = msg.key.participant.replace('@s.whatsapp.net', '');
        } else if (from.includes('@s.whatsapp.net')) {
          numero = from.replace('@s.whatsapp.net', '');
        }

        const nome = msg.pushName?.trim() || numero;
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
        if (!text.trim()) return;

        console.log(`\n[MENSAGEM] ${isGroup ? 'GRUPO' : 'PV'} | ${nome} (${numero}): ${text}`);

        if (!(await shouldActivate(msg, isGroup))) return;

        await sock.sendPresenceUpdate('composing', from);
        const start = Date.now();

        try {
          const res = await axios.post(AKIRA_API_URL, { usuario: nome, mensagem: text, numero }, { timeout: 30000 });
          const resposta = res.data.resposta || "Não entendi.";

          const typing = Math.min(Math.max(resposta.length * 50, 1000), 5000);
          if (Date.now() - start < typing) await delay(typing - (Date.now() - start));

          await sock.sendPresenceUpdate('paused', from);

          await sock.sendMessage(from, { text: resposta }, { quoted: msg });

        } catch (err) {
          console.error('Erro ao enviar:', err.message);
          try {
            await sock.sendMessage(from, { text: 'Erro interno.' }, { quoted: msg });
          } catch {}
        }
      } catch (err) {}
    });

  } catch (err) {
    isConnecting = false;
    console.error('Erro crítico:', err.message);
    setTimeout(connect, 20000);
  }
}

async function shouldActivate(msg, isGroup) {
  const context = msg.message?.extendedTextMessage?.contextInfo;
  const text = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').toLowerCase();

  if (context?.quotedMessage && context.stanzaId) {
    const quotedJid = context.participant || context.quotedMessage?.key?.participant;
    if (quotedJid && normalizeJid(quotedJid) === normalizeJid(BOT_REAL_JID)) return true;
  }

  if (isGroup) {
    const mentions = context?.mentionedJid || [];
    const isMentioned = mentions.some(j => normalizeJid(j) === normalizeJid(BOT_REAL_JID));
    if (text.includes('akira') || isMentioned) return true;
  }

  return false;
}

function normalizeJid(jid) {
  if (!jid) return null;
  return jid.replace(/@lid|@s\.whatsapp\.net|@c\.us/g, '').trim();
}

function startHealthCheck() {
  if (healthInterval) clearInterval(healthInterval);
  healthInterval = setInterval(() => {
    console.log(`[HEALTH] ${new Date().toLocaleString()} - Bot ativo`);
  }, 20 * 60 * 1000);
}

connect();
