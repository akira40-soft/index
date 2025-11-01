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
const fs = require('fs');
const path = require('path');

const logger = pino({ level: 'silent' });
const AKIRA_API_URL = process.env.AKIRA_API_URL || 'https://akra35567-akira.hf.space/api/akira';
const BOT_REAL_JID = process.env.BOT_REAL_JID || '37839265886398@lid';
const PORT = process.env.PORT || 3000;

let sock;
let lastProcessedTime = 0;
let healthInterval;
let isConnecting = false;

// LIMPA APENAS SENDER KEYS CORROMPIDOS
async function clearSenderKeys() {
  const authDir = 'auth_info_baileys';
  if (!fs.existsSync(authDir)) return;
  const files = fs.readdirSync(authDir);
  for (const file of files) {
    if (file.includes('sender-key')) {
      fs.unlinkSync(path.join(authDir, file));
    }
  }
}

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
      // ENVIA TEXTO PURO
      patchMessageBeforeSending: (msg) => {
        if (msg.text) {
          return { text: msg.text };
        }
        return msg;
      }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr && connection !== 'open') {
        console.log('\n[QR CODE] Escaneie com o celular:\n');
        require('qrcode-terminal').generate(qr, { small: true });
      }

      if (connection === 'open') {
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

        if (reason === 440 || reason === 428) {
          console.log('Conflito detectado. Limpando sender keys...');
          await clearSenderKeys();
          setTimeout(connect, 10000);
          return;
        }

        console.log(`Reconectando em 15s... (código: ${reason})`);
        setTimeout(connect, 15000);
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

        // NÚMERO CORRETO: MESMO EM PV E GRUPO
        let numero = 'desconhecido';
        let participantJid = null;

        if (isGroup && msg.key.participant) {
          participantJid = msg.key.participant;
          // Remove @s.whatsapp.net → número real
          numero = participantJid.replace('@s.whatsapp.net', '').replace('@lid', '');
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

          // LIMPA SENDER KEY ANTES DE ENVIAR NO GRUPO
          if (isGroup) {
            await clearSenderKeys();
          }

          // ENVIA NO GRUPO COM TEXTO PURO
          await sock.sendMessage(from, {
            text: resposta
          }, { quoted: msg });

        } catch (err) {
          console.error('Erro ao enviar:', err.message);
          try {
            await sock.sendMessage(from, { text: 'Erro interno.' }, { quoted: msg });
          } catch {}
        }
      } catch (err) {
        // Silencia
      }
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
    if (quotedJid && normalizeJid(quotedJid) === normalizeJid(BOT_REAL_JID)) {
      return true;
    }
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

// SERVIDOR
const app = express();
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Health check na porta ${server.address().port}`);
});

app.get('/', (req, res) => {
  res.send(`AKIRA BOT ONLINE | ${new Date().toLocaleString()}`);
});

connect();
