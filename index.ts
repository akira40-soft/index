/**
 * ═══════════════════════════════════════════════════════════════════════
 * AKIRA BOT V21 — ARQUITETURA OOP COMPLETA
 * ═══════════════════════════════════════════════════════════════════════
 * ✅ Arquitetura modular com 6+ classes especializadas
 * ✅ Conformidade completa com api.py payload
 * ✅ Integração com computervision.py
 * ✅ STT (Deepgram), TTS (Google), YT Download, Stickers
 * ✅ Sistema de moderação avançado
 * ✅ Rate limiting e proteção contra spam
 * ✅ Performance otimizada com cache e deduplicação
 * ✅ GARANTIA: Responde SEMPRE em REPLY nos grupos (@g.us)
 * ✅ SIMULAÇÕES: Digitação, Gravação, Ticks, Presença (em BotCore)
 * 
 * 📝 NOTA: Este arquivo delega a lógica para classes OOP:
 *    - BotCore.js → Processamento de mensagens e resposta
 *    - PresenceSimulator.js → Simulações de digitação/áudio/ticks
 *    - CommandHandler.js → Processamento de comandos
 * 
 * 🔗 REFERÊNCIA RÁPIDA:
 *    - Lógica de REPLY: modules/BotCore.js linha ~426
 *    - Simulações: modules/PresenceSimulator.js
 *    - Comandos: modules/CommandHandler.js
 *    - Config: modules/ConfigManager.js
 * 
 * ⚡ HF SPACES DNS CORRECTIONS - CRÍTICO PARA QR CODE:
 *    - Força IPv4 para resolver web.whatsapp.com
 *    - Configuração DNS do Google (8.8.8.8) como fallback
 * ═══════════════════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════════════════════════════════════
// HF SPACES DNS CORRECTIONS - CORREÇÃO CRÍTICA PARA QR CODE
// ═══════════════════════════════════════════════════════════════════════
import dns from 'dns';
import HFCorrections from './modules/HFCorrections';

// Aplica correções globais (DNS, IPv4, Fallbacks)
HFCorrections.apply();

// @ts-nocheck
/// <reference path="./modules/declarations.d.ts" />
import { exec } from 'child_process';
import express from 'express';
import QRCode from 'qrcode';
import ConfigManager from './modules/ConfigManager';
import BotCore from './modules/BotCore';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ═══════════════════════════════════════════════════════════════════════
// INICIALIZAÇÃO GLOBAL
// ═══════════════════════════════════════════════════════════════════════

const config = ConfigManager.getInstance();
let botCore: any = null;
let app: any = null;
let server: any = null;

/**
 * Inicializa o servidor Express
 */
function initializeServer() {
  app = express();
  app.use(express.json());
  // Ko-fi envia webhooks como application/x-www-form-urlencoded
  app.use(express.urlencoded({ extended: true }));

  // ═══ Middleware para logging ═══
  app.use((req: any, res: any, next: any) => {
    const start = Date.now();
    const path = req.path;
    res.on('finish', () => {
      const duration = Date.now() - start;
      console.log(`[${new Date().toISOString()}] ${req.method} ${path} ${res.statusCode} ${duration}ms`);
    });
    next();
  });

  // ═══ Rota: Status ═══
  app.get('/', (req: any, res: any) => {
    if (!botCore) {
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>🤖 Akira Bot V21 - Inicializando...</title>
          <style>
            body { background: #000; color: #ffaa00; font-family: 'Courier New', monospace; padding: 40px; line-height: 1.6; text-align: center; }
            h1 { color: #ffaa00; text-shadow: 0 0 10px #ffaa00; }
            .loading:after { content: '.'; animation: dots 1.5s steps(5, end) infinite; }
            @keyframes dots { 0%, 20% { content: '.'; } 40% { content: '..'; } 60% { content: '...'; } 80%, 100% { content: ''; } }
          </style>
          <meta http-equiv="refresh" content="3">
        </head>
        <body>
          <h1>🤖 AKIRA BOT V21</h1>
          <p>Inicializando o sistema<span class="loading"></span></p>
          <p>Por favor, aguarde alguns segundos</p>
          <p>Atualizando automaticamente</p>
        </body>
        </html>
      `);
    }

    const status = botCore.getStatus();
    const qr = botCore.getQRCode();

    // Se tem QR code mas ainda não está conectado
    const hasQR = qr !== null && qr !== undefined;

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>🤖 Akira Bot V21</title>
        <style>
          body { background: #000; color: #0f0; font-family: 'Courier New', monospace; padding: 40px; line-height: 1.6; }
          h1 { text-align: center; color: #00ff00; text-shadow: 0 0 10px #00ff00; }
          .container { max-width: 600px; margin: 0 auto; background: #0a0a0a; padding: 20px; border: 2px solid #00ff00; border-radius: 5px; }
          .status { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #00ff00; }
          .label { font-weight: bold; }
          .links { text-align: center; margin-top: 20px; }
          a { color: #00ff00; text-decoration: none; margin: 0 15px; padding: 8px 16px; border: 1px solid #00ff00; border-radius: 5px; display: inline-block; transition: all 0.3s; }
          a:hover { background: #00ff00; color: #000; text-decoration: none; }
          .version { color: #0099ff; }
          .qr-indicator { background: ${hasQR ? '#00ff00' : '#ffaa00'}; color: #000; padding: 5px 10px; border-radius: 3px; font-weight: bold; margin-left: 10px; }
          .status-indicator { background: ${status.isConnected ? '#00ff00' : '#ff4444'}; color: #000; padding: 5px 10px; border-radius: 3px; font-weight: bold; margin-left: 10px; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🤖 AKIRA BOT V21</h1>
          <div class="status">
            <span class="label">Status:</span>
            <span>${status.isConnected ? '✅ ONLINE' : '❌ OFFLINE'} <span class="status-indicator">${status.isConnected ? 'CONECTADO' : 'DESCONECTADO'}</span></span>
          </div>
          <div class="status">
            <span class="label">QR Code:</span>
            <span>${hasQR ? '📱 DISPONÍVEL' : '⏳ AGUARDANDO'} <span class="qr-indicator">${hasQR ? 'PRONTO' : 'GERANDO'}</span></span>
          </div>
          <div class="status">
            <span class="label">Número:</span>
            <span>${status.botNumero}</span>
          </div>
          <div class="status">
            <span class="label">JID:</span>
            <span>${status.botJid || 'Desconectado'}</span>
          </div>
          <div class="status">
            <span class="label">Uptime:</span>
            <span>${status.uptime}s</span>
          </div>
          <div class="status version">
            <span class="label">Versão:</span>
            <span>${status.version}</span>
          </div>
          <div class="links">
            <a href="/qr">📱 QR Code</a>
            <a href="/health">💚 Health</a>
            <a href="/stats">📊 Stats</a>
            ${!status.isConnected ? '<a href="/force-qr">🔄 Forçar QR</a>' : ''}
            <a href="/reset-auth" onclick="return confirm(\'Isso vai desconectar o bot e exigir novo login. Continuar?\')">🔄 Reset Auth</a>
          </div>
          <div style="margin-top: 20px; text-align: center; color: #666; font-size: 12px;">
            Porta: ${config.PORT} | API: ${config.API_URL ? 'Conectada' : 'Desconectada'}
          </div>
        </div>
      </body>
      </html>
    `);
  });

  // ═══ Rota: QR Code ═══
  app.get('/qr', async (req: any, res: any) => {
    try {
      if (!botCore) {
        return res.status(503).send(`
          <html>
          <head>
            <meta http-equiv="refresh" content="3">
            <style>
              body { background: #000; color: #ffaa00; font-family: monospace; text-align: center; padding: 50px; }
              .loading:after { content: '.'; animation: dots 1.5s steps(5, end) infinite; }
              @keyframes dots { 0%, 20% { content: '.'; } 40% { content: '..'; } 60% { content: '...'; } 80%, 100% { content: ''; } }
            </style>
          </head>
          <body>
            <h1>🔄 INICIALIZANDO BOT</h1>
            <p>O bot ainda está sendo inicializado<span class="loading"></span></p>
            <p>Por favor, aguarde alguns segundos</p>
            <p>Atualizando automaticamente em 3 segundos</p>
            <p><a href="/" style="color: #0f0;">← Voltar</a></p>
          </body>
          </html>
        `);
      }

      const status = botCore.getStatus();
      const qr = botCore.getQRCode();

      if (status.isConnected) {
        return res.send(`
          <html>
          <head>
            <style>
              body { background: #000; color: #0f0; font-family: monospace; text-align: center; padding: 50px; }
              .connected { color: #00ff00; font-size: 24px; margin: 20px 0; padding: 20px; border: 2px solid #00ff00; border-radius: 10px; }
            </style>
          </head>
          <body>
            <h1>✅ BOT CONECTADO!</h1>
            <div class="connected">
              <p>✅ <strong>ONLINE E OPERACIONAL</strong></p>
              <p>🤖 Nome: ${config.BOT_NAME}</p>
              <p>📱 Número: ${status.botNumero}</p>
              <p>🔗 JID: ${status.botJid || 'N/A'}</p>
              <p>⏱️ Uptime: ${status.uptime} segundos</p>
            </div>
            <p>O bot já está conectado ao WhatsApp e pronto para uso.</p>
            <p>Nenhum QR Code necessário agora.</p>
            <p><a href="/" style="color: #0f0;">← Voltar para Página Inicial</a></p>
          </body>
          </html>
        `);
      }

      if (!qr) {
        return res.send(`
          <html>
          <head>
            <meta http-equiv="refresh" content="5">
            <title>🔄 Gerando QR Code - Akira Bot</title>
            <style>
              body { background: #000; color: #ffaa00; font-family: monospace; text-align: center; padding: 50px; }
            </style>
          </head>
          <body>
            <h1>🔄 AGUARDANDO QR CODE</h1>
            <p>O QR code está sendo gerado...</p>
            <p>Atualizando automaticamente em 5 segundos</p>
            <p><a href="/qr" style="color: #0f0;">↪️ Atualizar</a></p>
          </body>
          </html>
        `);
      }

      const img = await QRCode.toDataURL(qr, {
        errorCorrectionLevel: 'H',
        scale: 10,
        margin: 2,
        width: 400
      });

      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta http-equiv="refresh" content="30">
          <title>📱 QR Code - Akira Bot</title>
          <style>
            body { background: #000; color: #0f0; font-family: monospace; text-align: center; padding: 20px; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            img { max-width: 100%; border: 2px solid #00ff00; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>📱 QR CODE DISPONÍVEL</h1>
            <img src="${img}" alt="QR Code">
            <p>⏳ Válido por 90 segundos</p>
            <p><a href="/qr">🔄 Atualizar</a> | <a href="/">🏠 Início</a></p>
          </div>
        </body>
        </html>
      `);
    } catch (error: any) {
      console.error('❌ Erro na rota /qr:', error);
      res.status(500).send('Erro ao gerar QR code');
    }
  });

  // ═══ Rota: Forçar QR ═══
  app.get('/force-qr', async (req: any, res: any) => {
    if (!botCore) return res.redirect('/qr');
    try {
      await botCore._forceQRGeneration();
      res.redirect('/qr');
    } catch (error) {
      res.redirect('/qr');
    }
  });

  // ═══ Rota: Health Check ═══
  app.get('/health', (req: any, res: any) => {
    const health: any = {
      status: 'healthy',
      server: 'running',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      node_version: process.version
    };

    if (botCore) {
      const status = botCore.getStatus();
      health.bot_status = status.isConnected ? 'connected' : 'disconnected';
      health.bot_ready = true;
    } else {
      health.bot_status = 'initializing';
      health.bot_ready = false;
    }

    res.status(200).json(health);
  });

  // ═══ Rota: Stats ═══
  app.get('/stats', (req: any, res: any) => {
    if (!botCore) {
      return res.status(503).json({ status: 'initializing' });
    }
    const stats = botCore.getStats();
    res.json({ bot: stats, timestamp: new Date().toISOString() });
  });

  // ═══ Rota: Reset Auth ═══
  app.post('/reset-auth', async (req: any, res: any) => {
    if (!botCore) {
      return res.status(503).json({ status: 'error', message: 'Bot não inicializado' });
    }
    try {
      const fs = await import('fs');
      const authPath = botCore.config.AUTH_FOLDER;
      if (fs.existsSync(authPath)) {
        fs.rmSync(authPath, { recursive: true, force: true });
      }
      res.json({ status: 'success', message: 'Credenciais resetadas' });
    } catch (error: any) {
      res.status(500).json({ status: 'error', message: error.message });
    }
  });

  // ═══ Rota: Debug ═══
  app.get('/debug', (req: any, res: any) => {
    if (!botCore) {
      return res.json({ status: 'not_initialized' });
    }
    const status = botCore.getStatus();
    res.json({ bot_status: status, timestamp: new Date().toISOString() });
  });

  // 404 handler
  app.use((req: any, res: any) => {
    res.status(404).json({ status: 'error', error: 'Rota não encontrada' });
  });

  server = app.listen(config.PORT, '0.0.0.0', () => {
    console.log(`\n🌐 Servidor rodando na porta ${config.PORT}`);
    console.log(`   📍 http://localhost:${config.PORT}`);
    console.log(`   📍 QR: http://localhost:${config.PORT}/qr\n`);
  });

  return server;
}

/**
 * Inicializa BotCore em background
 */
async function initializeBotCoreAsync() {
  try {
    console.log('🔧 Inicializando BotCore...');
    const startTime = Date.now();

    botCore = new BotCore();
    await botCore.initialize();
    console.log('✅ BotCore inicializado em ' + (Date.now() - startTime) + 'ms');

    console.log('🔗 Conectando ao WhatsApp...');
    botCore.connect().catch((error: any) => {
      console.error('❌ Erro na conexão:', error.message);
    });
  } catch (error: any) {
    console.error('❌ Erro ao inicializar BotCore:', error.message);
  }
}

/**
 * Função principal
 */
async function main() {
  try {
    console.log('\n🚀 INICIANDO AKIRA BOT V21\n');

    console.log('🌐 [1/2] Servidor web...');
    const serverStartTime = Date.now();
    initializeServer();
    console.log('✅ Servidor em ' + (Date.now() - serverStartTime) + 'ms\n');

    console.log('🤖 [2/2] BotCore...');
    initializeBotCoreAsync();

    console.log('✅ Sistema inicializado!');
    console.log(`📍 http://localhost:${config.PORT}`);
    console.log(`📱 QR: http://localhost:${config.PORT}/qr\n`);

  } catch (error: any) {
    console.error('❌ Erro fatal:', error.message);
    if (server) server.close();
    process.exit(1);
  }
}

/**
 * Graceful shutdown
 */
function shutdown() {
  console.log('\n🔴 Desligando...');
  if (server) {
    server.close(() => {
      console.log('✅ Servidor fechado');
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
}

process.on('unhandledRejection', (err) => console.error('❌ UNHANDLED:', err));
process.on('uncaughtException', (err) => {
  console.error('❌ UNCAUGHT:', err);
  process.exit(1);
});

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Inicialização
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('❌ Erro ao iniciar:', error);
    process.exit(1);
  });
}

export { botCore, app, config };
