// index.js — AKIRA bot (corrigido: JID/LID unify, sender extraction, session-fault handling)
// Author: ajuste por request do Isaac
// Node >= 18 recomendado

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
const qrcode = require('qrcode-terminal');

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

const AKIRA_API_URL = process.env.AKIRA_API_URL || 'https://akra35567-akira.hf.space/api/akira';
const PORT = process.env.PORT || 3000;

// --- estado global ---
let sock = null;
let BOT_JID = null; // JID canônico do bot (ex: 244952786417@s.whatsapp.net)
let lastConnectedAt = 0;

// ---------------------------
// UTILITÁRIOS
// ---------------------------

/**
 * Normaliza um JID/identificador que pode vir em varios formatos:
 * - '244952786417@s.whatsapp.net'
 * - '202391978787009@lid'
 * - '244937035662:19@s.whatsapp.net'  (coisas estranhas com :19)
 * - '37839265886398' (temporários)
 *
 * Retorna string no formato '244XXXXXXXXX@s.whatsapp.net' sempre que possível,
 * ou mantém BOT_JID fallback se não puder resolver (para comparação).
 */
function normalizeToCanonicalJid(raw = '') {
  if (!raw) return null;
  let s = String(raw).trim();

  // se veio com partes após ':' (ex: 244937035662:19@s.whatsapp.net) -> remover :... parte
  // também remove tudo após primeiro espaço (safeguard)
  s = s.split(/\s/)[0].split(':')[0];

  // se for um jid tipo "202391978787009@lid" — tenta extrair número
  if (s.includes('@')) {
    const left = s.split('@')[0];
    // se left já tem prefixo 2449... deixa
    if (/^2449\d{8}$/.test(left)) return `${left}@s.whatsapp.net`;
    // se left for 9xxxxxxxx adiciona 244
    if (/^9\d{8}$/.test(left)) return `244${left}@s.whatsapp.net`;
    // se left tem 12 dígitos sem prefixo
    if (/^\d{11,13}$/.test(left)) {
      // preferir 244 prefix
      if (left.length === 12 && left.startsWith('244')) return `${left}@s.whatsapp.net`;
      if (left.length === 9 && left.startsWith('9')) return `244${left}@s.whatsapp.net`;
      // fallback return as s (but convert domain to s.whatsapp.net)
      return `${left}@s.whatsapp.net`;
    }
    // fallback: return as-is domain -> convert to s.whatsapp.net for canonical comparisons
    return `${left}@s.whatsapp.net`;
  }

  // se não contiver @, pode ser '378...' temporário / lid string / raw number
  // se parecer com angola 9XXXXXXXX
  if (/^9\d{8}$/.test(s)) return `244${s}@s.whatsapp.net`;
  if (/^2449\d{8}$/.test(s)) return `${s}@s.whatsapp.net`;

  // se começar com '37' (temp id) devolver BOT_JID para evitar falsos positivos
  if (s.startsWith('37') || s.startsWith('202') || s.length < 8) {
    return BOT_JID || '244952786417@s.whatsapp.net';
  }

  // último recurso: extrair últimos 9..12 dígitos e tentar prefixar
  const digits = s.match(/\d{9,12}/);
  if (digits) {
    const d = digits[0];
    if (/^9\d{8}$/.test(d)) return `244${d}@s.whatsapp.net`;
    if (/^2449\d{8}$/.test(d)) return `${d}@s.whatsapp.net`;
    return `${d}@s.whatsapp.net`;
  }

  return BOT_JID || '244952786417@s.whatsapp.net';
}

/** Extrai o número no formato '2449XXXXXXXX' dado uma série de possíveis campos */
function extractNumberFromMessage(msg = {}) {
  // tenta vários campos que o Baileys pode popular
  const candidates = [];

  // key participant (group message)
  if (msg?.key?.participant) candidates.push(msg.key.participant);
  // key remoteJid (PV geralmente)
  if (msg?.key?.remoteJid) candidates.push(msg.key.remoteJid);
  // message context fields
  if (msg?.message?.extendedTextMessage?.contextInfo?.participant) candidates.push(msg.message.extendedTextMessage.contextInfo.participant);
  if (msg?.message?.extendedTextMessage?.contextInfo?.quotedParticipant) candidates.push(msg.message.extendedTextMessage.contextInfo.quotedParticipant);
  // some fields seen: senderLid, participantPn, senderPn, senderLid in logs
  if (msg?.key?.senderLid) candidates.push(msg.key.senderLid);
  if (msg?.senderLid) candidates.push(msg.senderLid);
  if (msg?.message?.senderLid) candidates.push(msg.message.senderLid);
  if (msg?.message?.participantPn) candidates.push(msg.message.participantPn);
  if (msg?.message?.senderPn) candidates.push(msg.message.senderPn);
  if (msg?.pushName) candidates.push(msg.pushName);
  if (msg?.participant) candidates.push(msg.participant);

  // adicionar algumas variações de raw chat id
  if (msg?.key?.remoteJid) candidates.push(msg.key.remoteJid);
  if (msg?.key?.id) candidates.push(msg.key.id);

  // extrair o primeiro match válido
  for (const c of candidates) {
    if (!c) continue;
    const text = String(c);
    // procura por 2449XXXXXXXX
    let m = text.match(/2449\d{8}/);
    if (m) return m[0];
    // procura por 9XXXXXXXX (prefixar 244)
    m = text.match(/\b9\d{8}\b/);
    if (m) return `244${m[0]}`;
    // procura por 12 dígitos que começam com 244
    m = text.match(/(?<!\d)(244\d{9})(?!\d)/);
    if (m) return m[0];
  }

  // fallback: pegar dígitos do key.remoteJid antes do @ e normalizar
  try {
    const r = msg?.key?.remoteJid || '';
    const left = String(r).split('@')[0].split(':')[0];
    if (/^2449\d{8}$/.test(left)) return left;
    if (/^9\d{8}$/.test(left)) return `244${left}`;
  } catch (e) {}

  return 'desconhecido';
}

/** Extrai texto de uma mensagem Baileys se disponível */
function extractTextFromMsg(msg = {}) {
  if (!msg || !msg.message) return '';
  const m = msg.message;
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    ''
  ) || '';
}

// ---------------------------
// RECONEXÃO / INÍCIO
// ---------------------------

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger,
    browser: Browsers.macOS('AkiraBot'),
    markOnlineOnConnect: true,
    syncFullHistory: false,
    connectTimeoutMs: 60000
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, qr, lastDisconnect } = update;
    if (qr) {
      qrcode.generate(qr, { small: true });
      console.log('📱 QR disponível — escaneie com WhatsApp');
    }
    if (connection === 'open') {
      BOT_JID = normalizeToCanonicalJid(sock.user?.id || '');
      lastConnectedAt = Date.now();
      console.log('✅ AKIRA BOT ONLINE!');
      console.log('botJid detectado:', BOT_JID);
    }
    if (connection === 'close') {
      console.log('⚠️ Conexão fechada:', lastDisconnect?.error?.output?.statusCode || lastDisconnect?.error?.message);
      console.log('Reconectando em 5s...');
      setTimeout(start, 5000);
    }
  });

  // handle decrypt failed: try retry request and log
  sock.ev.on('message-decrypt-failed', async (msgKey) => {
    try {
      console.warn('⚠️ message-decrypt-failed - tentando sendRetryRequest...', msgKey?.key);
      if (sock && msgKey?.key) await sock.sendRetryRequest(msgKey.key).catch(() => {});
    } catch (e) {
      console.error('Erro ao retry request:', e?.message || e);
    }
  });

  // mensagens
  sock.ev.on('messages.upsert', async (m) => {
    try {
      const messages = Array.isArray(m.messages) ? m.messages : [m.messages];
      for (const msg of messages) {
        if (!msg) continue;
        // ignore messages from us
        if (msg.key?.fromMe) continue;

        // evitar processar mensagens muito antigas (antes da conexão atual)
        const ts = (msg.messageTimestamp || msg.key?.timestamp || Math.floor(Date.now()/1000)) * 1000;
        if (lastConnectedAt && ts < (lastConnectedAt - 60_000)) {
          // mensagem provavelmente antiga; ignora
          // console.log('Ignorando msg antiga ts=', new Date(ts).toISOString());
          continue;
        }

        // extrair texto e metadados
        const from = msg.key?.remoteJid || '';
        const isGroup = String(from).endsWith('@g.us');
        const senderNumber = extractNumberFromMessage(msg);
        const text = extractTextFromMsg(msg).trim();
        const pushName = msg.pushName || msg.message?.pushName || '';
        const displayName = pushName || senderNumber || 'desconhecido';

        // log baseline
        console.log(`\n[MENSAGEM] ${isGroup ? 'GRUPO' : 'PV'} | ${displayName} (${senderNumber}) => ${text || '<media/sem-texto>'}`);

        // se não houver conteúdo textual extraído, tentar usar verbatim (por ex: protocol events)
        if (!text) {
          // se for uma mensagem que só existiu como notificação de grupo / reaction -> ignorar
          continue;
        }

        // lógica de ativação: reply ao bot OR menção "akira" OR pv sempre
        const should = await shouldActivate(msg, isGroup, text);
        if (!should) {
          console.log('[IGNORADO] Não ativado (não reply/nem menção/nem PV).');
          continue;
        }

        // prepare reply
        await sock.sendPresenceUpdate('composing', from).catch(()=>{});
        // call API
        try {
          const payload = {
            usuario: displayName,
            mensagem: text,
            numero: senderNumber,
            is_group: isGroup
          };
          const apiRes = await axios.post(AKIRA_API_URL, payload, { timeout: 30000 }).catch(e => { throw e; });
          const resposta = (apiRes?.data?.resposta || '...').toString();
          console.log('[RESPOSTA]', resposta);

          // typing delay
          await delay(Math.min(Math.max(resposta.length * 40, 600), 4000));
          await sock.sendPresenceUpdate('paused', from).catch(()=>{});

          // enviar reply: se houver quoted message info, usa quoted para manter contexto
          const quoted = msg.message?.extendedTextMessage?.contextInfo?.stanzaId ? { quoted: msg } : {};
          await sock.sendMessage(from, { text: resposta }, quoted).catch(err => {
            console.error('Erro ao enviar reply:', err?.message || err);
          });
        } catch (err) {
          console.error('Erro ao chamar AKIRA API:', err?.message || err);
          try { await sock.sendMessage(from, { text: 'Erro interno ao processar (AKIRA).' }, { quoted: msg }).catch(()=>{}); } catch {}
        }
      }
    } catch (e) {
      console.error('Erro no upsert loop:', e?.message || e);
    }
  });
}

// ---------------------------
// ACTIVATION LOGIC
// ---------------------------

async function shouldActivate(msg, isGroup, text) {
  // Se PV, sempre responder (mas se for mensagem convidativa ou vazia, já filtrada acima)
  if (!isGroup) return true;

  // se for grupo: checar quoted -> se quoted participant for o bot (lid ou s.whatsapp) -> ativar
  const ctx = msg.message?.extendedTextMessage?.contextInfo;
  if (ctx?.participant) {
    const quotedNormalized = normalizeToCanonicalJid(ctx.participant);
    if (quotedNormalized && quotedNormalized === BOT_JID) {
      console.log('[ATIVAÇÃO] Reply ao bot detectado (quoted participant).');
      return true;
    }
  }
  // em alguns logs quoted info aparece em contextInfo.quotedMessage?.key?.participant
  if (ctx?.quotedMessage && ctx?.stanzaId) {
    const quotedParticipant = ctx.participant || ctx?.quotedMessage?.key?.participant;
    if (quotedParticipant) {
      const qnorm = normalizeToCanonicalJid(quotedParticipant);
      if (qnorm === BOT_JID) {
        console.log('[ATIVAÇÃO] Reply ao bot detectado (quotedMessage key participant).');
        return true;
      }
    }
  }

  // menções diretas (mentionedJid)
  const mentioned = ctx?.mentionedJid || [];
  if (Array.isArray(mentioned) && mentioned.length) {
    // normalize list and compare with BOT_JID or bot number
    const matched = mentioned.some(j => {
      const nj = normalizeToCanonicalJid(j);
      if (!nj) return false;
      if (nj === BOT_JID) return true;
      // também comparar apenas pelo número sem domínio (ex: "244952786417")
      const botNum = BOT_JID?.split('@')[0];
      if (String(j).includes(botNum)) return true;
      return false;
    });
    if (matched) {
      console.log('[ATIVAÇÃO] Menção direta detectada (mentionedJid).');
      return true;
    }
  }

  // texto literal "akira" em mensagem (case-insensitive)
  if (typeof text === 'string' && text.toLowerCase().includes('akira')) {
    console.log('[ATIVAÇÃO] Texto contém "akira".');
    return true;
  }

  // default: não ativar
  return false;
}

// ---------------------------
// HEALTH server e start
// ---------------------------
const app = express();
app.get('/healthz', (req, res) => res.json({ ok: true, botJid: BOT_JID, since: lastConnectedAt }));
app.get('/', (req, res) => res.send('AKIRA BOT — OK'));
app.listen(PORT, '0.0.0.0', () => console.log(`Health check na porta ${PORT}`));

start().catch((e) => {
  console.error('Erro fatal ao iniciar:', e?.message || e);
  process.exit(1);
});
