/**
 * index.js — Akira (versão robusta)
 * - Normaliza JIDs (PV e grupos) para <numero>@s.whatsapp.net
 * - Detecta replies mesmo quando quoted.participant vem como @lid ou participantPn
 * - Usa o mesmo método de extração de número no grupo que no PV
 * - Evita citar mensagens inválidas ao responder
 */

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

const logger = pino({ level: 'info' });

const AKIRA_API_URL = process.env.AKIRA_API_URL || 'https://akra35567-akira.hf.space/api/akira';
const PORT = process.env.PORT || 3000;

// Se tens um JID fixo do bot, podes definir aqui. Caso prefiras usar o jid da sessão,
// vamos também atualizar dinamicamente com sock.user.id na conexão.
const CONFIG_BOT_JID = process.env.BOT_REAL_JID || null; // ex: '244952786417@s.whatsapp.net'

let sock;
let lastProcessedTime = 0;
let botJid = CONFIG_BOT_JID || null; // valor final usado para comparação

// --- Helpers de normalização / extração ---

/**
 * Retorna a "base" numérica do jid (só os dígitos) ou null.
 * Ex.: "37839265886398@lid" -> "37839265886398"
 *       "244937035662@s.whatsapp.net" -> "244937035662"
 */
function jidBase(jid) {
  if (!jid) return null;
  const s = String(jid);
  // remove qualquer sufixo @..., remove símbolos
  const parts = s.split('@')[0];
  const digits = parts.replace(/\D/g, '');
  return digits || null;
}

/**
 * Constrói um JID estável de usuário no formato <base>@s.whatsapp.net.
 * Se o jid de entrada era grupo (@g.us) preserva o jid do chat.
 */
function toUserJid(jid) {
  if (!jid) return null;
  if (jid.endsWith('@g.us')) return jid; // chat de grupo
  const base = jidBase(jid);
  if (!base) return null;
  return `${base}@s.whatsapp.net`;
}

/**
 * Tenta descobrir o participant/autor citado em um contexto de quotedMessage.
 * Procura em vários campos que o Baileys / WhatsApp usam.
 * Retorna JID normalizado (xxx@s.whatsapp.net) ou null.
 */
function getQuotedParticipantJid(context, msg) {
  if (!context) return null;

  // 1) context.participant (muito comum)
  if (context.participant) {
    return toUserJid(context.participant);
  }

  // 2) context.quotedMessage?.key?.participant
  if (context.quotedMessage?.key?.participant) {
    return toUserJid(context.quotedMessage.key.participant);
  }

  // 3) Alguns eventos/logs usam participantPn ou participant_pn - tentamos ler do msg (se existir)
  // Observação: campos podem ter nomes diferentes em logs; verificamos possibilidades.
  if (msg?.msgAttrs && msg.msgAttrs.participantPn) {
    return toUserJid(msg.msgAttrs.participantPn);
  }
  if (msg?.msgAttrs && msg.msgAttrs.participant_pn) {
    return toUserJid(msg.msgAttrs.participant_pn);
  }

  // 4) context.quotedMessage?.participant (pouco comum mas tentativa)
  if (context.quotedMessage?.participant) {
    return toUserJid(context.quotedMessage.participant);
  }

  return null;
}

/**
 * Extrai o JID do remetente/autoria da mensagem de forma consistente tanto em PV quanto em grupo.
 * Sempre retorna <numero>@s.whatsapp.net (ou null em caso de falha).
 */
function getSenderJid(msg) {
  if (!msg || !msg.key) return null;

  // Caso grupo, use msg.key.participant (muitas vezes vem como x@lid)
  if (msg.key.participant) {
    const p = toUserJid(msg.key.participant);
    if (p) return p;
  }

  // Caso PV, msg.key.remoteJid normalmente já é o usuário <num>@s.whatsapp.net
  if (msg.key.remoteJid) {
    // Se remoteJid for grupo, não queremos o chat, queremos o participante — portanto fallback
    if (!msg.key.remoteJid.endsWith('@g.us')) {
      const r = toUserJid(msg.key.remoteJid);
      if (r) return r;
    }
  }

  // Por fim, tenta extrair do próprio payload (algumas mensagens tem participantPn)
  if (msg.msgAttrs && (msg.msgAttrs.participantPn || msg.msgAttrs.participant_pn)) {
    return toUserJid(msg.msgAttrs.participantPn || msg.msgAttrs.participant_pn);
  }

  return null;
}

// --- Conexão / lógica principal ---

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
      // evita que o Baileys tente buscar mensagens antigas que podem exigir sessões
      shouldSyncHistoryMessage: () => false,
      getMessage: async () => ({ conversation: '' }),
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
      const { connection, qr } = update;

      if (qr) {
        require('qrcode-terminal').generate(qr, { small: true });
        console.log('\n📲 ESCANEIE O QR AGORA!\n');
      }

      if (connection === 'open') {
        // Atualiza botJid dinamicamente (prioridade: CONFIG depois sock.user.id)
        try {
          const sessionJid = sock.user?.id;
          if (sessionJid) {
            // sessionJid pode vir no formato "244952786417:10" — tiramos sufixo
            const base = sessionJid.split(':')[0];
            botJid = CONFIG_BOT_JID || `${base}@s.whatsapp.net`;
          } else {
            botJid = CONFIG_BOT_JID || botJid;
          }
        } catch (e) {
          botJid = CONFIG_BOT_JID || botJid;
        }

        console.log('✅ AKIRA BOT ONLINE! (Multi-device ativo)');
        console.log('botJid definido como:', botJid);
        lastProcessedTime = Date.now();
      }

      if (connection === 'close') {
        console.log('⚠️ Conexão fechada. Tentando reconectar em 5s...');
        setTimeout(connect, 5000);
      }
    });

    sock.ev.on('messages.upsert', async (m) => {
      // mensagens podem vir com tipos diferentes; pegamos a primeira válida
      const msg = m.messages?.[0];
      if (!msg || !msg.message) return;
      if (msg.key.fromMe) return;

      // evita mensagens antigas
      if (msg.messageTimestamp && (msg.messageTimestamp * 1000) < lastProcessedTime - 10000) {
        // console.log('Mensagem antiga ignorada');
        return;
      }

      // Normaliza sender info
      const fromChat = msg.key.remoteJid; // chat JID (grupo ou pv)
      const isGroup = !!fromChat && fromChat.endsWith('@g.us');

      // Pega o JID do autor (padronizado para <num>@s.whatsapp.net)
      const senderJid = getSenderJid(msg) || null;
      const senderNumber = senderJid ? jidBase(senderJid) : 'desconhecido';

      // Texto da mensagem (considera captions)
      const text =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        msg.message.imageMessage?.caption ||
        msg.message.videoMessage?.caption ||
        '';

      if (!text || !String(text).trim()) return;

      const displayName = msg.pushName?.trim() || senderNumber;
      console.log(`\n[MENSAGEM] ${isGroup ? 'GRUPO' : 'PV'} | ${displayName} (${senderJid || senderNumber}): ${text}`);

      // Decide se responde
      const should = await shouldActivate(msg, isGroup);
      if (!should) {
        console.log('[IGNORADO] Não ativado para responder (não reply ou não menção).');
        return;
      }

      // Presença
      try { await sock.sendPresenceUpdate('composing', fromChat); } catch (e) {}

      const start = Date.now();

      // Chamada à API
      try {
        const res = await axios.post(AKIRA_API_URL, {
          usuario: displayName,
          mensagem: text,
          numero: senderJid || `${senderNumber}@s.whatsapp.net`
        }, { timeout: 30000 });

        const resposta = (res?.data?.resposta) ? res.data.resposta : 'Não entendi.';
        console.log('[RESPOSTA]', resposta);

        const typing = Math.min(Math.max(String(resposta).length * 50, 1000), 5000);
        if (Date.now() - start < typing) await delay(typing - (Date.now() - start));

        try { await sock.sendPresenceUpdate('paused', fromChat); } catch (e) {}

        // Só usamos quoted se a mensagem original tiver estrutura válida (id)
        const quotedOpt = (msg?.key?.id) ? { quoted: msg } : {};

        // Responder no chat (se grupo -> responde no grupo; se PV -> no PV)
        await sock.sendMessage(fromChat, { text: resposta }, quotedOpt);

      } catch (err) {
        console.error('Erro API:', err?.message || err);
        try {
          // mensagem fallback
          await sock.sendMessage(fromChat, { text: 'Erro interno.' });
        } catch (e) {}
      }
    });

  } catch (err) {
    console.error('Erro ao iniciar conexão:', err?.message || err);
    setTimeout(connect, 20000);
  }
}

/**
 * shouldActivate: detecta se a mensagem deve ativar o bot
 * - Reply à mensagem da bot (verifica quoted participant em várias propriedades)
 * - Menção direta (mentionedJid) normalizada
 * - Palavra 'akira' no texto
 */
async function shouldActivate(msg, isGroup) {
  const context = msg.message?.extendedTextMessage?.contextInfo;
  const text = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').toLowerCase();

  // 1) Reply direto: verifica quoted participant (várias fontes)
  if (context?.quotedMessage) {
    const quotedJid = getQuotedParticipantJid(context, msg); // retorna normalized user jid ou null
    if (quotedJid) {
      // comparar bases (só a parte numérica) para cobrir @lid/@s.whatsapp.net etc.
      const quotedBase = jidBase(quotedJid);
      const botBase = jidBase(botJid);
      if (quotedBase && botBase && quotedBase === botBase) {
        console.log('[ATIVAÇÃO] Reply ao bot detectado (quoted participant).');
        return true;
      } else {
        console.log('[IGNORADO] Reply mas não cita mensagem da bot:', quotedJid);
        return false;
      }
    }
  }

  // 2) Menção via mentionedJid
  if (isGroup) {
    const mentions = context?.mentionedJid || [];
    if (Array.isArray(mentions) && mentions.length > 0) {
      const normalized = mentions.map(j => toUserJid(j));
      const botNormalized = toUserJid(botJid);
      if (normalized.includes(botNormalized)) {
        console.log('[ATIVAÇÃO] Bot mencionado via mentionedJid.');
        return true;
      }
    }
    // 3) palavra no texto
    if (text.includes('akira')) {
      console.log('[ATIVAÇÃO] Palavra "akira" detectada no texto.');
      return true;
    }
  }

  // PV: só respondemos se for reply direto (já tratado em cima), caso contrário não
  return false;
}

// Health check express
const app = express();
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Health check na porta ${server.address().port}`);
});
app.get('/', (req, res) => res.send('AKIRA BOT ONLINE'));
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`Porta ${PORT} em uso. Tentando outra...`);
    server.listen(0, '0.0.0.0');
  }
});

connect();
