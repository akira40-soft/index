]/**
 * ═══════════════════════════════════════════════════════════════════════
 * AKIRA BOT V21 — DIGITAÇÃO REALISTA + DINÂMICAS WHATSAPP COMPLETAS
 * ═══════════════════════════════════════════════════════════════════════
 * ✅ PV: Sempre marca como lido (✓✓ azul)
 * ✅ GRUPO: Só marca como lido se mencionada/reply
 * ✅ Status: Sempre online → composing → paused
 * ✅ Tempo de digitação proporcional ao tamanho
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
// STORE
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
}

// ═══════════════════════════════════════════════════════════════════════
// FUNÇÕES AUXILIARES
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
    const botMencionado = mentions.some(jid => ehOBot(jid));
    
    if (botMencionado) {
      console.log('✅ [ATIVAÇÃO] @mention do bot');
      return true;
    }
    
    if (BOT_JID_ALTERNATIVO) {
      const jidAltNumero = String(BOT_JID_ALTERNATIVO).split('@')[0].split(':')[0];
      if (texto.includes(jidAltNumero)) {
        console.log('✅ [ATIVAÇÃO] Menção ao JID alternativo');
        return true;
      }
    }
    
    console.log('❌ [IGNORADO] Grupo sem menção/reply ao bot');
    return false;
  }
  
  return true;
}

// ═══════════════════════════════════════════════════════════════════════
// DINÂMICA DE LEITURA (✓✓ AZUL) - CORRIGIDA
// ═══════════════════════════════════════════════════════════════════════
async function marcarComoLido(sock, m, ehGrupo, foiAtivada) {
  try {
    // === REGRA 1: PV → SEMPRE MARCA COMO LIDO ===
    if (!ehGrupo) {
      await sock.readMessages([m.key]);
      console.log('✓✓ [LIDO] PV - Marcado como lido (azul)');
      return;
    }
    
    // === REGRA 2: GRUPO → SÓ MARCA SE FOI MENCIONADA/REPLY ===
    if (ehGrupo && foiAtivada) {
      await sock.readMessages([m.key]);
      console.log('✓✓ [LIDO] Grupo - Marcado como lido (Akira foi mencionada)');
      return;
    }
    
    // === REGRA 3: GRUPO SEM MENÇÃO → NÃO MARCA (fica em ✓✓ cinza) ===
    if (ehGrupo && !foiAtivada) {
      console.log('✓✓ [ENTREGUE] Grupo - NÃO marcado como lido (sem menção)');
      return;
    }
    
  } catch (e) {
    console.error('Erro ao marcar lido:', e.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// SIMULAÇÃO REALISTA DE DIGITAÇÃO (CORRIGIDA)
// ═══════════════════════════════════════════════════════════════════════
async function simularDigitacao(sock, jid, tempoMs) {
  try {
    // 1. Marca como "online"
    await sock.sendPresenceUpdate('available', jid);
    await delay(500);
    
    // 2. MOSTRA "digitando..." (VISÍVEL NO WHATSAPP)
    await sock.sendPresenceUpdate('composing', jid);
    console.log(`⌨️ [DIGITANDO] Akira está digitando por ${(tempoMs/1000).toFixed(1)}s...`);
    
    // 3. AGUARDA o tempo de digitação
    await delay(tempoMs);
    
    // 4. Para de digitar (muda para "pausado")
    await sock.sendPresenceUpdate('paused', jid);
    await delay(300);
    
    console.log('✅ [PRONTO] Akira parou de digitar');
    
  } catch (e) {
    console.error('Erro na simulação:', e.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// CONEXÃO PRINCIPAL
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
    } catch (e) {}
    
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
        }
        
        console.log('\n' + '═'.repeat(70));
        console.log('✅ AKIRA BOT V21 ONLINE! (IRONIA MÁXIMA + DIGITAÇÃO REAL)');
        console.log('═'.repeat(70));
        console.log('🤖 Bot JID:', BOT_JID);
        console.log('📱 Número:', BOT_NUMERO_REAL);
        console.log('🔗 API:', API_URL);
        console.log('═'.repeat(70) + '\n');
        
        currentQR = null;
      }
      
      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        console.log(`\n⚠️ Conexão perdida (${code}). Reconectando em 5s...\n`);
        setTimeout(() => conectar().catch(console.error), 5000);
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
        
        const ativar = await deveResponder(m, ehGrupo, texto, replyInfo);
        
        // === DINÂMICA DE LEITURA (✓✓ AZUL) ===
        await marcarComoLido(sock, m, ehGrupo, ativar);
        
        if (!ativar) return;
        
        console.log(`\n🔥 [PROCESSANDO] ${nome}: ${texto.substring(0, 60)}...`);
        
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
        
        console.log('📤 Enviando para API Akira V21...');
        
        let resposta = '...';
        try {
          const res = await axios.post(API_URL, payload, {
            timeout: 120000,
            headers: { 'Content-Type': 'application/json' }
          });
          resposta = res.data?.resposta || '...';
        } catch (err) {
          console.error('⚠️ Erro na API:', err.message);
          resposta = 'Caralho, API tá fodida. 😤';
        }
        
        console.log(`📥 [RESPOSTA AKIRA] ${resposta.substring(0, 100)}...`);
        
        // === SIMULAÇÃO REALISTA DE DIGITAÇÃO ===
        // Tempo proporcional: 50ms por caractere (mín 3s, máx 10s)
        const tempoDigitacao = Math.min(Math.max(resposta.length * 50, 3000), 10000);
        
        await simularDigitacao(sock, m.key.remoteJid, tempoDigitacao);
        
        // === ENVIA MENSAGEM ===
        let opcoes = {};
        if (ehGrupo) {
          opcoes = { quoted: m };
          console.log('📎 Reply em grupo');
        } else {
          if (replyInfo && replyInfo.ehRespostaAoBot) {
            opcoes = { quoted: m };
            console.log('📎 Reply em PV (usuário respondeu ao bot)');
          } else {
            console.log('📩 Mensagem direta em PV');
          }
        }
        
        try {
          await sock.sendMessage(m.key.remoteJid, { text: resposta }, opcoes);
          console.log('✅ [ENVIADO COM SUCESSO]\n');
          
          // Volta ao estado normal
          try {
            await delay(500);
            await sock.sendPresenceUpdate('available', m.key.remoteJid);
          } catch (e) {}
          
        } catch (e) {
          console.error('❌ Erro ao enviar:', e.message);
        }
        
      } catch (err) {
        console.error('❌ Erro no handler:', err);
      }
    });
    
    console.log('✅ Socket criado, aguardando mensagens...');
    
  } catch (err) {
    console.error('❌ Erro na conexão:', err);
    setTimeout(() => conectar().catch(console.error), 5000);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// SERVIDOR EXPRESS
// ═══════════════════════════════════════════════════════════════════════
const app = express();
app.use(express.json());

app.get('/', (req, res) => res.send(`
  <html><body style="background:#000;color:#0f0;font-family:monospace;text-align:center;padding:50px">
    <h1>🤖 AKIRA BOT V21 ONLINE ✅</h1>
    <p>Status: ${BOT_JID ? 'Conectado' : 'Desconectado'}</p>
    <p>Versão: IRONIA MÁXIMA + DIGITAÇÃO REALISTA</p>
    <p><a href="/qr" style="color:#0f0">Ver QR</a> | <a href="/health" style="color:#0f0">Health</a></p>
  </body></html>
`));

app.get('/qr', async (req, res) => {
  if (!currentQR) {
    return res.send(`<html><body style="background:#000;color:#0f0;text-align:center;padding:50px">
      <h1>✅ BOT CONECTADO!</h1><p><a href="/" style="color:#0f0">Voltar</a></p></body></html>`);
  }
  const img = await QRCode.toDataURL(currentQR, { errorCorrectionLevel: 'H', scale: 10 });
  res.send(`<html><head><meta http-equiv="refresh" content="5"></head>
    <body style="background:#000;color:#fff;text-align:center;padding:40px">
      <h1>📱 ESCANEIE O QR</h1><img src="${img}" style="border:12px solid #0f0;border-radius:20px">
      <p style="color:#0f0">Atualiza em 5s</p></body></html>`);
});

app.get('/health', (req, res) => {
  res.json({
    status: BOT_JID ? 'online' : 'offline',
    bot_numero: BOT_NUMERO_REAL,
    bot_jid: BOT_JID || null,
    uptime: process.uptime(),
    version: 'v21_digitacao_real_ironia_maxima'
  });
});

app.post('/reset', async (req, res) => {
  try {
    const { numero, usuario = 'Anônimo' } = req.body;
    if (!numero) return res.status(400).json({ error: 'Número obrigatório' });
    
    const numeroLimpo = String(numero).trim();
    const nomeUsuario = String(usuario).trim();
    
    const isRoot = ROOT_USERS.some(root =>
      numeroLimpo === root.numero && nomeUsuario === root.nomeExato
    );
    
    if (isRoot) {
      console.log('✅ [ROOT] Reset autorizado');
      const payload = { usuario: nomeUsuario, numero: numeroLimpo, mensagem: '/reset' };
      const response = await axios.post(API_URL, payload, { timeout: 120000 });
      res.json(response.data);
    } else {
      console.log('❌ [BLOQUEADO] Reset negado');
      const payload = { usuario: nomeUsuario, numero: numeroLimpo, mensagem: '/reset' };
      const response = await axios.post(API_URL, payload, { timeout: 120000 });
      res.json(response.data);
    }
  } catch (error) {
    res.status(500).json({ error: 'Erro interno', details: error.message });
  }
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🌐 Servidor rodando na porta ${server.address().port}\n`);
});

conectar();

process.on('unhandledRejection', (err) => console.error('❌ REJECTION:', err));
process.on('uncaughtException', (err) => console.error('❌ EXCEPTION:', err));
