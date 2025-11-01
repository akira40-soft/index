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

const logger = pino({ level: 'silent' }); // Silencia logs internos
const AKIRA_API_URL = process.env.AKIRA_API_URL || 'https://akra35567-akira.hf.space/api/akira';
const BOT_REAL_JID = process.env.BOT_REAL_JID || '37839265886398@lid';
const PORT = process.env.PORT || 3000;

let sock;
let lastProcessedTime = 0;
let healthInterval;

function normalizeJid(jid) {
  if (!jid) return null;
  return jid.replace(/@lid|@s\.whatsapp\.net|@c\.us/g, '').trim();
}

async function connect() {
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
      printQRInTerminal: false, // QR no log do Render é ruim
      getMessage: async () => ({ conversation: 'Mensagem não disponível' }),
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log('\n[QR CODE] Escaneie com o WhatsApp (use celular):\n');
        require('qrcode-terminal').generate(qr, { small: true });
      }

      if (connection === 'open') {
        console.log('AKIRA BOT ONLINE! (Multi-device ativo)');
        console.log('botJid:', BOT_REAL_JID);
        lastProcessedTime = Date.now();
        startHealthCheck();
      }

      if (connection === 'close') {
        const reason = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = reason !== DisconnectReason.loggedOut;

        if (reason === 428 || reason === 440) {
          console.log('Conflito detectado. Aguardando 30s antes de reconectar...');
          setTimeout(() => connect(), 30000);
          return;
        }

        if (shouldReconnect) {
          console.log(`Reconectando em 15s... (motivo: ${reason})`);
          setTimeout(() => connect(), 15000);
        } else {
          console.log('Sessão encerrada. Pare o serviço e escaneie novo QR.');
        }
      }
    });

    // IGNORA MENSAGENS CORROMPIDAS
    sock.ev.on('messaging-history.set', () => {});
    sock.ev.on('message-receipt.update', () => {});

    sock.ev.on('messages.upsert', async (m) => {
      try {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        // IGNORA MENSAGENS DE SISTEMA
        if (msg.messageStubType || msg.message.protocolMessage) {
          return;
        }

        if (msg.messageTimestamp * 1000 < lastProcessedTime - 10000) return;

        const from = msg.key.remoteJid;
        const isGroup = from.endsWith('@g.us');

        let numero = 'desconhecido';
        if (isGroup && msg.key.participant) {
          numero = msg.key.participant.split('@')[0];
        } else if (from.includes('@s.whatsapp.net')) {
          numero = from.split('@')[0];
        }

        const nome = msg.pushName?.trim() || numero;
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
        if (!text.trim()) return;

        console.log(`\n[MENSAGEM] ${isGroup ? 'GRUPO' : 'PV'} | ${nome} (${numero}): ${text}`);

        if (!(await shouldActivate(msg, isGroup))) {
          console.log('[IGNORADO] Sem ativação');
          return;
        }

        await sock.sendPresenceUpdate('composing', from);
        const start = Date.now();

        try {
          const res = await axios.post(AKIRA_API_URL, { usuario: nome, mensagem: text, numero }, { timeout: 30000 });
          const resposta = res.data.resposta || "Não entendi.";

          const typing = Math.min(Math.max(resposta.length * 50, 1000), 5000);
          if (Date.now() - start < typing) await delay(typing - (Date.now() - start));

          await sock.sendPresenceUpdate('paused', from);

          // ENVIA COMO TEXTO PURO (EVITA CRIPTOGRAFIA CORROMPIDA)
          await sock.sendMessage(from, { text: resposta }, { quoted: msg });

        } catch (err) {
          console.error('Erro API:', err.message);
          try {
            await sock.sendMessage(from, { text: 'Erro interno.' }, { quoted: msg });
          } catch (sendErr) {
            console.log('Falha ao enviar erro:', sendErr.message);
          }
        }
      } catch (err) {
        console.log('Erro ao processar mensagem:', err.message);
      }
    });

  } catch (err) {
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
