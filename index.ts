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
import HFCorrections from './modules/HFCorrections.js';

// Aplica correções globais (DNS, IPv4, Fallbacks)
HFCorrections.apply();

// @ts-nocheck
/// <reference path="./modules/declarations.d.ts" />
import { exec } from 'child_process';
import express from 'express';
import QRCode from 'qrcode';
import ConfigManager from './modules/ConfigManager.js';
import BotCore from './modules/BotCore.js';
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
let watchdogTimer: NodeJS.Timeout | null = null;
const DISCONNECT_RESTART_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutos offline = RESTART
const WATCHDOG_INITIAL_GRACE_MS = 3 * 60 * 1000; // 3 min de graca no boot

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
    const hasQR = qr !== null && qr !== undefined;

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>🤖 Akira Bot V21 - Painel de Controlo</title>
        <meta charset="UTF-8">
        <style>
          :root { --neon: #00ff41; --bg: #0a0a0a; --card: #151515; }
          body { background: var(--bg); color: var(--neon); font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 20px; display: flex; flex-direction: column; align-items: center; }
          .card { background: var(--card); border: 2px solid var(--neon); padding: 30px; border-radius: 15px; box-shadow: 0 0 20px rgba(0, 255, 65, 0.2); max-width: 800px; width: 100%; text-align: center; }
          h1 { margin-top: 0; font-size: 2.5em; text-shadow: 0 0 10px var(--neon); letter-spacing: 2px; }
          .status-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; text-align: left; margin: 20px 0; }
          .status-item { background: #000; padding: 15px; border-radius: 8px; border-left: 4px solid var(--neon); }
          .label { font-size: 0.8em; color: #888; text-transform: uppercase; }
          .value { font-size: 1.1em; font-weight: bold; margin-top: 5px; }
          .qr-container { background: white; padding: 20px; border-radius: 10px; display: inline-block; margin: 20px 0; border: 4px solid var(--neon); }
          .btn { background: transparent; color: var(--neon); border: 1px solid var(--neon); padding: 10px 20px; border-radius: 5px; cursor: pointer; text-decoration: none; display: inline-block; transition: 0.3s; margin: 5px; }
          .btn:hover { background: var(--neon); color: #000; box-shadow: 0 0 15px var(--neon); }
          .btn-danger { color: #ff4b2b; border-color: #ff4b2b; }
          .btn-danger:hover { background: #ff4b2b; color: #fff; box-shadow: 0 0 15px #ff4b2b; }
          .badge { padding: 3px 8px; border-radius: 4px; font-size: 0.9em; font-weight: bold; }
          .badge-online { background: var(--neon); color: #000; }
          .badge-offline { background: #ff4444; color: #fff; }
          .log-area { background: #000; color: #aaa; font-family: monospace; padding: 15px; border-radius: 8px; text-align: left; font-size: 0.85em; max-height: 150px; overflow-y: auto; margin-top: 20px; border: 1px solid #333; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>AKIRA BOT V21</h1>
          <p>Automação Cyber-Agent & Moderação</p>

          <div class="status-grid">
            <div class="status-item">
              <div class="label">Estado da Conexão</div>
              <div class="value">${status.isConnected ? '<span class="badge badge-online">✅ CONECTADO</span>' : '<span class="badge badge-offline">❌ DESCONECTADO</span>'}</div>
            </div>
            <div class="status-item">
              <div class="label">Sessão WhatsApp</div>
              <div class="value">${hasQR ? '📱 QR CODE DISPONÍVEL' : (status.isConnected ? '✅ AUTENTICADO' : '⏳ A GERAR QR...')}</div>
            </div>
            <div class="status-item">
              <div class="label">Número do Bot</div>
              <div class="value">${status.botNumero || '---'}</div>
            </div>
            <div class="status-item">
              <div class="label">Tempo de Atividade</div>
              <div class="value">${Math.floor(status.uptime / 60)}m ${status.uptime % 60}s</div>
            </div>
          </div>

          ${!status.isConnected && hasQR ? `
            <div class="qr-section">
              <h3>📱 LEITURA OBRIGATÓRIA</h3>
              <p>O bot precisa de autenticação. Digitaliza o QR Code abaixo:</p>
              <div class="qr-container">
                <img src="/qr-image" style="width: 280px; height: 280px; image-rendering: pixelated;" />
              </div>
              <p style="font-size: 0.9em; color: #888;">Este ecrã atualiza automaticamente a cada 10s.</p>
            </div>
          ` : (status.isConnected ? `
            <div style="padding: 20px; border: 1px dashed var(--neon); border-radius: 10px; margin: 20px 0;">
              <p>🟢 <strong>SISTEMA OPERACIONAL</strong></p>
              <p>O bot está processando mensagens em tempo real.</p>
            </div>
          ` : `
            <div style="padding: 20px; border: 1px dashed #ffaa00; border-radius: 10px; margin: 20px 0;">
              <p>⏳ <strong>INICIALIZANDO...</strong></p>
              <p>A aguardar que o Baileys gere o fluxo de autenticação.</p>
            </div>
          `)}

          <div class="actions">
            <a href="/" class="btn">🔄 Recarregar</a>
            <a href="/force-qr" class="btn">🔁 Forçar QR</a>
            <a href="/stats" class="btn">📊 Estatísticas</a>
            <a href="/reset-auth" class="btn btn-danger" onclick="return confirm('ATENÇÃO: Isto vai apagar a sessão atual e exigir novo QR code. Continuar?')">⚠️ Resetar Sessão</a>
          </div>

          <div class="log-area">
            <div style="color: var(--neon); border-bottom: 1px solid #333; margin-bottom: 5px; padding-bottom: 3px;">ÚLTIMOS EVENTOS DO SISTEMA</div>
            <div id="logs-content">
              [SYSTEM] Painel de controlo carregado em ${new Date().toLocaleTimeString()}<br>
              [AUTH] Status: ${status.isConnected ? 'Conectado' : 'A aguardar'}<br>
              ${hasQR ? '[QR] Novo QR Code gerado e disponível.' : '[SYNC] A aguardar sinal do WhatsApp...'}
            </div>
          </div>
        </div>
        <script>
          // Auto-recarregamento se não estiver conectado
          ${!status.isConnected ? 'setTimeout(() => location.reload(), 10000);' : 'setTimeout(() => location.reload(), 60000);'}
        </script>
      </body>
      </html>
    `);
  });

  // ════ NOVA ROTA: Apenas a Imagem do QR ════
  app.get('/qr-image', async (req: any, res: any) => {
    if (!botCore) return res.status(503).send('Bot offline');
    const qr = botCore.getQRCode();
    if (!qr) return res.status(404).send('No QR');
    try {
      const img = await QRCode.toBuffer(qr, { scale: 10, margin: 2 });
      res.type('png').send(img);
    } catch (e) {
      res.status(500).send('Error');
    }
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

  // ═══ Rota: Reset Auth (O "Botão de Pânico") ═══
  app.get('/reset-auth', async (req: any, res: any) => {
    if (!botCore) {
      return res.status(503).send('Bot ainda inicializando...');
    }
    try {
      const fs = await import('fs');
      const authPath = botCore.config.AUTH_FOLDER;

      console.log(`⚠️ [RESET-AUTH] Solicitado via Web. Limpando: ${authPath}`);

      // Fecha o socket antes de apagar os arquivos
      if (botCore.sock) {
        try { botCore.sock.logout(); } catch (e) { }
        try { botCore.sock.end(); } catch (e) { }
      }

      if (fs.existsSync(authPath)) {
        // Apaga tudo para um fresh start
        fs.rmSync(authPath, { recursive: true, force: true });
        console.log('✅ [RESET-AUTH] Pasta de autenticação eliminada com sucesso.');
      }

      res.send(`
        <html>
        <head><meta http-equiv="refresh" content="3;url=/"></head>
        <body style="background:#000;color:#0f0;font-family:monospace;text-align:center;padding:50px;">
          <h1>✅ SESSÃO RESETADA COM SUCESSO</h1>
          <p>Todos os arquivos de autenticação foram apagados.</p>
          <p>O bot irá reiniciar agora. Redirecionando para o QR Code em 3 segundos...</p>
        </body>
        </html>
      `);

      // Força a reinicialização do processo para garantir que o Baileys recarregue do zero
      setTimeout(() => {
        process.exit(0); // Railway vai reiniciar o container automaticamente
      }, 1000);

    } catch (error: any) {
      res.status(500).send('Erro ao resetar: ' + error.message);
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

  // ═══ Rota: Webhook Autónomo (Comunicação Push do Python) ═══
  app.post('/api/webhook/autonomous', async (req: any, res: any) => {
    if (!botCore || !botCore.sock) {
      return res.status(503).json({ error: 'BotCore offline' });
    }

    // ✅ MELHORIA: Verifica se está realmente conectado
    if (!botCore.isConnected) {
      const statusReason = botCore.currentQR ? 'Waiting for QR Code' : 'Connecting/Offline';
      console.warn(`⚠️ [WEBHOOK] Pedido autónomo recebido mas bot está em: ${statusReason}`);
      return res.status(503).json({
        error: 'BotCore disconnected',
        status: statusReason,
        reconnecting: botCore.reconnectAttempts > 0
      });
    }

    // Simples autenticação por token para segurança
    const authHeader = req.headers['authorization'];
    const expectedToken = process.env.WEBHOOK_SECRET || 'akira-internal-secret-v21';

    if (authHeader !== `Bearer ${expectedToken}`) {
      console.warn('⚠️ Tentativa de acesso não autorizado ao Webhook Autónomo');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      const payload = req.body;
      console.log(`🤖 [WEBHOOK] Pedido autónomo recebido:`, payload.action || payload.cmd);

      // Constrói um objeto "m" mockado para satisfazer o handleRemoteActions
      // ✅ MELHORIA: Fallback de JID para o dono se for uma ação de sistema sem grupo
      const fallbackJid = `${config.DONO_USERS[0]?.numero || '244937035662'}@s.whatsapp.net`;
      const mockMessage = {
        key: {
          remoteJid: payload.params?.group_jid || payload.group_jid || 'system',
          id: 'auto_' + Date.now()
        },
        message: {}
      };

      // Se for system e não tiver target, pode falhar. BotCore.ts deve lidar.
      await botCore.handleRemoteActions(
        [payload],
        mockMessage
      );

      return res.status(200).json({ success: true, message: 'Ação executada com sucesso' });
    } catch (error: any) {
      console.error('❌ Erro no webhook autónomo:', error);
      return res.status(500).json({ error: error.message });
    }
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

    // ✅ INICIAR WATCHDOG DE CONEXÃO
    startConnectionWatchdog();
  } catch (error: any) {
    console.error('❌ Erro ao inicializar BotCore:', error.message);
  }
}

/**
 * ✅ WATCHDOG: Monitoriza se o bot está "preso" em modo offline
 * Se ficar desconectado por mais de 15 minutos, força reinicialização.
 * Possui período de graca inicial de 3 minutos para boot.
 */
function startConnectionWatchdog() {
  if (watchdogTimer) clearInterval(watchdogTimer);

  let disconnectedSince: number | null = null;
  const bootTime = Date.now();

  watchdogTimer = setInterval(() => {
    if (!botCore) return;

    // ✅ Período de graca: não contar nos primeiros 3 minutos após boot
    if (Date.now() - bootTime < WATCHDOG_INITIAL_GRACE_MS) return;

    if (!botCore.isConnected) {
      // ✅ Se há QR ativo, bot está vivo à espera de scan — pausar contagem
      if (botCore.currentQR) {
        if (disconnectedSince) {
          console.log('👀 [WATCHDOG] Bot em modo QR Code. Pausando contagem de restart.');
          disconnectedSince = null;
        }
        return;
      }

      if (!disconnectedSince) {
        disconnectedSince = Date.now();
        console.log('🕒 [WATCHDOG] Bot desconectado. Iniciando contagem para auto-restart...');
      } else {
        const duration = Date.now() - disconnectedSince;
        const remaining = DISCONNECT_RESTART_THRESHOLD_MS - duration;

        if (duration >= DISCONNECT_RESTART_THRESHOLD_MS) {
          console.error('🚨 [WATCHDOG] BOT OFFLINE POR MUITO TEMPO (>5m). FORÇANDO RESTART DO PROCESSO.');
          process.exit(1); // Railway reinicia o container
        } else {
          // Log sutil a cada minuto de desconexão
          if (Math.floor(duration / 1000) % 60 === 0) {
            console.warn(`🕒 [WATCHDOG] Bot offline há ${Math.floor(duration / 1000)}s. Restart em ${Math.floor(remaining / 1000)}s.`);
          }
        }
      }
    } else {
      if (disconnectedSince) {
        console.log('✅ [WATCHDOG] Bot reconectado. Resetando contagem de restart.');
        disconnectedSince = null;
      }
    }
  }, 10000); // Verifica a cada 10s
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
