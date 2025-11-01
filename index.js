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

const logger = pino({ level: 'info' });
const AKIRA_API_URL = 'https://akra35567-akira.hf.space/api/akira';
const PORT = process.env.PORT || 3000;

// JID real do bot (mantém consistência entre @lid e @s.whatsapp.net)
const BOT_REAL_JID = '37839265886398@lid';

let sock;
let lastProcessedTime = 0;
let healthInterval;

// Função para normalizar JIDs
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
      printQRInTerminal: true, // Mostra QR no log do Render
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
      const { connection, qr, lastDisconnect } = update;

      if (qr) {
        console.log('\n[QR CODE] Escaneie com o WhatsApp:\n');
        require('qrcode-terminal').generate(qr, { small: true });
      }

      if (connection === 'open') {
        console.log('AKIRA BOT ONLINE! (Multi-device ativo)');
        console.log('botJid definido como:', BOT_REAL_JID);
        lastProcessedTime = Date.now();
        startHealthCheck(); // Inicia health check
      }

      if (connection === 'close') {
        const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== 401;
        console.log('Conexão fechada. Reconectando em 5s...', shouldReconnect ? '' : '(Sessão expirada)');
        if (shouldReconnect) {
          setTimeout(connect, 5000);
        }
      }
    });

    sock.ev.on('messages.upsert', async (m) => {
      const msg = m.messages[0];
      if (!msg.message || msg.key.fromMe) return;

      if (msg.messageTimestamp && msg.messageTimestamp * 1000 < lastProcessedTime - 10000) {
        console.log(`[IGNORADO] Mensagem antiga: ${msg.messageTimestamp}`);
        return;
      }

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

      const ativar = await shouldActivate(msg, isGroup);
      if (!ativar) {
        console.log('[IGNORADO] Não ativado (sem reply ou menção).');
        return;
      }

      await sock.sendPresenceUpdate('composing', from);
      const start = Date.now();

      try {
        const res = await axios.post(AKIRA_API_URL, {
          usuario: nome,
          mensagem: text,
          numero: numero
        }, { timeout: 30000 });

        const resposta = res.data.resposta || "Não entendi.";
        console.log(`[RESPOSTA] ${resposta}`);

        const typing = Math.min(Math.max(resposta.length * 50, 1000), 5000);
        if (Date.now() - start < typing) await delay(typing - (Date.now() - start));

        await sock.sendPresenceUpdate('paused', from);
        await sock.sendMessage(from, { text: resposta }, { quoted: msg });

      } catch (err) {
        console.error('Erro API:', err.message);
        await sock.sendMessage(from, { text: 'Erro interno.' }, { quoted: msg });
      }
    });

  } catch (err) {
    console.error('Erro ao conectar:', err.message);
    setTimeout(connect, 10000);
  }
}

// Função de ativação (reply ou menção)
async function shouldActivate(msg, isGroup) {
  const context = msg.message?.extendedTextMessage?.contextInfo;
  const text = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').toLowerCase();

  // Caso 1: reply ao bot
  if (context?.quotedMessage && context.stanzaId) {
    const quotedParticipant = context.participant || context.quotedMessage?.key?.participant;
    if (quotedParticipant) {
      const botBase = normalizeJid(BOT_REAL_JID);
      const quotedBase = normalizeJid(quotedParticipant);
      if (botBase === quotedBase) {
        console.log(`[ATIVAÇÃO] Reply ao bot detectado (${BOT_REAL_JID})`);
        return true;
      } else {
        console.log(`[IGNORADO] Reply mas não é da bot: ${quotedParticipant}`);
        return false;
      }
    }
  }

  // Caso 2: menção no grupo
  if (isGroup) {
    const mentions = context?.mentionedJid || [];
    const mentionMatch = mentions.some(j => normalizeJid(j) === normalizeJid(BOT_REAL_JID));
    if (text.includes('akira') || mentionMatch) return true;
  }

  return false;
}

// Health Check a cada 20 minutos
function startHealthCheck() {
  if (healthInterval) clearInterval(healthInterval);

  healthInterval = setInterval(async () => {
    try {
      console.log(`[HEALTH CHECK] ${new Date().toLocaleString()} - Bot ativo`);
      // Tenta uma operação leve
      if (sock?.user?.id) {
        console.log(`[HEALTH] Bot conectado: ${sock.user.id}`);
      }
    } catch (err) {
      console.error('[HEALTH ERROR]', err.message);
    }
  }, 20 * 60 * 1000); // 20 minutos
}

// Servidor Express (obrigatório no Render)
const app = express();
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Health check na porta ${server.address().port}`);
});

app.get('/', (req, res) => {
  res.send(`AKIRA BOT ONLINE | ${new Date().toLocaleString()}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`Porta ${PORT} em uso. Tentando outra...`);
    server.listen(0, '0.0.0.0');
  }
});

// Inicia tudo
connect();
