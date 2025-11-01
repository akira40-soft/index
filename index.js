// ===============================================================
// FILE: index.js
// Baileys → Akira API Bridge (Render otimizado + QRCode compacto)
// ===============================================================

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');

const pino = require('pino');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const express = require('express');
const qrcode = require('qrcode-terminal');

const app = express();
const PORT = process.env.PORT || 3000;

// ===============================
// Servidor de health check
// ===============================
app.get('/', (req, res) => res.send('Akira bot ativo'));
app.listen(PORT, () => console.log(`Health check na porta ${PORT}`));

// ===============================
// QRCode ultra compacto no log
// ===============================
async function exibirQRCode(qr) {
  console.clear();
  console.log('==============================');
  console.log('📱 ESCANEIE O QR ABAIXO PARA CONECTAR:\n');

  qrcode.generate(qr, {
    small: true,  // Usa caracteres densos (█)
    scale: 1,     // Tamanho real (sem zoom)
    margin: 0     // Remove bordas e vazios
  });

  console.log('\n==============================');
}

// ===============================
// Função principal do bot
// ===============================
async function iniciarBot() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth_info_baileys');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    auth: state,
    browser: ['Mac OS', 'AkiraBot', '14.4.1']
  });

  // Eventos de conexão
  sock.ev.on('connection.update', async (update) => {
    const { connection, qr, lastDisconnect } = update;

    if (qr) await exibirQRCode(qr);

    if (connection === 'close') {
      const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
      console.log('❌ Conexão encerrada:', reason);
      if (reason !== DisconnectReason.loggedOut) iniciarBot();
      else console.log('Sessão removida, escaneie novamente.');
    }

    if (connection === 'open') {
      console.log('✅ AKIRA BOT ONLINE!');
      console.log(`botJid detectado: ${sock.user.id}`);
    }
  });

  sock.ev.on('creds.update', saveCreds);

  // ===============================
  // Evento de mensagem recebida
  // ===============================
  sock.ev.on('messages.upsert', async (msg) => {
    try {
      const info = msg.messages[0];
      if (!info.message) return;

      const from = info.key.remoteJid;
      const body =
        info.message.conversation ||
        info.message.extendedTextMessage?.text ||
        '';

      const isGroup = from.endsWith('@g.us');
      const sender = isGroup
        ? info.key.participant
        : from;

      const senderJid = sender?.replace(/:.+/, '').replace('@s.whatsapp.net', '');
      const botJid = sock.user.id.split(':')[0].replace('@s.whatsapp.net', '');

      console.log(`\n[MENSAGEM] ${isGroup ? 'GRUPO' : 'PRIVADO'} | ${senderJid}: ${body}`);

      // Só responde se for menção direta ou reply
      const mentionAkira =
        body.toLowerCase().includes('akira') ||
        info.message?.extendedTextMessage?.contextInfo?.mentionedJid?.includes(sock.user.id);

      if (!mentionAkira && !info.message?.extendedTextMessage?.contextInfo?.stanzaId)
        return console.log('[IGNORADO] Não ativado para responder (não reply ou não menção).');

      // Envia para API da Akira
      const resposta = await axios
        .post('https://akira-api.onrender.com/responder', {
          mensagem: body,
          usuario: senderJid,
          grupo: isGroup
        })
        .then((r) => r.data.resposta)
        .catch((err) => {
          console.log('⚠️ Erro na API:', err.message);
          return 'Tive um pequeno bug, tenta de novo, kota.';
        });

      await sock.sendMessage(from, { text: resposta }, { quoted: info });
      console.log(`[RESPOSTA] ${senderJid}: ${resposta}`);
    } catch (err) {
      console.error('Erro ao processar mensagem:', err);
    }
  });
}

// ===============================
// Início da sessão
// ===============================
(async () => {
  try {
    await iniciarBot();
  } catch (err) {
    console.error('Falha ao iniciar o bot:', err);
  }
})();
