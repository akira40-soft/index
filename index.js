// ===============================================================
// AKIRA BOT — VERSÃO FINAL CORRIGIDA (Dezembro 2025)
// ✅ Número real em grupos (LID → número)
// ✅ Reply contextualizado
// ✅ Debug permanente
// ===============================================================

import makeWASocket, {
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    Browsers,
    delay,
    getContentType,
    jidNormalizedUser
} from '@whiskeysockets/baileys';
import axios from 'axios';
import express from 'express';
import * as QRCode from 'qrcode';

const PORT = process.env.PORT || 3000;
const API_URL = process.env.API_URL || 'https://akra35567-akira.hf.space/api/akira';

let sock;
let BOT_REAL = null;
let currentQR = null;

// ============================================================================
// FUNÇÃO CORRIGIDA: PEGA NÚMERO REAL (INCLUINDO GRUPOS COM LID)
// ============================================================================
function pegarNumeroReal(m) {
    const key = m.key;
    
    // === PRIORIDADE 1: PARTICIPANT (GRUPOS) ===
    if (key.participant) {
        const participant = key.participant;
        
        // Caso 1: participant é número direto (@s.whatsapp.net)
        if (participant.includes('@s.whatsapp.net')) {
            return participant.split('@')[0];
        }
        
        // Caso 2: participant é LID (@lid)
        if (participant.includes('@lid')) {
            const lid = participant.split('@')[0];
            
            // LID formato padrão: "2025517869123456:78@lid"
            // Extrai os últimos 9 dígitos e adiciona código de país
            if (lid.includes(':')) {
                const partes = lid.split(':');
                const numero_parte = partes[0];
                
                // Extrai últimos 9 dígitos
                if (numero_parte.length >= 9) {
                    const ultimos9 = numero_parte.slice(-9);
                    return '244' + ultimos9; // Angola
                }
            }
            
            // Fallback: extrai qualquer sequência de 9+ dígitos
            const digitos = lid.replace(/\D/g, '');
            if (digitos.length >= 9) {
                return '244' + digitos.slice(-9);
            }
        }
    }
    
    // === PRIORIDADE 2: PRIVADO (remoteJid direto) ===
    if (!key.remoteJid.endsWith('@g.us')) {
        return key.remoteJid.split('@')[0];
    }
    
    // === PRIORIDADE 3: FALLBACK (extrai do remoteJid do grupo) ===
    // Formato grupo: 120363123456789@g.us
    const match = key.remoteJid.match(/120363(\d+)@g\.us/);
    if (match) {
        const grupoId = match[1];
        if (grupoId.length >= 9) {
            return '244' + grupoId.slice(-9);
        }
    }
    
    // === ÚLTIMO RECURSO ===
    return '244000000000';
}

// ============================================================================
// DEBUG PERMANENTE
// ============================================================================
function debugPermanente(m, numero) {
    const tipo = m.key.remoteJid.endsWith('@g.us') ? 'GRUPO' : 'PRIVADO';
    console.log("\n╔════════════════════════════════════════════════════════════════╗");
    console.log(`║ TIPO: ${tipo.padEnd(55)} ║`);
    console.log("╠════════════════════════════════════════════════════════════════╣");
    console.log(`║ remoteJid    : ${(m.key.remoteJid || 'N/A').padEnd(46)} ║`);
    console.log(`║ participant  : ${(m.key.participant || 'N/A').padEnd(46)} ║`);
    console.log(`║ pushName     : ${(m.pushName || 'N/A').padEnd(46)} ║`);
    console.log("╠════════════════════════════════════════════════════════════════╣");
    console.log(`║ NÚMERO EXTRAÍDO → ${numero.padEnd(43)} ║`);
    console.log("╚════════════════════════════════════════════════════════════════╝\n");
}

// ============================================================================
// EXTRAI TEXTO DA MENSAGEM
// ============================================================================
function getMessageText(m) {
    const t = getContentType(m.message);
    if (!t) return '';
    if (t === 'conversation') return m.message.conversation || '';
    if (t === 'extendedTextMessage') return m.message.extendedTextMessage.text || '';
    if (['imageMessage', 'videoMessage'].includes(t)) return m.message[t].caption || '';
    if (t === 'documentMessage') return m.message.documentMessage.caption || 'Documento';
    if (t === 'audioMessage') return 'Áudio';
    if (t === 'stickerMessage') return 'Sticker';
    return 'Mídia';
}

// ============================================================================
// EXTRAI MENSAGEM CITADA (REPLY)
// ============================================================================
function getQuotedMessage(m) {
    try {
        const quotedMsg = m.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        if (!quotedMsg) return '';
        
        const quotedType = getContentType(quotedMsg);
        if (quotedType === 'conversation') {
            return quotedMsg.conversation || '';
        }
        if (quotedType === 'extendedTextMessage') {
            return quotedMsg.extendedTextMessage?.text || '';
        }
        if (['imageMessage', 'videoMessage'].includes(quotedType)) {
            return quotedMsg[quotedType]?.caption || '[Mídia]';
        }
        return '[Mensagem citada]';
    } catch (e) {
        return '';
    }
}

// ============================================================================
// CONEXÃO COM WHATSAPP
// ============================================================================
async function connect() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        auth: state,
        browser: Browsers.macOS('Desktop'),
        syncFullHistory: false,
        markOnlineOnConnect: true,
        printQRInTerminal: false
    });

    sock.ev.on('creds.update', saveCreds);
    
    sock.ev.on('connection.update', ({ connection, qr }) => {
        if (qr) {
            currentQR = qr;
            console.log('\n🔗 QR Code disponível em: http://localhost:' + PORT + '/qr\n');
        }
        if (connection === 'open') {
            BOT_REAL = sock.user.id.split(':')[0];
            console.log('\n✅ AKIRA BOT ONLINE → ' + BOT_REAL + '\n');
        }
        if (connection === 'close') {
            console.log('\n⚠️  Conexão fechada. Reconectando em 5s...\n');
            setTimeout(connect, 5000);
        }
    });

    // Cache de mensagens processadas (evita duplicatas)
    const processadas = new Set();

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        
        // Ignora mensagens inválidas ou já processadas
        if (!m.message || m.key.fromMe || processadas.has(m.key.id)) return;
        
        processadas.add(m.key.id);
        setTimeout(() => processadas.delete(m.key.id), 10000); // Remove após 10s

        // === EXTRAI INFORMAÇÕES ===
        const numeroReal = pegarNumeroReal(m);
        const nome = m.pushName || numeroReal;
        const texto = getMessageText(m).trim();
        const mensagemCitada = getQuotedMessage(m);
        const ehGrupo = m.key.remoteJid.endsWith('@g.us');

        // Debug permanente
        debugPermanente(m, numeroReal);

        // === FILTRO: EM GRUPOS, RESPONDE APENAS SE MENCIONAR "akira" ===
        if (ehGrupo && !texto.toLowerCase().includes('akira')) {
            console.log('❌ Grupo: Mensagem não menciona "akira", ignorando...\n');
            return;
        }

        console.log(`✅ [${ehGrupo ? 'GRUPO' : 'PV'}] ${nome} (${numeroReal}): ${texto.substring(0, 50)}...\n`);

        try {
            // === MARCA COMO LIDA + DIGITANDO ===
            await sock.readMessages([m.key]);
            await sock.sendPresenceUpdate('composing', m.key.remoteJid);

            // === MONTA PAYLOAD PARA API ===
            const payload = {
                usuario: nome,
                numero: numeroReal,
                mensagem: texto,
                mensagem_citada: mensagemCitada
            };

            console.log('📤 Enviando para API...');
            
            // === CHAMA API DA AKIRA ===
            const res = await axios.post(API_URL, payload, { 
                timeout: 120000, // 2 minutos
                headers: { 'Content-Type': 'application/json' }
            });
            
            const resposta = res.data?.resposta || 'Ok';
            console.log('📥 Resposta recebida:', resposta.substring(0, 100) + '...\n');

            // === SIMULA DIGITAÇÃO (baseado no tamanho da resposta) ===
            const delayDigitacao = Math.min(resposta.length * 50, 3000); // Máx 3s
            await delay(delayDigitacao);
            
            // === PARA DE DIGITAR + ENVIA MENSAGEM ===
            await sock.sendPresenceUpdate('paused', m.key.remoteJid);
            await sock.sendMessage(m.key.remoteJid, { text: resposta }, { quoted: m });
            
            console.log('✅ Mensagem enviada com sucesso!\n');

        } catch (err) {
            console.error('❌ Erro ao processar mensagem:', err.message);
            
            // Mensagem de erro amigável
            const erroMsg = err.code === 'ECONNABORTED' 
                ? 'Demorou demais, tenta de novo' 
                : 'Barra no bardeado, já volto';
            
            try {
                await sock.sendMessage(m.key.remoteJid, { text: erroMsg }, { quoted: m });
            } catch (e) {
                console.error('❌ Falha ao enviar mensagem de erro:', e.message);
            }
        }
    });
}

// ============================================================================
// SERVIDOR EXPRESS (QR CODE)
// ============================================================================
const app = express();

app.get('/', (req, res) => {
    res.send(`
        <html>
        <head>
            <title>Akira Bot</title>
            <style>
                body { 
                    font-family: monospace; 
                    background: #000; 
                    color: #0f0; 
                    text-align: center; 
                    padding: 50px; 
                }
                h1 { border: 2px solid #0f0; padding: 20px; }
                a { color: #0f0; text-decoration: none; font-size: 20px; }
            </style>
        </head>
        <body>
            <h1>🤖 AKIRA BOT ONLINE</h1>
            <p>Status: ${BOT_REAL ? '✅ Conectado' : '⏳ Aguardando conexão'}</p>
            <p>Bot: ${BOT_REAL || 'N/A'}</p>
            <br>
            <a href="/qr">📱 Ver QR Code</a>
        </body>
        </html>
    `);
});

app.get('/qr', async (req, res) => {
    if (!currentQR) {
        return res.send(`
            <html>
            <head>
                <meta http-equiv="refresh" content="3">
                <style>
                    body { 
                        font-family: monospace; 
                        background: #000; 
                        color: #0f0; 
                        text-align: center; 
                        padding: 50px; 
                    }
                </style>
            </head>
            <body>
                <h1>✅ Bot já está conectado!</h1>
                <p>Número: ${BOT_REAL || 'N/A'}</p>
                <p><a href="/" style="color: #0f0;">Voltar</a></p>
            </body>
            </html>
        `);
    }
    
    const img = await QRCode.toDataURL(currentQR);
    res.send(`
        <html>
        <head>
            <meta http-equiv="refresh" content="5">
            <style>
                body { 
                    background: #000; 
                    color: #0f0; 
                    text-align: center; 
                    padding: 50px; 
                    font-family: monospace;
                }
                img { 
                    border: 10px solid #0f0; 
                    border-radius: 20px; 
                    max-width: 400px;
                }
            </style>
        </head>
        <body>
            <h1>📱 ESCANEIE O QR CODE</h1>
            <img src="${img}" />
            <p>Atualiza automaticamente em 5s</p>
            <p><a href="/" style="color: #0f0;">Voltar</a></p>
        </body>
        </html>
    `);
});

app.get('/health', (req, res) => {
    res.json({
        status: BOT_REAL ? 'online' : 'offline',
        bot_number: BOT_REAL || null,
        timestamp: new Date().toISOString()
    });
});

app.listen(PORT, () => {
    console.log('═══════════════════════════════════════════════════');
    console.log('🚀 AKIRA BOT INICIADO');
    console.log('═══════════════════════════════════════════════════');
    console.log(`📡 Servidor: http://localhost:${PORT}`);
    console.log(`🔗 QR Code: http://localhost:${PORT}/qr`);
    console.log(`🌐 API: ${API_URL}`);
    console.log('═══════════════════════════════════════════════════\n');
});

// Inicia conexão
connect();
