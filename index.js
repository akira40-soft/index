// ===============================================================
// AKIRA BOT — Baileys v6.7.8 (JSON PERFEITO + reply/menção fix)
// ===============================================================
import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers,
  delay
} from '@whiskeysockets/baileys';
import pino from 'pino';
import axios from 'axios';
import express from 'express';
import * as QRCode from 'qrcode';

const logger = pino({ level: 'info' });
const AKIRA_API_URL = 'https://akra35567-akira.hf.space/api/akira'; 
const PORT = process.env.PORT || 8080;

let sock;
let BOT_JID = null;
let lastProcessedTime = 0;
let currentQR = null;

// Prefixos conhecidos para JID de servidor que representa o bot (Ex: 37...)
const NON_STANDARD_JID_PREFIX = '37';

// ===============================================================
// FUNÇÕES UTILITÁRIAS
// ===============================================================
function extractNumber(input = '') {
  if (!input) return 'desconhecido';
  const clean = input.toString();
  
  // Extração de 12 dígitos (244XXXXXXXXX) se for um JID completo
  const fullJidMatch = clean.match(/(\d{12})@/);
  if (fullJidMatch) return fullJidMatch[1];
  
  // Busca o formato angolano 2449xxxxxxxxx
  const match = clean.match(/2449\d{8}/);
  if (match) return match[0];
  // Busca o formato 9xxxxxxxxx e adiciona 244
  const local = clean.match(/^9\d{8}$/);
  if (local) return `244${local[0]}`;
  
  return clean.replace(/\D/g, '').slice(-12);
}

function normalizeJid(jid = '') {
  if (!jid) return null;
  jid = jid.toString().trim();
  
  // Corrigir JIDs que o Baileys pode normalizar mal (ex: 2449...:XX)
  jid = jid.replace(/:\d+$/, ''); 

  // Se o JID for um número puro (ex: 2449...)
  if (!jid.includes('@')) {
    if (jid.length >= 9 && jid.length <= 12) {
      if (!jid.startsWith('244') && /^9\d{8}$/.test(jid)) {
          jid = '244' + jid;
      }
      return `${jid}@s.whatsapp.net`;
    }
  }
  
  // Retorna JID completo se já estiver no formato JID padrão
  return jid;
}

// ===============================================================
// ATIVAÇÃO CORRIGIDA (AGORA RECONHECE JID 37...)
// ===============================================================
function isBotJid(jid) {
  if (!BOT_JID) return false;

  // 1. Extrai o número real do bot (e.g., '244952786417')
  const botNumber = extractNumber(BOT_JID); 
  // 2. Extrai o número do JID que está sendo checado (o quoted JID)
  const checkNumber = extractNumber(jid);

  // CHECK PRIMÁRIO: O número real extraído coincide (o caso normal)
  if (botNumber === checkNumber) return true;

  // CHECK SECUNDÁRIO (FALLBACK - SOLUÇÃO PARA JID 37...): 
  // Verifica se o JID é o ID de servidor não-padrão (37...) usado pelo WhatsApp/Baileys
  if (checkNumber.startsWith(NON_STANDARD_JID_PREFIX) && checkNumber.length > 10) {
      console.log(`[BOT JID FALLBACK] JID citado (${checkNumber}) reconhecido como o Bot (Akira).`);
      return true;
  }

  return false;
}

async function shouldActivate(msg, isGroup, text) {
  const context = msg.message?.extendedTextMessage?.contextInfo || 
                  msg.message?.imageMessage?.contextInfo ||
                  msg.message?.videoMessage?.contextInfo;

  const lowered = text.toLowerCase();

  // Ativa se for Reply direto ao bot
  if (context?.participant) {
    const quoted = normalizeJid(context.participant);
    if (isBotJid(quoted)) return true;
  }

  if (isGroup) {
    const mentions = context?.mentionedJid || [];
    const mentionMatch = mentions.some(j => isBotJid(j));
    
    // Ativa se mencionar o bot ou a mensagem contiver "akira"
    if (lowered.includes('akira') || mentionMatch) return true;
  }

  // Ativa sempre em chat privado
  return !isGroup;
}


// ===============================================================
// CONEXÃO
// ===============================================================
async function connect() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
  const { version } = await fetchLatestBaileysVersion();

  if (sock && sock.user) {
    console.log('Fechando sessão antiga...');
    await sock.logout();
  }

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
      console.log('ESCANEIE O QR PARA CONECTAR');
    }
    if (connection === 'open') {
      // Garante a normalização do JID do bot (removendo o :XX)
      BOT_JID = normalizeJid(sock.user.id);
      console.log('AKIRA BOT ONLINE!');
      console.log('BOT_JID detectado:', BOT_JID);
      lastProcessedTime = Date.now();
      currentQR = null;
    }
    if (connection === 'close') {
      const reason = lastDisconnect?.error?.output?.statusCode;
      console.log(`Conexão perdida (reason: ${reason}). Reconectando em 5s...`);
      setTimeout(connect, 5000);
    }
  });

  // ===============================================================
  // EVENTO DE MENSAGEM (Com extração de mensagem citada)
  // ===============================================================
  sock.ev.on('messages.upsert', async (m) => {
    const msg = m.messages[0];
    if (!msg.message || msg.key.fromMe) return;
    const from = msg.key.remoteJid;
    const isGroup = from.endsWith('@g.us');
    if (msg.messageTimestamp && msg.messageTimestamp * 1000 < lastProcessedTime - 10000) return;

    const senderJid = msg.key.participant || msg.key.remoteJid;
    const numeroExtraido = extractNumber(senderJid);

    const nome = msg.pushName || numeroExtraido;
    const contextInfo = msg.message?.extendedTextMessage?.contextInfo ||
                        msg.message?.imageMessage?.contextInfo ||
                        msg.message?.videoMessage?.contextInfo;

    // ===== EXTRAÇÃO DO TEXTO DA MENSAGEM ATUAL =====
    const text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      msg.message?.imageMessage?.caption ||
      msg.message?.videoMessage?.caption ||
      '';

    // ===== EXTRAÇÃO DA MENSAGEM CITADA (REPLY) =====
    let mensagemCitada = '';
    
    if (contextInfo?.quotedMessage) {
      const quoted = contextInfo.quotedMessage;
      mensagemCitada = 
        quoted.conversation || 
        quoted.extendedTextMessage?.text || 
        quoted.imageMessage?.caption || 
        quoted.videoMessage?.caption || 
        ''; 
    }
    // ==============================================================

    if (!text.trim()) return;

    const ativar = await shouldActivate(msg, isGroup, text);
    if (!ativar) return;

    // ===== SIMULAÇÃO DE LEITURA (VISTO - DOIS TICKS AZUIS) =====
    try {
        await sock.readMessages([msg.key]);
        // O sendReceipt é opcional, mas garante o 'read' state em alguns casos
        await sock.sendReceipt(from, msg.key.participant, ['read']);
    } catch (e) {
        // Ignorar falhas na leitura, não é crítico
    }
    // ==========================================================


    await sock.sendPresenceUpdate('composing', from);

    try {
      // ENVIO JSON PERFEITO!
      const res = await axios.post(AKIRA_API_URL, {
        usuario: nome,
        mensagem: text,
        numero: numeroExtraido,
        mensagem_citada: mensagemCitada 
      }, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 30000 
      });

      const resposta = res.data?.resposta || '...';
      console.log(`[RESPOSTA] ${resposta}`);

      await delay(Math.min(resposta.length * 50, 4000));
      await sock.sendPresenceUpdate('paused', from);
      await sock.sendMessage(from, { text: resposta }, { quoted: msg });

    } catch (err) {
      console.error('Erro na API:', err.message);
      await sock.sendMessage(from, { text: 'Erro interno. Tenta depois.' }, { quoted: msg });
    }
  });

  sock.ev.on('message-decrypt-failed', async (msgKey) => {
    try {
      await sock.sendRetryRequest(msgKey.key);
    } catch (e) {}
  });
}

// ===============================================================
// EXPRESS SERVER (Health + QR)
// ===============================================================
const app = express();
app.get("/", (_, res) => {
  res.send(`
    <html><body style="font-family:sans-serif;text-align:center;margin-top:10%;">
      <h2>Akira Bot está online!</h2>
      <p>Acesse <a href="/qr">/qr</a> para escanear o QR Code.</p>
    </body></html>
  `);
});

app.get("/qr", async (_, res) => {
  if (!currentQR) {
    res.send(`<h2>Já conectado!</h2>`);
  } else {
    try {
      const qrBase64 = await QRCode.toDataURL(currentQR);
      res.send(`
        <html><head><meta http-equiv="refresh" content="10"></head>
        <body style="text-align:center;">
          <h2>Escaneie o QR</h2>
          <img src="${qrBase64}" />
          <p>Atualiza em 10s...</p>
        </body></html>
      `);
    } catch (err) {
      res.status(500).send(`Erro: ${err.message}`);
    }
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Servidor na porta ${PORT}`);
  console.log(`Acesse: http://localhost:${PORT}/qr`);
});

connect();
