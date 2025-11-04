// ===============================================================
// AKIRA BOT — Baileys + Express + QR HTML + Railway Ready
// ===============================================================

import express from "express";
import axios from "axios";
import fs from "fs";
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  Browsers
} from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";

const AKIRA_API_URL = process.env.AKIRA_API_URL || "https://akira-api.vercel.app/responder";
const PORT = process.env.PORT || 8080;

let sock;
let BOT_JID = null;
let currentQR = null;
let reconnecting = false;

// ===============================================================
// 📞 FUNÇÕES AUXILIARES
// ===============================================================
function extractNumber(input = "") {
  if (!input) return "desconhecido";
  const clean = input.toString();
  const match = clean.match(/2449\d{8}/);
  if (match) return match[0];
  const local = clean.match(/9\d{8}/);
  if (local) return `244${local[0]}`;
  return clean.replace(/\D/g, "").slice(-12);
}

function normalizeJid(jid = "") {
  if (!jid) return null;
  jid = jid.toString().trim();
  jid = jid.replace(/[:@].*/g, "");
  if (!jid.startsWith("244") && /^9\d{8}$/.test(jid)) jid = "244" + jid;
  return `${jid}@s.whatsapp.net`;
}

function isBotJid(jid) {
  return normalizeJid(jid) === normalizeJid(BOT_JID);
}

// ===============================================================
// 🔌 CONEXÃO BAILEYS
// ===============================================================
async function connect() {
  const { state, saveCreds } = await useMultiFileAuthState("./auth_info_baileys");

  sock = makeWASocket({
    auth: state,
    browser: Browsers.macOS("Desktop"),
    markOnlineOnConnect: true,
    printQRInTerminal: false,
    connectTimeoutMs: 60000,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      currentQR = qr;

      // QR no console
      qrcode.generate(qr, { small: true });
      console.log("\n📱 ESCANEIE O QR PARA CONECTAR AO WHATSAPP\n");
    }

    if (connection === "open") {
      BOT_JID = normalizeJid(sock.user.id);
      console.log("✅ AKIRA BOT ONLINE!");
      console.log("botJid detectado:", BOT_JID);
      currentQR = null; // QR não é mais necessário
    }

    if (connection === "close") {
      const reason = lastDisconnect?.error?.output?.statusCode || 0;
      if (reason === DisconnectReason.loggedOut) {
        console.log("🔒 Sessão expirada. Limpando credenciais...");
        fs.rmSync("./auth_info_baileys", { recursive: true, force: true });
        process.exit(0);
      }
      console.log(`⚠️ Conexão perdida (reason: ${reason}). Tentando reconectar...`);
      if (!reconnecting) {
        reconnecting = true;
        setTimeout(connect, 5000);
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const from = msg.key.remoteJid;
    const isGroup = from.endsWith("@g.us");
    const senderJid = isGroup
      ? msg.key.participant || msg.key.participantAlt || msg.message?.extendedTextMessage?.contextInfo?.participant
      : from;
    const senderNumber = extractNumber(senderJid);
    const nome =
      msg.pushName || msg.message?.senderName || msg.key.remoteJid.split("@")[0];
    const text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      msg.message.imageMessage?.caption ||
      "";

    console.log(`\n💬 ${isGroup ? "GRUPO" : "PV"} | ${nome} (${senderNumber}): ${text}`);

    const ativar = await shouldActivate(msg, isGroup, text);
    if (!ativar) return;

    try {
      await sock.sendPresenceUpdate("composing", from);
      await sock.readMessages([msg.key]);
    } catch {}

    try {
      const res = await axios.post(AKIRA_API_URL, {
        usuario: nome,
        mensagem: text,
        grupo: isGroup,
        remetente: senderNumber,
      });

      const resposta = res.data?.resposta || "⚠️ Erro ao processar resposta.";
      await sock.sendMessage(from, { text: resposta }, { quoted: msg });
    } catch (err) {
      console.error("❌ Erro ao enviar resposta:", err.message);
    }
  });
}

// ===============================================================
// 🎯 ATIVAÇÃO
// ===============================================================
async function shouldActivate(msg, isGroup, text) {
  const ctx = msg.message?.extendedTextMessage?.contextInfo;
  const lowered = text.toLowerCase();

  if (ctx?.participant && isBotJid(ctx.participant)) return true;
  if (isGroup) {
    const mentions = ctx?.mentionedJid || [];
    if (mentions.some((j) => isBotJid(j)) || lowered.includes("akira")) return true;
  } else return true;

  return false;
}

// ===============================================================
// 🌐 EXPRESS SERVER — Health + QR HTML
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

app.get("/qr", (_, res) => {
  if (!currentQR) {
    res.send(`
      <html><body style="font-family:sans-serif;text-align:center;margin-top:10%;">
        <h2>✅ Akira já está conectado ao WhatsApp!</h2>
        <p>Recarregue esta página se desconectar.</p>
      </body></html>
    `);
  } else {
    const qrImg = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(
      currentQR
    )}`;
    res.send(`
      <html><head><meta http-equiv="refresh" content="10"></head>
      <body style="font-family:sans-serif;text-align:center;margin-top:10%;">
        <h2>📱 Escaneie este QR Code no WhatsApp</h2>
        <img src="${qrImg}" alt="QR Code"/>
        <p style="color:gray;">Atualiza automaticamente a cada 10 segundos.</p>
      </body></html>
    `);
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🌐 Servidor ativo na porta ${PORT}`);
  console.log(`🔗 Acesse: http://localhost:${PORT}/qr`);
});

connect();
