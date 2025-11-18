===============================================================
 // AKIRA BOT — Baileys v6.7.8 (FIX LID + NÚMERO REAL)
===============================================================

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
let BOT_JID = null;
let BOT_REAL = null;
let currentQR = null;

function extractRealNumber(jid = "") {
    if (!jid) return "";

    let clean = jid.replace(/@.*/, "").replace(/:\d+$/, "").trim();

    if (clean.startsWith("202") && clean.length > 12) {
        clean = clean.slice(-9);
        return "244" + clean;
    }

    if (/^9\d{8}$/.test(clean)) {
        return "244" + clean;
    }

    if (/^2449\d{8}$/.test(clean)) {
        return clean;
    }

    const match = clean.match(/2449\d{8}/);
    if (match) return match[0];

    return clean.replace(/\D/g, "").slice(-12);
}

function normalizeJid(jid) {
    const n = extractRealNumber(jid);
    return n ? `${n}@s.whatsapp.net` : null;
}

function messageText(msg) {
    const type = getContentType(msg);
    if (type === "conversation") return msg.conversation;
    if (type === "extendedTextMessage") return msg.extendedTextMessage.text;
    if (type === "imageMessage" || type === "videoMessage")
        return msg[type].caption || "";
    if (type === "stickerMessage") return "Sticker";
    if (type === "buttonsResponseMessage") return msg.buttonsResponseMessage.selectedDisplayText;
    if (type === "templateButtonReplyMessage") return msg.templateButtonReplyMessage.selectedDisplayText;
    if (type === "listResponseMessage") return msg.listResponseMessage.title;
    return "";
}

function isBot(jid) {
    const real = extractRealNumber(jid);
    return real === BOT_REAL;
}
async function connect() {
    const { state, saveCreds } = await useMultiFileAuthState("auth_info_baileys");
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        logger,
        auth: state,
        browser: Browsers.macOS('Desktop'),
        syncFullHistory: false
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
        if (qr) currentQR = qr;

        if (connection === "open") {
            BOT_JID = sock.user.id;
            BOT_REAL = extractRealNumber(BOT_JID);
            logger.info(`AKIRA BOT ONLINE! @REAL: ${BOT_REAL}`);
            currentQR = null;
        }

        if (connection === "close") {
            setTimeout(connect, 4000);
        }
    });

    sock.ev.on("messages.upsert", async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const remoteJid = msg.key.remoteJid;
        const isGroup = remoteJid.endsWith("@g.us");

        const rawSender = msg.key.participant || msg.key.remoteJid;
        const senderReal = extractRealNumber(rawSender);

        const pushName = msg.pushName || senderReal;

        const msgText = messageText(msg.message).trim();

        const context = msg.message?.extendedTextMessage?.contextInfo;
        const quotedJid = context?.participant;
        const quotedMsg = context?.quotedMessage ? messageText(context.quotedMessage) : "";

        let activate = false;

        // PV sempre ativa
        if (!isGroup) activate = true;

        // Reply ao bot
        if (quotedJid && isBot(quotedJid)) {
            activate = true;
        }

        // Grupo → menciona Akira
        if (isGroup) {
            const lower = msgText.toLowerCase();
            const mentions = context?.mentionedJid || [];
            if (mentions.some(j => isBot(j))) activate = true;
            if (lower.includes("akira")) activate = true;
        }

        if (!activate) return;

        try {
            await sock.readMessages([msg.key]);
            await sock.sendReceipt(remoteJid, rawSender, ["read"]);
        } catch {}

        await sock.sendPresenceUpdate("composing", remoteJid);

        try {
            const payload = {
                usuario: pushName,
                mensagem: msgText,
                numero: `${senderReal}`,
                mensagem_citada: quotedMsg
            };

            const api = await axios.post(AKIRA_API_URL, payload, {
                headers: { "Content-Type": "application/json" },
                timeout: 300000
            });

            const resposta = api.data?.resposta || "...";

            await delay(Math.min(resposta.length * 50, 3500));
            await sock.sendPresenceUpdate("paused", remoteJid);

            await sock.sendMessage(
                remoteJid,
                { text: resposta },
                { quoted: msg }
            );

        } catch (err) {
            await sock.sendMessage(
                remoteJid,
                { text: "Erro interno. Tenta depois." },
                { quoted: msg }
            );
        }
    });

    sock.ev.on("message-decrypt-failed", async (msgKey) => {
        try { await sock.sendRetryRequest(msgKey.key); } catch {}
    });
}
const app = express();

app.get("/", (_, res) => {
    res.send("<h2>Akira Bot está online. Vá para /qr</h2>");
});

app.get("/qr", async (_, res) => {
    if (!currentQR) {
        res.send("<h2>Já conectado!</h2>");
        return;
    }

    const img = await QRCode.toDataURL(currentQR);
    res.send(`
        <html><body style='text-align:center'>
        <h2>Escaneie o QR</h2>
        <img src="${img}" />
        <meta http-equiv="refresh" content="5">
        </body></html>
    `);
});

app.listen(PORT, "0.0.0.0", () => {
    logger.info(`Servidor na porta ${PORT}`);
});

connect();
