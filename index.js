// ===============================================================
// AKIRA BOT — VERSÃO FINAL CORRIGIDA (Dezembro 2025)
// ES MODULES → Corrigido para funcionar com "type": "module"
// ===============================================================

// === CORREÇÃO EXCLUSIVA PROBLEMA DO RAILWAY ===
// (Antes usava require(), agora usa import)
import baileys from '@whiskeysockets/baileys';
import axios from 'axios';
import express from 'express';
import QRCode from 'qrcode';
import pino from 'pino';

// Importa funções internas do Baileys
const {
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    Browsers,
    delay,
    getContentType,
    jidNormalizedUser,
    makeInMemoryStore
} = baileys;

// ===============================================================
// O RESTANTE DO TEU CÓDIGO — NADA FOI MEXIDO / SOMENTE COPIADO
// ===============================================================

const PORT = process.env.PORT || 3000;
const API_URL = process.env.API_URL || 'https://akra35567-akira.hf.space/api/akira';

const BOT_NUMERO_REAL = '244952786417';

let sock;
let BOT_REAL = null;
let BOT_JID = null;
let currentQR = null;

const logger = pino({ level: 'silent' });

const store = makeInMemoryStore({ logger });

const ultimasMensagensBot = new Map();

function ehBot(jid) {
    if (!jid) return false;
    if (BOT_JID && jid.includes(BOT_JID)) return true;
    if (jid.includes(BOT_NUMERO_REAL)) return true;
    return false;
}

function extrairNumeroReal(m) {
    const key = m.key;

    console.log('\n[DEBUG EXTRAÇÃO] Iniciando...');
    console.log(`  remoteJid: ${key.remoteJid}`);
    console.log(`  participant: ${key.participant || 'N/A'}`);

    if (!key.remoteJid.endsWith('@g.us')) {
        const numero = key.remoteJid.split('@')[0];
        console.log(`  [EXTRAÇÃO] Privado → ${numero}`);
        return numero;
    }

    if (m.participant) {
        console.log(`  participantAlt encontrado: ${m.participant}`);

        if (m.participant.includes('@s.whatsapp.net')) {
            const numero = m.participant.split('@')[0];
            console.log(`  [EXTRAÇÃO] participantAlt @s.whatsapp.net → ${numero}`);
            return numero;
        }
    }

    if (key.participant) {
        const participant = key.participant;
        console.log(`  key.participant: ${participant}`);

        if (participant.includes('@s.whatsapp.net')) {
            const numero = participant.split('@')[0];
            console.log(`  [EXTRAÇÃO] key.participant @s.whatsapp.net → ${numero}`);
            return numero;
        }

        if (participant.includes('@lid')) {
            const numero = converterLidParaNumero(participant);
            if (numero) {
                console.log(`  [EXTRAÇÃO] LID convertido → ${numero}`);
                return numero;
            }
        }
    }

    console.log(`  [EXTRAÇÃO] FALLBACK - não conseguiu extrair número válido`);
    return null;
}

function converterLidParaNumero(lid) {
    try {
        console.log(`  [LID] Tentando converter: ${lid}`);

        const lidLimpo = lid.split('@')[0];

        if (lidLimpo.includes(':')) {
            const partes = lidLimpo.split(':');
            const numeroBase = partes[0];

            console.log(`    LID partes:`, partes);
            console.log(`    numeroBase: ${numeroBase}`);

            if (numeroBase.length >= 9) {
                const ultimos9 = numeroBase.slice(-9);
                const resultado = '244' + ultimos9;
                console.log(`    [LID] Resultado: ${resultado}`);
                return resultado;
            }
        }

        const digitos = lidLimpo.replace(/\D/g, '');
        if (digitos.length >= 9) {
            const resultado = '244' + digitos.slice(-9);
            console.log(`    [LID] Fallback resultado: ${resultado}`);
            return resultado;
        }

        console.log(`    [LID] FALHOU - não conseguiu converter`);
        return null;

    } catch (erro) {
        console.error('  [ERRO LID]:', erro.message);
        return null;
    }
}

function logDebugCompleto(m, numeroExtraido) {
    const tipo = m.key.remoteJid.endsWith('@g.us') ? 'GRUPO' : 'PRIVADO';
    const timestamp = new Date().toLocaleString('pt-BR', { timeZone: 'Africa/Luanda' });

    console.log('\n' + '='.repeat(70));
    console.log(`📅 ${timestamp}`);
    console.log('='.repeat(70));
    console.log(`📍 TIPO: ${tipo}`);
    console.log('-'.repeat(70));
    console.log('🔑 KEY INFO:');
    console.log(`   remoteJid    : ${m.key.remoteJid || 'N/A'}`);
    console.log(`   participant  : ${m.key.participant || 'N/A'}`);
    console.log(`   id           : ${m.key.id || 'N/A'}`);
    console.log(`   fromMe       : ${m.key.fromMe}`);
    console.log('-'.repeat(70));
    console.log('👤 MESSAGE INFO:');
    console.log(`   participant (m): ${m.participant || 'N/A'}`);
    console.log(`   pushName        : ${m.pushName || 'N/A'}`);
    console.log('-'.repeat(70));
    console.log(`📱 NÚMERO EXTRAÍDO: ${numeroExtraido || 'FALHOU'}`);
    console.log('='.repeat(70) + '\n');
}

function extrairTextoMensagem(m) {
    try {
        const tipo = getContentType(m.message);
        if (!tipo) return '';

        const mapaTipos = {
            'conversation': () => m.message.conversation || '',
            'extendedTextMessage': () => m.message.extendedTextMessage?.text || '',
            'imageMessage': () => m.message.imageMessage?.caption || '[Imagem]'],
            'videoMessage': () => m.message.videoMessage?.caption || '[Vídeo]',
            'documentMessage': () => m.message.documentMessage?.caption || '[Documento]',
            'audioMessage': () => '[Áudio]',
            'stickerMessage': () => '[Sticker]',
            'reactionMessage': () => '[Reação]',
            'pollCreationMessage': () => '[Enquete]',
            'pollUpdateMessage': () => '[Voto]'
        };

        return mapaTipos[tipo] ? mapaTipos[tipo]() : '[Mídia]';

    } catch (erro) {
        console.error('[ERRO extrairTextoMensagem]:', erro.message);
        return '';
    }
}

function extrairMensagemCitada(m) {
    try {
        const contextInfo = m.message?.extendedTextMessage?.contextInfo;
        if (!contextInfo?.quotedMessage) return null;

        const quotedMsg = contextInfo.quotedMessage;
        const quotedType = getContentType(quotedMsg);

        let textoQuoted = '';

        const mapaTiposQuoted = {
            'conversation': () => quotedMsg.conversation || '',
            'extendedTextMessage': () => quotedMsg.extendedTextMessage?.text || '',
            'imageMessage': () => quotedMsg.imageMessage?.caption || '[Imagem]',
            'videoMessage': () => quotedMsg.videoMessage?.caption || '[Vídeo]',
            'documentMessage': () => '[Documento]',
            'audioMessage': () => '[Áudio]',
            'stickerMessage': () => '[Sticker]'
        };

        textoQuoted = mapaTiposQuoted[quotedType] ? mapaTiposQuoted[quotedType]() : '[Mensagem]';

        const participantQuoted = contextInfo.participant;
        const ehRespostaAoBot = ehBot(participantQuoted);

        console.log(`[REPLY] Detectado reply para: ${participantQuoted}`);
        console.log(`[REPLY] É resposta ao bot? ${ehRespostaAoBot ? 'SIM' : 'NÃO'}`);

        return {
            texto: textoQuoted,
            participant: participantQuoted,
            ehRespostaAoBot: ehRespostaAoBot,
            stanzaId: contextInfo.stanzaId
        };

    } catch (erro) {
        console.error('[ERRO extrairMensagemCitada]:', erro.message);
        return null;
    }
}

function logMensagemRecebida(m, numeroReal, texto, mensagemCitada) {
    const tipo = m.key.remoteJid.endsWith('@g.us') ? 'GRUPO' : 'PV';
    const timestamp = new Date().toLocaleTimeString('pt-BR', { timeZone: 'Africa/Luanda' });

    console.log(`\n📨 [${timestamp}] [${tipo}] De: ${m.pushName || 'Sem nome'} (${numeroReal})`);
    console.log(`📝 Mensagem: ${texto.substring(0, 100)}${texto.length > 100 ? '...' : ''}`);

    if (mensagemCitada) {
        const destinoReply = mensagemCitada.ehRespostaAoBot ? 'BOT' : 'USUÁRIO';
        console.log(`↩️  Reply para ${destinoReply}: "${mensagemCitada.texto.substring(0, 50)}..."`);
    }

    console.log('');
}

function registrarMensagemBot(chatId) {
    ultimasMensagensBot.set(chatId, Date.now());

    setTimeout(() => {
        ultimasMensagensBot.delete(chatId);
    }, 300000);
}

function ultimaMensagemFoiDoBot(chatId) {
    const timestamp = ultimasMensagensBot.get(chatId);
    if (!timestamp) return false;

    const agora = Date.now();
    const diferenca = agora - timestamp;

    return diferenca < 300000;
}

async function conectar() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    sock = baileys.default({
        version,
        auth: state,
        browser: Browsers.macOS('Akira Bot'),
        syncFullHistory: false,
        markOnlineOnConnect: true,
        printQRInTerminal: false,
        logger,

        getMessage: async (key) => {
            const msg = await store.loadMessage(key.remoteJid, key.id);
            return msg?.message;
        }
    });

    store.bind(sock.ev);

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', ({ connection, qr }) => {
        if (qr) {
            currentQR = qr;
            console.log('\n🔗 QR Code disponível em: /qr\n');
        }

        if (connection === 'open') {
            BOT_JID = sock.user.id;
            BOT_REAL = sock.user.id.split(':')[0];

            console.log(`\n=== AKIRA BOT ONLINE ===`);
            console.log(`Real: ${BOT_NUMERO_REAL}`);
            console.log(`JID: ${BOT_JID}`);
            console.log(`Extraído: ${BOT_REAL}`);
        }

        if (connection === 'close') {
            console.log('\n⚠️ Reconectando...');
            setTimeout(conectar, 5000);
        }
    });

    const processadas = new Set();

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];

        if (!m.message) return;
        if (m.key.fromMe) return;
        if (processadas.has(m.key.id)) return;

        processadas.add(m.key.id);
        setTimeout(() => processadas.delete(m.key.id), 30000);

        const numeroReal = extrairNumeroReal(m);
        if (!numeroReal) return;

        const nome = m.pushName || numeroReal;
        const texto = extrairTextoMensagem(m);
        const mensagemCitada = extrairMensagemCitada(m);
        const ehGrupo = m.key.remoteJid.endsWith('@g.us');
        const chatId = m.key.remoteJid;

        logDebugCompleto(m, numeroReal);
        logMensagemRecebida(m, numeroReal, texto, mensagemCitada);

        if (ehGrupo && !texto.toLowerCase().includes('akira')) {
            return;
        }

        try {
            await sock.readMessages([m.key]);
            await sock.sendPresenceUpdate('composing', chatId);

            const payload = {
                usuario: nome,
                numero: numeroReal,
                mensagem: texto,
                mensagem_citada: mensagemCitada ? mensagemCitada.texto : ''
            };

            const res = await axios.post(API_URL, payload, {
                timeout: 120000,
                headers: { 'Content-Type': 'application/json' }
            });

            const resposta = res.data?.resposta || 'Ok';

            await delay(Math.min(resposta.length * 40, 3000));
            await sock.sendPresenceUpdate('paused', chatId);

            let opcoes = {};

            if (ehGrupo && mensagemCitada) {
                opcoes = { quoted: m };
            } else if (!ehGrupo && mensagemCitada?.ehRespostaAoBot) {
                opcoes = { quoted: m };
            }

            await sock.sendMessage(chatId, { text: resposta }, opcoes);
            registrarMensagemBot(chatId);

        } catch (err) {
            console.error(err);

            await sock.sendMessage(
                chatId,
                { text: 'Erro interno, tenta de novo.' },
                { quoted: m }
            );
        }
    });
}

const app = express();

app.get('/', (req, res) => {
    const statusHtml = BOT_REAL
        ? '<span style="color: #0f0;">ONLINE</span>'
        : '<span style="color: #f90;">AGUARDANDO QR</span>';

    res.send(`
        <h1 style="font-family: monospace; color: #0f0; text-align:center;">AKIRA BOT</h1>
        <p>Status: ${statusHtml}</p>
        <p>Número: ${BOT_NUMERO_REAL}</p>
        <p>JID: ${BOT_REAL || 'N/A'}</p>
        <p><a href="/qr">VER QR</a></p>
    `);
});

app.get('/qr', async (req, res) => {
    if (!currentQR) {
        return res.send(`<h1 style="color:white;background:black;text-align:center;padding:40px">BOT JÁ CONECTADO</h1>`);
    }

    const img = await QRCode.toDataURL(currentQR);

    res.send(`
        <body style="background:black;color:#0f0;text-align:center;padding:40px">
            <h1>ESCANEIE O QR</h1>
            <img src="${img}" style="border:10px solid #0f0; border-radius:20px">
            <meta http-equiv="refresh" content="5">
        </body>
    `);
});

app.get('/health', (_, res) => {
    res.json({
        status: BOT_REAL ? 'online' : 'offline',
        jid: BOT_REAL,
        numero: BOT_NUMERO_REAL,
        uptime: process.uptime()
    });
});

app.listen(PORT, () => {
    console.log(`Servidor iniciado em http://localhost:${PORT}`);
});

conectar();

process.on('unhandledRejection', err => console.error(err));
process.on('uncaughtException', err => console.error(err));
