// ===============================================================
// AKIRA BOT — Baileys v6.7.8 (Log detalhado + reply/menção fix)
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

// ===============================================================
// 🔧 FUNÇÕES UTILITÁRIAS
// ===============================================================
function extractNumber(input = '') {
  if (!input) return 'desconhecido';
  const clean = input.toString();
  const match = clean.match(/2449\d{8}/);
  if (match) return match[0];
  const local = clean.match(/9\d{8}/);
  if (local) return `244${local[0]}`;
  return clean.replace(/\D/g, '').slice(-12);
}

function normalizeJid(jid = '') {
  if (!jid) return null;
  jid = jid.toString().trim();
  jid = jid.replace(/[:@].*/g, '');
  if (jid.startsWith('37') || jid.startsWith('202') || jid.length < 9)
    return BOT_JID || '244952786417@s.whatsapp.net';
  if (!jid.startsWith('244') && /^9\d{8}$/.test(jid))
    jid = '244' + jid;
  return `${jid}@s.whatsapp.net`;
}

function isBotJid(jid) {
  const norm = normalizeJid(jid);
  return norm === normalizeJid(BOT_JID);
}

// ===============================================================
// ⚙️ CONEXÃO
// ===============================================================
async function connect() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
  const { version } = await fetchLatestBaileysVersion();

  if (sock && sock.user) {
    console.log('🔄 Fechando sessão antiga...');
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
      console.log('📱 ESCANEIE O QR PARA CONECTAR');
    }

    if (connection === 'open') {
      BOT_JID = normalizeJid(sock.user.id);
      console.log('✅ AKIRA BOT ONLINE!');
      console.log('BOT_JID detectado:', BOT_JID);
      lastProcessedTime = Date.now();
      currentQR = null;
    }

    if (connection === 'close') {
      const reason = lastDisconnect?.error?.output?.statusCode;
      console.log(`⚠️ Conexão perdida (reason: ${reason}). Reconectando em 5s...`);
      setTimeout(connect, 5000);
    }
  });

  // ===============================================================
  // 💬 EVENTO DE MENSAGEM
  // ===============================================================
  sock.ev.on('messages.upsert', async (m) => {
    const msg = m.messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const from = msg.key.remoteJid;
    const isGroup = from.endsWith('@g.us');
    if (msg.messageTimestamp && msg.messageTimestamp * 1000 < lastProcessedTime - 10000) return;

    // ===== DEBUG DETALHADO =====
    console.log('\n====================== MENSAGEM RECEBIDA ======================');
    console.log(JSON.stringify({
      remoteJid: msg.key.remoteJid,
      fromMe: msg.key.fromMe,
      pushName: msg.pushName,
      participant: msg.key.participant,
      participantAlt: msg.key.participantAlt,
      participant_pn: msg.participant_pn,
      contextInfo_participant: msg.message?.extendedTextMessage?.contextInfo?.participant,
      contextInfo_participant_pn: msg.message?.extendedTextMessage?.contextInfo?.participant_pn,
      messageType: Object.keys(msg.message)[0],
      textContent: msg.message.conversation ||
                   msg.message.extendedTextMessage?.text ||
                   msg.message?.imageMessage?.caption ||
                   msg.message?.videoMessage?.caption ||
                   '',
    }, null, 2));
    console.log('===============================================================\n');

    // ===== EXTRAÇÃO DE NÚMERO =====
    const numeroExtraido = extractNumber(
      msg.key.participantAlt ||
      msg.key.participant ||
      msg.participant_pn ||
      msg.message?.extendedTextMessage?.contextInfo?.participant_pn ||
      msg.message?.extendedTextMessage?.contextInfo?.participant ||
      msg.key.remoteJid
    );
    console.log(`📞 Número extraído final: ${numeroExtraido}`);

    const nome = msg.pushName || numeroExtraido;

    const text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      msg.message?.imageMessage?.caption ||
      msg.message?.videoMessage?.caption ||
      '';

    if (!text.trim()) return;

    console.log(`💬 ${isGroup ? 'GRUPO' : 'PV'} | ${nome} (${numeroExtraido}): ${text}`);

    const ativar = await shouldActivate(msg, isGroup, text);
    if (!ativar) {
      console.log('[IGNORADO] Não ativado para responder (não reply ou não menção).');
      return;
    }

    // ===== SIMULAÇÃO DE LEITURA =====
    if (!isGroup) {
      try {
        await sock.readMessages([msg.key]);
        await sock.sendReceipt(from, msg.key.participant, ['read']);
        console.log('✅ Simulação de visualização (dois tiques azuis)');
      } catch (e) {
        console.log('⚠️ Falha ao marcar como lida:', e.message);
      }
    }

    await sock.sendPresenceUpdate('composing', from);

    try {
      const res = await axios.post(AKIRA_API_URL, {
        usuario: nome,
        mensagem: text,
        numero: numeroExtraido
      });

      const resposta = res.data.resposta || '...';
      console.log(`[RESPOSTA] ${resposta}`);

      await delay(Math.min(resposta.length * 50, 4000));
      await sock.sendPresenceUpdate('paused', from);
      await sock.sendMessage(from, { text: resposta }, { quoted: msg });
    } catch (err) {
      console.error('⚠️ Erro na API:', err.message);
      await sock.sendMessage(from, { text: 'Erro interno. 😴' }, { quoted: msg });
    }
  });

  sock.ev.on('message-decrypt-failed', async (msgKey) => {
    console.log('⚠️ Tentando regenerar sessão perdida...');
    try {
      await sock.sendRetryRequest(msgKey.key);
    } catch (e) {
      console.log('❌ Falha ao regenerar sessão:', e.message);
    }
  });
}

// ===============================================================
// 🎯 ATIVAÇÃO (reply / menção / PV)
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
      j => isBotJid(j) || j.includes(BOT_JID.split('@')[0])
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
// 🌐 EXPRESS SERVER (Health + QR HTML)
// ===============================================================
const app = express();

app.get("/", (_, res) => {
  res.send(`
    <html><body style="font-family:sans-serif;text-align:center;margin-top:10%;">
      <h2>✅ Akira Bot está online!</h2>
      <p>Acesse <a href="/qr">/qr</a> para escanear o QR Code, se necessário.</p>
    </body></html>
  `);
});

app.get("/qr", async (_, res) => {
  if (!currentQR) {
    res.send(`
      <html><body style="font-family:sans-serif;text-align:center;margin-top:10%;">
        <h2>✅ Akira já está conectado ao WhatsApp!</h2>
        <p>Recarregue esta página se desconectar.</p>
      </body></html>
    `);
  } else {
    try {
      const qrBase64 = await QRCode.toDataURL(currentQR);
      res.send(`
        <html><head><meta http-equiv="refresh" content="10"></head>
        <body style="font-family:sans-serif;text-align:center;margin-top:10%;">
          <h2>📱 Escaneie este QR Code no WhatsApp</h2>
          <img src="${qrBase64}" alt="QR Code" />
          <p style="color:gray;">Atualiza automaticamente a cada 10 segundos.</p>
        </body></html>
      `);
    } catch (err) {
      res.status(500).send(`<p>Erro ao gerar QR: ${err.message}</p>`);
    }
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🌐 Servidor ativo na porta ${PORT}`);
  console.log(`🔗 Acesse: http://localhost:${PORT}/qr`);
});

connect();
