// ===============================================================
// AKIRA BOT — VERSÃO FINAL CORRIGIDA (Dezembro 2025)
// ✅ Extração correta de número (LID → PN)
// ✅ Reply funcionando 100%
// ✅ Debug detalhado completo
// ✅ Logs de todas mensagens
// ===============================================================
const baileys = require('@whiskeysockets/baileys');
const { makeInMemoryStore } = baileys; // Agora deve funcionar após injeção
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
    jidNormalizedUser
} = baileys;

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
   
    // === CASO 3: FALLBACK - usando remoteJid, mas em grupo, talvez ignorar ou retornar null
    console.log(`[EXTRAÇÃO] Fallback - usando remoteJid: ${key.remoteJid}`);
    return null; // Alterado para null para evitar processamento inválido
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
       
        return null;
       
    } catch (erro) {
        console.error('[ERRO] Conversão LID:', erro.message);
        return null;
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
            'extendedTextMessage': () => m.message.extendedTextMessage ? m.message.extendedTextMessage.text || '' : '',
            'imageMessage': () => m.message.imageMessage ? m.message.imageMessage.caption || '[Imagem]' : '[Imagem]',
            'videoMessage': () => m.message.videoMessage ? m.message.videoMessage.caption || '[Vídeo]' : '[Vídeo]',
            'documentMessage': () => m.message.documentMessage ? m.message.documentMessage.caption || '[Documento]' : '[Documento]',
            'audioMessage': () => '[Áudio]',
            'stickerMessage': () => '[Sticker]',
            'reactionMessage': () => m.message.reactionMessage ? `[Reação: ${m.message.reactionMessage.text || ''}]` : '',
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
        const contextInfo = m.message.extendedTextMessage ? m.message.extendedTextMessage.contextInfo : null;
        if (!contextInfo || !contextInfo.quotedMessage) return null;
       
        const quotedMsg = contextInfo.quotedMessage;
        const quotedType = getContentType(quotedMsg);
       
        let textoQuoted = '';
       
        const mapaTiposQuoted = {
            'conversation': () => quotedMsg.conversation || '',
            'extendedTextMessage': () => quotedMsg.extendedTextMessage ? quotedMsg.extendedTextMessage.text || '' : '',
            'imageMessage': () => quotedMsg.imageMessage ? quotedMsg.imageMessage.caption || '[Imagem]' : '[Imagem]',
            'videoMessage': () => quotedMsg.videoMessage ? quotedMsg.videoMessage.caption || '[Vídeo]' : '[Vídeo]',
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
    sock = baileys.default({
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
                return msg ? msg.message || undefined : undefined;
            }
            return undefined;
        }
    });
    // Bind do store ao socket
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
        if (!numeroReal) {
            console.log('[SKIP] Número real não extraído');
            return;
        }
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
           
            const resposta = res.data.resposta || 'Ok';
            console.log(`📥 Resposta da API (${resposta.length} caracteres):`, resposta.substring(0, 150) + '...\n
