// ===============================================================
// AKIRA BOT — Baileys v6.7.x
// Correções: resolve @lid -> @s.whatsapp.net, delivered->read, senderNumeric consistente
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

// Configs
const logger = pino({ level: 'info' }, pino.destination(1));
const AKIRA_API_URL = 'https://akra35567-akira.hf.space/api/akira';
const PORT = process.env.PORT || 8080;

// Estado global
let sock;
let BOT_JID = null;          // ex: 244952786417@s.whatsapp.net (normalizado)
let BOT_NUMERIC = null;      // ex: 244952786417
let lastProcessedTime = 0;
let currentQR = null;

// ---------------- Utilities ----------------

/** Extrai sequências de dígitos plausíveis; tenta priorizar 2449xxxxxxxx (12 dígitos). */
function extractNumberFromString(s = '') {
  if (!s) return '';
  const str = s.toString();
  const all = str.match(/\d{5,14}/g) || [];
  // procurar por padrão Angola 2449XXXXXXXX
  for (const seg of all) {
    if (seg.length === 12 && seg.startsWith('244')) return seg;
  }
  // procurar por 9xxxxxxxx (9 dígitos) e prefixar
  for (const seg of all) {
    if (/^9\d{8}$/.test(seg)) return '244' + seg;
  }
  // fallback: ultimo encontrado
  return all.length ? all[all.length - 1] : '';
}

/** Normaliza jid para formato @s.whatsapp.net se possível */
function normalizeJidToSWhatsapp(jid = '') {
  if (!jid) return null;
  let clean = jid.toString().trim();
  // remove tag de sessão (:46) se existir
  clean = clean.replace(/:\d+$/, '');
  if (clean.endsWith('@s.whatsapp.net')) return clean;
  // extrai número e constrói
  const num = extractNumberFromString(clean);
  if (num && num.length >= 9) {
    // preferimos 12 dígitos para Angola
    if (num.length === 9 && /^9\d{8}$/.test(num)) return `244${num}`;
    const final = num.length === 12 ? num : num;
    return `${final}@s.whatsapp.net`;
  }
  // se não conseguir, retorna o valor original (pode ser @lid)
  return clean;
}

/** Retorna a parte numérica de um jid/string */
function jidNumericPart(jid = '') {
  return extractNumberFromString(jid) || '';
}

/** Extrai texto legível de uma mensagem (conversation, extended, caption etc.) */
function getMessageText(message) {
  const type = getContentType(message);
  switch (type) {
    case 'conversation':
      return message.conversation || '';
    case 'extendedTextMessage':
      return message.extendedTextMessage?.text || '';
    case 'imageMessage':
    case 'videoMessage':
      return message[type]?.caption || '';
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

/** Tenta resolver um @lid ou outro JID para o JID real via sock.onWhatsApp */
async function resolveJidWithOnWhatsApp(jidCandidate) {
  if (!sock || !jidCandidate) return jidCandidate;
  try {
    const lookup = await sock.onWhatsApp(jidCandidate);
    if (Array.isArray(lookup) && lookup[0]?.jid) {
      return lookup[0].jid;
    }
  } catch (e) {
    logger.warn(`🔍 onWhatsApp falhou para ${jidCandidate}: ${e?.message || e}`);
  }
  return jidCandidate;
}

/** Verifica se um candidato de jid/menção refere-se ao bot (com robustez para 37..., lid, 244...) */
function isMentionForBot(candidate) {
  if (!BOT_NUMERIC) return false;
  if (!candidate) return false;
  const candidateNum = jidNumericPart(candidate);
  if (!candidateNum) return false;
  // comparações flexíveis: contém ou igual
  if (candidateNum === BOT_NUMERIC) return true;
  if (BOT_NUMERIC.includes(candidateNum)) return true;
  if (candidateNum.includes(BOT_NUMERIC)) return true;
  // short local (9xxxxxxx)
  if (candidateNum.length === 9 && (`244${candidateNum}` === BOT_NUMERIC)) return true;
  return false;
}

// ---------------- Activation logic ----------------

/**
 * Decide se o bot deve responder:
 * - Reply ao BOT (quoted sender é o bot)
 * - Menção direta (mentionedJid ou texto com @numero)
 * - Palavra chave "akira" em grupo
 * - Sempre em PV
 */
async function shouldActivate(msg, isGroup, text, quotedSenderJid, mensagemCitada) {
  const context =
    msg.message?.extendedTextMessage?.contextInfo ||
    msg.message?.imageMessage?.contextInfo ||
    msg.message?.videoMessage?.contextInfo;
  const lowered = (text || '').toLowerCase();
  let activationReason = 'NÃO ATIVADO';

  // 1) reply (quotedSenderJid pode ser @lid, @s.whatsapp.net, etc.)
  if (quotedSenderJid) {
    // tentar normalizar para s.whatsapp.net
    const normalized = normalizeJidToSWhatsapp(quotedSenderJid) || quotedSenderJid;
    if (isMentionForBot(normalized) || isMentionForBot(quotedSenderJid)) {
      activationReason = `REPLY ao BOT (${normalized})`;
    }
  }

  // 2) mentions
  if (activationReason === 'NÃO ATIVADO' && isGroup) {
    const mentions = context?.mentionedJid || [];
    const mentionMatch = mentions.some(j => isMentionForBot(j) || isMentionForBot(normalizeJidToSWhatsapp(j)));
    if (mentionMatch) activationReason = 'MENÇÃO direta (mentionedJid)';
    else if (lowered.includes('akira')) activationReason = 'PALAVRA-CHAVE "akira"';
    else {
      // detectar inline @12345 no texto
      const inline = (text || '').match(/@(\d{5,14})/g);
      if (inline && inline.some(m => isMentionForBot(m))) activationReason = 'MENÇÃO direta (inline)';
    }
  }

  // 3) PV sempre responde
  if (!isGroup && activationReason === 'NÃO ATIVADO') activationReason = 'CHAT PRIVADO';

  const activate = activationReason !== 'NÃO ATIVADO';
  logger.info(`[ATIVAR] ${activate ? 'SIM' : 'NÃO'} | Motivo: ${activationReason}`);
  return activate;
}

// ---------------- Connect / events ----------------

async function connect() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
  const { version } = await fetchLatestBaileysVersion();

  logger.info('Iniciando conexão Baileys...');
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
      // normaliza bot jid e extrai numero
      BOT_JID = normalizeJidToSWhatsapp(sock.user?.id) || sock.user?.id;
      BOT_NUMERIC = jidNumericPart(BOT_JID);
      logger.info(`✅ AKIRA BOT ONLINE! BOT_JID: ${BOT_JID} BOT_NUMERIC: ${BOT_NUMERIC}`);
      currentQR = null;
      lastProcessedTime = Date.now();
    }
    if (connection === 'close') {
      const reason = lastDisconnect?.error?.output?.statusCode;
      logger.error(`⚠️ Conexão perdida (reason: ${reason}). Reconectando em 5s...`);
      setTimeout(connect, 5000);
    }
  });

  // mensagens recebidas
  sock.ev.on('messages.upsert', async (m) => {
    const msg = m.messages?.[0];
    if (!msg || !msg.message || msg.key.fromMe) return;

    const from = msg.key.remoteJid;
    const isGroup = !!from && from.endsWith?.('@g.us');
    if (msg.messageTimestamp && (msg.messageTimestamp * 1000) < lastProcessedTime - 10000) return;

    // 1) pegar sender real: normalmente msg.key.participant (grupos) ou msg.key.remoteJid (pv)
    let senderCandidate = msg.key.participant || msg.key.remoteJid;
    // se for @lid ou outro, tentar resolver via onWhatsApp
    if (typeof senderCandidate === 'string' && senderCandidate.endsWith?.('@lid')) {
      const resolved = await resolveJidWithOnWhatsApp(senderCandidate);
      if (resolved && resolved !== senderCandidate) {
        logger.info(`🔍 LID -> JID real: ${senderCandidate} => ${resolved}`);
        senderCandidate = resolved;
      } else {
        logger.warn(`🔍 onWhatsApp não retornou jid para ${senderCandidate}`);
      }
    }
    // também se participant_pn existir no context, preferir
    const contextInfo = msg.message?.extendedTextMessage?.contextInfo ||
      msg.message?.imageMessage?.contextInfo ||
      msg.message?.videoMessage?.contextInfo ||
      msg.message?.stickerMessage?.contextInfo;

    // quoted info (reply)
    let quotedSenderJid = null;
    let mensagemCitada = '';
    if (contextInfo?.quotedMessage) {
      quotedSenderJid = contextInfo.participant || contextInfo.participant_pn || null;
      // attempt to resolve quoted sender if it's @lid
      if (quotedSenderJid && quotedSenderJid.endsWith?.('@lid')) {
        const r = await resolveJidWithOnWhatsApp(quotedSenderJid);
        if (r && r !== quotedSenderJid) quotedSenderJid = r;
      }
      mensagemCitada = getMessageText(contextInfo.quotedMessage) || '';
    }

    // tentar também resolver participant_pn se disponível (algumas versões enviam participant_pn)
    if (!senderCandidate && contextInfo?.participant_pn) senderCandidate = contextInfo.participant_pn;

    // normalizar senderCandidate para s.whatsapp.net quando possível
    const senderJid = normalizeJidToSWhatsapp(senderCandidate) || senderCandidate;
    const senderNumeric = jidNumericPart(senderJid) || extractNumberFromString(senderCandidate);
    const nome = msg.pushName || senderNumeric || 'desconhecido';

    // extrair texto principal
    const text = getMessageText(msg.message).trim();

    if (!text && !mensagemCitada) return;

    // LOG detalhado
    const detailLog = {
      remoteJid: msg.key.remoteJid,
      fromMe: msg.key.fromMe,
      pushName: msg.pushName,
      original_participant: msg.key.participant || null,
      resolved_senderJid: senderJid,
      senderNumeric,
      context_participant: contextInfo?.participant || null,
      context_participant_pn: contextInfo?.participant_pn || null,
      messageType: Object.keys(msg.message)[0],
      textContent: text || null,
      quotedText: mensagemCitada || null
    };
    logger.info('====================== MENSAGEM RECEBIDA ======================');
    logger.info(JSON.stringify(detailLog, null, 2));
    logger.info('===============================================================');

    // decide ativar
    const ativar = await shouldActivate(msg, isGroup, text || mensagemCitada, quotedSenderJid, mensagemCitada);
    if (!ativar) return;

    // SIMULAÇÃO de recibos: delivered -> read (mantendo dinâmica do whatsapp)
    try {
      // marcar como "delivered" (dois tiques cinza)
      await sock.sendReceipt(from, msg.key.participant || from, ['delivered']);
      logger.info(`(simulação) Mensagem marcada como ENTREGUE (delivered): ${senderJid}`);

      // pequeno delay natural antes de marcar "read"
      await delay(1200 + Math.floor(Math.random() * 1200));

      // marcar como "read" (dois tiques azuis)
      await sock.sendReceipt(from, msg.key.participant || from, ['read']);
      logger.info(`(simulação) Mensagem marcada como LIDA (read): ${senderJid}`);
    } catch (e) {
      logger.warn('Falha no envio de receipts: ' + (e?.message || e));
    }

    // informar presença e chamar API
    try {
      await sock.sendPresenceUpdate('composing', from);

      const payload = {
        usuario: nome,
        mensagem: text || ' ',
        numero: senderJid,           // PASSAMOS JID completo preferido
        mensagem_citada: mensagemCitada || ''
      };

      logger.info(`[PAYLOAD] Usuario: ${payload.usuario} | Numero: ${payload.numero} | Reply: ${!!payload.mensagem_citada}`);

      const res = await axios.post(AKIRA_API_URL, payload, {
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

  sock.ev.on('message-decrypt-failed', async (msgKey) => {
    try { await sock.sendRetryRequest(msgKey.key); } catch {}
  });
}

// ---------------- Express server (health + QR) ----------------

const app = express();
app.get('/', (_, res) => {
  res.send(`<html><body style="font-family:sans-serif;text-align:center;margin-top:8%;">
    <h2>Akira Bot</h2>
    <p>Acesse <a href="/qr">/qr</a> para visualizar o QR code (quando necessário).</p>
  </body></html>`);
});

app.get('/qr', async (_, res) => {
  if (!currentQR) return res.send('<h3>Já conectado ou QR não disponível</h3>');
  try {
    const qrBase64 = await QRCode.toDataURL(currentQR);
    res.send(`
      <html><head><meta http-equiv="refresh" content="10"></head>
      <body style="text-align:center;">
        <h3>Escaneie o QR</h3>
        <img src="${qrBase64}" />
        <p>Atualiza a cada 10s</p>
      </body></html>
    `);
  } catch (e) {
    res.status(500).send('Erro ao gerar QR: ' + e.message);
  }
});

app.listen(PORT, '0.0.0.0', () => {
  logger.info(`Servidor na porta ${PORT}. Acesse /qr`);
});

// start
connect().catch((err) => {
  logger.error('Erro ao conectar: ' + (err?.message || err));
  process.exit(1);
});
