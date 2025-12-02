/**
 * index.js — AKIRA BOT (CommonJS, versão completa e unificada)
 * - Mescla as duas bases que você enviou
 * - CommonJS (require)
 * - Extração robusta de número (participantAlt -> participant -> contextInfo -> remoteJid)
 * - Reply inteligente (PV: reply apenas se usuário respondeu ao bot; caso contrário responde normal)
 * - Grupo: responde somente se mencionado / "akira" / reply ao bot
 * - Presença (composing / paused), leitura, retry on decrypt fail
 * - Fallback de store (se makeInMemoryStore não existir)
 * - QR: gera DataURL para /qr com tamanho compacto (200x200), margin 0, fundo preto no HTML; também imprime QR terminal
 *
 * Requisitos no package.json:
 *   "@whiskeysockets/baileys"
 *   "axios"
 *   "express"
 *   "qrcode"
 *   "qrcode-terminal"
 *   "pino"
 *
 * Testado para rodar em Render/Railway/Local Node >= 18
 */

const baileys = require('@whiskeysockets/baileys');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers,
  delay,
  getContentType
} = baileys;

const axios = require('axios');
const express = require('express');
const QRCode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');
const pino = require('pino');

const PORT = process.env.PORT || 3000;
const API_URL = process.env.API_URL || 'https://akra35567-akira.hf.space/api/akira';
const BOT_NUMERO_REAL = process.env.BOT_NUMERO_REAL || '244952786417';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

// -------------------------------
// store (fallback if baileys.makeInMemoryStore missing)
// -------------------------------
let store;
if (typeof baileys.makeInMemoryStore === 'function') {
  try {
    store = baileys.makeInMemoryStore({ logger });
  } catch (e) {
    store = null;
  }
}
if (!store) {
  // Minimal fallback store with loadMessage & bind
  const _map = new Map();
  store = {
    bind: () => {},
    async loadMessage(jid, id) {
      return _map.get(`${jid}|${id}`) || undefined;
    },
    // small helper to save a copy when we send messages
    saveMessage(jid, id, msg) {
      _map.set(`${jid}|${id}`, msg);
    }
  };
  logger.info('Fallback store created (minimal).');
}

// -------------------------------
// Estado global
// -------------------------------
let sock = null;
let BOT_JID = null; // ex: 244952786417@s.whatsapp.net
let BOT_REAL = null; // ex: 244952786417
let currentQR = null;

// Control de-dup
const processed = new Set();

// Track last bot message timestamps per chat (useful se quiser fallback reply behaviour)
const lastBotMessageAt = new Map();

// -------------------------------
// Utilitários (extração número / normalização / checks)
// -------------------------------
function extractNumberFromString(input = '') {
  if (!input) return null;
  const s = String(input);
  // busca 2449xxxxxxxx
  let m = s.match(/2449\d{8}/);
  if (m) return m[0];
  // busca 9xxxxxxxx (Angola local)
  m = s.match(/9\d{8}/);
  if (m) return '244' + m[0];
  // busca qualquer 9+8 digits contiguous
  m = s.match(/\d{9,12}/);
  if (m) {
    const d = m[0];
    if (d.length === 9) return '244' + d;
    if (d.length === 11 || d.length === 12) {
      // try to return last 9 digits + 244 prefix
      const last9 = d.slice(-9);
      return '244' + last9;
    }
    return d;
  }
  return null;
}

function normalizeJidToFull(jid = '') {
  if (!jid) return null;
  jid = String(jid).trim();
  if (jid.includes('@')) return jid;
  // basic heuristics: if starts with 9 + 8 digits, prefix 244
  if (/^9\d{8}$/.test(jid)) return `${'244' + jid}@s.whatsapp.net`;
  if (/^2449\d{8}$/.test(jid)) return `${jid}@s.whatsapp.net`;
  // if looks like group id or other, return as-is with @s.whatsapp.net
  return `${jid}@s.whatsapp.net`;
}

function isBotJid(jid) {
  if (!jid) return false;
  if (!BOT_JID) return false;
  try {
    const a = normalizeJidToFull(jid);
    return a === normalizeJidToFull(BOT_JID);
  } catch (e) {
    return false;
  }
}

// -------------------------------
// Extrair número real a partir da message key/participant/context
// Prioridade:
// 1) participantAlt (algumas infra) -> m.participant
// 2) key.participant
// 3) message.extendedTextMessage.contextInfo.participant
// 4) key.remoteJid (para PV)
// -------------------------------
function extractRealNumberFromMessage(m) {
  try {
    const key = m.key || {};
    // PV
    if (key.remoteJid && !String(key.remoteJid).endsWith('@g.us')) {
      return String(key.remoteJid).split('@')[0];
    }

    // participantAlt (Baileys sometimes exposes as m.participant)
    if (m.participant && String(m.participant).includes('@s.whatsapp.net')) {
      return String(m.participant).split('@')[0];
    }

    // key.participant (common in cloud)
    if (key.participant && String(key.participant).includes('@s.whatsapp.net')) {
      return String(key.participant).split('@')[0];
    }

    // contextInfo.participant (quoted/reply)
    const contextPart = m.message?.extendedTextMessage?.contextInfo?.participant;
    if (contextPart && String(contextPart).includes('@s.whatsapp.net')) {
      return String(contextPart).split('@')[0];
    }

    // If we have LIDs (@lid), try to convert
    const lidCandidate = key.participant || m.participant || contextPart;
    if (lidCandidate && String(lidCandidate).includes('@lid')) {
      return convertLidToNumber(String(lidCandidate));
    }

    // fallback: attempt to extract digits from remoteJid
    if (key.remoteJid) {
      const maybe = extractNumberFromString(key.remoteJid);
      if (maybe) return maybe;
    }

    return null;
  } catch (e) {
    logger.error({ e }, 'extractRealNumberFromMessage error');
    return null;
  }
}

function convertLidToNumber(lid) {
  // Ex.: "202391978787009@lid" or "202391978787009:123@lid"
  if (!lid) return null;
  const clean = String(lid).split('@')[0];
  // if contains :, split and take left part
  const base = clean.split(':')[0];
  const digits = base.replace(/\D/g, '');
  if (digits.length >= 9) {
    return '244' + digits.slice(-9);
  }
  return null;
}

// -------------------------------
// Extração de texto simples
// -------------------------------
function extractTextFromMessage(m) {
  try {
    const t = getContentType(m.message);
    if (!t) return '';
    if (t === 'conversation') return m.message.conversation || '';
    if (t === 'extendedTextMessage') return m.message.extendedTextMessage?.text || '';
    if (t === 'imageMessage') return m.message.imageMessage?.caption || '[imagem]';
    if (t === 'videoMessage') return m.message.videoMessage?.caption || '[vídeo]';
    if (t === 'documentMessage') return m.message.documentMessage?.caption || '[documento]';
    if (t === 'stickerMessage') return '[sticker]';
    return '';
  } catch (e) {
    return '';
  }
}

// -------------------------------
// Extrair mensagem citada / reply info
// -------------------------------
function extractQuotedInfo(m) {
  try {
    const context = m.message?.extendedTextMessage?.contextInfo;
    if (!context || !context.quotedMessage) return null;

    const quoted = context.quotedMessage;
    const qType = getContentType(quoted);

    let quotedText = '';
    if (qType === 'conversation') quotedText = quoted.conversation || '';
    else if (qType === 'extendedTextMessage') quotedText = quoted.extendedTextMessage?.text || '';
    else if (qType === 'imageMessage') quotedText = quoted.imageMessage?.caption || '[imagem]';
    else quotedText = '[conteúdo]';

    const participantQuoted = context.participant || null;
    const ehRespostaAoBot = isBotJid(participantQuoted);

    return {
      texto: quotedText,
      participant: participantQuoted,
      ehRespostaAoBot,
      stanzaId: context.stanzaId || null
    };
  } catch (e) {
    logger.warn({ e }, 'extractQuotedInfo fail');
    return null;
  }
}

// -------------------------------
// Logging helpers
// -------------------------------
function debugLogMessage(m, numeroExtraido) {
  const tipo = m.key.remoteJid && String(m.key.remoteJid).endsWith('@g.us') ? 'GRUPO' : 'PV';
  const ts = new Date().toLocaleString('pt-BR', { timeZone: 'Africa/Luanda' });
  logger.info('='.repeat(60));
  logger.info(`TS: ${ts} | Tipo: ${tipo}`);
  logger.info('KEY:', {
    remoteJid: m.key.remoteJid,
    participant: m.key.participant,
    fromMe: m.key.fromMe,
    id: m.key.id
  });
  logger.info('MSG INFO:', { pushName: m.pushName, numeroExtraido });
  logger.info('='.repeat(60));
}

// -------------------------------
// QR helpers
// -------------------------------
async function printQrToTerminal(qr) {
  try {
    qrcodeTerminal.generate(qr, { small: true }, (q) => {
      // qrcode-terminal prints automatically; we keep this callback for compatibility
    });
  } catch (e) {
    logger.warn('qrcode-terminal fail:', e?.message || e);
  }
}

// -------------------------------
// Ativação (shouldActivate) - mesma lógica pedida
// - Reply ao bot -> true
// - Menção "akira" ou mentionedJid includes bot -> true
// - PV -> sempre true
// - Caso contrário (grupo sem menção) -> false
// -------------------------------
async function shouldActivate(m, isGroup, text) {
  const context = m.message?.extendedTextMessage?.contextInfo;
  const lowered = text?.toLowerCase() || '';

  // Reply ao bot
  if (context?.participant) {
    const quoted = normalizeJidToFull(context.participant);
    if (isBotJid(quoted)) {
      logger.info('[ATIVAÇÃO] Reply ao bot detectado');
      return true;
    }
  }

  // Menção direta no grupo
  if (isGroup) {
    const mentions = context?.mentionedJid || [];
    const mentionMatch = mentions.some(j => isBotJid(j) || String(j).includes(BOT_REAL));
    if (lowered.includes('akira') || mentionMatch) {
      logger.info('[ATIVAÇÃO] Menção direta a Akira detectada');
      return true;
    }
  }

  // PV sempre responde
  if (!isGroup) return true;

  // Default: não responder
  return false;
}

// -------------------------------
// Registrar mensagem do bot enviada (para possível lógica extra)
// -------------------------------
function registerBotSent(chatId) {
  lastBotMessageAt.set(chatId, Date.now());
  // cleanup older entries
  setTimeout(() => {
    if (lastBotMessageAt.get(chatId) && (Date.now() - lastBotMessageAt.get(chatId) > 1000 * 60 * 10)) {
      lastBotMessageAt.delete(chatId);
    }
  }, 1000 * 60 * 10);
}

// -------------------------------
// Conectar (main)
// -------------------------------
async function connect() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    // close old sock if exists
    if (sock && sock.ws && sock.ev) {
      try {
        logger.info('Closing previous socket...');
        await sock.logout();
      } catch (e) {
        // ignore
      }
      sock = null;
    }

    sock = makeWASocket({
      version,
      auth: state,
      logger,
      browser: Browsers.macOS('AkiraBot'),
      markOnlineOnConnect: true,
      syncFullHistory: false,
      printQRInTerminal: false,
      getMessage: async (key) => {
        // try store first
        if (!key) return undefined;
        try {
          const msg = await store.loadMessage(key.remoteJid, key.id);
          return msg?.message;
        } catch (e) {
          return undefined;
        }
      }
    });

    // bind store if available
    try {
      if (store && typeof store.bind === 'function') store.bind(sock.ev);
    } catch (e) {
      logger.warn('store.bind failed', e?.message || e);
    }

    // save creds on update
    sock.ev.on('creds.update', saveCreds);

    // connection updates
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        currentQR = qr;
        // Print small ascii QR in logs (dense) and provide link via /qr
        try {
          printQrToTerminal(qr);
        } catch (e) {
          logger.warn('printQrToTerminal fail', e?.message || e);
        }
        logger.info('QR available at /qr (HTTP)');
      }

      if (connection === 'open') {
        BOT_JID = sock.user?.id || null;
        BOT_REAL = BOT_JID ? String(BOT_JID).split(':')[0] : null;
        logger.info('✅ AKIRA BOT ONLINE');
        logger.info({ BOT_JID, BOT_REAL, BOT_NUMERO_REAL });
        currentQR = null;
      }

      if (connection === 'close') {
        logger.warn('Connection closed. Attempting reconnect in 5s...');
        const code = lastDisconnect?.error?.output?.statusCode || null;
        logger.warn({ code }, 'lastDisconnect code');
        setTimeout(() => connect().catch((e) => logger.error(e)), 5000);
      }
    });

    // handle decrypt failures
    sock.ev.on('message-decrypt-failed', async (msgKey) => {
      try {
        logger.warn('message-decrypt-failed:', msgKey?.key?.remoteJid || 'unknown');
        // attempt to request retry
        await sock.sendRetryRequest(msgKey.key).catch(() => {});
        // optionally purge sessions store for that jid (more aggressive)
        // if sock.store?.sessions exists (older baileys store structures)
        try {
          if (sock.store && sock.store.sessions && msgKey?.key?.remoteJid) {
            delete sock.store.sessions[msgKey.key.remoteJid];
            logger.info('Deleted session entry for', msgKey.key.remoteJid);
          }
        } catch (e) {
          // ignore
        }
      } catch (e) {
        logger.error('Error handling decrypt fail:', e?.message || e);
      }
    });

    // messages.upsert
    sock.ev.on('messages.upsert', async (m) => {
      try {
        const msg = m.messages && m.messages[0];
        if (!msg) return;
        if (!msg.message) return;
        if (msg.key && msg.key.fromMe) return;

        // de-dup
        if (processed.has(msg.key.id)) return;
        processed.add(msg.key.id);
        setTimeout(() => processed.delete(msg.key.id), 30 * 1000);

        const isGroup = String(msg.key.remoteJid || '').endsWith('@g.us');
        const numeroReal = extractRealNumberFromMessage(msg) || extractNumberFromString(msg.key.remoteJid || '');
        if (!numeroReal) {
          logger.warn('Could not extract real number, skipping message');
          return;
        }

        const nome = msg.pushName || numeroReal;
        const texto = String(extractTextFromMessage(msg) || '').trim();
        if (!texto) return;

        const mensagemCitada = extractQuotedInfo(msg);

        debugLogMessage(msg, numeroReal);
        logger.info(`[MENSAGEM] ${isGroup ? 'GRUPO' : 'PV'} | ${nome} (${numeroReal}): ${texto}`);

        const ativar = await shouldActivate(msg, isGroup, texto);
        if (!ativar) {
          logger.info('[IGNORADO] Não ativado (grupo sem menção / não reply).');
          return;
        }

        // mark as read + presence
        try {
          await sock.readMessages([msg.key]);
        } catch (e) {
          // ignore
        }
        await sock.sendPresenceUpdate('composing', msg.key.remoteJid).catch(() => {});

        // prepare payload to external API
        const payload = {
          usuario: nome,
          numero: numeroReal,
          mensagem: texto,
          mensagem_citada: mensagemCitada ? mensagemCitada.texto : ''
        };

        // call API
        let resposta = 'Ok';
        try {
          const res = await axios.post(API_URL, payload, { timeout: 120000 });
          resposta = res.data?.resposta || resposta;
        } catch (err) {
          logger.error('Erro na API:', err?.message || err);
          // respond fallback
          resposta = 'Erro interno. Tente novamente mais tarde.';
        }

        // delay "typing" proportional to length (natural)
        const typingDelay = Math.min(String(resposta).length * 40, 3000);
        await delay(typingDelay).catch(() => {});
        await sock.sendPresenceUpdate('paused', msg.key.remoteJid).catch(() => {});

        // decide whether to reply quoted or not
        let sendOptions = {};
        if (isGroup) {
          // in group: reply if there's a quoted message OR if the user explicitly mentioned? we'll reply quoted if quoted exists
          if (mensagemCitada) {
            sendOptions = { quoted: msg };
            logger.info('Respondendo em reply (grupo, citado).');
          }
        } else {
          // PV: reply only if user replied to bot (mensagemCitada.ehRespostaAoBot)
          if (mensagemCitada && mensagemCitada.ehRespostaAoBot) {
            sendOptions = { quoted: msg };
            logger.info('Respondendo em reply (PV - usuário respondeu ao bot).');
          } else {
            logger.info('Respondendo sem reply (PV).');
          }
        }

        try {
          await sock.sendMessage(msg.key.remoteJid, { text: resposta }, sendOptions);
          registerBotSent(msg.key.remoteJid);
          // store last message in fallback store for getMessage
          try {
            if (store && typeof store.saveMessage === 'function') {
              // create a fake message object with id and message so getMessage can load it
              const fakeId = (msg.key.id || `bot-${Date.now()}`);
              const fakeMsg = { message: { conversation: resposta } };
              store.saveMessage(msg.key.remoteJid, fakeId, fakeMsg);
            }
          } catch (e) {
            // ignore
          }
        } catch (e) {
          logger.error('Error sending message:', e?.message || e);
        }

      } catch (err) {
        logger.error('messages.upsert handler error:', err?.message || err);
      }
    });

    logger.info('Socket created, awaiting events...');
  } catch (err) {
    logger.error('Connect error:', err?.message || err);
    setTimeout(() => connect().catch(e => logger.error(e)), 5000);
  }
}

// -------------------------------
// EXPRESS server: / , /qr and /health
// - /qr shows a compact black-background image (200x200, margin 0) so scanning from Render logs/screenshot easier
// - Also prints a terminal QR to help local dev
// -------------------------------
const app = express();

app.get('/', (req, res) => {
  const statusHtml = BOT_REAL ? '<span style="color:#0f0;">ONLINE</span>' : '<span style="color:#f90;">AGUARDANDO QR</span>';
  res.send(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8"/>
        <meta name="viewport" content="width=device-width,initial-scale=1"/>
        <title>Akira Bot</title>
        <style>
          body{background:#000;color:#0f0;font-family:monospace;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
          .card{border:2px solid #0f0;padding:24px;border-radius:8px;max-width:600px;text-align:center}
          a{color:#000;background:#0f0;padding:10px 16px;border-radius:6px;text-decoration:none;font-weight:bold}
        </style>
      </head>
      <body>
        <div class="card">
          <h1>🤖 AKIRA BOT</h1>
          <p>Status: ${statusHtml}</p>
          <p>Número configurado: <strong>${BOT_NUMERO_REAL}</strong></p>
          <p>JID atual: <strong>${BOT_REAL || 'N/A'}</strong></p>
          <p><a href="/qr">📱 VER QR (200x200)</a></p>
        </div>
      </body>
    </html>
  `);
});

app.get('/qr', async (req, res) => {
  if (!currentQR) {
    // if already connected
    return res.send(`
      <div style="background:#000;color:#0f0;display:flex;align-items:center;justify-content:center;height:100vh;font-family:monospace">
        <div style="text-align:center">
          <h1>✅ BOT CONECTADO</h1>
          <p>JID: ${BOT_REAL || 'N/A'}</p>
          <p><a href="/" style="color:#0f0">Voltar</a></p>
        </div>
      </div>
    `);
  }

  try {
    // compact QR image: margin 0, width 200 -> module blocks will be tight
    const dataUrl = await QRCode.toDataURL(currentQR, { margin: 0, width: 200 });
    // also print a dense ASCII QR to logs (for dev)
    try { printQrToTerminal(currentQR); } catch (e){}

    // return black background page with the image centered
    res.send(`
      <html>
        <head>
          <meta charset="utf-8"/>
          <meta name="viewport" content="width=device-width,initial-scale=1"/>
          <title>QR - Akira</title>
          <meta http-equiv="refresh" content="5">
          <style>
            body{background:#000;margin:0;display:flex;align-items:center;justify-content:center;height:100vh}
            .box{padding:16px;background:#000;border-radius:10px;text-align:center}
            img{width:200px;height:200px;background:#000;display:block;margin:0 auto;image-rendering:pixelated}
            p{color:#0f0;font-family:monospace}
            a{color:#0f0;text-decoration:none}
          </style>
        </head>
        <body>
          <div class="box">
            <img src="${dataUrl}" alt="QR Code"/>
            <p>Escaneie com WhatsApp Web / App — atualiza a cada 5s</p>
            <p><a href="/">Voltar</a></p>
          </div>
        </body>
      </html>
    `);
  } catch (e) {
    logger.error('QR render error:', e?.message || e);
    res.status(500).send('Erro ao gerar QR');
  }
});

app.get('/health', (req, res) => {
  res.json({
    status: BOT_REAL ? 'online' : 'offline',
    bot_jid: BOT_REAL || null,
    bot_number: BOT_NUMERO_REAL,
    uptime: process.uptime()
  });
});

app.listen(PORT, () => {
  logger.info('HTTP server listening on port ' + PORT);
  logger.info('Health: /health  |  QR: /qr');
});

// -------------------------------
// Start
// -------------------------------
connect().catch((e) => logger.error('Initial connect error', e));

// Global error handlers
process.on('unhandledRejection', (err) => {
  logger.error('UNHANDLED REJECTION', err);
});
process.on('uncaughtException', (err) => {
  logger.error('UNCAUGHT EXCEPTION', err);
  // we do not exit automatically; let process manager restart if required
});
