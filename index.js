// ===============================================================
// AKIRA BOT — Baileys v6.7.8 (fix final: mention parsing + no message-confirm text)
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
let BOT_JID = null;          // ex: 244952786417@s.whatsapp.net
let BOT_NUMERIC = null;      // ex: 244952786417
let lastProcessedTime = 0;
let currentQR = null;

// ----------------- util -----------------
function extractNumberFromJid(input = '') {
  if (!input) return '';
  const s = input.toString();
  const m = s.match(/(\d{9,14})/g); // pega seq. de dígitos
  if (!m) return '';
  // prefer 12-digit angolan pattern 2449xxxxxxxx
  for (const seg of m) {
    if (seg.length === 12 && seg.startsWith('244')) return seg;
  }
  // fallback: return last 12 digits if possible
  const last = m[m.length - 1];
  if (last.length >= 9 && last.length <= 12) {
    if (last.length === 9 && /^9\d{8}$/.test(last)) return '244' + last;
    if (last.length === 12) return last;
  }
  // otherwise return digits as-is
  return last;
}

function normalizeJidToSWhatsapp(jid = '') {
  if (!jid) return null;
  let clean = jid.toString().trim();
  // remove :session if present
  clean = clean.replace(/:\d+$/, '');
  // if already s.whatsapp.net return as-is
  if (clean.endsWith('@s.whatsapp.net')) return clean;
  // if is plain number
  const num = extractNumberFromJid(clean);
  if (num && num.length === 12) return `${num}@s.whatsapp.net`;
  // else return original (could be @lid)
  return clean;
}

function getMessageText(message) {
  const messageType = getContentType(message);
  switch (messageType) {
    case 'conversation':
      return message.conversation || '';
    case 'extendedTextMessage':
      return message.extendedTextMessage?.text || '';
    case 'imageMessage':
    case 'videoMessage':
      return message[messageType]?.caption || '';
    case 'templateButtonReplyMessage':
      return message.templateButtonReplyMessage?.selectedDisplayText || '';
    case 'listResponseMessage':
      return message.listResponseMessage?.title || '';
    case 'buttonsResponseMessage':
      return message.buttonsResponseMessage?.selectedDisplayText || '';
    default:
      return '';
  }
}

function jidNumericPart(jid = '') {
  if (!jid) return '';
  return extractNumberFromJid(jid);
}

// Detecta se o jid/menção refere-se ao BOT (com robustez para 37..., lid, 244..., texto @378...)
function isMentionForBot(candidate) {
  if (!BOT_NUMERIC) return false;
  if (!candidate) return false;

  // se candidate for um JID (ex: '244952786417@s.whatsapp.net' ou '37839265886398@lid')
  const candidateNum = jidNumericPart(candidate);
  if (candidateNum && BOT_NUMERIC.endsWith(candidateNum)) return true;
  if (candidateNum && candidateNum.endsWith(BOT_NUMERIC)) return true;
  // Also compare inclusion both ways
  if (candidateNum && BOT_NUMERIC.includes(candidateNum)) return true;
  if (candidateNum && candidateNum.includes(BOT_NUMERIC)) return true;

  // se candidate for texto com @numero (ex: "@37839265886398")
  const textNums = (candidate.match(/\d{5,14}/g) || []);
  for (const t of textNums) {
    if (BOT_NUMERIC.includes(t) || t.includes(BOT_NUMERIC)) return true;
    // transform short local numbers 9xxxxxxxx -> 2449xxxxxxxx
    if (/^9\d{8}$/.test(t)) {
      if (BOT_NUMERIC === `244${t}`) return true;
    }
  }

  return false;
}

// ----------------- activation -----------------
async function shouldActivate(msg, isGroup, text, quotedSenderJid, mensagemCitada) {
  const context =
    msg.message?.extendedTextMessage?.contextInfo ||
    msg.message?.imageMessage?.contextInfo ||
    msg.message?.videoMessage?.contextInfo;
  const lowered = (text || '').toLowerCase();
  let activationReason = 'NÃO ATIVADO';

  // 1) reply =>
  if (quotedSenderJid) {
    // quotedSenderJid pode ser '@lid' ou '@s.whatsapp.net' ou nulo
    const normalizedQuoted = normalizeJidToSWhatsapp(quotedSenderJid) || quotedSenderJid;
    if (isMentionForBot(normalizedQuoted) || isMentionForBot(quotedSenderJid)) {
      activationReason = `REPLY ao BOT (${normalizedQuoted})`;
    }
  }

  // 2) mentions array (Baileys fornece context?.mentionedJid)
  if (activationReason === 'NÃO ATIVADO' && isGroup) {
    const mentions = context?.mentionedJid || [];
    const mentionMatch = mentions.some((j) => isMentionForBot(j) || isMentionForBot(normalizeJidToSWhatsapp(j)));
    if (mentionMatch) activationReason = 'MENÇÃO direta (mentionedJid)';
    else if (lowered.includes('akira')) activationReason = 'PALAVRA-CHAVE "akira"';
    else {
      // also detect inline '@12345' patterns in text
      const inlineMentionMatch = (text || '').match(/@(\d{5,14})/g);
      if (inlineMentionMatch && inlineMentionMatch.some(m => isMentionForBot(m))) activationReason = 'MENÇÃO direta (inline-text)';
    }
  }

  // 3) PV always activate
  if (!isGroup && activationReason === 'NÃO ATIVADO') activationReason = 'CHAT PRIVADO';

  const activate = activationReason !== 'NÃO ATIVADO';
  logger.info(`[ATIVAR] ${activate ? 'SIM' : 'NÃO'} | Motivo: ${activationReason}`);
  return activate;
}

// ----------------- connect -----------------
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
      logger.info('📱 ESCANEIE O QR PARA CONECTAR (acessar /qr)');
    }
    if (connection === 'open') {
      // normaliza e extrai numero
      BOT_JID = normalizeJidToSWhatsapp(sock.user?.id) || sock.user?.id;
      BOT_NUMERIC = jidNumericPart(BOT_JID);
      logger.info(`✅ AKIRA BOT ONLINE! BOT_JID: ${BOT_JID} BOT_NUMERIC: ${BOT_NUMERIC}`);
      currentQR = null;
      lastProcessedTime = Date.now();
    }
    if (connection === 'close') {
      const reason = lastDisconnect?.error?.output?.statusCode;
      logger.error(`⚠️ Conexão perdida (${reason}). Reconectando em 5s...`);
      setTimeout(connect, 5000);
    }
  });

  // messages.upsert
  sock.ev.on('messages.upsert', async (m) => {
    const msg = m.messages[0];
    if (!msg || !msg.message || msg.key.fromMe) return;

    const from = msg.key.remoteJid;
    const isGroup = !!from && from.endsWith?.('@g.us');
    if (msg.messageTimestamp && (msg.messageTimestamp * 1000) < lastProcessedTime - 10000) return;

    // 1) pegar senderJid (quem realmente falou)
    let senderJidRaw = msg.key.participant || msg.key.remoteJid; // pode ser @lid ou @s.whatsapp.net
    // se for lid, tenta converter para jid real via onWhatsApp
    if (typeof senderJidRaw === 'string' && senderJidRaw.endsWith('@lid')) {
      try {
        const lookup = await sock.onWhatsApp(senderJidRaw); // retorna [{ jid: '2449xxx@s.whatsapp.net', exists: true }, ...]
        if (lookup && lookup[0]?.jid) {
          logger.info(`🔍 LID -> JID real: ${senderJidRaw} => ${lookup[0].jid}`);
          senderJidRaw = lookup[0].jid;
        } else {
          logger.warn(`🔍 onWhatsApp não retornou jid para ${senderJidRaw}`);
        }
      } catch (e) {
        logger.warn(`⚠️ onWhatsApp falhou para ${senderJidRaw}: ${e.message}`);
      }
    }

    const senderJid = normalizeJidToSWhatsapp(senderJidRaw) || senderJidRaw;
    const senderNumeric = jidNumericPart(senderJid) || extractNumberFromJid(senderJidRaw);
    const nome = msg.pushName || senderNumeric || 'desconhecido';

    // text + quoted
    const text = getMessageText(msg.message).trim();
    const contextInfo = msg.message?.extendedTextMessage?.contextInfo || msg.message?.imageMessage?.contextInfo || msg.message?.videoMessage?.contextInfo;
    let quotedSenderJid = null;
    let mensagemCitada = '';
    if (contextInfo?.quotedMessage) {
      quotedSenderJid = contextInfo.participant || contextInfo.participant_pn || null;
      // try to normalize quoted sender jid to s.whatsapp.net if possible
      if (quotedSenderJid && quotedSenderJid.endsWith('@lid')) {
        try {
          const l = await sock.onWhatsApp(quotedSenderJid);
          if (l && l[0]?.jid) quotedSenderJid = l[0].jid;
        } catch {/* ignore */}
      }
      mensagemCitada = getMessageText(contextInfo.quotedMessage) || '';
    }

    if (!text && !mensagemCitada) return;

    // LOG DETALHADO
    logger.info('\n====================== MENSAGEM RECEBIDA ======================');
    logger.info(JSON.stringify({
      remoteJid: msg.key.remoteJid,
      fromMe: msg.key.fromMe,
      pushName: msg.pushName,
      original_participant: msg.key.participant || null,
      resolved_senderJid: senderJid,
      senderNumeric,
      context_participant: contextInfo?.participant || null,
      context_participant_pn: contextInfo?.participant_pn || null,
      messageType: Object.keys(msg.message)[0],
      textContent: text,
      quotedText: mensagemCitada?.substring(0, 200) || null
    }, null, 2));
    logger.info('===============================================================\n');

    // activation
    const ativar = await shouldActivate(msg, isGroup, text || mensagemCitada, quotedSenderJid, mensagemCitada);
    if (!ativar) return;

    // Simulação de leitura / entrega:
    try {
      // marca como lida (dois tiques) — no grupo e pv
      await sock.readMessages([msg.key]);
      // sendReceipt: no grupo use participant (quem enviou), em pv use from
      await sock.sendReceipt(from, msg.key.participant || from, ['read']);
      logger.info(`(simulação) Mensagem marcada como lida: ${senderJid}`);
      // NÃO enviar texto de confirmação no chat — apenas logamos a ação
    } catch (e) {
      logger.warn('Falha ao marcar como lida/receipt: ' + (e?.message || e));
    }

    // presence + call API
    await sock.sendPresenceUpdate('composing', from);

    try {
      const apiPayload = {
        usuario: nome,
        mensagem: text || ' ',
        numero: senderJid,              // JID completo preferido (ex: 2449xxxx@s.whatsapp.net)
        mensagem_citada: mensagemCitada || ''
      };
      logger.info(`[PAYLOAD] Usuario: ${apiPayload.usuario} | Numero: ${apiPayload.numero} | Reply: ${!!apiPayload.mensagem_citada}`);

      const res = await axios.post(AKIRA_API_URL, apiPayload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000
      });

      const resposta = res.data?.resposta || '...';
      logger.info(`[RESPOSTA API] ${resposta}`);

      await delay(Math.min(resposta.length * 50, 4000));
      await sock.sendPresenceUpdate('paused', from);
      await sock.sendMessage(from, { text: resposta }, { quoted: msg });

      logger.info(`[AKIRA ENVIADA] Resposta enviada para ${nome} (${senderNumeric}).`);
    } catch (err) {
      logger.error('Erro na API: ' + (err?.message || err));
      try { await sock.sendMessage(from, { text: 'Erro interno. Tenta depois.' }, { quoted: msg }); } catch {}
    }
  });

  // retry request on decrypt fail
  sock.ev.on('message-decrypt-failed', async (msgKey) => {
    try { await sock.sendRetryRequest(msgKey.key); } catch {}
  });
}

// ---------- express (health + qr) ----------
const app = express();
app.get('/', (_, res) => {
  res.send(`<html><body style="font-family:sans-serif;text-align:center;margin-top:10%;">
    <h2>Akira Bot</h2><p>Acesse <a href="/qr">/qr</a> para QR (se precisar)</p></body></html>`);
});

app.get('/qr', async (_, res) => {
  if (!currentQR) return res.send('<h3>Já conectado</h3>');
  try {
    const qrBase64 = await QRCode.toDataURL(currentQR);
    res.send(`<html><head><meta http-equiv="refresh" content="10"></head><body style="text-align:center;">
      <h3>Escaneie o QR</h3><img src="${qrBase64}"/><p>Atualiza a cada 10s</p></body></html>`);
  } catch (e) {
    res.status(500).send('Erro QR: ' + e.message);
  }
});

app.listen(PORT, '0.0.0.0', () => {
  logger.info(`Servidor na porta ${PORT}. /qr`);
});

connect();
