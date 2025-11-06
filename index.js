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

// Usar pino.destination(1) para output síncrono para o console no Railway
const logger = pino({ level: 'info' }, pino.destination(1)); 
const AKIRA_API_URL = 'https://akra35567-akira.hf.space/api/akira'; 
const PORT = process.env.PORT || 8080;

let sock;
let BOT_JID = null;
let lastProcessedTime = 0;
let currentQR = null;

const NON_STANDARD_JID_PREFIX = '37';

// ===============================================================
// FUNÇÕES UTILITÁRIAS
// ===============================================================
function extractNumber(input = '') {
  if (!input) return 'desconhecido';
  const clean = input.toString();
  
  // 1. Extração de 12 dígitos (244XXXXXXXXX) se for um JID completo (2449...@s.whatsapp.net)
  const fullJidMatch = clean.match(/(\d{12})@/);
  if (fullJidMatch) return fullJidMatch[1];
  
  // 2. Busca o formato angolano 2449xxxxxxxxx
  const match = clean.match(/2449\d{8}/);
  if (match) return match[0];
  // 3. Busca o formato 9xxxxxxxxx e adiciona 244
  const local = clean.match(/^9\d{8}$/);
  if (local) return `244${local[0]}`;
  
  return clean.replace(/\D/g, '').slice(-12);
}

function normalizeJid(jid = '') {
  if (!jid) return null;
  jid = jid.toString().trim();
  
  // Remove o sufixo de servidor e a tag de sessão (ex: :40)
  jid = jid.replace(/@.*/, '').replace(/:\d+$/, ''); 

  // Se o JID for um número puro (ex: 2449...)
  if (jid.length >= 9 && jid.length <= 12) {
    if (!jid.startsWith('244') && /^9\d{8}$/.test(jid)) {
        jid = '244' + jid;
    }
    return `${jid}@s.whatsapp.net`;
  }
  
  // Retorna nulo se não for um JID válido ou número
  return null;
}

// ===============================================================
// ATIVAÇÃO CORRIGIDA (AGORA RECONHECE JID 37... e Limpa JID)
// ===============================================================
function isBotJid(jid) {
  if (!BOT_JID) {
    logger.warn('BOT_JID não está definido ao verificar isBotJid.');
    return false;
  }

  // JID do bot limpo (sem @s.whatsapp.net e sem :XX)
  const botNumberClean = extractNumber(BOT_JID); 
  // JID que está a ser verificado (o quoted JID)
  const checkNumber = extractNumber(jid);
  
  logger.info(`[DEBUG:isBotJid] Bot: ${botNumberClean} | Check: ${checkNumber} | Original JID: ${jid}`);

  // CHECK PRIMÁRIO: O número real extraído coincide (e.g., 244952786417 == 244952786417)
  if (botNumberClean === checkNumber) {
    logger.info('[DEBUG:isBotJid] MATCH: Número real coincide.');
    return true;
  }

  // CHECK SECUNDÁRIO (FALLBACK - SOLUÇÃO PARA JID 37...): 
  // O JID do servidor que o Baileys/WhatsApp usa para replies.
  if (checkNumber.startsWith(NON_STANDARD_JID_PREFIX) && checkNumber.length > 10) {
      logger.info(`[DEBUG:isBotJid] MATCH: Fallback JID de servidor (${checkNumber}) coincide.`);
      return true;
  }

  logger.info('[DEBUG:isBotJid] FAIL: Nenhuma correspondência.');
  return false;
}

async function shouldActivate(msg, isGroup, text) {
  const context = msg.message?.extendedTextMessage?.contextInfo || 
                  msg.message?.imageMessage?.contextInfo ||
                  msg.message?.videoMessage?.contextInfo;

  const lowered = text.toLowerCase();
  
  let activationReason = 'NÃO ATIVADO';

  // 1. Ativa se for Reply direto ao bot
  if (context?.participant) {
    const quotedJid = normalizeJid(context.participant);
    if (isBotJid(quotedJid)) {
      activationReason = `REPLY ao JID: ${quotedJid}`;
    }
  }

  // 2. Lógica para Grupos
  if (isGroup && activationReason === 'NÃO ATIVADO') {
    const mentions = context?.mentionedJid || [];
    const mentionMatch = mentions.some(j => isBotJid(j));
    
    // Ativa se mencionar o bot
    if (mentionMatch) {
      activationReason = 'MENÇÃO direta';
    } 
    // Ativa se a mensagem contiver "akira"
    else if (lowered.includes('akira')) {
      activationReason = 'PALAVRA-CHAVE "akira"';
    }
  }

  // 3. Ativa sempre em chat privado (a menos que já tenha ativado por reply no grupo)
  if (!isGroup && activationReason === 'NÃO ATIVADO') {
    activationReason = 'CHAT PRIVADO';
  }

  const activate = activationReason !== 'NÃO ATIVADO';
  logger.info(`[ATIVAR] ${activate ? 'SIM' : 'NÃO'} | Motivo: ${activationReason} | De: ${msg.pushName} (${extractNumber(msg.key.remoteJid)}) | Mensagem: "${text.substring(0, 50)}..."`);

  return activate;
}


// ===============================================================
// CONEXÃO
// ===============================================================
async function connect() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
  const { version } = await fetchLatestBaileysVersion();

  if (sock && sock.user) {
    logger.info('Fechando sessão antiga...');
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
      logger.info('ESCANEIE O QR PARA CONECTAR');
    }
    if (connection === 'open') {
      // Normaliza o JID do bot, removendo o :XX
      BOT_JID = normalizeJid(sock.user.id);
      logger.info('AKIRA BOT ONLINE!');
      logger.info(`BOT_JID detectado: ${BOT_JID}`);
      lastProcessedTime = Date.now();
      currentQR = null;
    }
    if (connection === 'close') {
      const reason = lastDisconnect?.error?.output?.statusCode;
      logger.error(`Conexão perdida (reason: ${reason}). Reconectando em 5s...`);
      setTimeout(connect, 5000);
    }
  });

  // ===============================================================
  // EVENTO DE MENSAGEM
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
        await sock.sendReceipt(from, msg.key.participant, ['read']);
    } catch (e) {
        logger.warn('Falha ao enviar visto/read receipt.');
    }
    // ==========================================================

    await sock.sendPresenceUpdate('composing', from);

    try {
      // ENVIO JSON PERFEITO!
      const apiPayload = {
        usuario: nome,
        mensagem: text,
        numero: numeroExtraido,
        mensagem_citada: mensagemCitada 
      };

      const res = await axios.post(AKIRA_API_URL, apiPayload, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 30000 
      });

      const resposta = res.data?.resposta || '...';
      logger.info(`[RESPOSTA API] ${resposta}`);

      await delay(Math.min(resposta.length * 50, 4000));
      await sock.sendPresenceUpdate('paused', from);
      
      await sock.sendMessage(from, { text: resposta }, { quoted: msg });
      
      // LOG DE MENSAGEM ENVIADA
      logger.info(`[AKIRA ENVIADA] Resposta enviada com sucesso para ${nome} em ${from}.`);


    } catch (err) {
      logger.error(`Erro na API: ${err.message}`);
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
  logger.info(`Servidor na porta ${PORT}`);
  logger.info(`Acesse: http://localhost:${PORT}/qr`);
});

connect();
