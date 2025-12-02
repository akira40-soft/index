/**
 * ═══════════════════════════════════════════════════════════════════════
 * AKIRA BOT — VERSÃO FINAL CORRIGIDA (Dezembro 2025)
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * CORREÇÕES IMPLEMENTADAS:
 * ✅ JID do bot reconhecido (37... + 244952786417)
 * ✅ Extração de número em grupos (participantAlt → participant → LID)
 * ✅ PV: responde em reply APENAS se usuário respondeu ao bot
 * ✅ Grupos: sempre em reply quando ativado
 * ✅ Lógica robusta (funciona Railway/Render/Local)
 * 
 * ═══════════════════════════════════════════════════════════════════════
 */

const baileys = require('@whiskeysockets/baileys');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers,
  delay,
  getContentType
} = baileys;

const axios = require('axios');
const express = require('express');
const QRCode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');
const pino = require('pino');

// ═══════════════════════════════════════════════════════════════════════
// CONFIGURAÇÕES
// ═══════════════════════════════════════════════════════════════════════
const PORT = process.env.PORT || 3000;
const API_URL = process.env.API_URL || 'https://akra35567-akira.hf.space/api/akira';
const BOT_NUMERO_REAL = '244952786417'; // Número real do bot

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

// ═══════════════════════════════════════════════════════════════════════
// ESTADO GLOBAL
// ═══════════════════════════════════════════════════════════════════════
let sock = null;
let BOT_JID = null;           // Ex: 244952786417@s.whatsapp.net
let BOT_JID_ALTERNATIVO =  37839265886398; // Ex: 37839265886398@lid (usado em grupos)
let currentQR = null;

const processadas = new Set(); // Anti-duplicação

// ═══════════════════════════════════════════════════════════════════════
// STORE SIMPLIFICADO
// ═══════════════════════════════════════════════════════════════════════
let store;
if (typeof baileys.makeInMemoryStore === 'function') {
  try {
    store = baileys.makeInMemoryStore({ logger });
  } catch (e) {
    store = null;
  }
}

if (!store) {
  const _map = new Map();
  store = {
    bind: () => {},
    async loadMessage(jid, id) {
      return _map.get(`${jid}|${id}`) || undefined;
    },
    saveMessage(jid, id, msg) {
      _map.set(`${jid}|${id}`, msg);
    }
  };
  logger.info('Fallback store criado (mínimo)');
}

// ═══════════════════════════════════════════════════════════════════════
// UTILITÁRIOS — EXTRAÇÃO DE NÚMERO
// ═══════════════════════════════════════════════════════════════════════

/**
 * Extrai número real da mensagem (PRIORIDADE CORRETA)
 * 1. participantAlt (local funciona sempre)
 * 2. key.participant (Railway/Render)
 * 3. contextInfo.participant (fallback)
 * 4. Conversão LID → número
 * 5. remoteJid (PV)
 */
function extrairNumeroReal(m) {
  try {
    const key = m.key || {};
    const message = m.message || {};
    
    // === PV: remoteJid é o número direto ===
    if (key.remoteJid && !String(key.remoteJid).endsWith('@g.us')) {
      const numero = String(key.remoteJid).split('@')[0];
      // Remove prefixo de país se tiver
      if (numero.startsWith('244')) {
        return numero;
      }
      return numero;
    }
    
    // === GRUPOS: Tenta várias fontes ===
    
    // 1. participantAlt (funciona local, pode não existir em Railway)
    if (m.participantAlt && String(m.participantAlt).includes('@s.whatsapp.net')) {
      return String(m.participantAlt).split('@')[0];
    }
    
    // 2. key.participant (padrão Baileys)
    if (key.participant) {
      const participant = String(key.participant);
      
      // Caso A: É número direto (@s.whatsapp.net)
      if (participant.includes('@s.whatsapp.net')) {
        return participant.split('@')[0];
      }
      
      // Caso B: É LID (@lid) - converte para número
      if (participant.includes('@lid')) {
        const numeroConvertido = converterLidParaNumero(participant);
        if (numeroConvertido) return numeroConvertido;
      }
    }
    
    // 3. contextInfo.participant (mensagem citada/reply)
    const contextParticipant = message?.extendedTextMessage?.contextInfo?.participant;
    if (contextParticipant) {
      const cp = String(contextParticipant);
      
      if (cp.includes('@s.whatsapp.net')) {
        return cp.split('@')[0];
      }
      
      if (cp.includes('@lid')) {
        const numeroConvertido = converterLidParaNumero(cp);
        if (numeroConvertido) return numeroConvertido;
      }
    }
    
    // 4. Fallback: tenta extrair do remoteJid (grupo)
    if (key.remoteJid) {
      const match = String(key.remoteJid).match(/120363(\d+)@g\.us/);
      if (match && match[1].length >= 9) {
        return '244' + match[1].slice(-9);
      }
    }
    
    return 'desconhecido';
    
  } catch (e) {
    logger.error({ e }, 'Erro ao extrair número real');
    return 'desconhecido';
  }
}

/**
 * Converte LID para número real
 * Ex: "202391978787009:123@lid" → "244978787009"
 */
function converterLidParaNumero(lid) {
  if (!lid) return null;
  
  try {
    // Remove @lid e pega a parte antes do :
    const limpo = String(lid).split('@')[0].split(':')[0];
    
    // Extrai dígitos
    const digitos = limpo.replace(/\D/g, '');
    
    // Se tem 9+ dígitos, pega os últimos 9 e adiciona 244
    if (digitos.length >= 9) {
      const ultimos9 = digitos.slice(-9);
      return '244' + ultimos9;
    }
    
    return null;
  } catch (e) {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// VERIFICAÇÃO SE É O BOT (SUPORTA MÚLTIPLOS FORMATOS)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Verifica se JID é do bot
 * Suporta:
 * - 244952786417@s.whatsapp.net (padrão)
 * - 37839265886398@lid (JID alternativo em grupos)
 * - 244952786417 (número puro)
 */
function ehOBot(jid) {
  if (!jid) return false;
  
  const jidStr = String(jid).toLowerCase();
  
  // Compara com JID principal
  if (BOT_JID && jidStr.includes(BOT_JID.split('@')[0])) {
    return true;
  }
  
  // Compara com JID alternativo (37...)
  if (BOT_JID_ALTERNATIVO && jidStr === BOT_JID_ALTERNATIVO) {
    return true;
  }
  
  // Compara com número real
  if (jidStr.includes(BOT_NUMERO_REAL)) {
    return true;
  }
  
  // Extrai número e compara
  const numeroExtraido = jidStr.split('@')[0].split(':')[0];
  if (numeroExtraido === BOT_NUMERO_REAL) {
    return true;
  }
  
  return false;
}

// ═══════════════════════════════════════════════════════════════════════
// EXTRAÇÃO DE TEXTO E REPLY
// ═══════════════════════════════════════════════════════════════════════

function extrairTexto(m) {
  try {
    const tipo = getContentType(m.message);
    if (!tipo) return '';
    
    if (tipo === 'conversation') {
      return m.message.conversation || '';
    }
    
    if (tipo === 'extendedTextMessage') {
      return m.message.extendedTextMessage?.text || '';
    }
    
    if (tipo === 'imageMessage') {
      return m.message.imageMessage?.caption || '[imagem]';
    }
    
    if (tipo === 'videoMessage') {
      return m.message.videoMessage?.caption || '[vídeo]';
    }
    
    return '';
  } catch (e) {
    return '';
  }
}

/**
 * Extrai informações de mensagem citada (reply)
 * Retorna: { texto, participantJid, ehRespostaAoBot }
 */
function extrairReplyInfo(m) {
  try {
    const context = m.message?.extendedTextMessage?.contextInfo;
    if (!context || !context.quotedMessage) return null;
    
    const quoted = context.quotedMessage;
    const tipo = getContentType(quoted);
    
    let textoReply = '';
    if (tipo === 'conversation') {
      textoReply = quoted.conversation || '';
    } else if (tipo === 'extendedTextMessage') {
      textoReply = quoted.extendedTextMessage?.text || '';
    } else if (tipo === 'imageMessage') {
      textoReply = quoted.imageMessage?.caption || '[imagem]';
    } else {
      textoReply = '[conteúdo]';
    }
    
    const participantJid = context.participant || null;
    const ehRespostaAoBot = ehOBot(participantJid);
    
    return {
      texto: textoReply,
      participantJid: participantJid,
      ehRespostaAoBot: ehRespostaAoBot
    };
    
  } catch (e) {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// LÓGICA DE ATIVAÇÃO (QUANDO RESPONDER)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Decide se deve responder à mensagem
 * 
 * REGRAS:
 * - GRUPOS: 
 *   ✅ Reply ao bot → SIM
 *   ✅ Menção "akira" → SIM
 *   ✅ @mention do bot → SIM
 *   ❌ Resto → NÃO
 * 
 * - PV:
 *   ✅ Sempre responde
 */
async function deveResponder(m, ehGrupo, texto, replyInfo) {
  const textoLower = String(texto).toLowerCase();
  const context = m.message?.extendedTextMessage?.contextInfo;
  
  // === REPLY AO BOT (GRUPOS E PV) ===
  if (replyInfo && replyInfo.ehRespostaAoBot) {
    logger.info('[ATIVAÇÃO] Reply ao bot detectado');
    return true;
  }
  
  // === GRUPOS: PRECISA DE MENÇÃO/ATIVAÇÃO ===
  if (ehGrupo) {
    // Verifica menção explícita "akira"
    if (textoLower.includes('akira')) {
      logger.info('[ATIVAÇÃO] Menção "akira" detectada no grupo');
      return true;
    }
    
    // Verifica @mentions
    const mentions = context?.mentionedJid || [];
    const botMencionado = mentions.some(jid => ehOBot(jid));
    
    if (botMencionado) {
      logger.info('[ATIVAÇÃO] @mention do bot detectado');
      return true;
    }
    
    // Grupo sem ativação
    logger.info('[IGNORADO] Grupo sem menção/reply ao bot');
    return false;
  }
  
  // === PV: SEMPRE RESPONDE ===
  return true;
}

// ═══════════════════════════════════════════════════════════════════════
// LOGGING
// ═══════════════════════════════════════════════════════════════════════

function logMensagem(m, numeroExtraido, tipo) {
  const ts = new Date().toLocaleString('pt-PT', { timeZone: 'Africa/Luanda' });
  
  logger.info('═'.repeat(60));
  logger.info(`TS: ${ts} | Tipo: ${tipo}`);
  logger.info('KEY:', {
    remoteJid: m.key.remoteJid,
    participant: m.key.participant,
    fromMe: m.key.fromMe
  });
  logger.info('MSG INFO:', {
    pushName: m.pushName,
    numeroExtraido: numeroExtraido
  });
  logger.info('═'.repeat(60));
}

// ═══════════════════════════════════════════════════════════════════════
// CONEXÃO PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════

async function conectar() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();
    
    // Fecha socket anterior se existir
    if (sock && sock.ws) {
      try {
        logger.info('Fechando socket anterior...');
        await sock.logout();
      } catch (e) {
        // Ignora erros
      }
      sock = null;
    }
    
    // Cria novo socket
    sock = makeWASocket({
      version,
      auth: state,
      logger,
      browser: Browsers.macOS('AkiraBot'),
      markOnlineOnConnect: true,
      syncFullHistory: false,
      printQRInTerminal: false,
      getMessage: async (key) => {
        if (!key) return undefined;
        try {
          const msg = await store.loadMessage(key.remoteJid, key.id);
          return msg?.message;
        } catch (e) {
          return undefined;
        }
      }
    });
    
    // Bind store
    try {
      if (store && typeof store.bind === 'function') {
        store.bind(sock.ev);
      }
    } catch (e) {
      logger.warn('Store bind falhou:', e?.message);
    }
    
    // === EVENT: CREDS UPDATE ===
    sock.ev.on('creds.update', saveCreds);
    
    // === EVENT: CONNECTION UPDATE ===
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
      
      if (qr) {
        currentQR = qr;
        
        // QR no terminal
        try {
          qrcodeTerminal.generate(qr, { small: true });
        } catch (e) {
          logger.warn('QR terminal falhou:', e?.message);
        }
        
        logger.info('QR disponível em: /qr');
      }
      
      if (connection === 'open') {
        BOT_JID = sock.user?.id || null;
        
        // Detecta JID alternativo (37...)
        const userJid = sock.user?.id || '';
        if (userJid.includes('@')) {
          const parts = userJid.split('@');
          BOT_JID_ALTERNATIVO = userJid; // Salva JID completo
          
          // Se começar com 37, esse é o JID de grupo
          if (parts[0].startsWith('37')) {
            logger.info('JID alternativo detectado (usado em grupos):', BOT_JID_ALTERNATIVO);
          }
        }
        
        logger.info('✅ AKIRA BOT ONLINE');
        logger.info('Bot JID:', BOT_JID);
        logger.info('Bot Número Real:', BOT_NUMERO_REAL);
        logger.info('Bot JID Alternativo:', BOT_JID_ALTERNATIVO || 'N/A');
        
        currentQR = null;
      }
      
      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        logger.warn('Conexão fechada. Código:', code);
        logger.warn('Reconectando em 5s...');
        
        setTimeout(() => {
          conectar().catch(e => logger.error('Erro ao reconectar:', e));
        }, 5000);
      }
    });
    
    // === EVENT: DECRYPT FAILED ===
    sock.ev.on('message-decrypt-failed', async (msgKey) => {
      try {
        logger.warn('Falha ao descriptografar mensagem, tentando reenvio...');
        await sock.sendRetryRequest(msgKey.key).catch(() => {});
      } catch (e) {
        logger.error('Erro no retry:', e?.message);
      }
    });
    
    // === EVENT: MESSAGES UPSERT ===
    sock.ev.on('messages.upsert', async ({ messages }) => {
      try {
        const m = messages[0];
        if (!m || !m.message || m.key.fromMe) return;
        
        // Anti-duplicação
        if (processadas.has(m.key.id)) return;
        processadas.add(m.key.id);
        setTimeout(() => processadas.delete(m.key.id), 30000);
        
        const ehGrupo = String(m.key.remoteJid || '').endsWith('@g.us');
        const numeroReal = extrairNumeroReal(m);
        const nome = m.pushName || numeroReal;
        const texto = extrairTexto(m).trim();
        const replyInfo = extrairReplyInfo(m);
        
        if (!texto) return;
        
        // Log detalhado
        logMensagem(m, numeroReal, ehGrupo ? 'GRUPO' : 'PV');
        logger.info(`[MENSAGEM] ${ehGrupo ? 'GRUPO' : 'PV'} | ${nome} (${numeroReal}): ${texto}`);
        
        // Verifica se deve responder
        const ativar = await deveResponder(m, ehGrupo, texto, replyInfo);
        if (!ativar) return;
        
        // Marca como lida + composing
        try {
          await sock.readMessages([m.key]);
          await sock.sendPresenceUpdate('composing', m.key.remoteJid);
        } catch (e) {
          // Ignora erros
        }
        
        // === CHAMA API ===
        const payload = {
          usuario: nome,
          numero: numeroReal,
          mensagem: texto,
          mensagem_citada: replyInfo ? replyInfo.texto : ''
        };
        
        let resposta = 'Ok';
        try {
          const res = await axios.post(API_URL, payload, { 
            timeout: 120000,
            headers: { 'Content-Type': 'application/json' }
          });
          resposta = res.data?.resposta || 'Ok';
        } catch (err) {
          logger.error('Erro na API:', err?.message);
          resposta = 'Barra no bardeado.';
        }
        
        // Delay "digitação"
        const delayDigitacao = Math.min(String(resposta).length * 40, 3000);
        await delay(delayDigitacao);
        await sock.sendPresenceUpdate('paused', m.key.remoteJid);
        
        // === DECIDE SE ENVIA EM REPLY ===
        let opcoes = {};
        
        if (ehGrupo) {
          // GRUPOS: sempre em reply quando responde
          opcoes = { quoted: m };
          logger.info('Respondendo em reply (grupo)');
        } else {
          // PV: reply APENAS se usuário respondeu ao bot
          if (replyInfo && replyInfo.ehRespostaAoBot) {
            opcoes = { quoted: m };
            logger.info('Respondendo em reply (PV - usuário respondeu ao bot)');
          } else {
            logger.info('Respondendo sem reply (PV - mensagem normal)');
          }
        }
        
        // Envia mensagem
        try {
          await sock.sendMessage(m.key.remoteJid, { text: resposta }, opcoes);
          logger.info('[RESPOSTA ENVIADA]:', resposta.substring(0, 100));
          
          // Salva no store
          try {
            if (store && typeof store.saveMessage === 'function') {
              const fakeMsg = { message: { conversation: resposta } };
              store.saveMessage(m.key.remoteJid, m.key.id, fakeMsg);
            }
          } catch (e) {
            // Ignora
          }
        } catch (e) {
          logger.error('Erro ao enviar mensagem:', e?.message);
        }
        
      } catch (err) {
        logger.error('Erro no handler de mensagens:', err);
      }
    });
    
    logger.info('Socket criado, aguardando eventos...');
    
  } catch (err) {
    logger.error('Erro na conexão:', err);
    setTimeout(() => {
      conectar().catch(e => logger.error(e));
    }, 5000);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// SERVIDOR EXPRESS (HEALTH + QR)
// ═══════════════════════════════════════════════════════════════════════

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
        h1 { 
          border: 2px solid #0f0; 
          padding: 20px; 
          display: inline-block;
        }
        a { 
          color: #0f0; 
          text-decoration: none; 
          font-size: 18px; 
        }
      </style>
    </head>
    <body>
      <h1>🤖 AKIRA BOT RAILWAY</h1>
      <p>Status: ${BOT_JID ? '✅ Online' : '⏳ Conectando...'}</p>
      <p>Bot: ${BOT_NUMERO_REAL}</p>
      <br>
      <a href="/qr">📱 Ver QR Code</a> | 
      <a href="/health">❤️ Health Check</a>
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
            background: #000; 
            color: #0f0; 
            text-align: center; 
            padding: 50px; 
            font-family: monospace;
          }
        </style>
      </head>
      <body>
        <h1>✅ BOT JÁ CONECTADO</h1>
        <p>Número: ${BOT_NUMERO_REAL}</p>
        <p><a href="/" style="color: #0f0;">Voltar</a></p>
      </body>
      </html>
    `);
  }
  
  // QR Code em alta definição
  const img = await QRCode.toDataURL(currentQR, {
    errorCorrectionLevel: 'H',
    margin: 4,
    scale: 10,
    width: 500,
    color: {
      dark: '#000000',
      light: '#FFFFFF'
    }
  });
  
  res.send(`
    <html>
    <head>
      <meta http-equiv="refresh" content="5">
      <style>
        body { 
          background: #000; 
          color: #fff; 
          text-align: center; 
          padding: 40px; 
          font-family: monospace;
        }
        img { 
          border: 12px solid #0f0; 
          border-radius: 20px; 
          max-width: 500px;
        }
      </style>
    </head>
    <body>
      <h1>📱 ESCANEIE O QR CODE</h1>
      <img src="${img}" />
      <p style="color: #0f0; margin-top: 20px;">Atualiza automaticamente em 5s</p>
      <p><a href="/" style="color: #0f0;">Voltar</a></p>
    </body>
    </html>
  `);
});

app.get('/health', (req, res) => {
  res.json({
    status: BOT_JID ? 'online' : 'offline',
    bot_numero: BOT_NUMERO_REAL,
    bot_jid: BOT_JID || null,
    bot_jid_alternativo: BOT_JID_ALTERNATIVO || null,
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, '0.0.0.0', () => {
  logger.info('═'.repeat(60));
  logger.info(`HTTP Server: http://0.0.0.0:${PORT}`);
  logger.info(`Health: /health | QR: /qr`);
  logger.info('═'.repeat(60));
});

// ═══════════════════════════════════════════════════════════════════════
// INICIA CONEXÃO
// ═══════════════════════════════════════════════════════════════════════

conectar().catch(e => logger.error('Erro inicial:', e));

// Handlers de erro global
process.on('unhandledRejection', (err) => {
  logger.error('UNHANDLED REJECTION:', err);
});

process.on('uncaughtException', (err) => {
  logger.error('UNCAUGHT EXCEPTION:', err);
});
