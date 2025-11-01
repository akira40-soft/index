// ===============================================================
// AKIRA BOT — Sessões estáveis e correção total de descriptografia
// ===============================================================

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
const fs = require('fs');

const logger = pino({ level: 'info' });
const AKIRA_API_URL = 'https://akra35567-akira.hf.space/api/akira';
const PORT = process.env.PORT || 3000;
const SESSION_PATH = './auth_info_baileys';

let sock;
let BOT_JID = null;
let lastProcessedTime = 0;

// ===============================================================
// 🔧 UTILITÁRIOS
// ===============================================================
function normalizeJid(jid = '') {
  if (!jid) return null;
  jid = jid.toString().trim();
  jid = jid.replace(/[:@].*/g, '');
  if (jid.startsWith('37')) return BOT_JID || '244952786417@s.whatsapp.net';
  if (!jid.startsWith('244') && /^9\d{8}$/.test(jid)) jid = '244' + jid;
  return `${jid}@s.whatsapp.net`;
}

function extractNumber(input = '') {
  if (!input) return 'desconhecido';
  const clean = input.toString();
  const match = clean.match(/2449\d{8}/);
  if (match) return match[0];
  const matchLocal = clean.match(/9\d{8}/);
  if (matchLocal) return `244${matchLocal[0]}`;
  return clean.replace(/\D/g, '').slice(-12);
}

function isBotJid(jid) {
  const norm = normalizeJid(jid);
  return norm === normalizeJid(BOT_JID);
}

// ===============================================================
// 🧠 RECONSTRUÇÃO DE SESSÃO AUTOMÁTICA
// ===============================================================
async function rebuildSession() {
  console.warn('🧹 Limpando sessão corrompida...');
  try {
    if (fs.existsSync(SESSION_PATH)) fs.rmSync(SESSION_PATH, { recursive: true, force: true });
  } catch (e) {
    console.error('Erro ao apagar sessão antiga:', e.message);
  }
  console.log('♻️ Sessão antiga removida. Reconectando...');
  await delay(2000);
  return connect(true);
}

// ===============================================================
// ⚙️ CONEXÃO PRINCIPAL
// ===============================================================
async function connect(forceReconnect = false) {
  try {
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
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

    sock.ev.on('connection.update', async (update) => {
      const { connection, qr, lastDisconnect } = update;

      if (qr) {
        console.clear();
        console.log('\n📱 ESCANEIE O QR ABAIXO PARA CONECTAR:\n');
        qrcode.generate(qr, { small: false, margin: 2 });
        console.log('\n==============================\n');
      }

      if (connection === 'open') {
        BOT_JID = normalizeJid(sock.user.id);
        console.log('✅ AKIRA BOT ONLINE!');
        console.log('botJid detectado:', BOT_JID);
        lastProcessedTime = Date.now();
      }

      if (connection === 'close') {
        const error = lastDisconnect?.error?.message || '';
        if (error.includes('conflict') || error.includes('replaced')) {
          console.warn('⚠️ Sessão substituída — forçando reconexão limpa...');
          await rebuildSession();
          return;
        }
        console.log('⚠️ Conexão perdida. Tentando reconectar...');
        setTimeout(() => connect(), 5000);
      }
    });

    // ===============================================================
    // 💬 MENSAGENS
    // ===============================================================
    sock.ev.on('messages.upsert', async (m) => {
      const msg = m.messages[0];
      if (!msg.message || msg.key.fromMe) return;

      const from = msg.key.remoteJid;
      const isGroup = from.endsWith('@g.us');

      if (msg.messageTimestamp && msg.messageTimestamp * 1000 < lastProcessedTime - 10000) return;

      let sender = msg.key.participant || msg.participant || from;
      let senderNumber = extractNumber(sender);
      const nome = msg.pushName || senderNumber;

      const text =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        msg.message?.videoMessage?.caption ||
        '';

      if (!text.trim()) return;
      console.log(`\n[MENSAGEM] ${isGroup ? 'GRUPO' : 'PV'} | ${nome} (${senderNumber}): ${text}`);

      const ativar = await shouldActivate(msg, isGroup, text);
      if (!ativar) {
        console.log('[IGNORADO] Não ativado (não reply/nem menção/nem PV).');
        return;
      }

      await sock.sendPresenceUpdate('composing', from);

      try {
        const res = await axios.post(AKIRA_API_URL, {
          usuario: nome,
          mensagem: text,
          numero: senderNumber
        });

        const resposta = res.data.resposta || '...';
        console.log(`[RESPOSTA] ${resposta}`);

        await delay(Math.min(resposta.length * 50, 5000));
        await sock.sendPresenceUpdate('paused', from);

        await sock.sendMessage(from, { text: resposta }, { quoted: msg });
      } catch (err) {
        console.error('⚠️ Erro na API:', err.message);
        await sock.sendMessage(from, { text: 'Erro interno. 😴' }, { quoted: msg });
      }
    });

    // ===============================================================
    // 🔒 CORREÇÃO COMPLETA DE SESSÕES E DESCRIPTOGRAFIA
    // ===============================================================
    sock.ev.on('message-decrypt-failed', async (msgKey) => {
      try {
        const jid = msgKey?.key?.remoteJid;
        if (!jid) return;
        console.warn(`⚠️ Falha ao descriptografar mensagem de ${jid}. Tentando nova chave...`);
        await sock.sendRetryRequest(msgKey.key).catch(() => {});
        if (sock.store?.sessions) delete sock.store.sessions[jid];
        await sock.presenceSubscribe(jid).catch(() => {});
      } catch (e) {
        console.error('Erro ao tentar corrigir sessão:', e.message || e);
      }
    });

    // Hook para qualquer erro geral
    sock.ev.on('error', async (err) => {
      const msg = err.message || err.toString();
      if (
        msg.includes('senderMessageKeys') ||
        msg.includes('Bad MAC') ||
        msg.includes('SessionError')
      ) {
        console.error('🧩 Erro de criptografia detectado:', msg);
        await rebuildSession();
      }
    });

  } catch (e) {
    console.error('❌ Falha crítica ao iniciar conexão:', e.message);
    await rebuildSession();
  }
}

// ===============================================================
// 🎯 LÓGICA DE ATIVAÇÃO (reply / menção / PV)
// ===============================================================
async function shouldActivate(msg, isGroup, text) {
  const context = msg.message?.extendedTextMessage?.contextInfo;
  const lowered = text.toLowerCase();

  if (context?.participant) {
    const quoted = normalizeJid(context.participant);
    if (isBotJid(quoted)) {
      console.log(`[ATIVAÇÃO] Reply ao bot detectado (${BOT_JID})`);
      return true;
    }
  }

  if (isGroup) {
    const mentions = context?.mentionedJid || [];
    const mentionMatch = mentions.some(
      j => isBotJid(j) || j.startsWith('37') || j.includes(BOT_JID.split('@')[0])
    );
    if (lowered.includes('akira') || mentionMatch) {
      console.log('[ATIVAÇÃO] Menção direta a Akira detectada.');
      return true;
    }
  }

  if (!isGroup) return true;
  return false;
}

// ===============================================================
// 🌐 HEALTH CHECK SERVER
// ===============================================================
const app = express();
app.get('/', (req, res) => res.send('AKIRA BOT ONLINE ✅'));
app.listen(PORT, '0.0.0.0', () => console.log(`Health check na porta ${PORT}`));

connect();
