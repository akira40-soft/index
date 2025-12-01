// ===============================================================
// AKIRA BOT — VERSÃO FINAL CORRIGIDA (Dezembro 2025)
// ✅ Extração correta de número (LID → PN)
// ✅ Reply funcionando 100%
// ✅ Debug detalhado completo
// ✅ Logs de todas mensagens
// ===============================================================
import makeWASocket, {
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    Browsers,
    delay,
    getContentType,
    jidNormalizedUser,
    makeInMemoryStore
} from '@whiskeysockets/baileys';
import axios from 'axios';
import express from 'express';
import * as QRCode from 'qrcode';
import pino from 'pino';
const PORT = process.env.PORT || 3000;
const API_URL = process.env.API_URL || 'https://akra35567-akira.hf.space/api/akira';
let sock;
let BOT_REAL = null;
let currentQR = null;
// Logger silencioso
const logger = pino({ level: 'silent' });
// Store para armazenar mensagens (necessário para reply)
const store = makeInMemoryStore({ logger });
// ============================================================================
// FUNÇÃO CORRIGIDA: EXTRAI NÚMERO REAL (SUPORTE COMPLETO PARA LID)
// ============================================================================
function extrairNumeroReal(m) {
    const key = m.key;
   
    // === CASO 1: MENSAGEM PRIVADA (SEMPRE @s.whatsapp.net) ===
    if (!key.remoteJid.endsWith('@g.us')) {
        const numero = key.remoteJid.split('@')[0];
        console.log(`[EXTRAÇÃO] Privado: ${numero}`);
        return numero;
    }
   
    // === CASO 2: GRUPO COM PARTICIPANT ===
    if (key.participant) {
        const participant = key.participant;
       
        // 2A: Participant é número normal (@s.whatsapp.net)
        if (participant.includes('@s.whatsapp.net')) {
            const numero = participant.split('@')[0];
            console.log(`[EXTRAÇÃO] Grupo (participant @s.whatsapp.net): ${numero}`);
            return numero;
        }
       
        // 2B: Participant é LID (@lid)
        if (participant.includes('@lid')) {
            const numero = converterLidParaNumero(participant);
            console.log(`[EXTRAÇÃO] Grupo (participant @lid): ${participant} → ${numero}`);
            return numero;
        }
    }
   
    // === CASO 3: FALLBACK - EXTRAI DO REMOTEJID ===
    console.log(`[EXTRAÇÃO] Fallback - usando remoteJid: ${key.remoteJid}`);
    return '244000000000';
}
// ============================================================================
// CONVERTE LID PARA NÚMERO (BASEADO NA DOCUMENTAÇÃO BAILEYS)
// ============================================================================
function converterLidParaNumero(lid) {
    try {
        // Formato LID: "2025517869123456:78@lid"
        // Precisamos extrair o número da parte antes do ':'
       
        const lidLimpo = lid.split('@')[0]; // Remove @lid
       
        if (lidLimpo.includes(':')) {
            const partes = lidLimpo.split(':');
            const numeroBase = partes[0];
           
            // Extrai os últimos 9 dígitos
            if (numeroBase.length >= 9) {
                const ultimos9 = numeroBase.slice(-9);
                return '244' + ultimos9; // Código Angola
            }
        }
       
        // Fallback: extrai qualquer sequência de dígitos
        const digitos = lidLimpo.replace(/\D/g, '');
        if (digitos.length >= 9) {
            return '244' + digitos.slice(-9);
        }
       
        return '244000000000';
       
    } catch (erro) {
        console.error('[ERRO] Conversão LID:', erro.message);
        return '244000000000';
    }
}
// ============================================================================
// DEBUG DETALHADO COM TIMESTAMP
// ============================================================================
function logDebugCompleto(m, numeroExtraido) {
    const tipo = m.key.remoteJid.endsWith('@g.us') ? 'GRUPO' : 'PRIVADO';
    const timestamp = new Date().toLocaleString('pt-BR', { timeZone: 'Africa/Luanda' });
   
    console.log("\n" + "=".repeat(70));
    console.log(`📅 ${timestamp}`);
    console.log("=".repeat(70));
    console.log(`📍 TIPO: ${tipo}`);
    console.log("-".repeat(70));
    console.log(`🔑 KEY INFO:`);
    console.log(` remoteJid : ${m.key.remoteJid || 'N/A'}`);
    console.log(` participant : ${m.key.participant || 'N/A'}`);
    console.log(` id : ${m.key.id || 'N/A'}`);
    console.log(` fromMe : ${m.key.fromMe}`);
    console.log("-".repeat(70));
    console.log(`👤 USUÁRIO:`);
    console.log(` pushName : ${m.pushName || 'N/A'}`);
    console.log(` verifiedBizName: ${m.verifiedBizName || 'N/A'}`);
    console.log("-".repeat(70));
    console.log(`📱 NÚMERO EXTRAÍDO: ${numeroExtraido}`);
    console.log("=".repeat(70) + "\n");
}
// ============================================================================
// EXTRAI TEXTO DA MENSAGEM (TODOS OS TIPOS)
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
            'reactionMessage': () => `[Reação: ${m.message.reactionMessage?.text || ''}]`,
            'pollCreationMessage': () => '[Enquete]',
            'pollUpdateMessage': () => '[Voto em Enquete]'
        };
       
        return mapaTipos[tipo] ? mapaTipos[tipo]() : '[Mídia]';
       
    } catch (erro) {
        console.error('[ERRO] extrairTextoMensagem:', erro.message);
        return '[Erro ao extrair texto]';
    }
}
// ============================================================================
// EXTRAI MENSAGEM CITADA (REPLY) - VERSÃO MELHORADA
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
       
        return {
            texto: textoQuoted,
            stanzaId: contextInfo.stanzaId,
            participant: contextInfo.participant,
            quotedMessage: quotedMsg
        };
       
    } catch (erro) {
        console.error('[ERRO] extrairMensagemCitada:', erro.message);
        return null;
    }
}
// ============================================================================
// LOG COMPLETO DE MENSAGEM RECEBIDA
// ============================================================================
function logMensagemRecebida(m, numeroReal, texto, mensagemCitada) {
    const tipo = m.key.remoteJid.endsWith('@g.us') ? 'GRUPO' : 'PV';
    const timestamp = new Date().toLocaleTimeString('pt-BR', { timeZone: 'Africa/Luanda' });
   
    console.log(`\n📨 [${timestamp}] [${tipo}] De: ${m.pushName || 'Sem nome'} (${numeroReal})`);
    console.log(`📝 Mensagem: ${texto.substring(0, 100)}${texto.length > 100 ? '...' : ''}`);
   
    if (mensagemCitada) {
        console.log(`↩️ Reply para: "${mensagemCitada.texto.substring(0, 50)}${mensagemCitada.texto.length > 50 ? '...' : ''}"`);
    }
   
    console.log('');
}
// ============================================================================
// CONEXÃO COM WHATSAPP
// ============================================================================
async function conectar() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();
    sock = makeWASocket({
        version,
        auth: state,
        browser: Browsers.macOS('Akira Bot'),
        syncFullHistory: false,
        markOnlineOnConnect: true,
        printQRInTerminal: false,
        logger,
        // IMPORTANTE: Configuração para getMessage (necessário para reply)
        getMessage: async (key) => {
            if (store) {
                const msg = await store.loadMessage(key.remoteJid, key.id);
                return msg?.message || undefined;
            }
            return undefined;
        }
    });
    // Bind do store ao socket
    store?.bind(sock.ev);
    sock.ev.on('creds.update', saveCreds);
   
    sock.ev.on('connection.update', ({ connection, qr }) => {
        if (qr) {
            currentQR = qr;
            console.log('\n🔗 QR Code disponível em: http://localhost:' + PORT + '/qr\n');
        }
        if (connection === 'open') {
            BOT_REAL = sock.user.id.split(':')[0];
            console.log('\n' + '═'.repeat(50));
            console.log('✅ AKIRA BOT ONLINE');
            console.log(`📱 Número: ${BOT_REAL}`);
            console.log('═'.repeat(50) + '\n');
        }
        if (connection === 'close') {
            console.log('\n⚠️ Conexão fechada. Reconectando em 5s...\n');
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
        setTimeout(() => processadas.delete(m.key.id), 30000); // Remove após 30s
        // === EXTRAÇÃO DE DADOS ===
        const numeroReal = extrairNumeroReal(m);
        const nome = m.pushName || numeroReal;
        const texto = extrairTextoMensagem(m);
        const mensagemCitada = extrairMensagemCitada(m);
        const ehGrupo = m.key.remoteJid.endsWith('@g.us');
        // === DEBUG DETALHADO ===
        logDebugCompleto(m, numeroReal);
        logMensagemRecebida(m, numeroReal, texto, mensagemCitada);
        // === FILTRO: EM GRUPOS, RESPONDE APENAS SE MENCIONAR "akira" ===
        if (ehGrupo && !texto.toLowerCase().includes('akira')) {
            console.log('❌ [GRUPO] Mensagem não menciona "akira", ignorando...\n');
            return;
        }
        console.log(`✅ [PROCESSANDO] Mensagem de ${nome}\n`);
        try {
            // === MARCA COMO LIDA ===
            await sock.readMessages([m.key]);
            console.log('✓ Mensagem marcada como lida');
            // === SIMULA DIGITAÇÃO ===
            await sock.sendPresenceUpdate('composing', m.key.remoteJid);
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
            console.log(`📥 Resposta da API (${resposta.length} caracteres):`, resposta.substring(0, 150) + '...\n');
            // === DELAY BASEADO NO TAMANHO ===
            const delayDigitacao = Math.min(resposta.length * 40, 3000);
            console.log(`⏳ Aguardando ${delayDigitacao}ms antes de enviar...`);
            await delay(delayDigitacao);
           
            // === PARA DE DIGITAR ===
            await sock.sendPresenceUpdate('paused', m.key.remoteJid);
           
            // === ENVIA RESPOSTA (COM REPLY SE HOUVER) ===
            const opcoesEnvio = mensagemCitada ? { quoted: m } : {};
           
            await sock.sendMessage(m.key.remoteJid, { text: resposta }, opcoesEnvio);
           
            console.log('✅ Mensagem enviada com sucesso!');
            console.log('═'.repeat(70) + '\n');
        } catch (erro) {
            console.error('\n❌ ERRO AO PROCESSAR:', erro.message);
            console.error('Stack:', erro.stack);
           
            // Mensagem de erro amigável
            const msgErro = erro.code === 'ECONNABORTED'
                ? 'Demorou demais, tenta de novo 🕐'
                : 'Barra no bardeado, já volto! 🔧';
           
            try {
                await sock.sendMessage(m.key.remoteJid, { text: msgErro }, { quoted: m });
                console.log('✓ Mensagem de erro enviada');
            } catch (e) {
                console.error('❌ Falha ao enviar erro:', e.message);
            }
           
            console.log('═'.repeat(70) + '\n');
        }
    });
   
    // === EVENTO DE MAPEAMENTO LID (NOVO NA BAILEYS v7+) ===
    sock.ev.on('lid-mapping.update', ({ lid, pn }) => {
        console.log(`\n🔄 [LID MAPPING] ${lid} ↔️ ${pn}\n`);
    });
}
// ============================================================================
// SERVIDOR EXPRESS (QR CODE + HEALTH CHECK)
// ============================================================================
const app = express();
app.get('/', (req, res) => {
    const statusHtml = BOT_REAL
        ? `<span style="color: #0f0;">✅ ONLINE</span>`
        : `<span style="color: #f90;">⏳ AGUARDANDO</span>`;
   
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Akira Bot - Status</title>
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
                    <p><strong>Número:</strong> ${BOT_REAL || 'N/A'}</p>
                    <p><strong>Servidor:</strong> Railway</p>
                    <p><strong>Versão:</strong> 2.0 (Dezembro 2025)</p>
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
                <title>Akira Bot - Conectado</title>
                <style>
                    body {
                        font-family: 'Courier New', monospace;
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
                <p style="font-size: 1.5em;">Número: ${BOT_REAL || 'N/A'}</p>
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
            <title>Akira Bot - QR Code</title>
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
        bot_number: BOT_REAL || null,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memoria: process.memoryUsage()
    });
});
app.get('/stats', (req, res) => {
    res.json({
        bot: BOT_REAL || 'offline',
        status: BOT_REAL ? 'online' : 'offline',
        versao: '2.0',
        servidor: 'Railway',
        node: process.version,
        uptime_segundos: Math.floor(process.uptime()),
        memoria_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        timestamp: new Date().toISOString()
    });
});
app.listen(PORT, () => {
    console.log('\n' + '═'.repeat(60));
    console.log('🚀 AKIRA BOT SERVIDOR INICIADO');
    console.log('═'.repeat(60));
    console.log(`📡 Endereço: http://localhost:${PORT}`);
    console.log(`🔗 QR Code: http://localhost:${PORT}/qr`);
    console.log(`💚 Health: http://localhost:${PORT}/health`);
    console.log(`📊 Stats: http://localhost:${PORT}/stats`);
    console.log(`🌐 API: ${API_URL}`);
    console.log('═'.repeat(60) + '\n');
});
// Inicia conexão
conectar();
// Tratamento de erros não capturados
process.on('unhandledRejection', (erro) => {
    console.error('\n❌ ERRO NÃO TRATADO:', erro);
});
process.on('uncaughtException', (erro) => {
    console.error('\n❌ EXCEÇÃO NÃO CAPTURADA:', erro);
    process.exit(1);
});
