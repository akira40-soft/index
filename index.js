// ===============================================================
// AKIRA BOT — VERSÃO FINAL CORRIGIDA (Dezembro 2025)
// ✅ Extração robusta com participantAlt + fallbacks
// ✅ Bot reconhece JID + número real
// ✅ Reply inteligente no PV
// ✅ Debug completo
// ✅ CommonJS (require) para compatibilidade
// ===============================================================

const baileys = require('@whiskeysockets/baileys');
const axios = require('axios');
const express = require('express');
const QRCode = require('qrcode');
const pino = require('pino');

const {
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    Browsers,
    delay,
    getContentType,
    jidNormalizedUser,
    makeInMemoryStore
} = baileys;

const PORT = process.env.PORT || 3000;
const API_URL = process.env.API_URL || 'https://akra35567-akira.hf.space/api/akira';

// Número real do bot (para comparação)
const BOT_NUMERO_REAL = '244952786417';

let sock;
let BOT_REAL = null;
let BOT_JID = null;
let currentQR = null;

// Logger silencioso
const logger = pino({ level: 'silent' });

// Store para mensagens (reply)
const store = makeInMemoryStore({ logger });

// Cache de últimas mensagens do bot por chat (para reply no PV)
const ultimasMensagensBot = new Map();

// ============================================================================
// VERIFICA SE É O BOT (JID OU NÚMERO REAL)
// ============================================================================
function ehBot(jid) {
    if (!jid) return false;
    
    // Verifica JID do bot
    if (BOT_JID && jid.includes(BOT_JID)) return true;
    
    // Verifica número real do bot
    if (jid.includes(BOT_NUMERO_REAL)) return true;
    
    return false;
}

// ============================================================================
// EXTRAÇÃO ROBUSTA DE NÚMERO (PRIORIDADE: participantAlt → participant → remoteJid)
// ============================================================================
function extrairNumeroReal(m) {
    const key = m.key;
    
    console.log('\n[DEBUG EXTRAÇÃO] Iniciando...');
    console.log(`  remoteJid: ${key.remoteJid}`);
    console.log(`  participant: ${key.participant || 'N/A'}`);
    
    // === CASO 1: MENSAGEM PRIVADA ===
    if (!key.remoteJid.endsWith('@g.us')) {
        const numero = key.remoteJid.split('@')[0];
        console.log(`  [EXTRAÇÃO] Privado → ${numero}`);
        return numero;
    }
    
    // === CASO 2: GRUPO - TENTA participantAlt PRIMEIRO (LOCAL) ===
    if (m.participant) {
        console.log(`  participantAlt encontrado: ${m.participant}`);
        
        // Se é @s.whatsapp.net direto
        if (m.participant.includes('@s.whatsapp.net')) {
            const numero = m.participant.split('@')[0];
            console.log(`  [EXTRAÇÃO] participantAlt @s.whatsapp.net → ${numero}`);
            return numero;
        }
    }
    
    // === CASO 3: GRUPO - USA key.participant (RAILWAY/CLOUD) ===
    if (key.participant) {
        const participant = key.participant;
        console.log(`  key.participant: ${participant}`);
        
        // 3A: Participant é @s.whatsapp.net
        if (participant.includes('@s.whatsapp.net')) {
            const numero = participant.split('@')[0];
            console.log(`  [EXTRAÇÃO] key.participant @s.whatsapp.net → ${numero}`);
            return numero;
        }
        
        // 3B: Participant é LID (@lid)
        if (participant.includes('@lid')) {
            const numero = converterLidParaNumero(participant);
            if (numero) {
                console.log(`  [EXTRAÇÃO] LID convertido → ${numero}`);
                return numero;
            }
        }
    }
    
    // === CASO 4: FALLBACK - TENTA pushName como pista ===
    console.log(`  [EXTRAÇÃO] FALLBACK - não conseguiu extrair número válido`);
    return null;
}

// ============================================================================
// CONVERTE LID PARA NÚMERO REAL
// ============================================================================
function converterLidParaNumero(lid) {
    try {
        console.log(`  [LID] Tentando converter: ${lid}`);
        
        const lidLimpo = lid.split('@')[0];
        
        // Formato padrão: "2025517869123456:78@lid"
        if (lidLimpo.includes(':')) {
            const partes = lidLimpo.split(':');
            const numeroBase = partes[0];
            
            console.log(`    LID partes:`, partes);
            console.log(`    numeroBase: ${numeroBase}`);
            
            // Extrai últimos 9 dígitos + código Angola
            if (numeroBase.length >= 9) {
                const ultimos9 = numeroBase.slice(-9);
                const resultado = '244' + ultimos9;
                console.log(`    [LID] Resultado: ${resultado}`);
                return resultado;
            }
        }
        
        // Fallback: extrai qualquer sequência de dígitos
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

// ============================================================================
// DEBUG COMPLETO
// ============================================================================
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

// ============================================================================
// EXTRAI TEXTO DA MENSAGEM
// ============================================================================
function extrairTextoMensagem(m) {
    try {
        const tipo = getContentType(m.message);
        if (!tipo) return '';
        
        const mapaTipos = {
            'conversation': () => m.message.conversation || '',
            'extendedTextMessage': () => m.message.extendedTextMessage?.text || '',
            'imageMessage': () => m.message.imageMessage?.caption || '[Imagem]',
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

// ============================================================================
// EXTRAI MENSAGEM CITADA (REPLY)
// ============================================================================
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
        
        // Verifica se está respondendo ao bot
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

// ============================================================================
// LOG DE MENSAGEM RECEBIDA
// ============================================================================
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

// ============================================================================
// REGISTRA MENSAGEM DO BOT (PARA CONTROLE DE REPLY NO PV)
// ============================================================================
function registrarMensagemBot(chatId) {
    ultimasMensagensBot.set(chatId, Date.now());
    
    // Limpa registros antigos (mais de 5 minutos)
    setTimeout(() => {
        ultimasMensagensBot.delete(chatId);
    }, 300000);
}

// ============================================================================
// VERIFICA SE ÚLTIMA MENSAGEM FOI DO BOT (PARA PV)
// ============================================================================
function ultimaMensagemFoiDoBot(chatId) {
    const timestamp = ultimasMensagensBot.get(chatId);
    if (!timestamp) return false;
    
    // Considera válido se foi nos últimos 5 minutos
    const agora = Date.now();
    const diferenca = agora - timestamp;
    
    return diferenca < 300000; // 5 minutos
}

// ============================================================================
// CONEXÃO COM WHATSAPP
// ============================================================================
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
            if (store) {
                const msg = await store.loadMessage(key.remoteJid, key.id);
                return msg?.message || undefined;
            }
            return undefined;
        }
    });
    
    // Bind do store
    if (store) store.bind(sock.ev);
    
    sock.ev.on('creds.update', saveCreds);
    
    sock.ev.on('connection.update', (update) => {
        const { connection, qr } = update;
        
        if (qr) {
            currentQR = qr;
            console.log('\n🔗 QR Code disponível em: http://localhost:' + PORT + '/qr\n');
        }
        
        if (connection === 'open') {
            BOT_REAL = sock.user.id.split(':')[0];
            BOT_JID = sock.user.id;
            
            console.log('\n' + '═'.repeat(60));
            console.log('✅ AKIRA BOT ONLINE');
            console.log(`📱 Número Real: ${BOT_NUMERO_REAL}`);
            console.log(`🆔 JID Completo: ${BOT_JID}`);
            console.log(`🔢 JID Extraído: ${BOT_REAL}`);
            console.log('═'.repeat(60) + '\n');
        }
        
        if (connection === 'close') {
            console.log('\n⚠️  Conexão fechada. Reconectando em 5s...\n');
            setTimeout(conectar, 5000);
        }
    });
    
    // Cache de mensagens processadas
    const processadas = new Set();
    
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        const m = messages[0];
        
        // === VALIDAÇÕES INICIAIS ===
        if (!m.message) {
            console.log('[SKIP] Mensagem sem conteúdo');
            return;
        }
        
        if (m.key.fromMe) {
            console.log('[SKIP] Mensagem própria');
            return;
        }
        
        if (processadas.has(m.key.id)) {
            console.log('[SKIP] Mensagem já processada');
            return;
        }
        
        processadas.add(m.key.id);
        setTimeout(() => processadas.delete(m.key.id), 30000);
        
        // === EXTRAÇÃO DE DADOS ===
        const numeroReal = extrairNumeroReal(m);
        
        if (!numeroReal) {
            console.log('[SKIP] Não foi possível extrair número real\n');
            return;
        }
        
        const nome = m.pushName || numeroReal;
        const texto = extrairTextoMensagem(m);
        const mensagemCitada = extrairMensagemCitada(m);
        const ehGrupo = m.key.remoteJid.endsWith('@g.us');
        const chatId = m.key.remoteJid;
        
        // === DEBUG DETALHADO ===
        logDebugCompleto(m, numeroReal);
        logMensagemRecebida(m, numeroReal, texto, mensagemCitada);
        
        // === LÓGICA DE RESPOSTA ===
        
        // 1. EM GRUPOS: Só responde se mencionar "akira"
        if (ehGrupo && !texto.toLowerCase().includes('akira')) {
            console.log('❌ [GRUPO] Mensagem não menciona "akira", ignorando...\n');
            return;
        }
        
        // 2. EM PV: SEMPRE responde, mas reply apenas se usuário usou reply ao bot
        if (!ehGrupo) {
            console.log('✅ [PV] Mensagem recebida, sempre processamos no PV...');
            
            if (mensagemCitada && mensagemCitada.ehRespostaAoBot) {
                console.log('   → Usuário usou reply ao bot, vamos responder em reply também\n');
            } else if (mensagemCitada) {
                console.log('   → Usuário usou reply mas não ao bot, respondemos normal (sem reply)\n');
            } else {
                console.log('   → Mensagem normal, respondemos normal (sem reply)\n');
            }
        }
        
        console.log(`✅ [PROCESSANDO] Mensagem de ${nome}\n`);
        
        try {
            // === MARCA COMO LIDA ===
            await sock.readMessages([m.key]);
            console.log('✓ Mensagem marcada como lida');
            
            // === SIMULA DIGITAÇÃO ===
            await sock.sendPresenceUpdate('composing', chatId);
            console.log('✓ Presença: digitando...');
            
            // === MONTA PAYLOAD PARA API ===
            const payload = {
                usuario: nome,
                numero: numeroReal,
                mensagem: texto,
                mensagem_citada: mensagemCitada ? mensagemCitada.texto : ''
            };
            
            console.log('📤 Enviando para API:', API_URL);
            console.log('📦 Payload:', JSON.stringify(payload, null, 2));
            
            // === CHAMA API DA AKIRA ===
            const res = await axios.post(API_URL, payload, {
                timeout: 120000,
                headers: { 'Content-Type': 'application/json' }
            });
            
            const resposta = res.data?.resposta || 'Ok';
            console.log(`📥 Resposta da API (${resposta.length} caracteres)`);
            console.log(`   Prévia: ${resposta.substring(0, 150)}...\n`);
            
            // === DELAY BASEADO NO TAMANHO ===
            const delayDigitacao = Math.min(resposta.length * 40, 3000);
            console.log(`⏳ Aguardando ${delayDigitacao}ms...`);
            await delay(delayDigitacao);
            
            // === PARA DE DIGITAR ===
            await sock.sendPresenceUpdate('paused', chatId);
            
            // === ENVIA RESPOSTA ===
            // No PV: usa reply APENAS se usuário usou reply ao bot
            // Em GRUPOS: sempre usa reply quando disponível
            let opcoesEnvio = {};
            
            if (ehGrupo && mensagemCitada) {
                // Grupo: sempre responde em reply se houver contexto
                opcoesEnvio = { quoted: m };
                console.log('   → Respondendo em REPLY (grupo)');
            } else if (!ehGrupo && mensagemCitada && mensagemCitada.ehRespostaAoBot) {
                // PV: só responde em reply se usuário respondeu ao bot
                opcoesEnvio = { quoted: m };
                console.log('   → Respondendo em REPLY (PV - usuário usou reply ao bot)');
            } else {
                // Caso contrário: resposta normal
                console.log('   → Respondendo NORMAL (sem reply)');
            }
            
            await sock.sendMessage(chatId, { text: resposta }, opcoesEnvio);
            
            // === REGISTRA QUE BOT ENVIOU MENSAGEM (PARA CONTROLE DE REPLY) ===
            registrarMensagemBot(chatId);
            
            console.log('✅ Mensagem enviada com sucesso!');
            console.log('═'.repeat(70) + '\n');
            
        } catch (erro) {
            console.error('\n❌ ERRO AO PROCESSAR:', erro.message);
            console.error('Stack:', erro.stack);
            
            const msgErro = erro.code === 'ECONNABORTED'
                ? 'Demorou demais, tenta de novo 🕐'
                : 'Barra no bardeado, já volto! 🔧';
            
            try {
                await sock.sendMessage(chatId, { text: msgErro }, { quoted: m });
                console.log('✓ Mensagem de erro enviada');
            } catch (e) {
                console.error('❌ Falha ao enviar erro:', e.message);
            }
            
            console.log('═'.repeat(70) + '\n');
        }
    });
}

// ============================================================================
// SERVIDOR EXPRESS
// ============================================================================
const app = express();

app.get('/', (req, res) => {
    const statusHtml = BOT_REAL
        ? '<span style="color: #0f0;">✅ ONLINE</span>'
        : '<span style="color: #f90;">⏳ AGUARDANDO</span>';
    
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Akira Bot</title>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body {
                    font-family: 'Courier New', monospace;
                    background: linear-gradient(135deg, #000 0%, #1a1a1a 100%);
                    color: #0f0;
                    min-height: 100vh;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 20px;
                }
                .container {
                    text-align: center;
                    border: 3px solid #0f0;
                    padding: 40px;
                    border-radius: 15px;
                    background: rgba(0, 255, 0, 0.05);
                    box-shadow: 0 0 30px rgba(0, 255, 0, 0.3);
                    max-width: 600px;
                    width: 100%;
                }
                h1 {
                    font-size: 2.5em;
                    margin-bottom: 30px;
                    text-shadow: 0 0 10px #0f0;
                    animation: glow 2s ease-in-out infinite;
                }
                @keyframes glow {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.7; }
                }
                .info {
                    background: rgba(0, 0, 0, 0.5);
                    padding: 20px;
                    border-radius: 10px;
                    margin: 20px 0;
                    border: 1px solid #0f0;
                }
                .info p {
                    margin: 10px 0;
                    font-size: 1.1em;
                }
                .btn {
                    display: inline-block;
                    color: #000;
                    background: #0f0;
                    text-decoration: none;
                    padding: 15px 30px;
                    border-radius: 8px;
                    font-size: 1.2em;
                    font-weight: bold;
                    margin-top: 20px;
                    transition: all 0.3s;
                    border: 2px solid #0f0;
                }
                .btn:hover {
                    background: transparent;
                    color: #0f0;
                    box-shadow: 0 0 20px #0f0;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>🤖 AKIRA BOT</h1>
                <div class="info">
                    <p><strong>Status:</strong> ${statusHtml}</p>
                    <p><strong>Número:</strong> ${BOT_NUMERO_REAL}</p>
                    <p><strong>JID:</strong> ${BOT_REAL || 'N/A'}</p>
                    <p><strong>Versão:</strong> 2.0 Final</p>
                </div>
                <a href="/qr" class="btn">📱 VER QR CODE</a>
            </div>
        </body>
        </html>
    `);
});

app.get('/qr', async (req, res) => {
    if (!currentQR) {
        return res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <meta http-equiv="refresh" content="3">
                <title>Bot Conectado</title>
                <style>
                    body {
                        font-family: monospace;
                        background: #000;
                        color: #0f0;
                        text-align: center;
                        padding: 50px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        min-height: 100vh;
                        flex-direction: column;
                    }
                    h1 { font-size: 3em; margin-bottom: 20px; }
                    a { color: #0f0; text-decoration: none; font-size: 1.5em; }
                </style>
            </head>
            <body>
                <h1>✅ BOT JÁ CONECTADO!</h1>
                <p style="font-size: 1.5em;">Número: ${BOT_NUMERO_REAL}</p>
                <br><br>
                <a href="/">« Voltar</a>
            </body>
            </html>
        `);
    }
    
    const img = await QRCode.toDataURL(currentQR);
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta http-equiv="refresh" content="5">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>QR Code</title>
            <style>
                body {
                    background: #000;
                    color: #0f0;
                    text-align: center;
                    padding: 20px;
                    font-family: monospace;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    min-height: 100vh;
                    flex-direction: column;
                }
                h1 { margin-bottom: 30px; font-size: 2em; }
                img {
                    border: 10px solid #0f0;
                    border-radius: 20px;
                    max-width: 90%;
                    width: 400px;
                    box-shadow: 0 0 40px rgba(0, 255, 0, 0.5);
                }
                p { margin: 20px 0; font-size: 1.2em; }
                a { color: #0f0; text-decoration: none; font-size: 1.2em; }
            </style>
        </head>
        <body>
            <h1>📱 ESCANEIE O QR CODE</h1>
            <img src="${img}" alt="QR Code" />
            <p>⏱️ Atualiza automaticamente em 5s</p>
            <a href="/">« Voltar</a>
        </body>
        </html>
    `);
});

app.get('/health', (req, res) => {
    res.json({
        status: BOT_REAL ? 'online' : 'offline',
        bot_number: BOT_NUMERO_REAL,
        bot_jid: BOT_REAL || null,
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

app.listen(PORT, () => {
    console.log('\n' + '═'.repeat(60));
    console.log('🚀 AKIRA BOT SERVIDOR INICIADO');
    console.log('═'.repeat(60));
    console.log(`📡 Endereço: http://localhost:${PORT}`);
    console.log(`🔗 QR Code: http://localhost:${PORT}/qr`);
    console.log(`💚 Health: http://localhost:${PORT}/health`);
    console.log(`🌐 API: ${API_URL}`);
    console.log('═'.repeat(60) + '\n');
});

// Inicia conexão
conectar();

// Tratamento de erros
process.on('unhandledRejection', (erro) => {
    console.error('\n❌ ERRO NÃO TRATADO:', erro);
});

process.on('uncaughtException', (erro) => {
    console.error('\n❌ EXCEÇÃO NÃO CAPTURADA:', erro);
    process.exit(1);
});
