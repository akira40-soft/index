/**
 * ═══════════════════════════════════════════════════════════════════════
 * AKIRA BOT V21 — DIGITAÇÃO REALISTA + DINÂMICAS WHATSAPP COMPLETAS
 * ═══════════════════════════════════════════════════════════════════════
 * ✅ PV: Sempre marca como lido (✓✓ azul)
 * ✅ GRUPO: Só marca como lido se mencionada/reply
 * ✅ Status: Sempre online → composing → paused
 * ✅ Tempo de digitação proporcional ao tamanho
 * ✅ COMANDOS: sticker, gif (animado), toimg, tts, play, etc.
 * ✅ COMANDOS DE GRUPO: Apenas Isaac Quarenta pode usar
 * ✅ MODERAÇÃO: Mute, anti-link, etc.
 * ✅ STT: Transcrição de áudio via Deepgram (200h/mês GRATUITO) - REAL
 * ✅ TTS: Resposta em áudio via Google TTS (gratuito)
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
const API_URL = process.env.API_URL || 'https://akra35567-akira.hf.space/api/akira';
const BOT_NUMERO_REAL = '37839265886398';
const PREFIXO = '#'; // Prefixo para comandos extras
const TEMP_FOLDER = './temp';
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

// Configuração Deepgram STT (GRATUITO - 200h/mês)
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY || '2700019dc80925c32932ab0aba44d881d20d39f7'; // Crie conta em deepgram.com
const DEEPGRAM_API_URL = 'https://api.deepgram.com/v1/listen';

// USUÁRIOS COM PERMISSÃO DE DONO (APENAS ISAAC QUARENTA)
const DONO_USERS = [
  { numero: '244937035662', nomeExato: 'Isaac Quarenta' },
  { numero: '244978787009', nomeExato: 'Isaac Quarenta' }
];

// Sistema de mute melhorado
const mutedUsers = new Map(); // Map<groupId_userId, {expires: timestamp, type: string, muteCount: number}>
const antiLinkGroups = new Set(); // Set<groupId> - grupos com anti-link ativo

// Contador de mutes por dia
const muteCounts = new Map(); // Map<groupId_userId, {count: number, lastMuteDate: string}>

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
  
  // Incrementa contador de mutes no dia
  const muteCount = incrementMuteCount(groupId, userId);
  
  // Se for mutado mais de uma vez no mesmo dia, multiplica o tempo
  let muteMinutes = minutes;
  if (muteCount > 1) {
    muteMinutes = minutes * Math.pow(2, muteCount - 1); // 5, 10, 20, 40, etc.
    console.log(`⚠️ [MUTE INTENSIFICADO] Usuário ${userId} muteado ${muteCount}x hoje. Tempo: ${muteMinutes} minutos`);
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
    
    // Usa a mesma lógica dos comandos de grupo
    if (key.participant) {
      const participant = String(key.participant);
      if (participant.includes('@s.whatsapp.net')) {
        return participant.split('@')[0];
      }
      if (participant.includes('@lid')) {
        // Remove o :11@lid para obter o número
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
    
    // Se for mensagem de grupo, retorna o participant
    if (key.participant) {
      return key.participant;
    }
    
    // Tenta obter do contexto de reply
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
    
    return '';
  } catch (e) {
    return '';
  }
}

// FUNÇÃO MELHORADA PARA EXTRAIR REPLY INFO
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
    } else if (tipo === 'videoMessage') {
      textoReply = quoted.videoMessage?.caption || '[vídeo]';
    } else if (tipo === 'audioMessage') {
      textoReply = '[áudio]';
    } else {
      textoReply = '[conteúdo]';
    }
    
    const participantJid = context.participant || null;
    const ehRespostaAoBot = ehOBot(participantJid);
    
    // Obter informações do usuário que escreveu a mensagem citada
    let usuarioCitadoNome = 'desconhecido';
    let usuarioCitadoNumero = 'desconhecido';
    
    if (participantJid) {
      try {
        // Tenta obter nome do usuário do store
        const usuario = store?.contacts?.[participantJid] || {};
        usuarioCitadoNome = usuario.name || usuario.notify || participantJid.split('@')[0] || 'desconhecido';
        usuarioCitadoNumero = participantJid.split('@')[0] || 'desconhecido';
      } catch (e) {
        console.error('Erro ao obter info usuário citado:', e);
      }
    }
    
    return {
      texto: textoReply,
      participantJid: participantJid,
      ehRespostaAoBot: ehRespostaAoBot,
      usuarioCitadoNome: usuarioCitadoNome,
      usuarioCitadoNumero: usuarioCitadoNumero
    };
    
  } catch (e) {
    return null;
  }
}

async function deveResponder(m, ehGrupo, texto, replyInfo, temAudio = false) {
  const textoLower = String(texto).toLowerCase();
  const context = m.message?.extendedTextMessage?.contextInfo;
  
  // Se for mensagem de áudio e foi ativado por menção/reply, responde
  if (temAudio) {
    // Em PV sempre responde a áudio
    if (!ehGrupo) return true;
    
    // Em grupo só responde se for mencionada/reply
    if (replyInfo && replyInfo.ehRespostaAoBot) {
      console.log('✅ [ATIVAÇÃO] Reply ao bot detectado em áudio');
      return true;
    }
    
    if (textoLower.includes('akira')) {
      console.log('✅ [ATIVAÇÃO] Menção "akira" detectada em áudio');
      return true;
    }
    
    const mentions = context?.mentionedJid || [];
    const botMencionado = mentions.some(jid => ehOBot(jid));
    
    if (botMencionado) {
      console.log('✅ [ATIVAÇÃO] @mention do bot em áudio');
      return true;
    }
    
    if (BOT_JID_ALTERNATIVO) {
      const jidAltNumero = String(BOT_JID_ALTERNATIVO).split('@')[0].split(':')[0];
      if (textoLower.includes(jidAltNumero)) {
        console.log('✅ [ATIVAÇÃO] Menção ao JID alternativo em áudio');
        return true;
      }
    }
    
    console.log('❌ [IGNORADO] Grupo sem menção/reply ao bot em áudio');
    return false;
  }
  
  // Para mensagens de texto normal
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
      if (textoLower.includes(jidAltNumero)) {
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
// FUNÇÃO PARA MENSAGEM EDITÁVEL
// ═══════════════════════════════════════════════════════════════════════
let progressMessages = new Map(); // Map<userId_messageKey, {key: messageKey, timestamp: number}>

async function sendProgressMessage(sock, jid, text, originalMsg = null, userId = null) {
  try {
    // Se tiver uma mensagem de progresso anterior, edita
    if (originalMsg && userId) {
      const key = `${userId}_${originalMsg.key.id}`;
      const progressData = progressMessages.get(key);
      
      if (progressData && progressData.key) {
        try {
          // Tenta editar a mensagem existente
          await sock.sendMessage(jid, {
            text: text,
            edit: progressData.key
          });
          console.log('✏️ Mensagem de progresso atualizada');
          return progressData.key;
        } catch (e) {
          console.log('⚠️ Não foi possível editar mensagem, enviando nova...');
        }
      }
    }
    
    // Envia nova mensagem
    const sentMsg = await sock.sendMessage(jid, { text: text });
    
    // Salva referência se tiver userId e originalMsg
    if (originalMsg && userId && sentMsg.key) {
      const key = `${userId}_${originalMsg.key.id}`;
      progressMessages.set(key, {
        key: sentMsg.key,
        timestamp: Date.now()
      });
      
      // Limpa após 10 minutos
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
// FUNÇÕES PARA STT (SPEECH TO TEXT) - DEEPGRAM API (GRATUITO - REAL)
// ═══════════════════════════════════════════════════════════════════════
async function transcreverAudioParaTexto(audioBuffer) {
  try {
    console.log('🔊 Iniciando transcrição REAL de áudio (Deepgram)...');
    
    // Salva o áudio em arquivo temporário
    const audioPath = path.join(TEMP_FOLDER, `audio_${Date.now()}.ogg`);
    fs.writeFileSync(audioPath, audioBuffer);
    
    // Converte para formato compatível (MP3)
    const convertedPath = path.join(TEMP_FOLDER, `audio_${Date.now()}.mp3`);
    
    await new Promise((resolve, reject) => {
      ffmpeg(audioPath)
        .toFormat('mp3')
        .audioCodec('libmp3lame')
        .on('end', resolve)
        .on('error', reject)
        .save(convertedPath);
    });
    
    // Lê o arquivo convertido
    const convertedBuffer = fs.readFileSync(convertedPath);
    
    // Verifica se tem API key configurada
    if (!DEEPGRAM_API_KEY || DEEPGRAM_API_KEY === 'seu_token_aqui') {
      console.log('⚠️ API Key do Deepgram não configurada.');
      
      // Limpa arquivos
      try {
        fs.unlinkSync(audioPath);
        fs.unlinkSync(convertedPath);
      } catch (e) {}
      
      return { 
        texto: "Olá! Recebi seu áudio mas preciso que configure o token do Deepgram para transcrição real. Crie conta em deepgram.com (200h/mês grátis).", 
        sucesso: false,
        nota: "Configure DEEPGRAM_API_KEY no .env ou código"
      };
    }
    
    console.log('📤 Enviando para Deepgram API...');
    
    // Faz requisição para Deepgram
    const response = await axios.post(
      DEEPGRAM_API_URL,
      convertedBuffer,
      {
        headers: {
          'Authorization': `Token ${DEEPGRAM_API_KEY}`,
          'Content-Type': 'audio/mpeg'
        },
        params: {
          model: 'nova-2',
          language: 'pt',
          smart_format: true,
          punctuate: true,
          diarize: false,
          numerals: true
        },
        timeout: 30000
      }
    );
    
    // Extrai o texto transcrito
    let textoTranscrito = '';
    if (response.data && response.data.results && response.data.results.channels) {
      const transcription = response.data.results.channels[0].alternatives[0].transcript;
      textoTranscrito = transcription || '';
    }
    
    textoTranscrito = textoTranscrito.trim();
    
    if (!textoTranscrito || textoTranscrito.length < 2) {
      textoTranscrito = "[Não consegui entender o áudio claramente]";
    }
    
    // Limpa arquivos
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
    
    // Tenta limpar arquivos em caso de erro
    try {
      fs.unlinkSync(audioPath);
      fs.unlinkSync(convertedPath);
    } catch (e) {}
    
    if (error.response) {
      console.error('Detalhes do erro Deepgram:', {
        status: error.response.status,
        data: error.response.data
      });
      
      if (error.response.status === 401) {
        return { 
          texto: "[Erro: Token do Deepgram inválido]", 
          sucesso: false,
          erro: "Token inválido ou expirado"
        };
      }
    }
    
    // Fallback para texto padrão
    return { 
      texto: "Recebi seu áudio mas houve um erro na transcrição. Pode repetir ou digitar?", 
      sucesso: false,
      erro: error.message
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════
// FUNÇÕES PARA COMANDOS EXTRAS (MANTIDAS IGUAIS)
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

async function createSticker(imageBuffer, quotedMsg) {
  try {
    const inputPath = generateRandomFilename('jpg');
    const outputPath = generateRandomFilename('webp');
    
    fs.writeFileSync(inputPath, imageBuffer);
    
    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .outputOptions(['-vcodec libwebp', "-vf scale='min(512,iw)':min'(512,ih)':force_original_aspect_ratio=decrease,fps=15"])
        .on('end', resolve)
        .on('error', reject)
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

async function createAnimatedStickerFromVideo(videoBuffer, quotedMsg) {
  try {
    const inputPath = generateRandomFilename('mp4');
    const outputPath = generateRandomFilename('webp');
    
    fs.writeFileSync(inputPath, videoBuffer);
    
    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .outputOptions([
          '-vcodec libwebp',
          '-vf', 'fps=15,scale=512:512:flags=lanczos',
          '-loop', '0',
          '-lossless', '0',
          '-compression_level', '6',
          '-q:v', '70',
          '-preset', 'default',
          '-an',
          '-t', '7',
          '-y'
        ])
        .on('end', resolve)
        .on('error', reject)
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
    cleanupFile(inputPath);
    cleanupFile(outputPath);
    return { error: 'Erro ao criar sticker animado: ' + e.message };
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

async function searchYouTube(query) {
  try {
    const searchResult = await yts(query);
    if (searchResult.videos.length > 0) {
      return searchResult.videos[0].url;
    }
    return null;
  } catch (e) {
    console.error('Erro na busca YouTube:', e);
    return null;
  }
}

async function downloadYTAudio(url) {
  try {
    if (!ytdl.validateURL(url)) {
      return { error: 'URL do YouTube inválida' };
    }
    
    const info = await ytdl.getInfo(url, {
      requestOptions: {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      }
    });
    
    const audioFormat = ytdl.chooseFormat(info.formats, {
      quality: 'lowestaudio',
      filter: 'audioonly'
    });
    
    if (!audioFormat) {
      return { error: 'Não foi possível encontrar formato de áudio' };
    }
    
    const outputPath = generateRandomFilename('mp3');
    
    await new Promise((resolve, reject) => {
      const stream = ytdl(url, {
        quality: 'lowestaudio',
        filter: 'audioonly',
        requestOptions: {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
          }
        }
      });
      
      const outputStream = fs.createWriteStream(outputPath);
      
      stream.pipe(outputStream);
      
      outputStream.on('finish', resolve);
      outputStream.on('error', reject);
      stream.on('error', reject);
    });
    
    const stats = fs.statSync(outputPath);
    if (stats.size === 0) {
      cleanupFile(outputPath);
      return { error: 'Arquivo de áudio vazio' };
    }
    
    if (stats.size > 25 * 1024 * 1024) {
      cleanupFile(outputPath);
      return { error: 'Arquivo muito grande (>25MB). Não posso enviar via WhatsApp.' };
    }
    
    const audioBuffer = fs.readFileSync(outputPath);
    cleanupFile(outputPath);
    
    return { buffer: audioBuffer, title: info.videoDetails.title };
  } catch (e) {
    console.error('Erro ao baixar áudio do YouTube:', e);
    
    if (e.message.includes('Could not extract functions') || e.message.includes('signature')) {
      return { error: 'YouTube bloqueou o download. Tente outro vídeo ou use o comando mais tarde.' };
    }
    
    return { error: 'Erro ao processar vídeo: ' + e.message };
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
// SIMULAÇÃO DE GRAVAÇÃO DE ÁUDIO (NOVA FUNÇÃO)
// ═══════════════════════════════════════════════════════════════════════
async function simularGravacaoAudio(sock, jid, tempoMs) {
  try {
    console.log(`🎤 [GRAVANDO] Akira está preparando áudio por ${(tempoMs/1000).toFixed(1)}s...`);
    await delay(tempoMs);
    console.log('✅ [PRONTO] Áudio preparado');
  } catch (e) {
    console.error('Erro na simulação de gravação:', e.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// HANDLER DE COMANDOS EXTRAS (MANTIDO EXATAMENTE COMO ESTAVA)
// ═══════════════════════════════════════════════════════════════════════
async function handleComandosExtras(sock, m, texto, ehGrupo) {
  try {
    // Verifica se é um comando com prefixo
    if (!texto.startsWith(PREFIXO)) return false;
    
    // Rate limiting
    const sender = m.key.participant || m.key.remoteJid;
    if (!checkRateLimit(sender)) {
      await sock.sendMessage(m.key.remoteJid, { text: '⏰ Você está usando comandos muito rápido. Aguarde um pouco.' });
      return true;
    }
    
    const args = texto.slice(PREFIXO.length).trim().split(/ +/);
    const comando = args.shift().toLowerCase();
    const textoCompleto = args.join(' ');
    
    console.log(`🔧 [COMANDO] ${comando} de ${sender}`);
    
    // COMANDOS DISPONÍVEIS
    switch (comando) {
      
      // === STICKER (APENAS IMAGENS) ===
      case 'sticker':
      case 's':
      case 'fig':
        try {
          const quoted = m.message?.extendedTextMessage?.contextInfo?.quotedMessage;
          const hasMedia = m.message?.imageMessage || quoted?.imageMessage;
          
          if (!hasMedia) {
            await sock.sendMessage(m.key.remoteJid, { 
              text: '📸 *Como usar:* \n- Envie uma imagem com legenda `#sticker`\n- OU responda uma imagem com `#sticker`\n\n⚠️ *Para vídeos, use `#gif` para criar sticker animado.*' 
            }, { quoted: m });
            return true;
          }
          
          const mediaMessage = quoted?.imageMessage || m.message.imageMessage;
          const mediaBuffer = await downloadMediaMessage({ imageMessage: mediaMessage });
          
          if (!mediaBuffer) {
            await sock.sendMessage(m.key.remoteJid, { text: '❌ Erro ao baixar imagem.' }, { quoted: m });
            return true;
          }
          
          const stickerBuffer = await createSticker(mediaBuffer, m);
          
          if (stickerBuffer) {
            await sock.sendMessage(m.key.remoteJid, { 
              sticker: stickerBuffer 
            }, { quoted: m });
            console.log('✅ Sticker criado com sucesso');
          } else {
            await sock.sendMessage(m.key.remoteJid, { text: '❌ Erro ao criar sticker.' }, { quoted: m });
          }
        } catch (e) {
          console.error('Erro no comando sticker:', e);
          await sock.sendMessage(m.key.remoteJid, { text: '❌ Erro ao processar sticker.' }, { quoted: m });
        }
        return true;
      
      // === STICKER ANIMADO DE VÍDEO ===
      case 'gif':
        try {
          const quoted = m.message?.extendedTextMessage?.contextInfo?.quotedMessage;
          const hasVideo = m.message?.videoMessage || quoted?.videoMessage;
          
          if (!hasVideo) {
            await sock.sendMessage(m.key.remoteJid, { 
              text: '🎥 *Como usar:* \n- Envie um vídeo com legenda `#gif`\n- OU responda um vídeo com `#gif`\n\n⚠️ *Vídeos até 7 segundos*' 
            }, { quoted: m });
            return true;
          }
          
          const mediaMessage = quoted?.videoMessage || m.message.videoMessage;
          const mediaBuffer = await downloadMediaMessage({ videoMessage: mediaMessage });
          
          if (!mediaBuffer) {
            await sock.sendMessage(m.key.remoteJid, { text: '❌ Erro ao baixar vídeo.' }, { quoted: m });
            return true;
          }
          
          await sock.sendMessage(m.key.remoteJid, { 
            text: '🔄 Criando sticker animado... Isso pode levar alguns segundos.' 
          }, { quoted: m });
          
          const stickerResult = await createAnimatedStickerFromVideo(mediaBuffer, m);
          
          if (stickerResult.error) {
            await sock.sendMessage(m.key.remoteJid, { text: `❌ ${stickerResult.error}` }, { quoted: m });
            return true;
          }
          
          await sock.sendMessage(m.key.remoteJid, { 
            sticker: stickerResult.buffer 
          }, { quoted: m });
          console.log('✅ Sticker animado criado com sucesso');
        } catch (e) {
          console.error('Erro no comando gif:', e);
          await sock.sendMessage(m.key.remoteJid, { text: '❌ Erro ao criar sticker animado.' }, { quoted: m });
        }
        return true;
      
      // === CONVERTER STICKER PARA IMAGEM ===
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
      
      // === TTS (TEXT TO SPEECH) ===
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
          
          // Simula gravação
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
      
      // === PLAY / YOUTUBE MP3 ===
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
      
      // === MENU DE AJUDA ===
      case 'help':
      case 'menu':
      case 'comandos':
        const helpText = `🤖 *MENU DE COMANDOS AKIRA V21* 🤖

*📱 PREFIXO:* \`${PREFIXO}\`

*🎨 MÍDIA (Todos):*
\`#sticker\` - Criar sticker de imagem
\`#gif\` - Criar sticker animado de vídeo (até 7s)
\`#toimg\` - Converter sticker para imagem
\`#tts <idioma> <texto>\` - Texto para voz
\`#play <nome/link>\` - Baixar música do YouTube (com busca!)

*🎤 ÁUDIO INTELIGENTE:*
Agora eu posso responder mensagens de voz!
- Envie um áudio mencionando "Akira" em grupos
- Em PV, envie qualquer áudio que eu respondo
- Eu transcrevo seu áudio e respondo com minha voz

*👑 COMANDOS DE DONO (Apenas Isaac Quarenta):*
\`#add <número>\` - Adicionar membro
\`#remove @membro\` - Remover membro
\`#promote @membro\` - Dar admin
\`#demote @membro\` - Remover admin
\`#mute @usuário\` - Mutar por 5 minutos
\`#desmute @usuário\` - Desmutar
\`#antilink on/off\` - Ativar/desativar anti-link
\`#antilink status\` - Ver status anti-link
\`#apagar\` - Apagar mensagem (responda a mensagem)

*⚙️ UTILIDADES (Todos):*
\`#ping\` - Testar latência
\`#info\` - Informações do bot
\`#donate\` - Apoiar o projeto

*💬 CONVERSA NORMAL:*
Apenas mencione "Akira" ou responda minhas mensagens para conversar normalmente!

*⚠️ COMANDOS DE GRUPO APENAS PARA ISAAC QUARENTA!*`;
        
        await sock.sendMessage(m.key.remoteJid, { text: helpText }, { quoted: m });
        return true;
      
      // === PING ===
      case 'ping':
        const startTime = Date.now();
        await sock.sendMessage(m.key.remoteJid, { text: '🏓 Pong!' }, { quoted: m });
        const latency = Date.now() - startTime;
        await sock.sendMessage(m.key.remoteJid, { text: `📡 Latência: ${latency}ms\n🕐 Uptime: ${Math.floor(process.uptime())}s` });
        return true;
      
      // === INFO ===
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
✅ Stickers animados de vídeo
✅ Download de áudio do YouTube (com busca!)
✅ Texto para voz (TTS)
✅ Resposta a mensagens de voz (STT via Deepgram + TTS)
✅ Dinâmica de leitura inteligente
✅ Sistema de moderação aprimorado

*Configuração STT:* ${DEEPGRAM_API_KEY && DEEPGRAM_API_KEY !== 'seu_token_aqui' ? '✅ Deepgram configurado' : '❌ Configure DEEPGRAM_API_KEY'}

Use \`#help\` para ver todos os comandos.`;
        
        await sock.sendMessage(m.key.remoteJid, { text: infoText }, { quoted: m });
        return true;
      
      // === ADICIONAR MEMBRO (SÓ ISAAC QUARENTA) ===
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
      
      // === REMOVER MEMBRO (SÓ ISAAC QUARENTA) ===
      case 'remove':
      case 'kick':
        if (!ehGrupo) {
          await sock.sendMessage(m.key.remoteJid, { text: '❌ Este comando só funciona em grupos.' }, { quoted: m });
          return true;
        }
        
        try {
          const numeroUsuario = extrairNumeroReal(m);
          const nomeUsuario = m.pushName || 'Desconhecido';
          const ehDono = verificarPermissaoDono(numeroUsuario, nomeUsuario);
          
          if (!ehDono) {
            console.log('❌ [BLOQUEADO] Comando #remove usado por não-dono:', numeroUsuario, nomeUsuario);
            
            const payload = { 
              usuario: nomeUsuario, 
              numero: numeroUsuario, 
              mensagem: '/reset',
              tentativa_comando: '#remove'
            };
            
            try {
              await axios.post(API_URL, payload, { timeout: 120000 });
            } catch (e) {}
            
            await sock.sendMessage(m.key.remoteJid, { 
              text: '🚫 *COMANDO RESTRITO!* Apenas Isaac Quarenta pode usar comandos de grupo.' 
            }, { quoted: m });
            return true;
          }
          
          const mencionados = m.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
          if (mencionados.length === 0) {
            await sock.sendMessage(m.key.remoteJid, { text: '❌ Marque o membro com @ para remover.' }, { quoted: m });
            return true;
          }
          
          await sock.groupParticipantsUpdate(m.key.remoteJid, mencionados, 'remove');
          await sock.sendMessage(m.key.remoteJid, { text: '✅ Membro(s) removido(s) do grupo.' }, { quoted: m });
        } catch (e) {
          console.error('Erro ao remover membro:', e);
          await sock.sendMessage(m.key.remoteJid, { text: '❌ Erro ao remover membro. Verifique permissões.' }, { quoted: m });
        }
        return true;
      
      // === PROMOVER A ADMIN (SÓ ISAAC QUARENTA) ===
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
          
          const mencionados = m.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
          if (mencionados.length === 0) {
            await sock.sendMessage(m.key.remoteJid, { text: '❌ Marque o membro com @ para promover.' }, { quoted: m });
            return true;
          }
          
          await sock.groupParticipantsUpdate(m.key.remoteJid, mencionados, 'promote');
          await sock.sendMessage(m.key.remoteJid, { text: '✅ Membro(s) promovido(s) a admin.' }, { quoted: m });
        } catch (e) {
          console.error('Erro ao promover:', e);
          await sock.sendMessage(m.key.remoteJid, { text: '❌ Erro ao promover. Verifique permissões.' }, { quoted: m });
        }
        return true;
      
      // === REMOVER ADMIN (SÓ ISAAC QUARENTA) ===
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
          
          const mencionados = m.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
          if (mencionados.length === 0) {
            await sock.sendMessage(m.key.remoteJid, { text: '❌ Marque o admin com @ para remover admin.' }, { quoted: m });
            return true;
          }
          
          await sock.groupParticipantsUpdate(m.key.remoteJid, mencionados, 'demote');
          await sock.sendMessage(m.key.remoteJid, { text: '✅ Admin(s) rebaixado(s).' }, { quoted: m });
        } catch (e) {
          console.error('Erro ao rebaixar admin:', e);
          await sock.sendMessage(m.key.remoteJid, { text: '❌ Erro ao rebaixar admin. Verifique permissões.' }, { quoted: m });
        }
        return true;
      
      // === MUTE MELHORADO (SÓ ISAAC QUARENTA) ===
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
          
          const mencionados = m.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
          if (mencionados.length === 0) {
            await sock.sendMessage(m.key.remoteJid, { text: '❌ Marque o usuário com @ para mutar.' }, { quoted: m });
            return true;
          }
          
          const userId = mencionados[0];
          const groupId = m.key.remoteJid;
          
          // Obtém contagem de mutes no dia
          const muteCount = getMuteCount(groupId, userId);
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
      
      // === DESMUTE (SÓ ISAAC QUARENTA) ===
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
          
          const mencionados = m.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
          if (mencionados.length === 0) {
            await sock.sendMessage(m.key.remoteJid, { text: '❌ Marque o usuário com @ para desmutar.' }, { quoted: m });
            return true;
          }
          
          const userId = mencionados[0];
          const groupId = m.key.remoteJid;
          
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
      
      // === ANTI-LINK (SÓ ISAAC QUARENTA) ===
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
      
      // === APAGAR MENSAGENS (PARA GRUPOS E PV) ===
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
      
      // === DONATE ===
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
        console.log('✅ AKIRA BOT V21 ONLINE! (IRONIA MÁXIMA + DIGITAÇÃO REAL)');
        console.log('═'.repeat(70));
        console.log('🤖 Bot JID:', BOT_JID);
        console.log('📱 Número:', BOT_NUMERO_REAL);
        console.log('🔗 API:', API_URL);
        console.log('⚙️ Prefixo comandos:', PREFIXO);
        console.log('🔐 Comandos restritos: Apenas Isaac Quarenta');
        console.log('🎤 STT: Deepgram API (200h/mês GRATUITO)');
        console.log('🎤 TTS: Google TTS (funcional)');
        console.log('🎤 Resposta a voz: Ativada (STT REAL + TTS)');
        console.log('🎤 Simulação gravação: Ativada');
        console.log('🛡️ Sistema de moderação: Ativo (Mute progressivo, Anti-link com apagamento)');
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
        
        // Verifica se é mensagem de áudio
        const tipo = getContentType(m.message);
        const temAudio = tipo === 'audioMessage';
        let textoAudio = '';
        let processarComoAudio = false;
        
        // === VERIFICAÇÕES DE MODERAÇÃO MELHORADAS (APENAS PARA GRUPOS) ===
        if (ehGrupo && m.key.participant) {
          const groupId = m.key.remoteJid;
          const userId = m.key.participant;
          
          // 1. VERIFICA SE USUÁRIO ESTÁ MUTADO
          if (isUserMuted(groupId, userId)) {
            console.log(`🔇 [MUTE] Usuário ${nome} tentou falar durante mute. Removendo...`);
            
            try {
              // Primeiro apaga a mensagem do usuário mutado
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
              } catch (deleteError) {
                console.log(`⚠️ Não foi possível apagar mensagem do usuário mutado`);
              }
              
              // Remove o usuário do grupo
              await sock.groupParticipantsUpdate(groupId, [userId], 'remove');
              
              // Avisa no grupo
              await sock.sendMessage(groupId, { 
                text: `🚫 *${nome} foi removido por enviar mensagem durante período de mute!*` 
              });
              
              // Remove do sistema de mute
              unmuteUser(groupId, userId);
              
            } catch (e) {
              console.error('Erro ao remover usuário mutado:', e);
            }
            
            return; // Não processa a mensagem
          }
          
          // 2. VERIFICA ANTI-LINK (apenas para texto)
          if (isAntiLinkActive(groupId) && texto && containsLink(texto)) {
            console.log(`🔗 [ANTI-LINK] Usuário ${nome} enviou link. Banindo...`);
            
            try {
              // Primeiro apaga a mensagem com link
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
              } catch (deleteError) {
                console.log(`⚠️ Não foi possível apagar mensagem com link`);
              }
              
              // Remove o usuário do grupo
              await sock.groupParticipantsUpdate(groupId, [userId], 'remove');
              
              // Avisa no grupo
              await sock.sendMessage(groupId, { 
                text: `🚫 *${nome} foi removido por enviar link!*\n🔒 Anti-link está ativado neste grupo.` 
              });
              
            } catch (e) {
              console.error('Erro ao banir usuário por link:', e);
            }
            
            return; // Não processa a mensagem
          }
        }
        
        // === PRIMEIRO: VERIFICA SE É COMANDO EXTRA ===
        if (!temAudio && texto) {
          const isComandoExtra = await handleComandosExtras(sock, m, texto, ehGrupo);
          
          if (isComandoExtra) {
            await marcarComoLido(sock, m, ehGrupo, true);
            return;
          }
        }
        
        // === SE FOR MENSAGEM DE ÁUDIO: PROCESSA STT REAL ===
        if (temAudio) {
          console.log(`🎤 [ÁUDIO RECEBIDO] de ${nome}`);
          
          // Simula que está ouvindo o áudio
          await simularGravacaoAudio(sock, m.key.remoteJid, 2000);
          
          // Baixa o áudio
          const audioBuffer = await downloadMediaMessage({ audioMessage: m.message.audioMessage });
          
          if (!audioBuffer) {
            console.error('❌ Erro ao baixar áudio');
            if (ehGrupo) {
              await sock.sendMessage(m.key.remoteJid, { 
                text: '❌ Erro ao processar áudio. Tente novamente.' 
              }, { quoted: m });
            }
            return;
          }
          
          // Transcreve áudio para texto usando Deepgram REAL
          console.log('🔊 Transcrevendo áudio para texto (Deepgram)...');
          const transcricao = await transcreverAudioParaTexto(audioBuffer);
          
          if (transcricao.sucesso) {
            textoAudio = transcricao.texto;
            console.log(`📝 [TRANSCRIÇÃO REAL] ${nome}: ${textoAudio.substring(0, 100)}...`);
            processarComoAudio = true;
            
            // Mostra transcrição em grupos (opcional)
            if (ehGrupo && textoAudio.length > 10 && !textoAudio.includes('[Erro')) {
              await sock.sendMessage(m.key.remoteJid, { 
                text: `📝 *Transcrição:* ${textoAudio.substring(0, 150)}${textoAudio.length > 150 ? '...' : ''}` 
              }, { quoted: m });
            }
          } else {
            // Fallback
            textoAudio = transcricao.texto || "[Não foi possível transcrever]";
            console.log('⚠️ Transcrição falhou:', transcricao.erro || 'Erro desconhecido');
            
            // Em PV, responde mesmo sem transcrição
            if (!ehGrupo) {
              processarComoAudio = true;
              textoAudio = "Olá! Recebi seu áudio. Configure o token do Deepgram para transcrição real.";
            }
          }
        }
        
        // === VERIFICA SE DEVE RESPONDER ===
        let ativar = false;
        let textoParaAPI = texto;
        let mensagemCitadaFormatada = '';
        
        if (temAudio && processarComoAudio) {
          ativar = await deveResponder(m, ehGrupo, textoAudio, replyInfo, true);
          textoParaAPI = textoAudio;
        } else if (!temAudio && texto) {
          ativar = await deveResponder(m, ehGrupo, texto, replyInfo, false);
        }
        
        // === FORMATAR MENSAGEM CITADA PARA API ===
        if (replyInfo) {
          if (replyInfo.ehRespostaAoBot) {
            mensagemCitadaFormatada = `[Respondendo à Akira: "${replyInfo.texto.substring(0, 100)}..."]`;
          } else {
            // Formato melhorado: inclui quem escreveu a mensagem citada
            mensagemCitadaFormatada = `[${replyInfo.usuarioCitadoNome} disse: "${replyInfo.texto.substring(0, 100)}..."]`;
          }
        }
        
        // === DINÂMICA DE LEITURA ===
        await marcarComoLido(sock, m, ehGrupo, ativar);
        
        if (!ativar) return;
        
        // Log
        if (temAudio) {
          console.log(`\n🎤 [PROCESSANDO ÁUDIO] ${nome}: ${textoAudio.substring(0, 60)}...`);
        } else {
          console.log(`\n🔥 [PROCESSANDO TEXTO] ${nome}: ${texto.substring(0, 60)}...`);
        }
        
        // === PAYLOAD PARA API (MELHORADO) ===
        const payload = {
          usuario: nome,
          numero: numeroReal,
          mensagem: textoParaAPI,
          mensagem_citada: mensagemCitadaFormatada,
          tipo_conversa: ehGrupo ? 'grupo' : 'pv',
          tipo_mensagem: temAudio ? 'audio' : 'texto',
          // Informações adicionais para contexto
          reply_info: replyInfo ? {
            reply_to_bot: replyInfo.ehRespostaAoBot,
            usuario_citado_nome: replyInfo.usuarioCitadoNome,
            usuario_citado_numero: replyInfo.usuarioCitadoNumero
          } : null
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
        
        // === SIMULAÇÃO REALISTA ===
        let tempoDigitacao = 0;
        if (temAudio) {
          tempoDigitacao = Math.min(Math.max(resposta.length * 30, 2000), 7000);
        } else {
          tempoDigitacao = Math.min(Math.max(resposta.length * 50, 3000), 10000);
        }
        
        await simularDigitacao(sock, m.key.remoteJid, tempoDigitacao);
        
        // === DECIDE COMO RESPONDER ===
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
        
        // SE A MENSAGEM ORIGINAL FOI ÁUDIO, RESPONDE COM ÁUDIO
        if (temAudio) {
          console.log('🎤 Convertendo resposta para áudio...');
          
          // Simula gravação de resposta
          await simularGravacaoAudio(sock, m.key.remoteJid, 2000);
          
          // Gera áudio da resposta
          const ttsResult = await textToSpeech(resposta, 'pt');
          
          if (ttsResult.error) {
            console.error('❌ Erro ao gerar áudio TTS:', ttsResult.error);
            await sock.sendMessage(m.key.remoteJid, { 
              text: `*[Resposta ao seu áudio]*\n${resposta}` 
            }, opcoes);
          } else {
            // Envia como áudio
            await sock.sendMessage(m.key.remoteJid, { 
              audio: ttsResult.buffer,
              mimetype: 'audio/mp4',
              ptt: true,
              caption: `Resposta ao seu áudio`
            }, opcoes);
            console.log('✅ Áudio enviado com sucesso');
          }
        } else {
          // Resposta normal em texto
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
    <p>Versão: IRONIA MÁXIMA + DIGITAÇÃO REALISTA + COMANDOS</p>
    <p>Prefixo: ${PREFIXO}</p>
    <p>🔐 Comandos restritos: Apenas Isaac Quarenta</p>
    <p>🎤 STT: Deepgram API (200h/mês GRATUITO)</p>
    <p>🎤 TTS: Google TTS (funcional)</p>
    <p>🎤 Resposta a voz: Ativada (STT REAL + TTS)</p>
    <p>🎤 Simulação gravação: Ativada</p>
    <p>🛡️ Sistema de moderação: Ativo (Mute progressivo, Anti-link com apagamento)</p>
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
    grupos_com_antilink: Array.from(antiLinkGroups).length,
    usuarios_mutados: mutedUsers.size,
    progress_messages: progressMessages.size,
    uptime: process.uptime(),
    version: 'v21_completo_moderacao_stt_real_deepgram_melhorado'
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
