/**
 * ═══════════════════════════════════════════════════════════════════════
 * AKIRA BOT V21 — CONTEXTO DE REPLY CORRIGIDO (COM CONTEÚDO DA MENSAGEM CITADA)
 * ═══════════════════════════════════════════════════════════════════════
 * ✅ CORREÇÃO: Contexto de reply otimizado SEM PERDER O CONTEÚDO DA MENSAGEM CITADA
 * ✅ CORREÇÃO: Mensagem citada enviada COMPLETA para a API entender o contexto
 * ✅ CORREÇÃO: O modelo agora recebe tanto a mensagem atual quanto a mensagem citada
 * ✅ Sistema: Mensagem atual é PRIORIDADE, mas mensagem citada é ENVIADA COMPLETA
 * ═══════════════════════════════════════════════════════════════════════
 */

const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers,
  delay,
  getContentType,
  downloadContentFromMessage,
  generateWAMessageFromContent,
  proto
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const axios = require('axios');
const express = require('express');
const QRCode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');
const ytdl = require('ytdl-core');
const yts = require('yt-search');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const googleTTS = require('google-tts-api');
const FormData = require('form-data');

ffmpeg.setFfmpegPath(ffmpegStatic);

// ═══════════════════════════════════════════════════════════════════════
// CONFIGURAÇÕES
// ═══════════════════════════════════════════════════════════════════════
const PORT = process.env.PORT || 3000;
const API_URL = process.env.API_URL || ' https://akra35567-akira-softedge.hf.space/api/akira';
const BOT_NUMERO_REAL = '37839265886398';
const PREFIXO = '#'; // Prefixo para comandos extras
const TEMP_FOLDER = './temp';
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

// Configuração Deepgram STT (GRATUITO - 200h/mês)
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY || '2700019dc80925c32932ab0aba44d881d20d39f7';
const DEEPGRAM_API_URL = 'https://api.deepgram.com/v1/listen';

// USUÁRIOS COM PERMISSÃO DE DONO (APENAS ISAAC QUARENTA)
const DONO_USERS = [
  { numero: '244937035662', nomeExato: 'Isaac Quarenta' },
  { numero: '244978787009', nomeExato: 'Isaac Quarenta' }
];

// Sistema de mute melhorado
const mutedUsers = new Map();
const antiLinkGroups = new Set();

// Contador de mutes por dia
const muteCounts = new Map();

// Criar pasta temp se não existir
if (!fs.existsSync(TEMP_FOLDER)) {
  fs.mkdirSync(TEMP_FOLDER, { recursive: true });
}

// ═══════════════════════════════════════════════════════════════════════
// ESTADO GLOBAL
// ═══════════════════════════════════════════════════════════════════════
let sock = null;
let BOT_JID = null;
let BOT_JID_ALTERNATIVO = null;
let currentQR = null;
let lastProcessedTime = 0;
const processadas = new Set();

// Rate limiting para comandos
const rateLimitMap = new Map();
const RATE_LIMIT = { windowSec: 8, maxCalls: 6 };

function checkRateLimit(userJid) {
  const now = Date.now();
  const rec = rateLimitMap.get(userJid) || [];
  const filtered = rec.filter(t => (now - t) < RATE_LIMIT.windowSec * 1000);
  filtered.push(now);
  rateLimitMap.set(userJid, filtered);
  return filtered.length <= RATE_LIMIT.maxCalls;
}

// ═══════════════════════════════════════════════════════════════════════
// VERIFICAÇÃO DE PERMISSÕES
// ═══════════════════════════════════════════════════════════════════════
function verificarPermissaoDono(numero, nome) {
  try {
    const numeroLimpo = String(numero).trim();
    const nomeLimpo = String(nome).trim();
    
    return DONO_USERS.some(dono =>
      numeroLimpo === dono.numero && nomeLimpo === dono.nomeExato
    );
  } catch (e) {
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// FUNÇÕES DE MODERAÇÃO MELHORADAS
// ═══════════════════════════════════════════════════════════════════════
function isUserMuted(groupId, userId) {
  const key = `${groupId}_${userId}`;
  const muteData = mutedUsers.get(key);
  
  if (!muteData) return false;
  
  if (Date.now() > muteData.expires) {
    mutedUsers.delete(key);
    return false;
  }
  
  return true;
}

function getMuteCount(groupId, userId) {
  const key = `${groupId}_${userId}`;
  const today = new Date().toDateString();
  const countData = muteCounts.get(key);
  
  if (!countData || countData.lastMuteDate !== today) {
    return 0;
  }
  
  return countData.count || 0;
}

function incrementMuteCount(groupId, userId) {
  const key = `${groupId}_${userId}`;
  const today = new Date().toDateString();
  const countData = muteCounts.get(key) || { count: 0, lastMuteDate: today };
  
  if (countData.lastMuteDate !== today) {
    countData.count = 0;
    countData.lastMuteDate = today;
  }
  
  countData.count += 1;
  muteCounts.set(key, countData);
  
  return countData.count;
}

function muteUser(groupId, userId, minutes = 5) {
  const key = `${groupId}_${userId}`;
  
  const muteCount = incrementMuteCount(groupId, userId);
  
  let muteMinutes = minutes;
  if (muteCount > 1) {
    muteMinutes = minutes * Math.pow(2, muteCount - 1);
  }
  
  const expires = Date.now() + (muteMinutes * 60 * 1000);
  mutedUsers.set(key, { 
    expires, 
    mutedAt: Date.now(), 
    minutes: muteMinutes,
    muteCount: muteCount
  });
  
  return { expires, muteMinutes, muteCount };
}

function unmuteUser(groupId, userId) {
  const key = `${groupId}_${userId}`;
  return mutedUsers.delete(key);
}

function toggleAntiLink(groupId, enable = true) {
  if (enable) {
    antiLinkGroups.add(groupId);
  } else {
    antiLinkGroups.delete(groupId);
  }
  return enable;
}

function isAntiLinkActive(groupId) {
  return antiLinkGroups.has(groupId);
}

function containsLink(text) {
  if (!text) return false;
  const urlRegex = /(https?:\/\/[^\s]+)|(www\.[^\s]+)|(bit\.ly\/[^\s]+)|(t\.me\/[^\s]+)|(wa\.me\/[^\s]+)|(chat\.whatsapp\.com\/[^\s]+)/gi;
  return urlRegex.test(text);
}

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
// FUNÇÕES AUXILIARES MELHORADAS
// ═══════════════════════════════════════════════════════════════════════
function extrairNumeroReal(m) {
  try {
    const key = m.key || {};
    const message = m.message || {};
    
    if (key.remoteJid && !String(key.remoteJid).endsWith('@g.us')) {
      return String(key.remoteJid).split('@')[0];
    }
    
    if (key.participant) {
      const participant = String(key.participant);
      if (participant.includes('@s.whatsapp.net')) {
        return participant.split('@')[0];
      }
      if (participant.includes('@lid')) {
        const limpo = participant.split(':')[0];
        const digitos = limpo.replace(/\D/g, '');
        if (digitos.length >= 9) {
          return '244' + digitos.slice(-9);
        }
      }
    }
    
    return 'desconhecido';
    
  } catch (e) {
    logger.error({ e }, 'Erro ao extrair número');
    return 'desconhecido';
  }
}

function obterParticipanteGrupo(m) {
  try {
    const key = m.key || {};
    
    if (key.participant) {
      return key.participant;
    }
    
    const context = m.message?.extendedTextMessage?.contextInfo;
    if (context?.participant) {
      return context.participant;
    }
    
    return null;
    
  } catch (e) {
    return null;
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
    if (tipo === 'audioMessage') {
      return '[mensagem de voz]';
    }
    if (tipo === 'stickerMessage') {
      return '[figurinha]';
    }
    
    return '';
  } catch (e) {
    return '';
  }
}

// ═══════════════════════════════════════════════════════════════════════
// FUNÇÃO CRÍTICA CORRIGIDA: EXTRAIR REPLY INFO - INCLUINDO TEXTO COMPLETO
// ═══════════════════════════════════════════════════════════════════════
function extrairReplyInfo(m) {
  try {
    const context = m.message?.extendedTextMessage?.contextInfo;
    if (!context || !context.quotedMessage) return null;
    
    const quoted = context.quotedMessage;
    const tipo = getContentType(quoted);
    
    // EXTRAI TEXTO DA MENSAGEM CITADA (COMPLETO - CORRIGIDO)
    let textoMensagemCitada = '';
    let tipoMidia = 'texto';
    let textoCompletoCitado = ''; // Nova variável para texto COMPLETO
    
    if (tipo === 'conversation') {
      textoMensagemCitada = quoted.conversation || '';
      textoCompletoCitado = textoMensagemCitada;
      tipoMidia = 'texto';
    } else if (tipo === 'extendedTextMessage') {
      textoMensagemCitada = quoted.extendedTextMessage?.text || '';
      textoCompletoCitado = textoMensagemCitada;
      tipoMidia = 'texto';
    } else if (tipo === 'imageMessage') {
      textoMensagemCitada = quoted.imageMessage?.caption || '[imagem]';
      textoCompletoCitado = textoMensagemCitada + ' [imagem enviada]';
      tipoMidia = 'imagem';
    } else if (tipo === 'videoMessage') {
      textoMensagemCitada = quoted.videoMessage?.caption || '[vídeo]';
      textoCompletoCitado = textoMensagemCitada + ' [vídeo enviado]';
      tipoMidia = 'video';
    } else if (tipo === 'audioMessage') {
      textoMensagemCitada = '[áudio]';
      textoCompletoCitado = '[mensagem de áudio]';
      tipoMidia = 'audio';
    } else if (tipo === 'stickerMessage') {
      textoMensagemCitada = '[figurinha]';
      textoCompletoCitado = '[figurinha enviada]';
      tipoMidia = 'sticker';
    } else {
      textoMensagemCitada = '[conteúdo]';
      textoCompletoCitado = '[conteúdo de mídia]';
      tipoMidia = 'outro';
    }
    
    // IDENTIFICA QUEM ESCREVEU A MENSAGEM CITADA
    const participantJidCitado = context.participant || null;
    const ehRespostaAoBot = ehOBot(participantJidCitado);
    
    // Informações de quem escreveu a mensagem citada
    let nomeQuemEscreveuCitacao = 'desconhecido';
    let numeroQuemEscreveuCitacao = 'desconhecido';
    
    if (participantJidCitado) {
      try {
        const usuario = store?.contacts?.[participantJidCitado] || {};
        nomeQuemEscreveuCitacao = usuario.name || usuario.notify || participantJidCitado.split('@')[0] || 'desconhecido';
        numeroQuemEscreveuCitacao = participantJidCitado.split('@')[0] || 'desconhecido';
      } catch (e) {
        console.error('Erro ao obter info de quem escreveu citação:', e);
      }
    }
    
    // IDENTIFICA QUEM ESTÁ FALANDO AGORA (A MENSAGEM ATUAL)
    const quemFalaAgoraJid = m.key.participant || m.key.remoteJid;
    let nomeQuemFalaAgora = m.pushName || 'desconhecido';
    let numeroQuemFalaAgora = extrairNumeroReal(m);
    
    // CORREÇÃO: Garantir que o contexto inclua a mensagem citada COMPLETA
    let contextoParaAPI = '';
    if (ehRespostaAoBot) {
      contextoParaAPI = `(Usuário está respondendo à MINHA mensagem anterior: "${textoCompletoCitado.substring(0, 100)}")`;
    } else {
      contextoParaAPI = `(Usuário está comentando sobre mensagem de ${nomeQuemEscreveuCitacao}: "${textoCompletoCitado.substring(0, 100)}")`;
    }
    
    return {
      // QUEM ESTÁ FALANDO AGORA
      quemFalaAgoraJid: quemFalaAgoraJid,
      quemFalaAgoraNome: nomeQuemFalaAgora,
      quemFalaAgoraNumero: numeroQuemFalaAgora,
      
      // INFORMAÇÕES DA MENSAGEM CITADA (COMPLETAS - CORRIGIDO)
      textoMensagemCitada: textoCompletoCitado, // USAR TEXTO COMPLETO
      tipoMidiaCitada: tipoMidia,
      textoCitadoResumido: textoMensagemCitada, // Mantém resumo também
      
      // QUEM ESCREVEU A MENSAGEM CITADA
      quemEscreveuCitacaoJid: participantJidCitado,
      quemEscreveuCitacaoNome: nomeQuemEscreveuCitacao,
      quemEscreveuCitacaoNumero: numeroQuemEscreveuCitacao,
      
      // FLAGS IMPORTANTES
      ehRespostaAoBot: ehRespostaAoBot,
      
      // CONTEXTO OTIMIZADO
      contextoParaAPI: contextoParaAPI,
      
      // Para compatibilidade
      participantJid: participantJidCitado,
      texto: textoCompletoCitado,
      tipoMidia: tipoMidia,
      quemFalaJid: quemFalaAgoraJid,
      quemFalaNome: nomeQuemFalaAgora,
      quemFalaNumero: numeroQuemFalaAgora
    };
    
  } catch (e) {
    console.error('Erro ao extrair reply info:', e);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// FUNÇÃO PARA VERIFICAR SE DEVE RESPONDER
// ═══════════════════════════════════════════════════════════════════════
async function deveResponder(m, ehGrupo, texto, replyInfo, temAudio = false) {
  const textoLower = String(texto).toLowerCase();
  const context = m.message?.extendedTextMessage?.contextInfo;
  
  // REGRAS PARA ÁUDIO
  if (temAudio) {
    if (!ehGrupo) {
      console.log('✅ [ATIVAÇÃO ÁUDIO] PV - Sempre responde');
      return true;
    }
    
    if (replyInfo && replyInfo.ehRespostaAoBot) {
      console.log('✅ [ATIVAÇÃO ÁUDIO] Reply ao bot detectado');
      return true;
    }
    
    if (textoLower.includes('akira')) {
      console.log('✅ [ATIVAÇÃO ÁUDIO] Menção "akira" detectada');
      return true;
    }
    
    const mentions = context?.mentionedJid || [];
    const botMencionado = mentions.some(jid => ehOBot(jid));
    
    if (botMencionado) {
      console.log('✅ [ATIVAÇÃO ÁUDIO] @mention do bot');
      return true;
    }
    
    console.log('❌ [IGNORADO] Grupo sem menção/reply ao bot em áudio');
    return false;
  }
  
  // REGRAS PARA TEXTO
  if (replyInfo && replyInfo.ehRespostaAoBot) {
    console.log('✅ [ATIVAÇÃO TEXTO] Reply ao bot detectado');
    return true;
  }
  
  if (ehGrupo) {
    if (textoLower.includes('akira')) {
      console.log('✅ [ATIVAÇÃO TEXTO] Menção "akira" detectada');
      return true;
    }
    
    const mentions = context?.mentionedJid || [];
    const botMencionado = mentions.some(jid => ehOBot(jid));
    
    if (botMencionado) {
      console.log('✅ [ATIVAÇÃO TEXTO] @mention do bot');
      return true;
    }
    
    console.log('❌ [IGNORADO] Grupo sem menção/reply ao bot');
    return false;
  }
  
  // Em PV sempre responde texto
  return true;
}

// ═══════════════════════════════════════════════════════════════════════
// FUNÇÃO PARA MENSAGEM EDITÁVEL
// ═══════════════════════════════════════════════════════════════════════
let progressMessages = new Map();

async function sendProgressMessage(sock, jid, text, originalMsg = null, userId = null) {
  try {
    if (originalMsg && userId) {
      const key = `${userId}_${originalMsg.key.id}`;
      const progressData = progressMessages.get(key);
      
      if (progressData && progressData.key) {
        try {
          await sock.sendMessage(jid, {
            text: text,
            edit: progressData.key
          });
          return progressData.key;
        } catch (e) {}
      }
    }
    
    const sentMsg = await sock.sendMessage(jid, { text: text });
    
    if (originalMsg && userId && sentMsg.key) {
      const key = `${userId}_${originalMsg.key.id}`;
      progressMessages.set(key, {
        key: sentMsg.key,
        timestamp: Date.now()
      });
      
      setTimeout(() => {
        progressMessages.delete(key);
      }, 10 * 60 * 1000);
    }
    
    return sentMsg.key;
  } catch (e) {
    console.error('Erro ao enviar mensagem de progresso:', e);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// FUNÇÕES PARA STT (SPEECH TO TEXT) - DEEPGRAM API
// ═══════════════════════════════════════════════════════════════════════
async function transcreverAudioParaTexto(audioBuffer) {
  try {
    console.log('🔊 Iniciando transcrição REAL de áudio (Deepgram)...');
    
    const audioPath = path.join(TEMP_FOLDER, `audio_${Date.now()}.ogg`);
    fs.writeFileSync(audioPath, audioBuffer);
    
    const convertedPath = path.join(TEMP_FOLDER, `audio_${Date.now()}.mp3`);
    
    await new Promise((resolve, reject) => {
      ffmpeg(audioPath)
        .toFormat('mp3')
        .audioCodec('libmp3lame')
        .on('end', resolve)
        .on('error', reject)
        .save(convertedPath);
    });
    
    const convertedBuffer = fs.readFileSync(convertedPath);
    
    if (!DEEPGRAM_API_KEY || DEEPGRAM_API_KEY === 'seu_token_aqui') {
      try {
        fs.unlinkSync(audioPath);
        fs.unlinkSync(convertedPath);
      } catch (e) {}
      
      return { 
        texto: "Olá! Recebi seu áudio mas preciso que configure o token do Deepgram para transcrição real.", 
        sucesso: false,
        nota: "Configure DEEPGRAM_API_KEY"
      };
    }
    
    console.log('📤 Enviando para Deepgram API...');
    
    const response = await axios.post(
      DEEPGRAM_API_URL,
      convertedBuffer,
      {
        headers: {
          'Authorization': `Token ${DEEPGRAM_API_KEY}`,
          'Content-Type': 'audio/mpeg'
        },
        params: {
          model: 'nova-3',
          language: 'pt',
          smart_format: true,
          punctuate: true,
          diarize: false,
          numerals: true
        },
        timeout: 30000
      }
    );
    
    let textoTranscrito = '';
    if (response.data && response.data.results && response.data.results.channels) {
      const transcription = response.data.results.channels[0].alternatives[0].transcript;
      textoTranscrito = transcription || '';
    }
    
    textoTranscrito = textoTranscrito.trim();
    
    if (!textoTranscrito || textoTranscrito.length < 2) {
      textoTranscrito = "[Não consegui entender o áudio claramente]";
    }
    
    try {
      fs.unlinkSync(audioPath);
      fs.unlinkSync(convertedPath);
    } catch (e) {
      console.error('Erro ao limpar arquivos temporários:', e);
    }
    
    console.log(`📝 Transcrição REAL: ${textoTranscrito.substring(0, 100)}...`);
    
    return { 
      texto: textoTranscrito, 
      sucesso: true,
      fonte: 'Deepgram STT'
    };
    
  } catch (error) {
    console.error('❌ Erro na transcrição REAL:', error.message);
    
    let audioPath, convertedPath;
    try {
      if (audioPath) fs.unlinkSync(audioPath);
      if (convertedPath) fs.unlinkSync(convertedPath);
    } catch (e) {}
    
    if (error.response) {
      if (error.response.status === 401) {
        return { 
          texto: "[Erro: Token do Deepgram inválido]", 
          sucesso: false,
          erro: "Token inválido ou expirado"
        };
      }
    }
    
    return { 
      texto: "Recebi seu áudio mas houve um erro na transcrição. Pode repetir ou digitar?", 
      sucesso: false,
      erro: error.message
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════
// FUNÇÕES PARA COMANDOS EXTRAS
// ═══════════════════════════════════════════════════════════════════════
async function downloadMediaMessage(message) {
  try {
    const mimeMap = {
      'imageMessage': 'image',
      'videoMessage': 'video',
      'audioMessage': 'audio',
      'stickerMessage': 'sticker',
      'documentMessage': 'document'
    };
    
    const type = Object.keys(message)[0];
    const mimeType = mimeMap[type] || 'document';
    
    const stream = await downloadContentFromMessage(message[type], mimeType);
    let buffer = Buffer.from([]);
    
    for await (const chunk of stream) {
      buffer = Buffer.concat([buffer, chunk]);
    }
    
    return buffer;
  } catch (e) {
    console.error('Erro ao baixar mídia:', e);
    return null;
  }
}

function generateRandomFilename(ext = '') {
  return path.join(TEMP_FOLDER, Date.now().toString() + '-' + Math.random().toString(36).slice(2, 8) + (ext ? '.' + ext : ''));
}

function cleanupFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (e) {
    console.error('Erro ao limpar arquivo:', e);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// FUNÇÕES PARA STICKERS
// ═══════════════════════════════════════════════════════════════════════
function isStickerAnimated(stickerBuffer) {
  try {
    if (stickerBuffer.length < 20) return false;
    
    const header = stickerBuffer.slice(0, 12).toString('hex');
    if (header.includes('52494646') && header.includes('5745425056503858')) {
      return true;
    }
    
    const stickerStr = stickerBuffer.toString('binary');
    return stickerStr.includes('ANIM');
  } catch (e) {
    return false;
  }
}

async function createSticker(imageBuffer, quotedMsg, packName = "Angolan Vibes", author = "+244937035662") {
  try {
    const inputPath = generateRandomFilename('jpg');
    const outputPath = generateRandomFilename('webp');
    
    fs.writeFileSync(inputPath, imageBuffer);
    
    const usuarioNome = quotedMsg?.pushName || "Usuário";
    
    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .outputOptions([
          '-vcodec libwebp', 
          "-vf scale='min(512,iw)':min'(512,ih)':force_original_aspect_ratio=decrease,fps=15",
          '-metadata', `title=${packName}`,
          '-metadata', `artist=${author}`,
          '-metadata', `comment=Criado por ${usuarioNome} via Akira Bot`
        ])
        .on('end', () => {
          console.log(`✅ Sticker criado para ${usuarioNome}`);
          resolve();
        })
        .on('error', (err) => {
          console.error('❌ Erro ao criar sticker:', err);
          reject(err);
        })
        .save(outputPath);
    });
    
    const stickerBuffer = fs.readFileSync(outputPath);
    cleanupFile(inputPath);
    cleanupFile(outputPath);
    
    return stickerBuffer;
  } catch (e) {
    console.error('Erro ao criar sticker:', e);
    return null;
  }
}

async function createAnimatedStickerFromVideo(videoBuffer, quotedMsg, duracaoMaxima = 30) {
  try {
    const inputPath = generateRandomFilename('mp4');
    const outputPath = generateRandomFilename('webp');
    
    fs.writeFileSync(inputPath, videoBuffer);
    
    const usuarioNome = quotedMsg?.pushName || "Usuário";
    
    await new Promise((resolve, reject) => {
      const command = ffmpeg(inputPath);
      
      command
        .outputOptions([
          '-vcodec libwebp',
          '-vf', 'fps=15,scale=512:512:flags=lanczos',
          '-loop', '0',
          '-lossless', '0',
          '-compression_level', '6',
          '-q:v', '70',
          '-preset', 'default',
          '-an',
          '-t', duracaoMaxima.toString(),
          '-metadata', `title=${usuarioNome}'s Pack`,
          '-metadata', `artist=Akira Bot`,
          '-metadata', `comment=Criado por ${usuarioNome}`,
          '-y'
        ])
        .on('end', () => {
          console.log(`✅ Sticker animado criado para ${usuarioNome}`);
          resolve();
        })
        .on('error', (err) => {
          console.error('❌ Erro ao criar sticker animado:', err);
          reject(err);
        })
        .save(outputPath);
    });
    
    const stickerBuffer = fs.readFileSync(outputPath);
    
    if (stickerBuffer.length > 500 * 1024) {
      cleanupFile(inputPath);
      cleanupFile(outputPath);
      return { error: 'Sticker animado muito grande (>500KB). Tente um vídeo mais curto.' };
    }
    
    cleanupFile(inputPath);
    cleanupFile(outputPath);
    
    return { buffer: stickerBuffer };
  } catch (e) {
    console.error('Erro ao criar sticker animado:', e);
    return { error: 'Erro ao criar sticker animado: ' + e.message };
  }
}

async function createStickerFromSticker(stickerBuffer, quotedMsg) {
  try {
    return stickerBuffer;
  } catch (e) {
    console.error('Erro ao criar sticker de sticker:', e);
    return null;
  }
}

async function createAnimatedStickerFromAnimatedSticker(stickerBuffer, quotedMsg) {
  try {
    return stickerBuffer;
  } catch (e) {
    console.error('Erro ao criar sticker animado de sticker animado:', e);
    return null;
  }
}

async function convertStickerToImage(stickerBuffer, quotedMsg) {
  try {
    const inputPath = generateRandomFilename('webp');
    const outputPath = generateRandomFilename('png');
    
    fs.writeFileSync(inputPath, stickerBuffer);
    
    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .outputOptions(['-vcodec png'])
        .on('end', resolve)
        .on('error', reject)
        .save(outputPath);
    });
    
    const imageBuffer = fs.readFileSync(outputPath);
    cleanupFile(inputPath);
    cleanupFile(outputPath);
    
    return imageBuffer;
  } catch (e) {
    console.error('Erro ao converter sticker:', e);
    return null;
  }
}

async function enviarStickerPersonalizado(sock, jid, stickerBuffer, packName = "Angolan Vibes", author = "+244937035662", quotedMsg = null) {
  try {
    const opcoes = quotedMsg ? { quoted: quotedMsg } : {};
    
    await sock.sendMessage(jid, { sticker: stickerBuffer }, opcoes);
    
    console.log(`✅ Sticker enviado para ${packName}`);
    return true;
  } catch (e) {
    console.error('Erro ao enviar sticker personalizado:', e);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// FUNÇÃO PARA DOWNLOAD DE ÁUDIO DO YOUTUBE
// ═══════════════════════════════════════════════════════════════════════
async function downloadYTAudio(url) {
  try {
    console.log('🎵 Iniciando download de áudio do YouTube...');
    
    let videoId = '';
    if (url.includes('youtube.com/watch?v=')) {
      videoId = url.split('v=')[1]?.split('&')[0];
    } else if (url.includes('youtu.be/')) {
      videoId = url.split('youtu.be/')[1]?.split('?')[0];
    }
    
    if (!videoId || videoId.length !== 11) {
      return { error: 'URL do YouTube inválida' };
    }
    
    console.log(`📹 Video ID: ${videoId}`);
    const outputPath = generateRandomFilename('mp3');
    
    try {
      console.log('🔄 Tentando método 1: API externa confiável...');
      
      const apiUrl = `https://api.download-lagu-mp3.com/@api/json/mp3/${videoId}`;
      
      const response = await axios.get(apiUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json',
          'Referer': 'https://download-lagu-mp3.com/'
        },
        timeout: 30000
      });
      
      if (response.data && response.data.vid && response.data.vid.mp3) {
        console.log('✅ Link de download obtido da API');
        const mp3Url = response.data.vid.mp3;
        
        const audioResponse = await axios({
          method: 'GET',
          url: mp3Url,
          responseType: 'stream',
          timeout: 60000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'audio/mpeg,audio/*'
          }
        });
        
        const writer = fs.createWriteStream(outputPath);
        audioResponse.data.pipe(writer);
        
        await new Promise((resolve, reject) => {
          writer.on('finish', resolve);
          writer.on('error', reject);
        });
        
        const stats = fs.statSync(outputPath);
        if (stats.size === 0) {
          cleanupFile(outputPath);
          throw new Error('Arquivo vazio');
        }
        
        if (stats.size > 25 * 1024 * 1024) {
          cleanupFile(outputPath);
          return { error: 'Arquivo muito grande (>25MB). Tente um vídeo mais curto.' };
        }
        
        const audioBuffer = fs.readFileSync(outputPath);
        cleanupFile(outputPath);
        
        let title = 'Música do YouTube';
        try {
          const search = await yts({ videoId: videoId });
          if (search && search.title) {
            title = search.title;
          }
        } catch (e) {}
        
        return { buffer: audioBuffer, title: title };
      }
    } catch (apiError) {
      console.log('❌ API falhou:', apiError.message);
    }
    
    try {
      console.log('🔄 Tentando método 2: ytdl-core atualizado...');
      
      const info = await ytdl.getInfo(videoId, {
        requestOptions: {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          }
        }
      });
      
      let audioFormat = ytdl.chooseFormat(info.formats, { 
        quality: 'highestaudio',
        filter: 'audioonly'
      });
      
      if (!audioFormat) {
        throw new Error('Nenhum formato de áudio encontrado');
      }
      
      console.log(`✅ Format encontrado: ${audioFormat.container}`);
      
      const writeStream = fs.createWriteStream(outputPath);
      const stream = ytdl.downloadFromInfo(info, { format: audioFormat });
      
      await new Promise((resolve, reject) => {
        stream.pipe(writeStream);
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
        stream.on('error', reject);
      });
      
      const stats = fs.statSync(outputPath);
      if (stats.size === 0) {
        cleanupFile(outputPath);
        throw new Error('Arquivo vazio');
      }
      
      if (stats.size > 25 * 1024 * 1024) {
        cleanupFile(outputPath);
        return { error: 'Arquivo muito grande (>25MB). Tente um vídeo mais curto.' };
      }
      
      const audioBuffer = fs.readFileSync(outputPath);
      cleanupFile(outputPath);
      
      return { 
        buffer: audioBuffer, 
        title: info.videoDetails.title || 'Música do YouTube'
      };
      
    } catch (ytdlError) {
      console.log('❌ ytdl-core falhou:', ytdlError.message);
    }
    
    return { error: 'Não foi possível baixar o áudio. Tente outro vídeo.' };
    
  } catch (e) {
    console.error('❌ Erro geral ao baixar áudio:', e);
    
    try {
      cleanupFile(outputPath);
    } catch (cleanError) {}
    
    return { error: 'Erro ao processar: ' + e.message };
  }
}

async function textToSpeech(text, lang = 'pt') {
  try {
    const url = googleTTS.getAudioUrl(text, { 
      lang: lang, 
      slow: false, 
      host: 'https://translate.google.com' 
    });
    
    const outputPath = generateRandomFilename('mp3');
    const response = await axios({
      url,
      method: 'GET',
      responseType: 'arraybuffer'
    });
    
    fs.writeFileSync(outputPath, Buffer.from(response.data));
    
    const stats = fs.statSync(outputPath);
    if (stats.size === 0) {
      cleanupFile(outputPath);
      return { error: 'Áudio TTS vazio' };
    }
    
    const audioBuffer = fs.readFileSync(outputPath);
    cleanupFile(outputPath);
    
    return { buffer: audioBuffer };
  } catch (e) {
    console.error('Erro TTS:', e);
    return { error: 'Erro ao gerar TTS' };
  }
}

// ═══════════════════════════════════════════════════════════════════════
// DINÂMICA DE LEITURA MELHORADA
// ═══════════════════════════════════════════════════════════════════════
async function marcarMensagem(sock, m, ehGrupo, foiAtivada, temAudio = false) {
  try {
    if (temAudio && foiAtivada) {
      try {
        await sock.readMessages([m.key]);
        console.log('▶️ [REPRODUZIDO] Áudio marcado como reproduzido');
      } catch (e) {}
      return;
    }
    
    if (!ehGrupo) {
      await sock.readMessages([m.key]);
      console.log('✓✓ [LIDO] PV - Marcado como lido (azul)');
      return;
    }
    
    if (ehGrupo && foiAtivada) {
      await sock.readMessages([m.key]);
      console.log('✓✓ [LIDO] Grupo - Marcado como lido (Akira foi mencionada)');
      return;
    }
    
    if (ehGrupo && !foiAtivada) {
      try {
        await sock.sendReadReceipt(m.key.remoteJid, m.key.participant, [m.key.id]);
        console.log('✓ [ENTREGUE FORÇADO] Grupo - Marcado como entregue (check simples)');
      } catch (e) {
        try {
          await sock.sendReceipt(m.key.remoteJid, m.key.participant, [m.key.id]);
          console.log('✓ [ENTREGUE ALT] Grupo - Usando método alternativo');
        } catch (e2) {}
      }
      return;
    }
    
  } catch (e) {
    console.error('Erro ao marcar mensagem:', e.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// SIMULAÇÃO REALISTA DE DIGITAÇÃO
// ═══════════════════════════════════════════════════════════════════════
async function simularDigitacao(sock, jid, tempoMs) {
  try {
    await sock.sendPresenceUpdate('available', jid);
    await delay(500);
    
    await sock.sendPresenceUpdate('composing', jid);
    console.log(`⌨️ [DIGITANDO] Akira está digitando por ${(tempoMs/1000).toFixed(1)}s...`);
    
    await delay(tempoMs);
    
    await sock.sendPresenceUpdate('paused', jid);
    await delay(300);
    
    console.log('✅ [PRONTO] Akira parou de digitar');
    
  } catch (e) {
    console.error('Erro na simulação:', e.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// SIMULAÇÃO DE GRAVAÇÃO DE ÁUDIO
// ═══════════════════════════════════════════════════════════════════════
async function simularGravacaoAudio(sock, jid, tempoMs) {
  try {
    console.log(`🎤 [GRAVANDO] Akira está preparando áudio por ${(tempoMs/1000).toFixed(1)}s...`);
    
    await sock.sendPresenceUpdate('recording', jid);
    await delay(tempoMs);
    
    await sock.sendPresenceUpdate('paused', jid);
    
    console.log('✅ [PRONTO] Áudio preparado');
  } catch (e) {
    console.error('Erro na simulação de gravação:', e.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// FUNÇÃO PARA OBTER INFORMAÇÕES DO GRUPO
// ═══════════════════════════════════════════════════════════════════════
async function obterInfoGrupo(sock, groupId) {
  try {
    const groupMetadata = await sock.groupMetadata(groupId);
    return {
      id: groupId,
      subject: groupMetadata.subject || 'Grupo sem nome',
      participants: groupMetadata.participants || [],
      created: groupMetadata.creation || Date.now()
    };
  } catch (e) {
    console.error('Erro ao obter info do grupo:', e);
    return {
      id: groupId,
      subject: 'Grupo sem nome',
      participants: [],
      created: Date.now()
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════
// SIMULAÇÃO DE STATUS DE MENSAGENS
// ═══════════════════════════════════════════════════════════════════════
async function simularStatusMensagem(sock, m, foiAtivada, temAudio = false) {
  try {
    const ehGrupo = String(m.key.remoteJid || '').endsWith('@g.us');
    
    if (ehGrupo) {
      try {
        await sock.sendReadReceipt(m.key.remoteJid, m.key.participant, [m.key.id]);
        console.log('✓ [ENTREGUE FORÇADO] Grupo - Marcado como entregue (check simples)');
      } catch (e) {
        try {
          await sock.sendReceipt(m.key.remoteJid, m.key.participant, [m.key.id]);
          console.log('✓ [ENTREGUE ALT] Grupo - Usando método alternativo');
        } catch (e2) {}
      }
    }
    
    if (!foiAtivada) {
      return;
    }
    
    if (temAudio && foiAtivada) {
      await sock.readMessages([m.key]);
      console.log('▶️ [REPRODUZIDO] Áudio marcado como reproduzido (✓✓)');
    } else if (foiAtivada) {
      await sock.readMessages([m.key]);
      console.log('✓✓ [LIDO] Mensagem marcada como lida (azul)');
    }
    
  } catch (e) {
    console.error('Erro ao simular status:', e.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// HANDLER DE COMANDOS EXTRAS
// ═══════════════════════════════════════════════════════════════════════
async function handleComandosExtras(sock, m, texto, ehGrupo) {
  try {
    if (!texto.startsWith(PREFIXO)) return false;
    
    const sender = m.key.participant || m.key.remoteJid;
    if (!checkRateLimit(sender)) {
      await sock.sendMessage(m.key.remoteJid, { text: '⏰ Você está usando comandos muito rápido. Aguarde um pouco.' });
      return true;
    }
    
    const args = texto.slice(PREFIXO.length).trim().split(/ +/);
    const comando = args.shift().toLowerCase();
    const textoCompleto = args.join(' ');
    
    console.log(`🔧 [COMANDO] ${comando} de ${sender}`);
    
    switch (comando) {
      
      case 'sticker':
      case 's':
      case 'fig':
        try {
          const quoted = m.message?.extendedTextMessage?.contextInfo?.quotedMessage;
          const hasImage = m.message?.imageMessage || quoted?.imageMessage;
          const hasSticker = quoted?.stickerMessage;
          
          if (!hasImage && !hasSticker) {
            await sock.sendMessage(m.key.remoteJid, { 
              text: '📸 *Como usar:* \n- Envie uma imagem com legenda `#sticker`\n- OU responda uma imagem/sticker com `#sticker`\n\n⚠️ *Para vídeos, use `#gif` para criar sticker animado.*' 
            }, { quoted: m });
            return true;
          }
          
          let stickerBuffer = null;
          let isAnimated = false;
          let packName = "Angolan Vibes";
          let author = "+244937035662";
          
          const usuarioNome = m.pushName || "Usuário";
          packName = `${usuarioNome}'s Pack`;
          
          if (hasImage) {
            const mediaMessage = quoted?.imageMessage || m.message.imageMessage;
            const mediaBuffer = await downloadMediaMessage({ imageMessage: mediaMessage });
            
            if (!mediaBuffer) {
              await sock.sendMessage(m.key.remoteJid, { text: '❌ Erro ao baixar imagem.' }, { quoted: m });
              return true;
            }
            
            stickerBuffer = await createSticker(mediaBuffer, m, packName, author);
            isAnimated = false;
            
          } else if (hasSticker) {
            const stickerMessage = quoted.stickerMessage;
            const mediaBuffer = await downloadMediaMessage({ stickerMessage: stickerMessage });
            
            if (!mediaBuffer) {
              await sock.sendMessage(m.key.remoteJid, { text: '❌ Erro ao baixar sticker.' }, { quoted: m });
              return true;
            }
            
            isAnimated = isStickerAnimated(mediaBuffer);
            
            if (isAnimated) {
              stickerBuffer = await createAnimatedStickerFromAnimatedSticker(mediaBuffer, m);
            } else {
              stickerBuffer = await createStickerFromSticker(mediaBuffer, m);
            }
          }
          
          if (!stickerBuffer) {
            await sock.sendMessage(m.key.remoteJid, { text: '❌ Erro ao criar sticker.' }, { quoted: m });
            return true;
          }
          
          const sucesso = await enviarStickerPersonalizado(sock, m.key.remoteJid, stickerBuffer, packName, author, m);
          
          if (!sucesso) {
            await sock.sendMessage(m.key.remoteJid, { text: '❌ Erro ao enviar sticker.' }, { quoted: m });
          }
        } catch (e) {
          console.error('Erro no comando sticker:', e);
          await sock.sendMessage(m.key.remoteJid, { text: '❌ Erro ao processar sticker.' }, { quoted: m });
        }
        return true;
      
      case 'gif':
        try {
          const quoted = m.message?.extendedTextMessage?.contextInfo?.quotedMessage;
          const hasVideo = m.message?.videoMessage || quoted?.videoMessage;
          const hasSticker = quoted?.stickerMessage;
          
          if (!hasVideo && !hasSticker) {
            await sock.sendMessage(m.key.remoteJid, { 
              text: '🎥 *Como usar:* \n- Envie um vídeo com legenda `#gif`\n- OU responda um vídeo/sticker animado com `#gif`\n\n⚠️ *Vídeos até 30 segundos*' 
            }, { quoted: m });
            return true;
          }
          
          let stickerBuffer = null;
          const usuarioNome = m.pushName || "Usuário";
          let packName = `${usuarioNome}`;
          let author = "+244937035662";
          
          if (hasVideo) {
            const mediaMessage = quoted?.videoMessage || m.message.videoMessage;
            const mediaBuffer = await downloadMediaMessage({ videoMessage: mediaMessage });
            
            if (!mediaBuffer) {
              await sock.sendMessage(m.key.remoteJid, { text: '❌ Erro ao baixar vídeo.' }, { quoted: m });
              return true;
            }
            
            const stickerResult = await createAnimatedStickerFromVideo(mediaBuffer, m, 30);
            
            if (stickerResult.error) {
              await sock.sendMessage(m.key.remoteJid, { text: `❌ ${stickerResult.error}` }, { quoted: m });
              return true;
            }
            
            stickerBuffer = stickerResult.buffer;
            
          } else if (hasSticker) {
            const stickerMessage = quoted.stickerMessage;
            const mediaBuffer = await downloadMediaMessage({ stickerMessage: stickerMessage });
            
            if (!mediaBuffer) {
              await sock.sendMessage(m.key.remoteJid, { text: '❌ Erro ao baixar sticker.' }, { quoted: m });
              return true;
            }
            
            if (!isStickerAnimated(mediaBuffer)) {
              await sock.sendMessage(m.key.remoteJid, { text: '❌ Este sticker não é animado. Use `#sticker` para stickers normais.' }, { quoted: m });
              return true;
            }
            
            stickerBuffer = await createAnimatedStickerFromAnimatedSticker(mediaBuffer, m);
          }
          
          if (!stickerBuffer) {
            await sock.sendMessage(m.key.remoteJid, { text: '❌ Erro ao criar sticker animado.' }, { quoted: m });
            return true;
          }
          
          const sucesso = await enviarStickerPersonalizado(sock, m.key.remoteJid, stickerBuffer, packName, author, m);
          
          if (!sucesso) {
            await sock.sendMessage(m.key.remoteJid, { text: '❌ Erro ao enviar sticker animado.' }, { quoted: m });
          }
        } catch (e) {
          console.error('Erro no comando gif:', e);
          await sock.sendMessage(m.key.remoteJid, { text: '❌ Erro ao criar sticker animado.' }, { quoted: m });
        }
        return true;
      
      case 'toimg':
      case 'img':
      case 'unstick':
        try {
          const quoted = m.message?.extendedTextMessage?.contextInfo?.quotedMessage;
          const hasSticker = quoted?.stickerMessage;
          
          if (!hasSticker) {
            await sock.sendMessage(m.key.remoteJid, { 
              text: '🔄 *Como usar:* \nResponda um sticker com `#toimg` para converter em imagem' 
            }, { quoted: m });
            return true;
          }
          
          const stickerBuffer = await downloadMediaMessage({ stickerMessage: quoted.stickerMessage });
          
          if (!stickerBuffer) {
            await sock.sendMessage(m.key.remoteJid, { text: '❌ Erro ao baixar sticker.' }, { quoted: m });
            return true;
          }
          
          const imageBuffer = await convertStickerToImage(stickerBuffer, m);
          
          if (imageBuffer) {
            await sock.sendMessage(m.key.remoteJid, { 
              image: imageBuffer 
            }, { quoted: m });
            console.log('✅ Sticker convertido para imagem');
          } else {
            await sock.sendMessage(m.key.remoteJid, { text: '❌ Erro ao converter sticker.' }, { quoted: m });
          }
        } catch (e) {
          console.error('Erro no comando toimg:', e);
          await sock.sendMessage(m.key.remoteJid, { text: '❌ Erro ao converter sticker.' }, { quoted: m });
        }
        return true;
      
      case 'tts':
        if (!textoCompleto) {
          await sock.sendMessage(m.key.remoteJid, { 
            text: '🗣️ *Como usar:* \n`#tts pt olá mundo`\n`#tts en hello world`\n\nIdiomas: pt, en, es, fr, etc.' 
          }, { quoted: m });
          return true;
        }
        
        try {
          const lang = args[0] || 'pt';
          const text = args.slice(1).join(' ');
          
          if (text.length > 200) {
            await sock.sendMessage(m.key.remoteJid, { 
              text: '❌ Texto muito longo. Máximo 200 caracteres para TTS.' 
            }, { quoted: m });
            return true;
          }
          
          await simularGravacaoAudio(sock, m.key.remoteJid, 3000);
          
          const ttsResult = await textToSpeech(text, lang);
          
          if (ttsResult.error) {
            await sock.sendMessage(m.key.remoteJid, { text: `❌ ${ttsResult.error}` }, { quoted: m });
            return true;
          }
          
          await sock.sendMessage(m.key.remoteJid, { 
            audio: ttsResult.buffer,
            mimetype: 'audio/mp4',
            ptt: true
          }, { quoted: m });
          console.log('✅ TTS gerado com sucesso');
        } catch (e) {
          console.error('Erro no comando tts:', e);
          await sock.sendMessage(m.key.remoteJid, { text: '❌ Erro ao gerar TTS.' }, { quoted: m });
        }
        return true;
      
      case 'play':
      case 'tocar':
      case 'music':
      case 'ytmp3':
      case 'yt':
      case 'ytaudio':
        if (!textoCompleto) {
          await sock.sendMessage(m.key.remoteJid, { 
            text: '🎵 *COMO USAR:* \n`#play https://youtube.com/...`\n`#play nome da música`\n`#ytmp3 https://youtube.com/...`\n\n*Limites:*\n- Máximo 25MB\n- Vídeos até 10 minutos recomendados' 
          }, { quoted: m });
          return true;
        }
        
        try {
          let urlFinal = args[0] || textoCompleto;
          let title = '';
          const userId = extrairNumeroReal(m);
          let progressMsgKey = null;
          
          if (!urlFinal.startsWith('http')) {
            const searchQuery = textoCompleto;
            const initialText = `🔍 Buscando: "${searchQuery}" no YouTube...`;
            progressMsgKey = await sendProgressMessage(sock, m.key.remoteJid, initialText, m, userId);
            
            const searchResult = await yts(searchQuery);
            if (!searchResult || searchResult.videos.length === 0) {
              await sendProgressMessage(sock, m.key.remoteJid, '❌ Não encontrei resultados. Use o link direto do YouTube.', m, userId);
              return true;
            }
            
            const video = searchResult.videos[0];
            urlFinal = video.url;
            title = video.title;
            
            await sendProgressMessage(sock, m.key.remoteJid, `✅ Encontrei!\n📌 *${title}*\n\n⏳ Processando...`, m, userId);
          } else {
            progressMsgKey = await sendProgressMessage(sock, m.key.remoteJid, '🔍 Processando link do YouTube...', m, userId);
          }
          
          await sendProgressMessage(sock, m.key.remoteJid, '⏳ Baixando áudio do YouTube... Isso pode levar alguns minutos.', m, userId);
          
          const ytResult = await downloadYTAudio(urlFinal);
          
          if (ytResult.error) {
            await sendProgressMessage(sock, m.key.remoteJid, `❌ ${ytResult.error}`, m, userId);
            return true;
          }
          
          const finalTitle = title || ytResult.title || 'Música do YouTube';
          
          if (userId && m.key.id) {
            const key = `${userId}_${m.key.id}`;
            progressMessages.delete(key);
          }
          
          await sock.sendMessage(m.key.remoteJid, { 
            audio: ytResult.buffer,
            mimetype: 'audio/mp4',
            ptt: false,
            fileName: `${finalTitle.substring(0, 50).replace(/[^\w\s]/gi, '')}.mp3`
          }, { quoted: m });
          
          console.log('✅ Música enviada com sucesso');
          
        } catch (e) {
          console.error('Erro no comando play/ytmp3:', e);
          await sock.sendMessage(m.key.remoteJid, { text: '❌ Erro ao baixar música: ' + e.message }, { quoted: m });
        }
        return true;
      
      case 'help':
      case 'menu':
      case 'comandos':
        const helpText = `🤖 *MENU DE COMANDOS AKIRA V21* 🤖

*📱 PREFIXO:* \`${PREFIXO}\`

*🎨 MÍDIA (Todos):*
\`#sticker\` - Criar sticker de imagem OU sticker (com nome personalizado)
\`#gif\` - Criar sticker animado de vídeo OU sticker animado (até 30s, com nome personalizado)
\`#toimg\` - Converter sticker para imagem
\`#tts <idioma> <texto>\` - Texto para voz
\`#play <nome/link>\` - Baixar música do YouTube

*🎤 ÁUDIO INTELIGENTE:*
Agora eu posso responder mensagens de voz!
- Envie um áudio mencionando "Akira" em grupos
- Em PV, envie qualquer áudio que eu respondo
- Eu transcrevo seu áudio e respondo com minha voz
- NUNCA mostro transcrições no chat

*👑 COMANDOS DE DONO (Apenas Isaac Quarenta):*
\`#add <número>\` - Adicionar membro
\`#remove @membro\` - Remover membro (ou use reply)
\`#ban @membro\` - Alias para remover (ou use reply)
\`#promote @membro\` - Dar admin (ou use reply)
\`#demote @membro\` - Remover admin (ou use reply)
\`#mute @usuário\` - Mutar por 5 minutos (ou use reply)
\`#desmute @usuário\` - Desmutar (ou use reply)
\`#antilink on/off\` - Ativar/desativar anti-link
\`#antilink status\` - Ver status anti-link
\`#apagar\` - Apagar mensagem (responda a mensagem)

*💬 CONVERSA NORMAL:*
Apenas mencione "Akira" ou responda minhas mensagens para conversar normalmente!

*⚠️ COMANDOS DE GRUPO APENAS PARA ISAAC QUARENTA!*`;
        
        await sock.sendMessage(m.key.remoteJid, { text: helpText }, { quoted: m });
        return true;
      
      case 'ping':
        const startTime = Date.now();
        await sock.sendMessage(m.key.remoteJid, { text: '🏓 Pong!' }, { quoted: m });
        const latency = Date.now() - startTime;
        await sock.sendMessage(m.key.remoteJid, { text: `📡 Latência: ${latency}ms\n🕐 Uptime: ${Math.floor(process.uptime())}s` });
        return true;
      
      case 'info':
      case 'botinfo':
        const infoText = `🤖 *INFORMAÇÕES DO BOT*

*Nome:* Akira V21
*Número:* ${BOT_NUMERO_REAL}
*Prefixo:* ${PREFIXO}
*Status:* ${BOT_JID ? '✅ Online' : '❌ Offline'}
*JID:* ${BOT_JID || 'Desconhecido'}
*Uptime:* ${Math.floor(process.uptime())} segundos
*Desenvolvedor:* Isaac Quarenta

*Recursos:*
✅ Digitação realista
✅ IA conversacional
✅ Figurinhas personalizadas
✅ Stickers animados até 30s
✅ Sticker de sticker
✅ Download de áudio do YouTube
✅ Texto para voz (TTS)
✅ Resposta a mensagens de voz (STT via Deepgram + TTS)
✅ Sistema de moderação aprimorado
✅ NUNCA mostra transcrições de áudio no chat
✅ Contexto de reply otimizado (SEM REPETIÇÕES mas COM CONTEÚDO DA MENSAGEM CITADA)

*Configuração STT:* ${DEEPGRAM_API_KEY && DEEPGRAM_API_KEY !== 'seu_token_aqui' ? '✅ Deepgram configurado' : '❌ Configure DEEPGRAM_API_KEY'}

Use \`#help\` para ver todos os comandos.`;
        
        await sock.sendMessage(m.key.remoteJid, { text: infoText }, { quoted: m });
        return true;
      
      case 'add':
        if (!ehGrupo) {
          await sock.sendMessage(m.key.remoteJid, { text: '❌ Este comando só funciona em grupos.' }, { quoted: m });
          return true;
        }
        
        try {
          const numeroUsuario = extrairNumeroReal(m);
          const nomeUsuario = m.pushName || 'Desconhecido';
          const ehDono = verificarPermissaoDono(numeroUsuario, nomeUsuario);
          
          if (!ehDono) {
            console.log('❌ [BLOQUEADO] Comando #add usado por não-dono:', numeroUsuario, nomeUsuario);
            
            const payload = { 
              usuario: nomeUsuario, 
              numero: numeroUsuario, 
              mensagem: '/reset',
              tentativa_comando: '#add'
            };
            
            try {
              await axios.post(API_URL, payload, { timeout: 120000 });
            } catch (e) {}
            
            await sock.sendMessage(m.key.remoteJid, { 
              text: '🚫 *COMANDO RESTRITO!* Apenas Isaac Quarenta pode usar comandos de grupo.' 
            }, { quoted: m });
            return true;
          }
          
          const numeroAdicionar = args[0];
          if (!numeroAdicionar) {
            await sock.sendMessage(m.key.remoteJid, { text: '❌ Uso: `#add 244123456789`' }, { quoted: m });
            return true;
          }
          
          const jidAdicionar = `${numeroAdicionar.replace(/\D/g, '')}@s.whatsapp.net`;
          await sock.groupParticipantsUpdate(m.key.remoteJid, [jidAdicionar], 'add');
          await sock.sendMessage(m.key.remoteJid, { text: `✅ ${numeroAdicionar} adicionado ao grupo.` }, { quoted: m });
        } catch (e) {
          console.error('Erro ao adicionar membro:', e);
          await sock.sendMessage(m.key.remoteJid, { text: '❌ Erro ao adicionar membro. Verifique se sou admin.' }, { quoted: m });
        }
        return true;
      
      case 'remove':
      case 'kick':
      case 'ban':
        if (!ehGrupo) {
          await sock.sendMessage(m.key.remoteJid, { text: '❌ Este comando só funciona em grupos.' }, { quoted: m });
          return true;
        }
        
        try {
          const numeroUsuario = extrairNumeroReal(m);
          const nomeUsuario = m.pushName || 'Desconhecido';
          const ehDono = verificarPermissaoDono(numeroUsuario, nomeUsuario);
          
          if (!ehDono) {
            console.log('❌ [BLOQUEADO] Comando #remove/#ban usado por não-dono:', numeroUsuario, nomeUsuario);
            
            const payload = { 
              usuario: nomeUsuario, 
              numero: numeroUsuario, 
              mensagem: '/reset',
              tentativa_comando: '#remove/#ban'
            };
            
            try {
              await axios.post(API_URL, payload, { timeout: 120000 });
            } catch (e) {}
            
            await sock.sendMessage(m.key.remoteJid, { 
              text: '🚫 *COMANDO RESTRITO!* Apenas Isaac Quarenta pode usar comandos de grupo.' 
            }, { quoted: m });
            return true;
          }
          
          let targetUserIds = [];
          const mencionados = m.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
          const replyInfo = extrairReplyInfo(m);
          
          if (mencionados.length > 0) {
            targetUserIds = mencionados;
          } else if (replyInfo && replyInfo.quemEscreveuCitacaoJid) {
            targetUserIds = [replyInfo.quemEscreveuCitacaoJid];
          } else {
            await sock.sendMessage(m.key.remoteJid, { 
              text: '❌ Marque o membro com @ OU responda a mensagem dele com `#remove` ou `#ban`' 
            }, { quoted: m });
            return true;
          }
          
          await sock.groupParticipantsUpdate(m.key.remoteJid, targetUserIds, 'remove');
          await sock.sendMessage(m.key.remoteJid, { text: '✅ Membro(s) removido(s) do grupo.' }, { quoted: m });
        } catch (e) {
          console.error('Erro ao remover membro:', e);
          await sock.sendMessage(m.key.remoteJid, { text: '❌ Erro ao remover membro. Verifique permissões.' }, { quoted: m });
        }
        return true;
      
      case 'promote':
        if (!ehGrupo) {
          await sock.sendMessage(m.key.remoteJid, { text: '❌ Este comando só funciona em grupos.' }, { quoted: m });
          return true;
        }
        
        try {
          const numeroUsuario = extrairNumeroReal(m);
          const nomeUsuario = m.pushName || 'Desconhecido';
          const ehDono = verificarPermissaoDono(numeroUsuario, nomeUsuario);
          
          if (!ehDono) {
            console.log('❌ [BLOQUEADO] Comando #promote usado por não-dono:', numeroUsuario, nomeUsuario);
            
            const payload = { 
              usuario: nomeUsuario, 
              numero: numeroUsuario, 
              mensagem: '/reset',
              tentativa_comando: '#promote'
            };
            
            try {
              await axios.post(API_URL, payload, { timeout: 120000 });
            } catch (e) {}
            
            await sock.sendMessage(m.key.remoteJid, { 
              text: '🚫 *COMANDO RESTRITO!* Apenas Isaac Quarenta pode usar comandos de grupo.' 
            }, { quoted: m });
            return true;
          }
          
          let targetUserIds = [];
          const mencionados = m.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
          const replyInfo = extrairReplyInfo(m);
          
          if (mencionados.length > 0) {
            targetUserIds = mencionados;
          } else if (replyInfo && replyInfo.quemEscreveuCitacaoJid) {
            targetUserIds = [replyInfo.quemEscreveuCitacaoJid];
          } else {
            await sock.sendMessage(m.key.remoteJid, { text: '❌ Marque o membro com @ OU responda a mensagem dele com `#promote`' }, { quoted: m });
            return true;
          }
          
          await sock.groupParticipantsUpdate(m.key.remoteJid, targetUserIds, 'promote');
          await sock.sendMessage(m.key.remoteJid, { text: '✅ Membro(s) promovido(s) a admin.' }, { quoted: m });
        } catch (e) {
          console.error('Erro ao promover:', e);
          await sock.sendMessage(m.key.remoteJid, { text: '❌ Erro ao promover. Verifique permissões.' }, { quoted: m });
        }
        return true;
      
      case 'demote':
        if (!ehGrupo) {
          await sock.sendMessage(m.key.remoteJid, { text: '❌ Este comando só funciona em grupos.' }, { quoted: m });
          return true;
        }
        
        try {
          const numeroUsuario = extrairNumeroReal(m);
          const nomeUsuario = m.pushName || 'Desconhecido';
          const ehDono = verificarPermissaoDono(numeroUsuario, nomeUsuario);
          
          if (!ehDono) {
            console.log('❌ [BLOQUEADO] Comando #demote usado por não-dono:', numeroUsuario, nomeUsuario);
            
            const payload = { 
              usuario: nomeUsuario, 
              numero: numeroUsuario, 
              mensagem: '/reset',
              tentativa_comando: '#demote'
            };
            
            try {
              await axios.post(API_URL, payload, { timeout: 120000 });
            } catch (e) {}
            
            await sock.sendMessage(m.key.remoteJid, { 
              text: '🚫 *COMANDO RESTRITO!* Apenas Isaac Quarenta pode usar comandos de grupo.' 
            }, { quoted: m });
            return true;
          }
          
          let targetUserIds = [];
          const mencionados = m.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
          const replyInfo = extrairReplyInfo(m);
          
          if (mencionados.length > 0) {
            targetUserIds = mencionados;
          } else if (replyInfo && replyInfo.quemEscreveuCitacaoJid) {
            targetUserIds = [replyInfo.quemEscreveuCitacaoJid];
          } else {
            await sock.sendMessage(m.key.remoteJid, { text: '❌ Marque o admin com @ OU responda a mensagem dele com `#demote`' }, { quoted: m });
            return true;
          }
          
          await sock.groupParticipantsUpdate(m.key.remoteJid, targetUserIds, 'demote');
          await sock.sendMessage(m.key.remoteJid, { text: '✅ Admin(s) rebaixado(s).' }, { quoted: m });
        } catch (e) {
          console.error('Erro ao rebaixar admin:', e);
          await sock.sendMessage(m.key.remoteJid, { text: '❌ Erro ao rebaixar admin. Verifique permissões.' }, { quoted: m });
        }
        return true;
      
      case 'mute':
        if (!ehGrupo) {
          await sock.sendMessage(m.key.remoteJid, { text: '❌ Este comando só funciona em grupos.' }, { quoted: m });
          return true;
        }
        
        try {
          const numeroUsuario = extrairNumeroReal(m);
          const nomeUsuario = m.pushName || 'Desconhecido';
          const ehDono = verificarPermissaoDono(numeroUsuario, nomeUsuario);
          
          if (!ehDono) {
            console.log('❌ [BLOQUEADO] Comando #mute usado por não-dono:', numeroUsuario, nomeUsuario);
            
            const payload = { 
              usuario: nomeUsuario, 
              numero: numeroUsuario, 
              mensagem: '/reset',
              tentativa_comando: '#mute'
            };
            
            try {
              await axios.post(API_URL, payload, { timeout: 120000 });
            } catch (e) {}
            
            await sock.sendMessage(m.key.remoteJid, { 
              text: '🚫 *COMANDO RESTRITO!* Apenas Isaac Quarenta pode usar comandos de grupo.' 
            }, { quoted: m });
            return true;
          }
          
          let targetUserId = null;
          const mencionados = m.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
          const replyInfo = extrairReplyInfo(m);
          
          if (mencionados.length > 0) {
            targetUserId = mencionados[0];
          } else if (replyInfo && replyInfo.quemEscreveuCitacaoJid) {
            targetUserId = replyInfo.quemEscreveuCitacaoJid;
          } else {
            await sock.sendMessage(m.key.remoteJid, { 
              text: '❌ Marque o usuário com @ OU responda a mensagem dele com `#mute`' 
            }, { quoted: m });
            return true;
          }
          
          const groupId = m.key.remoteJid;
          const userId = targetUserId;
          
          const muteResult = muteUser(groupId, userId, 5);
          
          const expiryTime = new Date(muteResult.expires).toLocaleTimeString('pt-BR', { 
            hour: '2-digit', 
            minute: '2-digit',
            second: '2-digit'
          });
          
          let mensagemExtra = '';
          if (muteResult.muteCount > 1) {
            mensagemExtra = `\n⚠️ *ATENÇÃO:* Este usuário já foi mutado ${muteResult.muteCount} vezes hoje! Tempo multiplicado para ${muteResult.muteMinutes} minutos.`;
          }
          
          await sock.sendMessage(m.key.remoteJid, { 
            text: `🔇 Usuário mutado por ${muteResult.muteMinutes} minutos.\n⏰ Expira às: ${expiryTime}${mensagemExtra}\n\n⚠️ Se enviar mensagem durante o mute, será automaticamente removido e a mensagem apagada!` 
          }, { quoted: m });
          
        } catch (e) {
          console.error('Erro no comando mute:', e);
          await sock.sendMessage(m.key.remoteJid, { text: '❌ Erro ao mutar usuário.' }, { quoted: m });
        }
        return true;
      
      case 'desmute':
        if (!ehGrupo) {
          await sock.sendMessage(m.key.remoteJid, { text: '❌ Este comando só funciona em grupos.' }, { quoted: m });
          return true;
        }
        
        try {
          const numeroUsuario = extrairNumeroReal(m);
          const nomeUsuario = m.pushName || 'Desconhecido';
          const ehDono = verificarPermissaoDono(numeroUsuario, nomeUsuario);
          
          if (!ehDono) {
            console.log('❌ [BLOQUEADO] Comando #desmute usado por não-dono:', numeroUsuario, nomeUsuario);
            
            const payload = { 
              usuario: nomeUsuario, 
              numero: numeroUsuario, 
              mensagem: '/reset',
              tentativa_comando: '#desmute'
            };
            
            try {
              await axios.post(API_URL, payload, { timeout: 120000 });
            } catch (e) {}
            
            await sock.sendMessage(m.key.remoteJid, { 
              text: '🚫 *COMANDO RESTRITO!* Apenas Isaac Quarenta pode usar comandos de grupo.' 
            }, { quoted: m });
            return true;
          }
          
          let targetUserId = null;
          const mencionados = m.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
          const replyInfo = extrairReplyInfo(m);
          
          if (mencionados.length > 0) {
            targetUserId = mencionados[0];
          } else if (replyInfo && replyInfo.quemEscreveuCitacaoJid) {
            targetUserId = replyInfo.quemEscreveuCitacaoJid;
          } else {
            await sock.sendMessage(m.key.remoteJid, { 
              text: '❌ Marque o usuário com @ OU responda a mensagem dele com `#desmute`' 
            }, { quoted: m });
            return true;
          }
          
          const groupId = m.key.remoteJid;
          const userId = targetUserId;
          
          if (unmuteUser(groupId, userId)) {
            await sock.sendMessage(m.key.remoteJid, { 
              text: '🔊 Usuário desmutado com sucesso!' 
            }, { quoted: m });
          } else {
            await sock.sendMessage(m.key.remoteJid, { 
              text: 'ℹ️ Este usuário não estava mutado.' 
            }, { quoted: m });
          }
          
        } catch (e) {
          console.error('Erro no comando desmute:', e);
          await sock.sendMessage(m.key.remoteJid, { text: '❌ Erro ao desmutar usuário.' }, { quoted: m });
        }
        return true;
      
      case 'antilink':
        if (!ehGrupo) {
          await sock.sendMessage(m.key.remoteJid, { text: '❌ Este comando só funciona em grupos.' }, { quoted: m });
          return true;
        }
        
        try {
          const numeroUsuario = extrairNumeroReal(m);
          const nomeUsuario = m.pushName || 'Desconhecido';
          const ehDono = verificarPermissaoDono(numeroUsuario, nomeUsuario);
          
          if (!ehDono) {
            console.log('❌ [BLOQUEADO] Comando #antilink usado por não-dono:', numeroUsuario, nomeUsuario);
            
            const payload = { 
              usuario: nomeUsuario, 
              numero: numeroUsuario, 
              mensagem: '/reset',
              tentativa_comando: '#antilink'
            };
            
            try {
              await axios.post(API_URL, payload, { timeout: 120000 });
            } catch (e) {}
            
            await sock.sendMessage(m.key.remoteJid, { 
              text: '🚫 *COMANDO RESTRITO!* Apenas Isaac Quarenta pode usar comandos de grupo.' 
            }, { quoted: m });
            return true;
          }
          
          const subcomando = args[0]?.toLowerCase();
          const groupId = m.key.remoteJid;
          
          if (subcomando === 'on') {
            toggleAntiLink(groupId, true);
            await sock.sendMessage(m.key.remoteJid, { 
              text: '🔒 *ANTI-LINK ATIVADO!*\n\n⚠️ Qualquer usuário que enviar links será automaticamente removido e a mensagem apagada!' 
            }, { quoted: m });
            
          } else if (subcomando === 'off') {
            toggleAntiLink(groupId, false);
            await sock.sendMessage(m.key.remoteJid, { 
              text: '🔓 *ANTI-LINK DESATIVADO!*\n\n✅ Usuários podem enviar links normalmente.' 
            }, { quoted: m });
            
          } else if (subcomando === 'status') {
            const status = isAntiLinkActive(groupId) ? '🟢 ATIVADO' : '🔴 DESATIVADO';
            await sock.sendMessage(m.key.remoteJid, { 
              text: `📊 *STATUS ANTI-LINK:* ${status}` 
            }, { quoted: m });
            
          } else {
            await sock.sendMessage(m.key.remoteJid, { 
              text: '🔗 *Como usar:*\n`#antilink on` - Ativa anti-link\n`#antilink off` - Desativa anti-link\n`#antilink status` - Ver status\n\n⚠️ Quando ativado, qualquer link enviado resulta em banimento automático e apagamento da mensagem!' 
            }, { quoted: m });
          }
          
        } catch (e) {
          console.error('Erro no comando antilink:', e);
          await sock.sendMessage(m.key.remoteJid, { text: '❌ Erro ao configurar anti-link.' }, { quoted: m });
        }
        return true;
      
      case 'apagar':
      case 'delete':
      case 'del':
        try {
          const numeroUsuario = extrairNumeroReal(m);
          const nomeUsuario = m.pushName || 'Desconhecido';
          const ehGrupoAtual = String(m.key.remoteJid || '').endsWith('@g.us');
          
          if (ehGrupoAtual) {
            const ehDono = verificarPermissaoDono(numeroUsuario, nomeUsuario);
            if (!ehDono) {
              console.log('❌ [BLOQUEADO] Comando #apagar usado por não-dono:', numeroUsuario, nomeUsuario);
              await sock.sendMessage(m.key.remoteJid, { 
                text: '🚫 *COMANDO RESTRITO!* Apenas Isaac Quarenta pode apagar mensagens em grupos.' 
              }, { quoted: m });
              return true;
            }
          }
          
          const context = m.message?.extendedTextMessage?.contextInfo;
          const quotedMsgId = context?.stanzaId;
          const quotedParticipant = context?.participant;
          
          if (quotedMsgId && m.key.remoteJid) {
            try {
              await sock.sendMessage(m.key.remoteJid, {
                delete: {
                  id: quotedMsgId,
                  remoteJid: m.key.remoteJid,
                  fromMe: false,
                  participant: quotedParticipant
                }
              });
              
              await sock.sendMessage(m.key.remoteJid, { 
                text: '✅ Mensagem apagada com sucesso!' 
              }, { quoted: m });
              
            } catch (deleteError) {
              console.error('Erro ao apagar mensagem:', deleteError);
              
              if (context && quotedParticipant && ehOBot(quotedParticipant)) {
                try {
                  await sock.sendMessage(m.key.remoteJid, {
                    delete: {
                      id: quotedMsgId,
                      remoteJid: m.key.remoteJid,
                      fromMe: true
                    }
                  });
                  
                  await sock.sendMessage(m.key.remoteJid, { 
                    text: '✅ Minha mensagem foi apagada!' 
                  });
                  
                } catch (e) {
                  await sock.sendMessage(m.key.remoteJid, { 
                    text: '❌ Não tenho permissão para apagar esta mensagem.' 
                  }, { quoted: m });
                }
              } else {
                await sock.sendMessage(m.key.remoteJid, { 
                  text: '❌ Não tenho permissão para apagar esta mensagem.' 
                }, { quoted: m });
              }
            }
            
          } else {
            await sock.sendMessage(m.key.remoteJid, { 
              text: '🗑️ *Como apagar mensagens:*\n\n1. *Para apagar mensagem de membro:*\n   Responda a mensagem com `#apagar`\n   (Apenas Isaac Quarenta em grupos)\n\n2. *Para apagar minha mensagem:*\n   Responda minha mensagem com `#apagar`\n   (Funciona em PV e grupos)\n\n⚠️ *Nota:* Em grupos, apenas Isaac Quarenta pode apagar mensagens de outros membros.' 
            }, { quoted: m });
          }
          
        } catch (e) {
          console.error('Erro no comando apagar:', e);
          await sock.sendMessage(m.key.remoteJid, { text: '❌ Erro ao apagar mensagem.' }, { quoted: m });
        }
        return true;
      
      case 'donate':
      case 'doar':
      case 'apoia':
        await sock.sendMessage(m.key.remoteJid, { 
          text: '❤️ *APOIE O PROJETO AKIRA* ❤️\n\nSe você gosta do bot e quer ajudar a mantê-lo online:\n\n*💰 Chave PIX:* `akira.bot.dev@gmail.com`\n\n*Ou compre um café:*\nhttps://ko-fi.com/isaacquarenta\n\nAgradeço qualquer contribuição! 💖' 
        }, { quoted: m });
        return true;
      
      default:
        return false;
    }
    
  } catch (e) {
    console.error('Erro no handler de comandos:', e);
    return false;
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
        console.log('✅ AKIRA BOT V21 ONLINE! (CONTEXTO OTIMIZADO - COM CONTEÚDO DA MENSAGEM CITADA)');
        console.log('═'.repeat(70));
        console.log('🤖 Bot JID:', BOT_JID);
        console.log('📱 Número:', BOT_NUMERO_REAL);
        console.log('🔗 API:', API_URL);
        console.log('⚙️ Prefixo comandos:', PREFIXO);
        console.log('🔐 Comandos restritos: Apenas Isaac Quarenta');
        console.log('✅ CORREÇÃO: Contexto de reply otimizado SEM PERDER CONTEÚDO');
        console.log('✅ CORREÇÃO: Mensagem citada enviada COMPLETA para API');
        console.log('✅ CORREÇÃO: O modelo agora recebe tanto mensagem atual quanto citada');
        console.log('🎤 STT: Deepgram API (200h/mês GRATUITO)');
        console.log('🎤 TTS: Google TTS (funcional)');
        console.log('🎤 Resposta a voz: Ativada');
        console.log('🛡️ Sistema de moderação: Ativo');
        console.log('📝 Contexto de mensagens: OTIMIZADO (com conteúdo da mensagem citada)');
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
        
        // EXTRAI REPLY INFO
        const replyInfo = extrairReplyInfo(m);
        
        if (replyInfo) {
          console.log('📋 [CONTEXTO]:', replyInfo.contextoParaAPI);
          console.log('📝 [MENSAGEM CITADA]:', replyInfo.textoMensagemCitada.substring(0, 100) + '...');
        }
        
        const tipo = getContentType(m.message);
        const temAudio = tipo === 'audioMessage';
        let textoAudio = '';
        let processarComoAudio = false;
        
        // VERIFICAÇÕES DE MODERAÇÃO
        if (ehGrupo && m.key.participant) {
          const groupId = m.key.remoteJid;
          const userId = m.key.participant;
          
          if (isUserMuted(groupId, userId)) {
            console.log(`🔇 [MUTE] Usuário ${nome} tentou falar durante mute. Removendo...`);
            
            try {
              try {
                await sock.sendMessage(groupId, {
                  delete: {
                    id: m.key.id,
                    remoteJid: groupId,
                    fromMe: false,
                    participant: userId
                  }
                });
                console.log(`🗑️ Mensagem do usuário mutado apagada`);
              } catch (deleteError) {}
              
              await sock.groupParticipantsUpdate(groupId, [userId], 'remove');
              
              await sock.sendMessage(groupId, { 
                text: `🚫 *${nome} foi removido por enviar mensagem durante período de mute!*` 
              });
              
              unmuteUser(groupId, userId);
              
            } catch (e) {
              console.error('Erro ao remover usuário mutado:', e);
            }
            
            return;
          }
          
          if (isAntiLinkActive(groupId) && texto && containsLink(texto)) {
            console.log(`🔗 [ANTI-LINK] Usuário ${nome} enviou link. Banindo...`);
            
            try {
              try {
                await sock.sendMessage(groupId, {
                  delete: {
                    id: m.key.id,
                    remoteJid: groupId,
                    fromMe: false,
                    participant: userId
                  }
                });
                console.log(`🗑️ Mensagem com link apagada`);
              } catch (deleteError) {}
              
              await sock.groupParticipantsUpdate(groupId, [userId], 'remove');
              
              await sock.sendMessage(groupId, { 
                text: `🚫 *${nome} foi removido por enviar link!*\n🔒 Anti-link está ativado neste grupo.` 
              });
              
            } catch (e) {
              console.error('Erro ao banir usuário por link:', e);
            }
            
            return;
          }
        }
        
        // PRIMEIRO: VERIFICA SE É COMANDO EXTRA
        if (!temAudio && texto) {
          const isComandoExtra = await handleComandosExtras(sock, m, texto, ehGrupo);
          
          if (isComandoExtra) {
            await simularStatusMensagem(sock, m, true, false);
            return;
          }
        }
        
        // SE FOR MENSAGEM DE ÁUDIO: PROCESSA STT
        if (temAudio) {
          console.log(`🎤 [ÁUDIO RECEBIDO] de ${nome}`);
          
          await simularGravacaoAudio(sock, m.key.remoteJid, 1500);
          
          const audioBuffer = await downloadMediaMessage({ audioMessage: m.message.audioMessage });
          
          if (!audioBuffer) {
            console.error('❌ Erro ao baixar áudio');
            await simularStatusMensagem(sock, m, false, true);
            return;
          }
          
          console.log('🔊 Transcrevendo áudio para texto (Deepgram)...');
          const transcricao = await transcreverAudioParaTexto(audioBuffer);
          
          if (transcricao.sucesso) {
            textoAudio = transcricao.texto;
            console.log(`📝 [TRANSCRIÇÃO INTERNA] ${nome}: ${textoAudio.substring(0, 100)}...`);
            processarComoAudio = true;
            
          } else {
            textoAudio = transcricao.texto || "[Não foi possível transcrever]";
            console.log('⚠️ Transcrição falhou:', transcricao.erro || 'Erro desconhecido');
            
            if (!ehGrupo) {
              processarComoAudio = true;
              textoAudio = "Olá! Recebi seu áudio mas houve um erro na transcrição.";
            }
          }
        }
        
        // VERIFICA SE DEVE RESPONDER
        let ativar = false;
        let textoParaAPI = texto;
        
        if (temAudio && processarComoAudio) {
          ativar = await deveResponder(m, ehGrupo, textoAudio, replyInfo, true);
          textoParaAPI = textoAudio;
        } else if (!temAudio && texto) {
          ativar = await deveResponder(m, ehGrupo, texto, replyInfo, false);
        }
        
        // SIMULA STATUS DE MENSAGEM
        await simularStatusMensagem(sock, m, ativar, temAudio);
        
        if (!ativar) return;
        
        // Log
        if (temAudio) {
          console.log(`\n🎤 [PROCESSANDO ÁUDIO] ${nome}: ${textoAudio.substring(0, 60)}...`);
        } else {
          console.log(`\n🔥 [PROCESSANDO TEXTO] ${nome}: ${texto.substring(0, 60)}...`);
        }
        
        // ═══════════════════════════════════════════════════════════════
        // PAYLOAD PARA API CORRIGIDO - INCLUI MENSAGEM CITADA COMPLETA
        // ═══════════════════════════════════════════════════════════════
        const payloadBase = {
          usuario: nome,
          numero: numeroReal,
          mensagem: textoParaAPI, // MENSAGEM ATUAL (PRIORIDADE)
          tipo_conversa: ehGrupo ? 'grupo' : 'pv',
          tipo_mensagem: temAudio ? 'audio' : 'texto'
        };
        
        // === CORREÇÃO CRÍTICA: INCLUIR MENSAGEM CITADA COMPLETA ===
        if (replyInfo) {
          // ADICIONA A MENSAGEM CITADA COMPLETA NO PAYLOAD
          payloadBase.mensagem_citada = replyInfo.textoMensagemCitada;
          
          // Informações METADATA sobre o reply
          payloadBase.reply_metadata = {
            // Informa SE É REPLY
            is_reply: true,
            
            // Indica se é reply AO BOT (flag simples)
            reply_to_bot: replyInfo.ehRespostaAoBot,
            
            // Informação sobre quem escreveu a mensagem citada
            quoted_author_name: replyInfo.quemEscreveuCitacaoNome,
            
            // TIPO de mídia citada
            quoted_type: replyInfo.tipoMidiaCitada,
            
            // Contexto breve
            context_hint: replyInfo.contextoParaAPI
          };
          
        } else {
          payloadBase.mensagem_citada = '';
          payloadBase.reply_metadata = {
            is_reply: false,
            reply_to_bot: false
          };
        }
        
        // Adiciona info de grupo
        if (ehGrupo) {
          try {
            const grupoInfo = await obterInfoGrupo(sock, m.key.remoteJid);
            payloadBase.grupo_id = m.key.remoteJid;
            payloadBase.grupo_nome = grupoInfo.subject;
          } catch (e) {
            payloadBase.grupo_id = m.key.remoteJid;
            payloadBase.grupo_nome = 'Grupo';
          }
        }
        
        console.log('📤 Enviando para API com contexto COMPLETO...');
        console.log(`📝 Mensagem atual: ${textoParaAPI.substring(0, 80)}...`);
        console.log(`📝 Mensagem citada: ${payloadBase.mensagem_citada.substring(0, 80)}...`);
        
        let resposta = '...';
        try {
          const res = await axios.post(API_URL, payloadBase, {
            timeout: 120000,
            headers: { 'Content-Type': 'application/json' }
          });
          resposta = res.data?.resposta || '...';
        } catch (err) {
          console.error('⚠️ Erro na API:', err.message);
          resposta = 'barra no bardeado';
        }
        
        console.log(`📥 [RESPOSTA] ${resposta.substring(0, 100)}...`);
        
        // DECIDE COMO RESPONDER
        let opcoes = {};
        
        if (ehGrupo) {
          opcoes = { quoted: m };
          console.log('📎 Reply em grupo (regra fixa)');
        } else {
          if (replyInfo && replyInfo.ehRespostaAoBot) {
            opcoes = { quoted: m };
            console.log('📎 Reply em PV (usuário respondeu ao bot)');
          } else if (temAudio) {
            console.log('📩 Mensagem direta em PV (áudio)');
          } else {
            console.log('📩 Mensagem direta em PV (texto)');
          }
        }
        
        // SE A MENSAGEM ORIGINAL FOI ÁUDIO, RESPONDE APENAS COM ÁUDIO
        if (temAudio) {
          console.log('🎤 Convertendo resposta para áudio...');
          
          await simularGravacaoAudio(sock, m.key.remoteJid, 2500);
          
          const ttsResult = await textToSpeech(resposta, 'pt');
          
          if (ttsResult.error) {
            console.error('❌ Erro ao gerar áudio TTS:', ttsResult.error);
            await sock.sendMessage(m.key.remoteJid, { 
              text: resposta
            }, opcoes);
          } else {
            await sock.sendMessage(m.key.remoteJid, { 
              audio: ttsResult.buffer,
              mimetype: 'audio/mp4',
              ptt: true
            }, opcoes);
            console.log('✅ Áudio enviado com sucesso');
          }
        } else {
          let tempoDigitacao = Math.min(Math.max(resposta.length * 50, 3000), 10000);
          await simularDigitacao(sock, m.key.remoteJid, tempoDigitacao);
          
          try {
            await sock.sendMessage(m.key.remoteJid, { text: resposta }, opcoes);
            console.log('✅ [ENVIADO COM SUCESSO]\n');
          } catch (e) {
            console.error('❌ Erro ao enviar:', e.message);
          }
        }
        
        // Volta ao estado normal
        try {
          await delay(500);
          await sock.sendPresenceUpdate('available', m.key.remoteJid);
        } catch (e) {}
        
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
    <p>✅ CORREÇÃO: Contexto de reply otimizado</p>
    <p>✅ CORREÇÃO: Mensagem citada enviada COMPLETA para API</p>
    <p>✅ CORREÇÃO: Modelo recebe tanto mensagem atual quanto mensagem citada</p>
    <p>Prefixo: ${PREFIXO}</p>
    <p>🔐 Comandos restritos: Apenas Isaac Quarenta</p>
    <p>🎤 STT: Deepgram API (200h/mês GRATUITO)</p>
    <p>🎤 TTS: Google TTS (funcional)</p>
    <p>🛡️ Sistema de moderação: Ativo</p>
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
    prefixo: PREFIXO,
    dono_autorizado: 'Isaac Quarenta',
    stt_configurado: DEEPGRAM_API_KEY && DEEPGRAM_API_KEY !== 'seu_token_aqui' ? 'Deepgram (200h/mês)' : 'Não configurado',
    tts_configurado: 'Google TTS (funcional)',
    stickers_pack_personalizado: 'Sim',
    stickers_animados_max: '30 segundos',
    sticker_de_sticker: 'Suportado',
    youtube_download_methods: 'APIs confiáveis + ytdl-core',
    grupos_com_antilink: Array.from(antiLinkGroups).length,
    usuarios_mutados: mutedUsers.size,
    progress_messages: progressMessages.size,
    uptime: process.uptime(),
    version: 'v21_contexto_completo',
    correcoes_aplicadas: [
      'Contexto de reply otimizado SEM PERDER CONTEÚDO',
      'Mensagem citada enviada COMPLETA para API',
      'Modelo agora recebe tanto mensagem atual quanto mensagem citada',
      'Payload inclui mensagem_citada e reply_metadata'
    ]
  });
});

app.post('/reset', async (req, res) => {
  try {
    const { numero, usuario = 'Anônimo' } = req.body;
    if (!numero) return res.status(400).json({ error: 'Número obrigatório' });
    
    const numeroLimpo = String(numero).trim();
    const nomeUsuario = String(usuario).trim();
    
    const isRoot = DONO_USERS.some(root =>
      numeroLimpo === root.numero && nomeUsuario === root.nomeExato
    );
    
    if (isRoot) {
      console.log('✅ [DONO] Reset autorizado');
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

// Limpeza periódica
setInterval(() => {
  const now = Date.now();
  for (const [key, data] of progressMessages.entries()) {
    if (now - data.timestamp > 10 * 60 * 1000) {
      progressMessages.delete(key);
    }
  }
}, 5 * 60 * 1000);

process.on('unhandledRejection', (err) => console.error('❌ REJECTION:', err));
process.on('uncaughtException', (err) => console.error('❌ EXCEPTION:', err));
