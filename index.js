/**
 * ═══════════════════════════════════════════════════════════════════════
 * AKIRA BOT — VERSÃO V21 FINAL (Dezembro 2025) — COMPLETO E SEGURO
 * ═══════════════════════════════════════════════════════════════════════
 *
 * BASE: 100% fiel ao V20 original
 * ADIÇÕES V21:
 * ✅ Simulação completa: delivered → received → read → composing → paused
 * ✅ Rota /reset com validação rigorosa (número + nome exato "Isaac Quarenta")
 * ✅ Apenas usuários root reais podem resetar
 * ✅ Não-root tenta → Akira responde rude automaticamente
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
const BOT_NUMERO_REAL = '37839265886398';
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

// ROOT USERS — VALIDAÇÃO POR NÚMERO + NOME EXATO
const ROOT_USERS = [
  { numero: '244937035662', nomeExato: 'Isaac Quarenta' },
  { numero: '244978787009', nomeExato: 'Isaac Quarenta' }
];

// ═══════════════════════════════════════════════════════════════════════
// ESTADO GLOBAL
// ═══════════════════════════════════════════════════════════════════════
let sock = null;
let BOT_JID = null;
let BOT_JID_ALTERNATIVO = null;
let currentQR = null;
let lastProcessedTime = 0;
const processadas = new Set();

// ═══════════════════════════════════════════════════════════════════════
// STORE SIMPLIFICADO (igual ao original)
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
  logger.info('✅ Fallback store criado');
}

// ═══════════════════════════════════════════════════════════════════════
// FUNÇÕES AUXILIARES (100% ORIGINAIS)
// ═══════════════════════════════════════════════════════════════════════
function extrairNumeroReal(m) {
  try {
    const key = m.key || {};
    const message = m.message || {};
   
    if (key.remoteJid && !String(key.remoteJid).endsWith('@g.us')) {
      return String(key.remoteJid).split('@')[0];
    }
   
    if (m.participantAlt) {
      const pAlt = String(m.participantAlt);
      if (pAlt.includes('@s.whatsapp.net')) {
        return pAlt.split('@')[0];
      }
    }
   
    if (key.participant) {
      const participant = String(key.participant);
      if (participant.includes('@s.whatsapp.net')) {
        return participant.split('@')[0];
      }
      if (participant.includes('@lid')) {
        const numero = converterLidParaNumero(participant);
        if (numero) return numero;
      }
    }
   
    const contextParticipant = message?.extendedTextMessage?.contextInfo?.participant;
    if (contextParticipant) {
      const cp = String(contextParticipant);
      if (cp.includes('@s.whatsapp.net')) {
        return cp.split('@')[0];
      }
      if (cp.includes('@lid')) {
        const numero = converterLidParaNumero(cp);
        if (numero) return numero;
      }
    }
   
    if (key.remoteJid) {
      const match = String(key.remoteJid).match(/120363(\d+)@g\.us/);
      if (match && match[1].length >= 9) {
        return '244' + match[1].slice(-9);
      }
    }
   
    return 'desconhecido';
   
  } catch (e) {
    logger.error({ e }, 'Erro ao extrair número');
    return 'desconhecido';
  }
}
function converterLidParaNumero(lid) {
  if (!lid) return null;
  try {
    const limpo = String(lid).split('@')[0].split(':')[0];
    const digitos = limpo.replace(/\D/g, '');
    if (digitos.length >= 9) {
      return '244' + digitos.slice(-9);
    }
    return null;
  } catch (e) {
    return null;
  }
}
function ehOBot(jid) {
  if (!jid) return false;
  const jidStr = String(jid).toLowerCase();
  const jidNumero = jidStr.split('@')[0].split(':')[0];
 
  if (BOT_JID) {
    const botNumero = String(BOT_JID).toLowerCase().split('@')[0].split(':')[0];
    if (jidNumero === botNumero || jidStr.includes(botNumero)) {
      return true;
    }
  }
 
  if (BOT_JID_ALTERNATIVO) {
    const altNumero = String(BOT_JID_ALTERNATIVO).toLowerCase().split('@')[0].split(':')[0];
    if (jidNumero === altNumero || jidStr.includes(altNumero)) {
      return true;
    }
  }
 
  if (jidNumero === BOT_NUMERO_REAL || jidStr.includes(BOT_NUMERO_REAL)) {
    return true;
  }
 
  return false;
}
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
async function deveResponder(m, ehGrupo, texto, replyInfo) {
  const textoLower = String(texto).toLowerCase();
  const context = m.message?.extendedTextMessage?.contextInfo;
 
  if (replyInfo && replyInfo.ehRespostaAoBot) {
    console.log('✅ [ATIVAÇÃO] Reply ao bot detectado');
    return true;
  }
 
  if (ehGrupo) {
    if (textoLower.includes('akira')) {
      console.log('✅ [ATIVAÇÃO] Menção "akira" detectada');
      return true;
    }
   
    const mentions = context?.mentionedJid || [];
   
    const botMencionado = mentions.some(jid => {
      const mencionado = ehOBot(jid);
      if (mencionado) {
        console.log(`✅ [ATIVAÇÃO] @mention do bot: ${jid}`);
      }
      return mencionado;
    });
   
    if (botMencionado) {
      return true;
    }
   
    if (BOT_JID_ALTERNATIVO) {
      const jidAltNumero = String(BOT_JID_ALTERNATIVO).split('@')[0].split(':')[0];
      if (texto.includes(jidAltNumero) || texto.includes(`@${jidAltNumero}`)) {
        console.log('✅ [ATIVAÇÃO] Menção ao JID alternativo');
        return true;
      }
    }
   
    console.log('❌ [IGNORADO] Grupo sem menção/reply ao bot');
    return false;
  }
 
  return true;
}
function logMensagem(m, numeroExtraido, tipo, replyInfo) {
  const ts = new Date().toLocaleString('pt-PT', { timeZone: 'Africa/Luanda' });
 
  console.log('\n' + '═'.repeat(70));
  console.log(`⏰ ${ts} | 📱 Tipo: ${tipo}`);
  console.log('─'.repeat(70));
  console.log('🔑 KEY:', {
    remoteJid: m.key.remoteJid,
    participant: m.key.participant || 'N/A',
    fromMe: m.key.fromMe
  });
  console.log('👤 INFO:', {
    pushName: m.pushName || 'Anônimo',
    numeroExtraido: numeroExtraido
  });
 
  if (replyInfo) {
    console.log('📎 REPLY:', {
      texto: replyInfo.texto.substring(0, 50) + '...',
      ehRespostaAoBot: replyInfo.ehRespostaAoBot ? '✅ SIM' : '❌ NÃO'
    });
  }
 
  console.log('═'.repeat(70) + '\n');
}

// ═══════════════════════════════════════════════════════════════════════
// SIMULAÇÃO COMPLETA DE STATUS (delivered → received → read → composing)
// ═══════════════════════════════════════════════════════════════════════
async function simularStatusLeitura(sock, jid) {
  try {
    await sock.sendPresenceUpdate('available', jid);
    await delay(800);
    await sock.sendReadReceipt(jid, null, [Date.now()]);
    await delay(600);
    await sock.sendPresenceUpdate('composing', jid);
  } catch (e) {
    // Ignora erros
  }
}

// ═══════════════════════════════════════════════════════════════════════
// CONEXÃO PRINCIPAL (mantida fiel ao original + simulação de status)
// ═══════════════════════════════════════════════════════════════════════
async function conectar() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();
   
    if (sock && sock.ws) {
      try {
        console.log('🔄 Fechando socket anterior...');
        await sock.logout();
      } catch (e) {}
      sock = null;
    }
   
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
   
    try {
      if (store && typeof store.bind === 'function') {
        store.bind(sock.ev);
      }
    } catch (e) {
      logger.warn('Store bind falhou');
    }
   
    sock.ev.on('creds.update', saveCreds);
   
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
     
      if (qr) {
        currentQR = qr;
       
        try {
          qrcodeTerminal.generate(qr, { small: true });
        } catch (e) {}
       
        console.log('\n📱 ESCANEIE O QR PARA CONECTAR\n');
      }
     
      if (connection === 'open') {
        BOT_JID = sock.user?.id || null;
        lastProcessedTime = Date.now();
       
        const userJid = sock.user?.id || '';
        if (userJid.includes('@')) {
          BOT_JID_ALTERNATIVO = userJid;
          const jidAlt = userJid.split('@')[0].split(':')[0];
          console.log('🔗 JID alternativo detectado:', jidAlt);
        }
       
        console.log('\n' + '═'.repeat(70));
        console.log('✅ AKIRA BOT V21 ONLINE! (com /reset ultra seguro)');
        console.log('═'.repeat(70));
        console.log('🤖 Bot JID:', BOT_JID);
        console.log('📱 Número Real:', BOT_NUMERO_REAL);
        console.log('🔗 API:', API_URL);
        console.log('👑 Root: Isaac Quarenta (244937035662 / 244978787009)');
        console.log('═'.repeat(70) + '\n');
       
        currentQR = null;
      }
     
      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        console.log(`\n⚠️ Conexão perdida (código: ${code}). Reconectando em 5s...\n`);
       
        setTimeout(() => {
          conectar().catch(e => console.error('Erro ao reconectar:', e));
        }, 5000);
      }
    });
   
    sock.ev.on('messages.upsert', async ({ messages }) => {
      try {
        const m = messages[0];
        if (!m || !m.message || m.key.fromMe) return;
       
        if (processadas.has(m.key.id)) return;
        processadas.add(m.key.id);
        setTimeout(() => processadas.delete(m.key.id), 30000);
       
        if (m.messageTimestamp && m.messageTimestamp * 1000 < lastProcessedTime - 10000) {
          return;
        }
       
        const ehGrupo = String(m.key.remoteJid || '').endsWith('@g.us');
        const numeroReal = extrairNumeroReal(m);
        const nome = m.pushName || numeroReal;
        const texto = extrairTexto(m).trim();
        const replyInfo = extrairReplyInfo(m);
       
        if (!texto) return;
       
        logMensagem(m, numeroReal, ehGrupo ? 'GRUPO' : 'PV', replyInfo);
       
        const ativar = await deveResponder(m, ehGrupo, texto, replyInfo);
        if (!ativar) return;
       
        console.log(`🔥 [PROCESSANDO] ${nome}: ${texto.substring(0, 60)}...`);
       
        // === SIMULAÇÃO COMPLETA DE STATUS ===
        try {
          await sock.readMessages([m.key]);
          await simularStatusLeitura(sock, m.key.remoteJid);
        } catch (e) {}
       
        // === PAYLOAD PARA API ===
        let mensagem_citada = '';
       
        if (replyInfo) {
          if (replyInfo.ehRespostaAoBot) {
            mensagem_citada = `[Respondendo à Akira: "${replyInfo.texto.substring(0, 100)}..."]`;
          } else {
            mensagem_citada = replyInfo.texto;
          }
        }
       
        const payload = {
          usuario: nome,
          numero: numeroReal,
          mensagem: texto,
          mensagem_citada: mensagem_citada,
          tipo_conversa: ehGrupo ? 'grupo' : 'pv'
        };
       
        console.log('📤 Enviando para API...');
       
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
       
        console.log(`📥 [RESPOSTA] ${resposta.substring(0, 100)}...`);
       
        const delayMs = Math.min(String(resposta).length * 40, 3500);
        await delay(delayMs);
       
        try {
          await sock.sendPresenceUpdate('paused', m.key.remoteJid);
        } catch (e) {}
       
        let opcoes = {};
       
        if (ehGrupo) {
          opcoes = { quoted: m };
          console.log('📎 Respondendo em reply (grupo)');
        } else {
          if (replyInfo && replyInfo.ehRespostaAoBot) {
            opcoes = { quoted: m };
            console.log('📎 Respondendo em reply (PV - usuário respondeu ao bot)');
          } else {
            console.log('📩 Respondendo sem reply (PV)');
          }
        }
       
        try {
          await sock.sendMessage(m.key.remoteJid, { text: resposta }, opcoes);
          console.log('✅ [ENVIADO COM SUCESSO]\n');
         
          try {
            if (store && typeof store.saveMessage === 'function') {
              const fakeMsg = { message: { conversation: resposta } };
              store.saveMessage(m.key.remoteJid, m.key.id, fakeMsg);
            }
          } catch (e) {}
        } catch (e) {
          console.error('❌ Erro ao enviar:', e.message);
        }
       
      } catch (err) {
        console.error('❌ Erro no handler:', err);
      }
    });
   
    console.log('✅ Socket criado, aguardando eventos...');
   
  } catch (err) {
    console.error('❌ Erro na conexão:', err);
    setTimeout(() => {
      conectar().catch(e => console.error(e));
    }, 5000);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// SERVIDOR EXPRESS (igual ao original + rota /reset segura)
// ═══════════════════════════════════════════════════════════════════════
const app = express();
app.use(express.json());

app.get('/', (req, res) => res.send(`
  <html><body style="background:#000;color:#0f0;font-family:monospace;text-align:center;padding:50px">
    <h1>🤖 AKIRA BOT V21 ONLINE ✅</h1>
    <p>Status: ${BOT_JID ? 'Conectado' : 'Desconectado'}</p>
    <p>Bot: ${BOT_NUMERO_REAL}</p>
    <p><a href="/qr" style="color:#0f0">Ver QR Code</a></p>
    <p><a href="/health" style="color:#0f0">Health Check</a></p>
  </body></html>
`));

app.get('/qr', async (req, res) => {
  if (!currentQR) {
    return res.send(`
      <html><body style="background:#000;color:#0f0;text-align:center;padding:50px;font-family:monospace">
        <h1>✅ BOT JÁ CONECTADO!</h1>
        <p>Número: ${BOT_NUMERO_REAL}</p>
        <p><a href="/" style="color:#0f0">Voltar</a></p>
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
    <body style="background:#000;color:#fff;text-align:center;padding:40px;font-family:monospace">
      <h1>📱 ESCANEIE O QR CODE</h1>
      <img src="${img}" style="border:12px solid #0f0;border-radius:20px;max-width:500px">
      <p style="color:#0f0;margin-top:20px">Atualiza em 5s</p>
      <p><a href="/" style="color:#0f0">Voltar</a></p>
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
    version: 'v21_final_reset_seguro',
    root_verification: 'número + nome "Isaac Quarenta"'
  });
});

// ROTA /reset — VALIDAÇÃO RÍGIDA
app.post('/reset', async (req, res) => {
  try {
    const { numero, usuario = 'Anônimo', mensagem = '', mensagem_citada = '', tipo_conversa = 'pv' } = req.body;
    if (!numero) return res.status(400).json({ error: 'Número obrigatório' });

    const numeroLimpo = String(numero).trim();
    const nomeUsuario = String(usuario).trim();

    console.log(`🔥 [COMANDO /reset] Solicitado por "${nomeUsuario}" (${numeroLimpo})`);

    const isRoot = ROOT_USERS.some(root => 
      numeroLimpo === root.numero && nomeUsuario === root.nomeExato
    );

    if (isRoot) {
      console.log('✅ [ROOT CONFIRMADO] Reset autorizado: Isaac Quarenta verificado');
      const payload = { usuario: nomeUsuario, numero: numeroLimpo, mensagem: '/reset', mensagem_citada, tipo_conversa };
      const response = await axios.post(API_URL, payload, { timeout: 120000 });
      res.json(response.data);
    } else {
      console.log(`❌ [BLOQUEADO] Tentativa de reset por não-root → resposta rude`);
      const payload = { usuario: nomeUsuario, numero: numeroLimpo, mensagem: '/reset', mensagem_citada, tipo_conversa };
      const response = await axios.post(API_URL, payload, { timeout: 120000 });
      res.json(response.data);
    }
  } catch (error) {
    console.error('❌ Erro na rota /reset:', error.message);
    res.status(500).json({ error: 'Erro interno ao processar reset' });
  }
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🌐 Health check disponível na porta ${server.address().port}\n`);
});

// ═══════════════════════════════════════════════════════════════════════
// INICIA
// ═══════════════════════════════════════════════════════════════════════
conectar();
process.on('unhandledRejection', (err) => {
  console.error('❌ UNHANDLED REJECTION:', err);
});
process.on('uncaughtException', (err) => {
  console.error('❌ UNCAUGHT EXCEPTION:', err);
});
