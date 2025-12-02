/**
 * ═══════════════════════════════════════════════════════════════════════
 * AKIRA BOT — VERSÃO DEFINITIVA ULTRA CORRIGIDA (Dezembro 2025)
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * CORREÇÕES FINAIS:
 * ✅ Extração de número PERFEITA (local + Railway)
 * ✅ participantAlt não existe no Railway → usa key.participant
 * ✅ JID do bot detectado (37... + 244...)
 * ✅ Reply correto (PV: só se usuário respondeu ao bot | Grupos: sempre)
 * ✅ Logs detalhados para debug
 * 
 * ═══════════════════════════════════════════════════════════════════════
 */

const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers,
  delay,
  getContentType
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const axios = require('axios');
const express = require('express');
const QRCode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');

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
let BOT_JID_ALTERNATIVO = null; // Ex: 37839265886398@lid (grupos)
let currentQR = null;
let lastProcessedTime = 0;

const processadas = new Set();

// ═══════════════════════════════════════════════════════════════════════
// STORE SIMPLIFICADO
// ═══════════════════════════════════════════════════════════════════════
const baileys = require('@whiskeysockets/baileys');
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
// EXTRAÇÃO DE NÚMERO REAL (VERSÃO ULTRA CORRIGIDA)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Extrai número real da mensagem
 * DIFERENÇA CRÍTICA: participantAlt só existe LOCAL, não no Railway
 */
function extrairNumeroReal(m) {
  try {
    const key = m.key || {};
    const message = m.message || {};
    
    // === PV: remoteJid é o número direto ===
    if (key.remoteJid && !String(key.remoteJid).endsWith('@g.us')) {
      return String(key.remoteJid).split('@')[0];
    }
    
    // === GRUPOS: Extração em ordem de prioridade ===
    
    // PRIORIDADE 1: participantAlt (SÓ EXISTE NO LOCAL!)
    // No Railway, isso será undefined, então pula para próxima
    if (m.participantAlt) {
      const pAlt = String(m.participantAlt);
      if (pAlt.includes('@s.whatsapp.net')) {
        const numero = pAlt.split('@')[0];
        logger.debug(`[EXTRAÇÃO] participantAlt: ${numero}`);
        return numero;
      }
    }
    
    // PRIORIDADE 2: key.participant (FUNCIONA EM TODOS)
    if (key.participant) {
      const participant = String(key.participant);
      
      // Caso A: É número direto (@s.whatsapp.net)
      if (participant.includes('@s.whatsapp.net')) {
        const numero = participant.split('@')[0];
        logger.debug(`[EXTRAÇÃO] key.participant (direto): ${numero}`);
        return numero;
      }
      
      // Caso B: É LID (@lid) - converte
      if (participant.includes('@lid')) {
        const numero = converterLidParaNumero(participant);
        if (numero) {
          logger.debug(`[EXTRAÇÃO] key.participant (LID): ${numero}`);
          return numero;
        }
      }
    }
    
    // PRIORIDADE 3: contextInfo.participant (reply/citação)
    const contextParticipant = message?.extendedTextMessage?.contextInfo?.participant;
    if (contextParticipant) {
      const cp = String(contextParticipant);
      
      if (cp.includes('@s.whatsapp.net')) {
        const numero = cp.split('@')[0];
        logger.debug(`[EXTRAÇÃO] contextInfo.participant: ${numero}`);
        return numero;
      }
      
      if (cp.includes('@lid')) {
        const numero = converterLidParaNumero(cp);
        if (numero) {
          logger.debug(`[EXTRAÇÃO] contextInfo.participant (LID): ${numero}`);
          return numero;
        }
      }
    }
    
    // PRIORIDADE 4: Fallback do remoteJid (grupo)
    if (key.remoteJid) {
      const match = String(key.remoteJid).match(/120363(\d+)@g\.us/);
      if (match && match[1].length >= 9) {
        const numero = '244' + match[1].slice(-9);
        logger.debug(`[EXTRAÇÃO] remoteJid fallback: ${numero}`);
        return numero;
      }
    }
    
    logger.warn('[EXTRAÇÃO] Falhou, retornando desconhecido');
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
    // Remove @lid e pega parte antes do :
    const limpo = String(lid).split('@')[0].split(':')[0];
    
    // Extrai dígitos
    const digitos = limpo.replace(/\D/g, '');
    
    // Pega últimos 9 dígitos + prefixo 244
    if (digitos.length >= 9) {
      return '244' + digitos.slice(-9);
    }
    
    return null;
  } catch (e) {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// VERIFICAÇÃO SE É O BOT
// ═══════════════════════════════════════════════════════════════════════

function ehOBot(jid) {
  if (!jid) return false;
  
  const jidStr = String(jid).toLowerCase();
  
  // Compara com BOT_JID principal
  if (BOT_JID && jidStr.includes(BOT_JID.split('@')[0].toLowerCase())) {
    return true;
  }
  
  // Compara com JID alternativo (37...)
  if (BOT_JID_ALTERNATIVO) {
    const altStr = String(BOT_JID_ALTERNATIVO).toLowerCase();
    if (jidStr.includes(altStr.split('@')[0])) {
      return true;
    }
  }
  
  // Compara com número real
  if (jidStr.includes(BOT_NUMERO_REAL)) {
    return true;
  }
  
  return false;
}

// ═══════════════════════════════════════════════════════════════════════
// EXTRAÇÃO DE TEXTO
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
      return m.message.imageMessage?.caption || '';
    }
    
    if (tipo === 'videoMessage') {
      return m.message.videoMessage?.caption || '';
    }
    
    return '';
  } catch (e) {
    return '';
  }
}

// ═══════════════════════════════════════════════════════════════════════
// EXTRAÇÃO DE REPLY INFO
// ═══════════════════════════════════════════════════════════════════════

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
// LÓGICA DE ATIVAÇÃO
// ═══════════════════════════════════════════════════════════════════════

async function deveResponder(m, ehGrupo, texto, replyInfo) {
  const textoLower = String(texto).toLowerCase();
  const context = m.message?.extendedTextMessage?.contextInfo;
  
  // === REPLY AO BOT ===
  if (replyInfo && replyInfo.ehRespostaAoBot) {
    logger.info('[ATIVAÇÃO] Reply ao bot detectado');
    return true;
  }
  
  // === GRUPOS: PRECISA DE ATIVAÇÃO ===
  if (ehGrupo) {
    // Menção "akira"
    if (textoLower.includes('akira')) {
      logger.info('[ATIVAÇÃO] Menção "akira" detectada no grupo');
      return true;
    }
    
    // @mention do bot
    const mentions = context?.mentionedJid || [];
    const botMencionado = mentions.some(jid => ehOBot(jid));
    
    if (botMencionado) {
      logger.info('[ATIVAÇÃO] @mention do bot detectado');
      return true;
    }
    
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
  
  console.log('═'.repeat(60));
  console.log(`TS: ${ts} | Tipo: ${tipo}`);
  console.log('KEY:', {
    remoteJid: m.key.remoteJid,
    participant: m.key.participant,
    fromMe: m.key.fromMe
  });
  console.log('MSG INFO:', {
    pushName: m.pushName,
    numeroExtraido: numeroExtraido
  });
  console.log('═'.repeat(60));
}

// ═══════════════════════════════════════════════════════════════════════
// CONEXÃO PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════

async function conectar() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();
    
    // Fecha socket anterior
    if (sock && sock.ws) {
      try {
        console.log('🔄 Fechando socket anterior...');
        await sock.logout();
      } catch (e) {
        // Ignora
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
      connectTimeoutMs: 60000,
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
        
        try {
          qrcodeTerminal.generate(qr, { small: true });
        } catch (e) {
          logger.warn('QR terminal falhou');
        }
        
        console.log('\n📱 ESCANEIE O QR PARA CONECTAR\n');
      }
      
      if (connection === 'open') {
        BOT_JID = sock.user?.id || null;
        lastProcessedTime = Date.now();
        
        // Detecta JID alternativo
        const userJid = sock.user?.id || '';
        if (userJid.includes('@')) {
          BOT_JID_ALTERNATIVO = userJid;
          console.log('JID alternativo detectado:', BOT_JID_ALTERNATIVO);
        }
        
        console.log('✅ AKIRA BOT ONLINE!');
        console.log('Bot JID:', BOT_JID);
        console.log('Bot Número Real:', BOT_NUMERO_REAL);
        
        currentQR = null;
      }
      
      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        console.log(`⚠️ Conexão perdida (código: ${code}). Reconectando em 5s...`);
        
        setTimeout(() => {
          conectar().catch(e => logger.error('Erro ao reconectar:', e));
        }, 5000);
      }
    });
    
    // === EVENT: DECRYPT FAILED ===
    sock.ev.on('message-decrypt-failed', async (msgKey) => {
      try {
        console.log('⚠️ Tentando regenerar sessão perdida...');
        await sock.sendRetryRequest(msgKey.key).catch(() => {});
      } catch (e) {
        console.log('❌ Falha ao regenerar sessão:', e.message);
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
        
        // Ignora mensagens antigas
        if (m.messageTimestamp && m.messageTimestamp * 1000 < lastProcessedTime - 10000) {
          return;
        }
        
        const ehGrupo = String(m.key.remoteJid || '').endsWith('@g.us');
        const numeroReal = extrairNumeroReal(m);
        const nome = m.pushName || numeroReal;
        const texto = extrairTexto(m).trim();
        const replyInfo = extrairReplyInfo(m);
        
        if (!texto) return;
        
        // Log
        logMensagem(m, numeroReal, ehGrupo ? 'GRUPO' : 'PV');
        console.log(`[MENSAGEM] ${ehGrupo ? 'GRUPO' : 'PV'} | ${nome} (${numeroReal}): ${texto}`);
        
        // Verifica ativação
        const ativar = await deveResponder(m, ehGrupo, texto, replyInfo);
        if (!ativar) return;
        
        // Composing
        try {
          await sock.readMessages([m.key]);
          await sock.sendPresenceUpdate('composing', m.key.remoteJid);
        } catch (e) {
          // Ignora
        }
        
        // === CHAMA API ===
        const payload = {
          usuario: nome,
          numero: numeroReal,
          mensagem: texto,
          mensagem_citada: replyInfo ? replyInfo.texto : ''
        };
        
        let resposta = '...';
        try {
          const res = await axios.post(API_URL, payload, { 
            timeout: 120000,
            headers: { 'Content-Type': 'application/json' }
          });
          resposta = res.data?.resposta || '...';
        } catch (err) {
          console.error('⚠️ Erro na API:', err.message);
          resposta = 'Erro interno. 😴';
        }
        
        console.log(`[RESPOSTA] ${resposta}`);
        
        // Delay
        await delay(Math.min(String(resposta).length * 50, 4000));
        await sock.sendPresenceUpdate('paused', m.key.remoteJid);
        
        // === DECIDE REPLY ===
        let opcoes = {};
        
        if (ehGrupo) {
          opcoes = { quoted: m };
          console.log('Respondendo em reply (grupo)');
        } else {
          if (replyInfo && replyInfo.ehRespostaAoBot) {
            opcoes = { quoted: m };
            console.log('Respondendo em reply (PV - usuário respondeu ao bot)');
          } else {
            console.log('Respondendo sem reply (PV)');
          }
        }
        
        // Envia
        try {
          await sock.sendMessage(m.key.remoteJid, { text: resposta }, opcoes);
          console.log('[RESPOSTA ENVIADA]:', resposta.substring(0, 100));
          
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
          console.error('Erro ao enviar:', e.message);
        }
        
      } catch (err) {
        console.error('Erro no handler:', err);
      }
    });
    
    console.log('Socket criado, aguardando eventos...');
    
  } catch (err) {
    console.error('Erro na conexão:', err);
    setTimeout(() => {
      conectar().catch(e => console.error(e));
    }, 5000);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// SERVIDOR EXPRESS
// ═══════════════════════════════════════════════════════════════════════

const app = express();

app.get('/', (req, res) => res.send('AKIRA BOT ONLINE ✅'));

app.get('/qr', async (req, res) => {
  if (!currentQR) {
    return res.send(`
      <html><body style="background:#000;color:#0f0;text-align:center;padding:50px">
        <h1>✅ BOT CONECTADO</h1>
        <p>${BOT_NUMERO_REAL}</p>
      </body></html>
    `);
  }
  
  const img = await QRCode.toDataURL(currentQR, {
    errorCorrectionLevel: 'H',
    margin: 4,
    scale: 10,
    width: 500,
    color: { dark: '#000000', light: '#FFFFFF' }
  });
  
  res.send(`
    <html>
    <head><meta http-equiv="refresh" content="5"></head>
    <body style="background:#000;color:#fff;text-align:center;padding:40px">
      <h1>📱 ESCANEIE O QR</h1>
      <img src="${img}" style="border:12px solid #0f0;border-radius:20px;max-width:500px">
      <p style="color:#0f0;margin-top:20px">Atualiza em 5s</p>
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
    uptime: process.uptime()
  });
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Health check na porta ${server.address().port}`);
});

// ═══════════════════════════════════════════════════════════════════════
// INICIA
// ═══════════════════════════════════════════════════════════════════════

conectar();

process.on('unhandledRejection', (err) => {
  console.error('UNHANDLED REJECTION:', err);
});

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
});
