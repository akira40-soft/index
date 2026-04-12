/**
 * ═══════════════════════════════════════════════════════════════════════
 * CLASSE: MediaProcessor
 * ═══════════════════════════════════════════════════════════════════════
 * Gerencia processamento de mídia: imagens, vídeos, stickers, YouTube
 * Download, conversão, criação de stickers personalizados
 * ═══════════════════════════════════════════════════════════════════════
 */

import axios from 'axios';
import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
// ✅ Sharp com lazy loading - importado apenas quando necessário
let sharp: any = null;
const loadSharp = async () => {
    if (!sharp) {
        try {
            // @ts-ignore - Sharp pode não estar instalado
            sharp = await import('sharp').then(m => m.default || m);
        } catch (e: any) {
            console.warn('⚠️ Sharp não disponível. Stickers usarão ffmpeg como fallback.');
            return null;
        }
    }
    return sharp;
};
import { exec, execSync } from 'child_process';
import util from 'util';
const execAsync = util.promisify(exec);
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { downloadContentFromMessage } from '@whiskeysockets/baileys';
import ConfigManager from './ConfigManager.js';

// ✅ Configurar ffmpeg path para fluent-ffmpeg
try {
    const ffmpegPath = execSync('which ffmpeg', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);
} catch (e) {
    // Tentar paths comuns se which falhar
    const possiblePaths = ['/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg', 'ffmpeg'];
    for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
            ffmpeg.setFfmpegPath(p);
            break;
        }
    }
}

// ✅ Configurar ffprobe path para fluent-ffmpeg
try {
    const ffprobePath = execSync('which ffprobe', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (ffprobePath) ffmpeg.setFfprobePath(ffprobePath);
} catch (e) {
    // Tentar paths comuns se which falhar
    const possiblePaths = ['/usr/local/bin/ffprobe', '/usr/bin/ffprobe', 'ffprobe'];
    for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
            ffmpeg.setFfprobePath(p);
            break;
        }
    }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Webpmux para metadados de stickers - carregado dinamicamente
let Webpmux: any = null;

async function loadWebpmux() {
    try {
        Webpmux = await import('node-webpmux').then(m => m.default || m);
    } catch (e: any) {
        console.warn('⚠️ node-webpmux não instalado. Stickers sem metadados EXIF.');
    }
}

// Carrega Webpmux asynchronously
loadWebpmux();

class MediaProcessor {
    private config: any;
    private logger: any;
    private tempFolder: string;
    private downloadCache: Map<string, any>;
    private ytdlpCommand: string;
    public sock: any;

    constructor(logger: any = null) {
        this.config = ConfigManager.getInstance();
        this.logger = logger || console;
        this.tempFolder = this.config?.TEMP_FOLDER || './temp';
        this.downloadCache = new Map();
        this.ytdlpCommand = this._resolveYtdlpCommand();

        // Garante que a pasta temporária exista
        if (!fs.existsSync(this.tempFolder)) {
            try {
                fs.mkdirSync(this.tempFolder, { recursive: true });
                this.logger?.info(`📁 Diretório temporário criado: ${this.tempFolder}`);
            } catch (dirErr: any) {
                this.logger.error(`❌ Erro ao criar pasta temporária:`, dirErr.message);
            }
        }
    }

    public setSocket(sock: any): void {
        this.sock = sock;
    }

    /**
     * Encontra o caminho do cookie válido
     */
    private _findCookiePath(): string {
        const possiblePaths = [
            './cookies.txt',
            '/app/cookies.txt',
            './youtube_cookies.txt',
            path.join(this.config.DATABASE_FOLDER || './database', 'cookies', 'youtube_cookies.txt'),
            process.env.YT_COOKIES_PATH
        ].filter(Boolean);

        for (const p of possiblePaths) {
            if (p && fs.existsSync(p)) {
                this.logger?.info(`✅ Cookie encontrado em: ${p}`);
                return p;
            }
        }
        return '';
    }

    private _resolveYtdlpCommand(): string {
        try {
            const binary = execSync('command -v yt-dlp || which yt-dlp', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
            if (binary) {
                this.logger?.info(`✅ Usando yt-dlp do sistema: ${binary}`);
                return binary;
            }
        } catch (error) {
            this.logger?.warn('⚠️ yt-dlp não encontrado no PATH. Tentando python3 -m yt_dlp...');
        }

        try {
            execSync('python3 -m yt_dlp --version', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
            this.logger?.info('✅ Usando python3 -m yt_dlp como fallback');
            return 'python3 -m yt_dlp';
        } catch (error) {
            this.logger?.warn('⚠️ python3 -m yt_dlp não disponível. Usando comando genérico yt-dlp.');
        }

        return 'yt-dlp';
    }

    /**
     * Constrói o comando yt-dlp com GAMBIARRAS REAIS contra bloqueios do YouTube
     * - Usa Web Embedded Client (menos bloqueado)
     * - Node.js como runtime JS obrigatório
     * - Desabilita verificações de bot
     * - Skip DASH manifest para formatos simples
     * - Usa formatos progressivamente mais genéricos em retries
     */
    private _buildYtdlpCommand(url: string, options: { type: 'audio' | 'video' | 'json', output?: string, isSearch?: boolean, retryCount?: number, playerClient?: string }): string {
        const cookiePath = this._findCookiePath();
        const cookieArg = cookiePath ? `--cookies "${cookiePath}"` : '';
        const retryCount = options.retryCount || 0;

        // GAMBIARRAS REAIS CONTRA BLOQUEIO YOUTUBE 2024-2026:
        // 1. web_embedded menos bloqueado que web
        // 2. Node.js como runtime obrigatório
        // 3. Força IPv4 para evitar problemas
        // 4. Em retries, troca player_client
        const playerClient = options.playerClient || 'web_embedded';
        let extractorArgs = `youtube:player_client=${playerClient}`;

        const bypassFlags = retryCount === 0 ? [
            '--ignore-config',
            `--extractor-args "${extractorArgs}"`,
            '--js-runtimes node',
            '--remote-components ejs:github',
            '--socket-timeout 100',
            '--retries 10',
            '--geo-bypass',
            '--no-check-certificates',
            '--no-playlist'
        ].filter(Boolean).join(' ') : [
            '--ignore-config',
            `--extractor-args "${extractorArgs}"`,
            '--js-runtimes node',
            '--remote-components ejs:github',
            '--no-warnings',
            '--no-check-certificates',
            '--socket-timeout 60'
        ].filter(Boolean).join(' ');

        let actionFlags = '';
        if (options.type === 'audio') {
            // Cascade robusto de formatos: m4a > audio genérico > extrair de mp4 > melhor
            const formatCascade = 'ba[ext=m4a]/ba/b[ext=mp4]/b';
            actionFlags = `-f "${formatCascade}" -x --audio-format mp3 --audio-quality 0 -o "${options.output}"`;
        } else if (options.type === 'video') {
            const videoFormat = 'bv[ext=mp4][height<=720]+ba[ext=m4a]/b[ext=mp4][height<=720]/best';
            actionFlags = `-f "${videoFormat}" -o "${options.output}"`;
        } else if (options.type === 'json') {
            actionFlags = '--dump-json --no-download';
        }

        const target = options.isSearch ? `ytsearch1:${url}` : url;
        const executable = this.ytdlpCommand || 'yt-dlp';
        return `${executable} ${cookieArg} ${bypassFlags} ${actionFlags} "${target}"`;
    }

    /**
     * ═══════════════════════════════════════════════════════════════════════
     * DOWNLOAD DE ÁUDIO - yt-dlp COM GAMBIARRAS CONTRA BLOQUEIO DO YOUTUBE
     * ═══════════════════════════════════════════════════════════════════════
     */
    async downloadYouTubeAudio(url: string, retryCount: number = 0, playerClient: string = 'web_embedded'): Promise<{ sucesso: boolean; buffer?: Buffer; filePath?: string; error?: string; metadata?: any }> {
        try {
            this.logger?.info(`🎧 Download áudio: ${url}${retryCount > 0 ? ` (retry ${retryCount}/4)` : ''} (player_client=${playerClient})`);

            const metadata = await this._getYouTubeMetadataSimple(url);
            if (!metadata.sucesso) {
                return { sucesso: false, error: 'Não foi possível encontrar música para esse nome.' };
            }

            const finalUrl = metadata.url || url;
            const outputPath = this.generateRandomFilename('mp3');

            this.logger?.info(`[ÁUDIO] Rodando yt-dlp com gambiarra player_client=${playerClient}...`);
            const cmd = this._buildYtdlpCommand(finalUrl, {
                type: 'audio',
                output: outputPath,
                retryCount: retryCount,
                playerClient: playerClient
            });

            try {
                this.logger?.debug(`Comando: ${cmd.substring(0, 200)}...`);
                await execAsync(cmd, { timeout: 180000, maxBuffer: 150 * 1024 * 1024 });
            } catch (e: any) {
                const fullErrorStr = (e.stderr || e.message || '').toLowerCase();
                const msg = fullErrorStr.split('\n')[0];
                this.logger?.error(`❌ yt-dlp erro: ${msg}`);

                // Retry com cascade estratégico de player_client
                if ((fullErrorStr.includes('format not available') || fullErrorStr.includes('format is not available') || fullErrorStr.includes('jsc')) && retryCount < 4) {
                    const clients = ['ios', 'android', 'web', 'tv'];
                    const nextClient = clients[retryCount] || clients[clients.length - 1];
                    this.logger?.info(`🔄 [FORMAT RETRY] Tentando client alternativo: ${nextClient}...`);
                    await new Promise(r => setTimeout(r, 2000));
                    return await this.downloadYouTubeAudio(url, retryCount + 1, nextClient);
                }

                // FALLBACK EXTREMO PIpED:
                this.logger?.warn(`⚠️ yt-dlp falhou, tentando FALLBACK EXTREMO Piped API...`);
                const videoId = metadata.videoId || this._extractVideoId(finalUrl);
                if (videoId) {
                    const pipedRes = await this._downloadStreamFromPiped(videoId, outputPath);
                    if (pipedRes.sucesso && fs.existsSync(outputPath)) {
                        const buffer = await fs.promises.readFile(outputPath);
                        await this.cleanupFile(outputPath);
                        return { sucesso: true, buffer, metadata };
                    }
                }

                return { sucesso: false, error: `yt-dlp bloqueado: ${msg}` };
            }

            if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 10000) {
                return { sucesso: false, error: 'YouTube bloqueou. Tente um vídeo diferente ou aguarde.' };
            }

            const buffer = await fs.promises.readFile(outputPath);
            await this.cleanupFile(outputPath);
            return { sucesso: true, buffer, metadata };

        } catch (error: any) {
            this.logger?.error(`❌ Erro download audio: ${error.message}`);
            return { sucesso: false, error: error.message };
        }
    }

    /**
     * ═══════════════════════════════════════════════════════════════════════
     * DOWNLOAD DE VÍDEO - yt-dlp COM GAMBIARRAS CONTRA BLOQUEIO DO YOUTUBE
     * ═══════════════════════════════════════════════════════════════════════
     */
    async downloadYouTubeVideo(url: string, retryCount: number = 0, playerClient: string = 'web_embedded'): Promise<{ sucesso: boolean; buffer?: Buffer; filePath?: string; error?: string; metadata?: any }> {
        try {
            this.logger?.info(`🎬 Download vídeo: ${url}${retryCount > 0 ? ` (retry ${retryCount}/3)` : ''} (player_client=${playerClient})`);

            const metadata = await this._getYouTubeMetadataSimple(url);
            if (!metadata.sucesso) {
                return { sucesso: false, error: 'Não foi possível encontrar vídeo para esse nome.' };
            }

            const finalUrl = metadata.url || url;
            const outputPath = this.generateRandomFilename('mp4');

            this.logger?.info(`[VÍDEO] Rodando yt-dlp com gambiarra player_client=${playerClient}...`);
            const cmd = this._buildYtdlpCommand(finalUrl, {
                type: 'video',
                output: outputPath,
                retryCount: retryCount,
                playerClient: playerClient
            });

            try {
                this.logger?.debug(`Comando: ${cmd.substring(0, 200)}...`);
                await execAsync(cmd, { timeout: 360000, maxBuffer: 500 * 1024 * 1024 });
            } catch (e: any) {
                const fullErrorStr = (e.stderr || e.message || '').toLowerCase();
                const msg = fullErrorStr.split('\n')[0];
                this.logger?.error(`❌ yt-dlp erro: ${msg}`);

                // Retry com cascade estratégico de player_client
                if ((fullErrorStr.includes('format not available') || fullErrorStr.includes('format is not available') || fullErrorStr.includes('jsc')) && retryCount < 3) {
                    const clients = ['ios', 'android', 'web', 'tv'];
                    const nextClient = clients[retryCount] || clients[clients.length - 1];
                    this.logger?.info(`🔄 [FORMAT RETRY] Tentando client alternativo: ${nextClient}...`);
                    if (fs.existsSync(outputPath)) await this.cleanupFile(outputPath);
                    await new Promise(r => setTimeout(r, 2000));
                    return await this.downloadYouTubeVideo(url, retryCount + 1, nextClient);
                }

                // FALLBACK EXTREMO EM CASO DE ERRO FATAL:
                this.logger?.warn(`⚠️ yt-dlp falhou com erro fatal, tentando FALLBACK EXTREMO...`);
                const videoId = metadata.videoId || this._extractVideoId(finalUrl);
                if (videoId) {
                    // Tenta Piped
                    this.logger?.info(`🌊 Tentando FALLBACK 1: Piped VÍDEO API...`);
                    const pipedRes = await this._downloadVideoStreamFromPiped(videoId, outputPath, '720');
                    if (pipedRes.sucesso && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 100000) {
                        const buffer = await fs.promises.readFile(outputPath);
                        await this.cleanupFile(outputPath);
                        return { sucesso: true, buffer, metadata };
                    }
                    // Tenta Invidious
                    this.logger?.info(`🔌 Tentando FALLBACK 2: Invidious Proxy...`);
                    const invRes = await this._downloadViaInvidiousProxy(videoId, outputPath, 'video', '720');
                    if (invRes.sucesso && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 100000) {
                        const buffer = await fs.promises.readFile(outputPath);
                        await this.cleanupFile(outputPath);
                        return { sucesso: true, buffer, metadata };
                    }
                }

                return { sucesso: false, error: `yt-dlp bloqueado: ${msg}` };
            }

            // Validação de arquivo (Silent Fail check)
            if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 100000) {
                // Se o arquivo existe mas é pequeno, tenta o PRÓXIMO client antes de ir pro fallback
                if (retryCount < 3) {
                    const clients = ['ios', 'android', 'web', 'tv'];
                    const nextClient = clients[retryCount] || clients[clients.length - 1];
                    const size = fs.existsSync(outputPath) ? fs.statSync(outputPath).size : 0;
                    this.logger?.info(`🔄 [SIZE RETRY] Arquivo inexistente ou muito pequeno (${size} bytes). Tentando client: ${nextClient}...`);
                    if (fs.existsSync(outputPath)) await this.cleanupFile(outputPath);
                    await new Promise(r => setTimeout(r, 2000));
                    return await this.downloadYouTubeVideo(url, retryCount + 1, nextClient);
                }

                // FALLBACKS APÓS TODOS OS CLIENTS FALHAREM
                this.logger?.warn(`⚠️ Todos os clients do yt-dlp produziram arquivos inválidos. Tentando Fallbacks...`);
                const videoId = metadata.videoId || this._extractVideoId(finalUrl);

                if (videoId) {
                    // 1. Tenta Piped
                    this.logger?.info(`🌊 Tentando FALLBACK 1: Piped VÍDEO API...`);
                    const pipedRes = await this._downloadVideoStreamFromPiped(videoId, outputPath, '720');
                    if (pipedRes.sucesso && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 100000) {
                        const buffer = await fs.promises.readFile(outputPath);
                        await this.cleanupFile(outputPath);
                        return { sucesso: true, buffer, metadata };
                    }

                    // 2. Tenta Invidious
                    this.logger?.info(`🔌 Tentando FALLBACK 2: Invidious Proxy...`);
                    const invRes = await this._downloadViaInvidiousProxy(videoId, outputPath, 'video', '720');
                    if (invRes.sucesso && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 100000) {
                        const buffer = await fs.promises.readFile(outputPath);
                        await this.cleanupFile(outputPath);
                        return { sucesso: true, buffer, metadata };
                    }
                }

                if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 5000) {
                    return { sucesso: false, error: 'YouTube bloqueou o download em todas as camadas. Tente novamente mais tarde.' };
                }
            }

            const buffer = await fs.promises.readFile(outputPath);
            await this.cleanupFile(outputPath);
            return { sucesso: true, buffer, metadata };

        } catch (error: any) {
            this.logger?.error(`❌ Erro download video: ${error.message}`);
            return { sucesso: false, error: error.message };
        }
    }

    /**
     * Obtém metadados usando método simples - VERSÃO ROBUSTA
     * Tenta múltiplas fontes: yt-dlp, Invidious, Piped, ytdl-core
     */
    private async _getYouTubeMetadataSimple(url: string): Promise<any> {
        // Extrai video ID da URL (apenas funciona se for uma URL válida do YouTube)
        let videoId = this._extractVideoId(url);
        const isSearch = !url.startsWith('http');

        // SE for uma busca por nome (não URL), precisamos resolver o nome → videoId primeiro
        if (isSearch && !videoId) {
            this.logger?.info(`🔍 Buscando "${url}" via APIs Fallback...`);
            const searchResult = await this._searchYouTubeFallback(url);
            if (searchResult.sucesso && searchResult.videoId) {
                videoId = searchResult.videoId;
                this.logger?.info(`✅ Encontrado via busca: ${searchResult.titulo} (${videoId})`);
                // Retorna direto com todos os metadados da busca
                return {
                    sucesso: true,
                    titulo: searchResult.titulo,
                    canal: searchResult.canal,
                    duracao: searchResult.duracao,
                    duracaoFormatada: searchResult.duracaoFormatada,
                    thumbnail: searchResult.thumbnail,
                    url: `https://www.youtube.com/watch?v=${videoId}`,
                    videoId,
                    visualizacoes: searchResult.visualizacoes || 'N/A',
                    curtidas: searchResult.curtidas || 'N/A',
                    dataPublicacao: searchResult.dataPublicacao || 'N/A'
                };
            }
            this.logger?.warn(`⚠️ Busca inicial falhou para "${url}", tentando yt-dlp search...`);
        } else {
            this.logger?.info(`🔍 Extraindo metadados para video ID: ${videoId || '(URL sem ID)'}`);
        }

        // PRIORIDADE 1: Invidious API (direto pelo ID, se temos o ID)
        if (videoId) {
            const invidiousResult = await this._getMetadataFromInvidious(videoId);
            if (invidiousResult.sucesso) {
                this.logger?.info(`✅ Metadados via Invidious: ${invidiousResult.titulo}`);
                return { ...invidiousResult, videoId };
            }

            // PRIORIDADE 2: Piped API
            const pipedResult = await this._getMetadataFromPiped(videoId);
            if (pipedResult.sucesso) {
                this.logger?.info(`✅ Metadados via Piped: ${pipedResult.titulo}`);
                return { ...pipedResult, videoId };
            }
        }

        // PRIORIDADE 3: yt-dlp (busca ou URL)
        const commands = [
            this._buildYtdlpCommand(url, { type: 'json', isSearch }),
            `yt-dlp --dump-json --no-download ${isSearch ? `ytsearch1:${url}` : url}`
        ];

        for (const cmd of commands) {
            try {
                const { stdout } = await execAsync(cmd, { timeout: 45000 });
                if (stdout && stdout.trim()) {
                    const data = JSON.parse(stdout.split('\n')[0].trim());
                    const resolvedUrl = data.webpage_url || (data.id ? `https://www.youtube.com/watch?v=${data.id}` : url);
                    const resolvedId = data.id || videoId;

                    return {
                        sucesso: true,
                        titulo: data.title || 'Título desconhecido',
                        canal: data.channel || data.uploader || 'Canal desconhecido',
                        duracao: data.duration || 0,
                        duracaoFormatada: this._formatDuration(data.duration || 0),
                        thumbnail: data.thumbnail || '',
                        url: resolvedUrl,
                        videoId: resolvedId,
                        visualizacoes: this._formatStats(data.view_count),
                        curtidas: this._formatStats(data.like_count),
                        dataPublicacao: this._formatDate(data.upload_date)
                    };
                }
            } catch (err: any) {
                this.logger?.debug(`⚠️ yt-dlp metadata falhou: ${err.message.substring(0, 50)}`);
            }
        }

        // Último recurso: URL direta sem metadata completo
        if (url.startsWith('http')) {
            this.logger?.warn('⚠️ Todas as fontes de metadata falharam. Usando dados mínimos.');
            return {
                sucesso: true,
                titulo: this._extractTitleFromUrl(url),
                canal: 'Canal desconhecido',
                duracao: 0,
                duracaoFormatada: '0:00',
                thumbnail: videoId ? `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg` : '',
                url: url,
                videoId,
                visualizacoes: 'N/A',
                curtidas: 'N/A',
                dataPublicacao: 'N/A'
            };
        }

        this.logger?.error(`❌ Falha total: não foi possível resolver "${url}"`);
        return { sucesso: false, error: 'Não foi possível encontrar o conteúdo solicitado.' };
    }

    /**
     * Extrai video ID da URL do YouTube
     */
    private _extractVideoId(url: string): string {
        const patterns = [
            /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
            /^([a-zA-Z0-9_-]{11})$/
        ];

        for (const pattern of patterns) {
            const match = url.match(pattern);
            if (match) return match[1];
        }
        return '';
    }

    /**
     * Extrai título básico da URL (último recurso)
     */
    private _extractTitleFromUrl(url: string): string {
        try {
            const videoId = this._extractVideoId(url);
            return `YouTube Video (${videoId})`;
        } catch {
            return 'Vídeo do YouTube';
        }
    }

    /**
     * Busca um vídeo por nome nas APIs públicas (Piped)
     */
    private async _searchYouTubeFallback(query: string): Promise<any> {
        try {
            const yts = await import('yt-search').then(m => m.default || m);
            const r = await yts(query);
            const videos = r.videos.slice(0, 1);
            if (videos.length > 0) {
                const first = videos[0];
                return {
                    sucesso: true,
                    videoId: first.videoId,
                    titulo: first.title,
                    canal: first.author?.name || 'Desconhecido',
                    duracao: first.seconds,
                    duracaoFormatada: first.timestamp,
                    thumbnail: first.thumbnail || `https://img.youtube.com/vi/${first.videoId}/maxresdefault.jpg`,
                    visualizacoes: this._formatStats(first.views),
                    dataPublicacao: first.ago || 'N/A',
                    curtidas: 'N/A'
                };
            }
        } catch (err: any) {
            this.logger?.debug(`⚠️ yt-search falhou: ${err.message?.substring(0, 40)}`);
        }

        return { sucesso: false };
    }

    /**
     * Obtém metadados via Invidious API
     */
    private async _getMetadataFromInvidious(videoId: string): Promise<any> {
        // Instâncias Invidious VERIFICADAS e ATIVAS (Março 2026)
        const invidiousInstances = [
            'https://yewtu.be',
            'https://inv.nadeko.net',
            'https://invidious.flokinet.to',
            'https://yt.artemislena.eu',
            'https://invidious.privacydev.net',
            'https://invidious.nerdvpn.de',
            'https://invidious.v0l.io'
        ];

        for (const instance of invidiousInstances) {
            try {
                const response = await axios.get(`${instance}/api/v1/videos/${videoId}`, {
                    timeout: 10000,
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
                });

                if (response.data) {
                    const data = response.data;
                    return {
                        sucesso: true,
                        titulo: data.title || 'Título desconhecido',
                        canal: data.author || 'Canal desconhecido',
                        duracao: data.lengthSeconds || 0,
                        duracaoFormatada: this._formatDuration(data.lengthSeconds || 0),
                        thumbnail: data.thumbnails?.[data.thumbnails?.length - 1]?.url || '',
                        url: `https://youtube.com/watch?v=${videoId}`,
                        visualizacoes: this._formatStats(data.viewCount),
                        curtidas: this._formatStats(data.likeCount),
                        dataPublicacao: data.publishedText || 'N/A'
                    };
                }
            } catch (err: any) {
                this.logger?.debug(`⚠️ Invidious ${instance} falhou: ${err.message.substring(0, 30)}`);
            }
        }

        return { sucesso: false, error: 'Todas as instâncias Invidious falharam' };
    }

    /**
     * Obtém metadados via Piped API
     */
    private async _getMetadataFromPiped(videoId: string): Promise<any> {
        const pipedInstances = [
            'https://pipedapi.kavin.rocks',
            'https://pipedapi.tokhmi.xyz',
            'https://pipedapi.syncpundit.io',
            'https://api.piped.projectsegfau.lt',
            'https://watchapi.whatever.social'
        ];

        for (const instance of pipedInstances) {
            try {
                const response = await axios.get(`${instance}/streams/${videoId}`, {
                    timeout: 10000,
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
                });

                if (response.data) {
                    const data = response.data;
                    return {
                        sucesso: true,
                        titulo: data.title || 'Título desconhecido',
                        canal: data.uploader || 'Canal desconhecido',
                        duracao: data.duration || 0,
                        duracaoFormatada: this._formatDuration(data.duration || 0),
                        thumbnail: data.thumbnailUrl || '',
                        url: `https://youtube.com/watch?v=${videoId}`,
                        visualizacoes: this._formatStats(data.views),
                        curtidas: this._formatStats(data.likes),
                        dataPublicacao: data.uploadDate || 'N/A'
                    };
                }
            } catch (err: any) {
                this.logger?.debug(`⚠️ Piped ${instance} falhou: ${err.message?.substring(0, 30)}`);
            }
        }

        return { sucesso: false, error: 'Todas as instâncias Piped falharam' };
    }

    /**
     * Baixa o stream de áudio DIRETAMENTE via Piped API
     * Usa curl como subprocess (não via Node.js puro) para melhor compatibilidade
     * e bypass de limitações da camada HTTP do Node.js
     */
    private async _downloadStreamFromPiped(videoId: string, outputPath: string): Promise<{ sucesso: boolean; error?: string }> {
        if (!videoId) {
            return { sucesso: false, error: 'videoId não pode ser vazio' };
        }

        // Instâncias Piped VERIFICADAS (Março 2026)
        const pipedInstances = [
            'https://pipedapi.kavin.rocks',
            'https://pipedapi.tokhmi.xyz',
            'https://pipedapi.syncpundit.io',
            'https://api.piped.projectsegfau.lt',
            'https://watchapi.whatever.social'
        ];

        for (const instance of pipedInstances) {
            try {
                this.logger?.info(`🌊 Piped stream: ${instance}/streams/${videoId}`);
                const response = await axios.get(`${instance}/streams/${videoId}`, {
                    timeout: 15000,
                    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AkiraBot/1.0)' }
                });

                const data = response.data;
                let streamUrl: string | null = null;
                let mimeType = 'audio/webm';

                if (data.audioStreams && data.audioStreams.length > 0) {
                    const sorted = [...data.audioStreams].sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0));
                    const best = sorted.find((s: any) => s.url);
                    streamUrl = best?.url || null;
                    mimeType = best?.mimeType || 'audio/webm';
                }

                if (!streamUrl) {
                    this.logger?.warn(`⚠️ Piped ${instance}: sem URL de stream de áudio`);
                    continue;
                }

                // Determina extensão pelo MIME type
                const rawExt = mimeType.includes('mp4') ? 'mp4' : 'webm';
                const rawPath = outputPath.replace('.mp3', `.${rawExt}`);

                // ════════════════════════════════════════════════════
                // Usa CURL como subprocess para download (não via Node)
                // Isso bypassa limitações do Node.js HTTP e é mais robusto
                // ════════════════════════════════════════════════════
                this.logger?.info(`📥 Baixando via curl: ${streamUrl.substring(0, 60)}...`);
                const curlCmd = `curl -L -s --max-time 300 --retry 3 \
                    -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" \
                    -H "Referer: https://www.youtube.com/" \
                    -o "${rawPath}" \
                    "${streamUrl}"`;

                await execAsync(curlCmd, { timeout: 320000, maxBuffer: 500 * 1024 * 1024 });

                if (!fs.existsSync(rawPath) || fs.statSync(rawPath).size < 1000) {
                    this.logger?.warn(`⚠️ curl baixou arquivo vazio ou inválido`);
                    continue;
                }

                // Converter para MP3 via ffmpeg
                this.logger?.info(`🎵 Convertendo para MP3 via ffmpeg...`);
                await new Promise<void>((resolve, reject) => {
                    ffmpeg(rawPath)
                        .toFormat('mp3')
                        .audioCodec('libmp3lame')
                        .audioBitrate('192k')
                        .on('end', () => resolve())
                        .on('error', (err: Error) => reject(err))
                        .save(outputPath);
                });

                await this.cleanupFile(rawPath);
                this.logger?.info(`✅ Piped + curl download concluído!`);
                return { sucesso: true };

            } catch (err: any) {
                this.logger?.warn(`⚠️ Piped stream ${instance} falhou: ${err.message?.substring(0, 60)}`);
            }
        }

        return { sucesso: false, error: 'Todas as instâncias Piped falharam no stream' };
    }

    /**
     * Baixa o stream de vídeo DIRETAMENTE via Piped API
     * Usa curl como subprocess para garantir estabilidade no download
     */
    private async _downloadVideoStreamFromPiped(videoId: string, outputPath: string, targetQuality: string = '720'): Promise<{ sucesso: boolean; error?: string }> {
        if (!videoId) {
            return { sucesso: false, error: 'videoId não pode ser vazio' };
        }

        // Instâncias Piped VERIFICADAS (Março 2026)
        const pipedInstances = [
            'https://pipedapi.kavin.rocks',
            'https://pipedapi.tokhmi.xyz',
            'https://pipedapi.syncpundit.io',
            'https://api.piped.projectsegfau.lt',
            'https://watchapi.whatever.social'
        ];

        for (const instance of pipedInstances) {
            try {
                this.logger?.info(`🌊 Piped VÍDEO stream: ${instance}/streams/${videoId}`);
                const response = await axios.get(`${instance}/streams/${videoId}`, {
                    timeout: 15000,
                    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AkiraBot/1.0)' }
                });

                const data = response.data;
                let videoUrl: string | null = null;
                let audioUrl: string | null = null;
                let needsMuxing = false;

                if (data.videoStreams && data.videoStreams.length > 0) {
                    const targetQualNum = parseInt(targetQuality) || 360;

                    const validStreams = data.videoStreams.filter((s: any) => s.quality !== 'auto');

                    if (validStreams.length > 0) {
                        const sorted = validStreams.sort((a: any, b: any) => {
                            const qA = parseInt(a.quality.replace('p', '')) || 0;
                            const qB = parseInt(b.quality.replace('p', '')) || 0;
                            if (qA <= targetQualNum && qB > targetQualNum) return -1;
                            if (qB <= targetQualNum && qA > targetQualNum) return 1;
                            return qB - qA;
                        });

                        const selectedVideo = sorted[0];
                        videoUrl = selectedVideo?.url || null;
                        needsMuxing = selectedVideo?.videoOnly === true;
                    }
                }

                if (!videoUrl) {
                    this.logger?.warn(`⚠️ Piped ${instance}: sem URL de stream VÍDEO`);
                    continue;
                }

                if (needsMuxing && data.audioStreams && data.audioStreams.length > 0) {
                    const sortedAudio = [...data.audioStreams].sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0));
                    audioUrl = sortedAudio[0]?.url || null;
                }

                if (needsMuxing && !audioUrl) {
                    this.logger?.warn(`⚠️ Piped ${instance} precisa de muxing mas não tem stream de áudio`);
                    continue;
                }

                this.logger?.info(`📥 Baixando VÍDEO via curl (${needsMuxing ? 'Muxing: Video+Audio' : 'Muxed direto'})...`);

                if (needsMuxing) {
                    const tempVideo = outputPath.replace('.mp4', '_v.mp4');
                    const tempAudio = outputPath.replace('.mp4', '_a.m4a');

                    const curlVidCmd = `curl -L -s --max-time 300 --retry 3 -H "User-Agent: Mozilla/5.0" -H "Referer: https://www.youtube.com/" -o "${tempVideo}" "${videoUrl}"`;
                    await execAsync(curlVidCmd, { timeout: 320000, maxBuffer: 500 * 1024 * 1024 });

                    const curlAudCmd = `curl -L -s --max-time 300 --retry 3 -H "User-Agent: Mozilla/5.0" -H "Referer: https://www.youtube.com/" -o "${tempAudio}" "${audioUrl}"`;
                    await execAsync(curlAudCmd, { timeout: 320000, maxBuffer: 500 * 1024 * 1024 });

                    if (!fs.existsSync(tempVideo) || !fs.existsSync(tempAudio)) {
                        this.logger?.warn(`⚠️ Erro ao baixar arquivos temporários para Muxing no ${instance}`);
                        continue;
                    }

                    this.logger?.info(`🎵 Muxing Áudio e Vídeo via ffmpeg...`);
                    await new Promise<void>((resolve, reject) => {
                        ffmpeg()
                            .input(tempVideo)
                            .input(tempAudio)
                            .outputOptions(['-c:v copy', '-c:a aac'])
                            .on('end', () => resolve())
                            .on('error', (err: Error) => reject(err))
                            .save(outputPath);
                    });

                    await this.cleanupFile(tempVideo);
                    await this.cleanupFile(tempAudio);
                } else {
                    const curlCmd = `curl -L -s --max-time 300 --retry 3 -H "User-Agent: Mozilla/5.0" -H "Referer: https://www.youtube.com/" -o "${outputPath}" "${videoUrl}"`;
                    await execAsync(curlCmd, { timeout: 320000, maxBuffer: 500 * 1024 * 1024 });
                }

                if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 10000) {
                    this.logger?.info(`✅ Piped VÍDEO download concluído!`);
                    return { sucesso: true };
                }

            } catch (err: any) {
                this.logger?.warn(`⚠️ Piped VÍDEO ${instance} falhou: ${err.message?.substring(0, 60)}`);
            }
        }

        return { sucesso: false, error: 'Todas as instâncias falharam no stream de áudio' };
    }

    /**
     * ═══════════════════════════════════════════════════════════════════════
     * DOWNLOAD VIA INVIDIOUS PROXY - BYPASS TOTAL DO 429/SHADOW BLOCK
     * ═══════════════════════════════════════════════════════════════════════
     * Usa a API do Invidious para obter URLs de stream direta e baixa via curl.
     * As URLs de stream do Invidious passam pelo servidor DELES, não pelo IP do Railway.
     */
    private async _downloadViaInvidiousProxy(
        videoId: string,
        outputPath: string,
        type: 'audio' | 'video',
        quality: string = '720'
    ): Promise<{ sucesso: boolean; error?: string }> {
        if (!videoId) return { sucesso: false, error: 'videoId vazio' };

        // Instâncias Invidious com suporte a streaming (Março 2026)
        const instances = [
            'https://yewtu.be',
            'https://inv.nadeko.net',
            'https://invidious.flokinet.to',
            'https://yt.artemislena.eu',
            'https://invidious.nerdvpn.de',
            'https://invidious.v0l.io'
        ];

        for (const instance of instances) {
            try {
                this.logger?.info(`🔌 Invidious Proxy: ${instance}/api/v1/videos/${videoId}`);
                const resp = await axios.get(`${instance}/api/v1/videos/${videoId}?fields=adaptiveFormats,formatStreams`, {
                    timeout: 12000,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                        'Accept': 'application/json',
                        'Accept-Language': 'en-US,en;q=0.9',
                        'Origin': instance,
                        'Referer': `${instance}/watch?v=${videoId}`
                    }
                });

                const data = resp.data;
                let streamUrl: string | null = null;

                if (type === 'audio') {
                    // Prioriza audio/mp4 (M4A) para depois converter com ffmpeg
                    const audioStreams: any[] = data.adaptiveFormats?.filter((f: any) =>
                        f.type?.startsWith('audio')
                    ) || [];
                    audioStreams.sort((a: any, b: any) => (parseInt(b.bitrate) || 0) - (parseInt(a.bitrate) || 0));
                    streamUrl = audioStreams[0]?.url || null;

                    if (!streamUrl && data.formatStreams?.length > 0) {
                        // Fallback: formato progressivo (tem áudio+vídeo)
                        streamUrl = data.formatStreams[0]?.url || null;
                    }
                } else {
                    // Procura stream de vídeo com a qualidade mais próxima
                    const targetHeight = parseInt(quality) || 720;
                    const videoStreams: any[] = data.adaptiveFormats?.filter((f: any) =>
                        f.type?.startsWith('video') && f.container === 'mp4'
                    ) || [];
                    videoStreams.sort((a: any, b: any) => {
                        // Prefere a resolução mais próxima do alvo
                        return Math.abs(parseInt(a.resolution) - targetHeight) - Math.abs(parseInt(b.resolution) - targetHeight);
                    });

                    // Primeiro tenta formato progressivo (áudio + vídeo juntos)
                    const progressive = data.formatStreams?.find((f: any) =>
                        parseInt(f.resolution) <= targetHeight
                    );
                    streamUrl = progressive?.url || videoStreams[0]?.url || null;
                }

                if (!streamUrl) {
                    this.logger?.warn(`⚠️ Invidious ${instance}: sem URL de stream`);
                    continue;
                }

                // A URL do Invidious pode ser um proxy deles (ex: ${instance}/videoplayback?...) OU
                // a URL direta do Google. Ambas funcionam via curl.
                this.logger?.info(`📥 [Invidious Proxy] Baixando via curl: ${streamUrl.substring(0, 70)}...`);

                const rawPath = type === 'audio' ? outputPath.replace('.mp3', '.m4a') : outputPath;
                const curlCmd = [
                    'curl -L -s --max-time 300 --retry 2',
                    '-H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"',
                    `-H "Referer: ${instance}/"`,
                    `-o "${rawPath}"`,
                    `"${streamUrl}"`
                ].join(' ');

                await execAsync(curlCmd, { timeout: 320000, maxBuffer: 512 * 1024 * 1024 });

                if (!fs.existsSync(rawPath) || fs.statSync(rawPath).size < 5000) {
                    this.logger?.warn(`⚠️ Invidious ${instance}: arquivo baixado vazio ou inválido`);
                    continue;
                }

                if (type === 'audio' && rawPath !== outputPath) {
                    // Converte M4A → MP3 via ffmpeg
                    await new Promise<void>((resolve, reject) => {
                        ffmpeg(rawPath)
                            .toFormat('mp3')
                            .audioCodec('libmp3lame')
                            .audioQuality(0)
                            .on('end', () => resolve())
                            .on('error', (e: Error) => reject(e))
                            .save(outputPath);
                    });
                    await this.cleanupFile(rawPath);
                }

                if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 5000) {
                    this.logger?.info(`✅ [Invidious Proxy] Download concluído com sucesso!`);
                    return { sucesso: true };
                }

            } catch (err: any) {
                this.logger?.warn(`⚠️ Invidious ${instance} falhou: ${err.message?.substring(0, 60)}`);
            }
        }

        return { sucesso: false, error: 'Todas as instâncias Invidious falharam' };
    }

    /**
     * Cria agente com cookies para o @distube/ytdl-core
     */
    private async _createYtdlAgent(): Promise<any> {
        const cookiePath = this._findCookiePath();
        if (!cookiePath) return undefined;
        try {
            const ytdl = await import('@distube/ytdl-core').then(m => m.default || m);
            const content = await fs.promises.readFile(cookiePath, 'utf8');
            const cookies = content.split('\n')
                .filter(l => {
                    if (l.startsWith('#') || !l.trim()) return false;
                    const parts = l.split('\t');
                    if (parts.length < 7) return false;
                    const domain = parts[0].toLowerCase();
                    // Aceita APENAS domínios do youtube para evitar erro "Cookie not in this host's domain"
                    // Muitos cookies do Google são espelhados como __Secure- no youtube.com
                    return domain.includes('youtube.com');
                })
                .map(line => {
                    const parts = line.split('\t');
                    let domain = parts[0];
                    // Normalização básica de domínio para a biblioteca
                    if (domain.startsWith('#HttpOnly_')) domain = domain.replace('#HttpOnly_', '');
                    return {
                        domain: domain,
                        path: parts[2],
                        secure: parts[3] === 'TRUE',
                        name: parts[5],
                        value: parts[6]
                    };
                });
            return ytdl.createAgent(cookies);
        } catch (e: any) {
            this.logger?.warn(`⚠️ Erro ao criar agent de cookies ytdl: ${e.message}`);
            return undefined;
        }
    }

    /**
     * Obtém metadados usando ytdl-core
     */
    private async _getMetadataYtdlCore(url: string): Promise<any> {
        try {
            const ytdl = await import('@distube/ytdl-core').then(m => m.default || m);

            const agent = await this._createYtdlAgent();
            const options = agent ? { agent } : {};

            const info = await ytdl.getInfo(url, options);
            const videoDetails = info.videoDetails;

            return {
                sucesso: true,
                titulo: videoDetails.title || 'Título desconhecido',
                canal: videoDetails.author?.name || 'Canal desconhecido',
                duracao: parseInt(videoDetails.lengthSeconds) || 0,
                duracaoFormatada: this._formatDuration(parseInt(videoDetails.lengthSeconds) || 0),
                thumbnail: videoDetails.thumbnails?.[0]?.url || '',
                url: videoDetails.video_url || url,
                visualizacoes: this._formatStats(videoDetails.viewCount),
                curtidas: this._formatStats(videoDetails.likes),
                dataPublicacao: videoDetails.publishDate || 'N/A'
            };
        } catch (err: any) {
            this.logger?.warn(`⚠️ ytdl-core falhou: ${err.message}`);
            return { sucesso: false, error: err.message };
        }
    }

    /**
     * Download usando ytdl-core como fallback
     */
    private async _downloadWithYtdlCore(url: string, type: 'audio' | 'video', metadata?: any): Promise<{ sucesso: boolean; buffer?: Buffer; error?: string; metadata?: any }> {
        try {
            this.logger?.info(`📥 Usando @distube/ytdl-core para ${type}...`);

            const ytdl = await import('@distube/ytdl-core').then(m => m.default || m);


            const agent = await this._createYtdlAgent();
            const poToken = this.config?.YT_PO_TOKEN;
            const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

            const options: any = {
                requestOptions: {
                    headers: {
                        'User-Agent': userAgent
                    }
                }
            };

            if (agent) options.agent = agent;

            if (poToken) {
                options.requestOptions.headers['x-youtube-identity-token'] = poToken;
                options.poToken = poToken;
            }

            const info = await ytdl.getInfo(url, options);
            const formats = info.formats;

            let format;
            if (type === 'audio') {
                format = ytdl.chooseFormat(formats, { quality: 'highestaudio', filter: 'audioonly' });
            } else {
                format = ytdl.chooseFormat(formats, { quality: 'highest' });
            }

            if (!format || !format.url) {
                return { sucesso: false, error: 'Não foi possível obter URL de download' };
            }

            // Pega string de cookies pro axios como segurança, se existir.
            let cookieHeader = '';
            if (agent && agent.jar && typeof agent.jar.getCookieStringSync === 'function') {
                cookieHeader = agent.jar.getCookieStringSync(format.url) || '';
            }

            // Download usando axios
            const response = await axios.get(format.url, {
                responseType: 'arraybuffer',
                timeout: 300000,
                maxContentLength: 500 * 1024 * 1024,
                headers: cookieHeader ? { 'Cookie': cookieHeader } : {}
            });

            let buffer = Buffer.from(response.data);

            // Se for áudio, converte para MP3
            if (type === 'audio') {
                const inputPath = this.generateRandomFilename('webm');
                const outputPath = this.generateRandomFilename('mp3');

                await fs.promises.writeFile(inputPath, buffer);

                await new Promise((resolve, reject) => {
                    ffmpeg(inputPath)
                        .toFormat('mp3')
                        .audioCodec('libmp3lame')
                        .on('end', () => resolve(void 0))
                        .on('error', reject)
                        .save(outputPath);
                });

                buffer = await fs.promises.readFile(outputPath);
                await this.cleanupFile(inputPath);
                await this.cleanupFile(outputPath);
            }

            const videoMeta = metadata || {
                titulo: info.videoDetails.title,
                canal: info.videoDetails.author?.name,
                duracao: parseInt(info.videoDetails.lengthSeconds),
                duracaoFormatada: this._formatDuration(parseInt(info.videoDetails.lengthSeconds) || 0),
                thumbnail: info.videoDetails.thumbnails?.[0]?.url
            };

            return {
                sucesso: true,
                buffer,
                metadata: videoMeta
            };

        } catch (error: any) {
            this.logger?.error(`❌ Erro ytdl-core: ${error.message}`);

            // Sugestão de PO_TOKEN se for erro de bot
            if (error.message?.includes('Sign in') || error.message?.includes('bot')) {
                if (!this.config?.YT_PO_TOKEN) {
                    return {
                        sucesso: false,
                        error: 'O YouTube bloqueou o download. Como você está no Railway, configure a variável YT_PO_TOKEN para burlar isso. Veja o arquivo RAILWAY_SETUP.md.'
                    };
                }
            }

            return { sucesso: false, error: error.message };
        }
    }

    /**
     * Obtém metadados de vídeo do YouTube (compatibilidade)
     */
    async getYouTubeMetadata(url: string): Promise<any> {
        return await this._getYouTubeMetadataSimple(url);
    }

    /**
     * Formata duração em segundos para MM:SS ou HH:MM:SS
     */
    private _formatDuration(seconds: number): string {
        if (!seconds || seconds <= 0) return '0:00';
        const hours = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        if (hours > 0) {
            return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    /**
     * Formata números grandes (K, M, B)
     */
    private _formatCount(num: number): string {
        if (!num || num <= 0) return '0';
        if (num >= 1000000000) return (num / 1000000000).toFixed(1).replace(/\.0$/, '') + 'B';
        if (num >= 1000000) return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
        if (num >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
        return num.toString();
    }

    /**
     * Gera nome de arquivo aleatório
     */
    generateRandomFilename(ext: string = ''): string {
        return path.join(
            this.tempFolder,
            `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext ? '.' + ext : ''}`
        );
    }

    /**
     * Limpa arquivo temporário
     */
    async cleanupFile(filePath: string): Promise<void> {
        try {
            if (!filePath || !fs.existsSync(filePath)) return;
            await fs.promises.unlink(filePath).catch(() => { });
        } catch (e) {
            // Silencioso
        }
    }

    /**
     * Download de mídia via Baileys
     */
    async downloadMedia(message: any, mimeType: string = 'image'): Promise<{ buffer: Buffer; mediaContent: any } | null> {
        try {
            if (!message) {
                this.logger?.error('❌ Mensagem é null');
                return null;
            }

            const extractMediaContainer = (msgObj: any, depth: number = 0): any => {
                if (!msgObj || typeof msgObj !== 'object' || depth > 5) return null;

                // Se encontramos as chaves de mídia, retornamos este objeto
                if (msgObj.mediaKey && (msgObj.url || msgObj.directPath)) return msgObj;

                // Wrappers conhecidos
                const wraps = [
                    msgObj.viewOnceMessageV2?.message,
                    msgObj.viewOnceMessageV2Extension?.message,
                    msgObj.viewOnceMessage?.message,
                    msgObj.ephemeralMessage?.message,
                    msgObj.documentWithCaptionMessage?.message,
                    msgObj.editMessage?.message,
                    msgObj.protocolMessage?.editedMessage,
                    msgObj.extendedTextMessage?.contextInfo?.quotedMessage,
                    msgObj.message // Caso a estrutura esteja um nível abaixo
                ];

                for (const w of wraps) {
                    if (w) {
                        const found = extractMediaContainer(w, depth + 1);
                        if (found) return found;
                    }
                }

                // Sub-mensagens específicas
                const subKeys = ['imageMessage', 'videoMessage', 'stickerMessage', 'audioMessage', 'documentMessage'];
                for (const k of subKeys) {
                    if (msgObj[k]) {
                        // Se o objeto em msgObj[k] já tem as chaves, retorna ele
                        if (msgObj[k].mediaKey) return msgObj[k];
                        // Senão, aprofunda
                        const found = extractMediaContainer(msgObj[k], depth + 1);
                        if (found) return found;
                    }
                }

                return null;
            };

            const mediaContent = extractMediaContainer(message);
            if (!mediaContent) {
                this.logger?.error('❌ Mídia não encontrada. Estrutura:', JSON.stringify(message).substring(0, 200));
                return null;
            }

            let finalMimeType = mimeType;
            if (mediaContent.mimetype) {
                if (mediaContent.mimetype.includes('image')) finalMimeType = 'image';
                else if (mediaContent.mimetype.includes('video')) finalMimeType = 'video';
                else if (mediaContent.mimetype.includes('audio')) finalMimeType = 'audio';
            }

            // Fallback de tipos para evitar erro de bad decrypt (1C800064)
            let typesToTry = [finalMimeType];
            if (finalMimeType === 'audio') typesToTry.push('document', 'video');
            else if (finalMimeType === 'image') typesToTry.push('document', 'sticker');
            else if (finalMimeType === 'video') typesToTry.push('document');
            else if (finalMimeType === 'document') typesToTry.push('image', 'video', 'audio', 'sticker');
            else typesToTry.push('document', 'image', 'video', 'audio', 'sticker');

            typesToTry = [...new Set(typesToTry)]; // Remove duplicatas

            let buffer = Buffer.from([]);
            let success = false;

            for (const tryType of typesToTry) {
                if (success) break;

                for (let attempt = 1; attempt <= 3; attempt++) {
                    try {
                        let stream;
                        try {
                            stream = await downloadContentFromMessage(mediaContent, tryType as any);
                        } catch (err: any) {
                            if (err.message?.includes('bad decrypt') || err.message?.includes('1C800064')) {
                                this.logger?.warn(`⚠️ Decrypt falhou com tipo '${tryType}'. Tentando outro tipo...`);
                                break;
                            }
                            throw err;
                        }

                        buffer = Buffer.from([]);
                        for await (const chunk of stream as any) {
                            buffer = Buffer.concat([buffer, chunk]);
                        }

                        if (buffer.length > 0) {
                            success = true;
                            if (tryType !== finalMimeType) {
                                this.logger?.info(`✅ Download mídia sucedeu usando tipo alternativo: ${tryType}`);
                            }
                            break;
                        }
                    } catch (err: any) {
                        const backoff = Math.pow(2, attempt) * 1000;
                        this.logger?.warn(`⚠️ Tentativa ${attempt} (tipo: ${tryType}) falhou: ${err.message}. Retrying in ${backoff}ms...`);
                        await new Promise(r => setTimeout(r, backoff));
                    }
                }
            }

            if (buffer.length < 100) {
                this.logger?.error(`❌ Buffer muito pequeno: ${buffer.length} bytes`);
                return null;
            }

            return { buffer, mediaContent };
        } catch (e: any) {
            this.logger?.error('❌ Erro ao baixar mídia:', e.message);
            return null;
        }
    }

    /**
     * Converte buffer para base64
     */
    bufferToBase64(buffer: Buffer): string | null {
        if (!buffer) return null;
        return buffer.toString('base64');
    }

    /**
     * Converte base64 para buffer
     */
    base64ToBuffer(base64String: string): Buffer | null {
        if (!base64String) return null;
        return Buffer.from(base64String, 'base64');
    }

    /**
     * Busca buffer de URL externa
     */
    async fetchBuffer(url: string): Promise<Buffer | null> {
        try {
            const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 10000 });
            return Buffer.from(res.data);
        } catch (e) {
            return null;
        }
    }

    /**
     * Adiciona metadados EXIF ao sticker
     */
    async addStickerMetadata(webpBuffer: Buffer, packName: string = 'akira-bot', author: string = 'Akira-Bot'): Promise<Buffer> {
        let tempInput: string | null = null;
        let tempOutput: string | null = null;

        try {
            if (!Webpmux) return webpBuffer;

            tempInput = this.generateRandomFilename('webp');
            tempOutput = this.generateRandomFilename('webp');

            await fs.promises.writeFile(tempInput, webpBuffer);

            const img = new Webpmux.Image();
            await img.load(tempInput);

            const json = {
                'sticker-pack-id': `akira-${crypto.randomBytes(8).toString('hex')}`,
                'sticker-pack-name': String(packName).trim().slice(0, 30),
                'sticker-pack-publisher': String(author).trim().slice(0, 30),
                'emojis': ['🎨', '🤖']
            };

            const exifAttr = Buffer.from([
                0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00,
                0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00,
                0x00, 0x00, 0x16, 0x00, 0x00, 0x00
            ]);

            const jsonBuff = Buffer.from(JSON.stringify(json), 'utf-8');
            const exif = Buffer.concat([exifAttr, jsonBuff]);
            exif.writeUIntLE(jsonBuff.length, 14, 4);

            img.exif = exif;

            if (img.anim?.frames?.length > 0) {
                await img.muxAnim({
                    path: tempOutput,
                    frames: img.anim.frames,
                    loops: img.anim.loops || 0,
                    exif: exif
                });
            } else {
                await img.save(tempOutput);
            }

            const result = await fs.promises.readFile(tempOutput);

            if (tempInput) await this.cleanupFile(tempInput);
            if (tempOutput) await this.cleanupFile(tempOutput);

            return result;
        } catch (e: any) {
            if (tempInput) await this.cleanupFile(tempInput);
            if (tempOutput) await this.cleanupFile(tempOutput);
            return webpBuffer;
        }
    }

    /**
     * Cria sticker de imagem
     */
    async createStickerFromImage(imageBuffer: Buffer, metadata: any = {}): Promise<any> {
        const inputPath = this.generateRandomFilename('jpg');
        const outputPath = this.generateRandomFilename('webp');

        try {
            const { packName = 'akira-bot', author = 'Akira-Bot' } = metadata;

            // ✅ NOVO: Carregar sharp dinamicamente
            const sharpLib = await loadSharp();

            if (sharpLib) {
                // ✅ FALLBACK: Usar Sharp em vez de ffmpeg (mais confiável)
                try {
                    let processado = sharpLib(imageBuffer);

                    // Redimensionar para 512x512
                    processado = processado
                        .resize(512, 512, {
                            fit: 'cover',
                            position: 'center'
                        })
                        .webp({
                            lossless: false,
                            quality: 75,
                            effort: 6
                        });

                    const webpBuffer = await processado.toBuffer();
                    const stickerComMetadados = await this.addStickerMetadata(webpBuffer, packName, author);

                    return {
                        sucesso: true,
                        buffer: stickerComMetadados,
                        tipo: 'sticker_image',
                        size: stickerComMetadados.length
                    };
                } catch (sharpError: any) {
                    this.logger?.warn(`⚠️ Sharp falhou: ${sharpError.message}, tentando ffmpeg...`);
                }
            }

            // FALLBACK: Tentar com ffmpeg se sharp falhar ou não estiver disponível
            await fs.promises.writeFile(inputPath, imageBuffer);

            const videoFilter = 'scale=512:512:flags=lanczos:force_original_aspect_ratio=increase,crop=512:512';

            try {
                await new Promise((resolve, reject) => {
                    const proc = ffmpeg(inputPath)
                        .outputOptions([
                            '-vcodec', 'libwebp',
                            '-vf', videoFilter,
                            '-s', '512x512',
                            '-lossless', '0',
                            '-compression_level', '4',
                            '-q:v', '75',
                            '-preset', 'default',
                            '-y'
                        ])
                        .on('start', (cmd: string) => {
                            this.logger?.debug(`🎬 ffmpeg cmd: ${cmd}`);
                        })
                        .on('end', () => resolve(void 0))
                        .on('error', (err: any) => {
                            this.logger?.error(`❌ ffmpeg error: ${err.message}`);
                            reject(err);
                        })
                        .save(outputPath);
                });

                if (!fs.existsSync(outputPath)) {
                    throw new Error('Arquivo não criado pelo ffmpeg');
                }

                const stickerBuffer = await fs.promises.readFile(outputPath);
                const stickerComMetadados = await this.addStickerMetadata(stickerBuffer, packName, author);

                await this.cleanupFile(inputPath);
                await this.cleanupFile(outputPath);

                return {
                    sucesso: true,
                    buffer: stickerComMetadados,
                    tipo: 'sticker_image',
                    size: stickerComMetadados.length
                };
            } catch (ffmpegError: any) {
                this.logger?.error(`❌ ffmpeg também falhou: ${ffmpegError.message}`);
                await this.cleanupFile(inputPath);
                await this.cleanupFile(outputPath);
                throw ffmpegError;
            }
        } catch (error: any) {
            this.logger?.error(`❌ Erro ao criar sticker: ${error.message}`);
            return { sucesso: false, error: error.message };
        }
    }

    /**
     * Cria sticker animado de vídeo
     */
    async createAnimatedStickerFromVideo(videoBuffer: Buffer, maxDuration: number | string = 30, metadata: any = {}): Promise<any> {
        try {
            const cfgMax = parseInt(this.config?.STICKER_MAX_ANIMATED_SECONDS || '30');
            const duration = Math.min(parseInt(String(maxDuration || cfgMax)), 10);

            const inputPath = this.generateRandomFilename('mp4');
            const outputPath = this.generateRandomFilename('webp');

            await fs.promises.writeFile(inputPath, videoBuffer);

            const { packName = 'akira-bot', author = 'Akira-Bot' } = metadata;
            const videoFilter = `fps=15,scale=512:512:flags=lanczos:force_original_aspect_ratio=increase,crop=512:512`;

            await new Promise((resolve, reject) => {
                ffmpeg(inputPath)
                    .outputOptions([
                        '-vcodec', 'libwebp',
                        '-vf', videoFilter,
                        '-s', '512x512',
                        '-loop', '0',
                        '-lossless', '0',
                        '-compression_level', '6',
                        '-q:v', '75',
                        '-preset', 'default',
                        '-an',
                        '-t', String(duration),
                        '-y'
                    ])
                    .on('end', () => resolve(void 0))
                    .on('error', (err) => reject(err))
                    .save(outputPath);
            });

            if (!fs.existsSync(outputPath)) {
                throw new Error('Arquivo não criado');
            }

            let stickerBuffer = await fs.promises.readFile(outputPath);

            // Reduz qualidade se muito grande
            if (stickerBuffer.length > 500 * 1024) {
                await this.cleanupFile(outputPath);

                await new Promise((resolve, reject) => {
                    ffmpeg(inputPath)
                        .outputOptions([
                            '-vcodec', 'libwebp',
                            '-vf', videoFilter,
                            '-s', '512x512',
                            '-loop', '0',
                            '-lossless', '0',
                            '-compression_level', '9',
                            '-q:v', '50',
                            '-preset', 'picture',
                            '-an',
                            '-t', String(duration),
                            '-y'
                        ])
                        .on('end', () => resolve(void 0))
                        .on('error', reject)
                        .save(outputPath);
                });

                stickerBuffer = await fs.promises.readFile(outputPath);

                if (stickerBuffer.length > 500 * 1024) {
                    await this.cleanupFile(inputPath);
                    await this.cleanupFile(outputPath);
                    return { sucesso: false, error: 'Sticker muito grande (>500KB)' };
                }
            }

            const stickerComMetadados = await this.addStickerMetadata(stickerBuffer, packName, author);

            await this.cleanupFile(inputPath);
            await this.cleanupFile(outputPath);

            return {
                sucesso: true,
                buffer: stickerComMetadados,
                tipo: 'sticker_animado',
                size: stickerComMetadados.length
            };
        } catch (error: any) {
            return { sucesso: false, error: error.message };
        }
    }

    /**
     * Converte vídeo para áudio
     */
    async convertVideoToAudio(videoBuffer: Buffer): Promise<any> {
        try {
            const inputPath = this.generateRandomFilename('mp4');
            const outputPath = this.generateRandomFilename('mp3');

            await fs.promises.writeFile(inputPath, videoBuffer);

            await new Promise((resolve, reject) => {
                ffmpeg(inputPath)
                    .toFormat('mp3')
                    .audioCodec('libmp3lame')
                    .on('end', () => resolve(void 0))
                    .on('error', reject)
                    .save(outputPath);
            });

            const audioBuffer = await fs.promises.readFile(outputPath);
            await this.cleanupFile(inputPath);
            await this.cleanupFile(outputPath);

            return { sucesso: true, buffer: audioBuffer };
        } catch (e: any) {
            return { sucesso: false, error: e.message };
        }
    }

    /**
     * Converte sticker para imagem
     */
    async convertStickerToImage(stickerBuffer: Buffer): Promise<any> {
        try {
            const inputPath = this.generateRandomFilename('webp');
            const outputPath = this.generateRandomFilename('png');

            await fs.promises.writeFile(inputPath, stickerBuffer);

            await new Promise((resolve, reject) => {
                ffmpeg(inputPath)
                    .outputOptions('-vcodec', 'png')
                    .on('end', () => resolve(void 0))
                    .on('error', reject)
                    .save(outputPath);
            });

            if (!fs.existsSync(outputPath)) {
                throw new Error('Arquivo não criado');
            }

            const imageBuffer = await fs.promises.readFile(outputPath);
            await this.cleanupFile(inputPath);
            await this.cleanupFile(outputPath);

            return { sucesso: true, buffer: imageBuffer, tipo: 'imagem' };
        } catch (error: any) {
            return { sucesso: false, error: error.message };
        }
    }

    /**
     * Detecta view-once na mensagem
     */
    detectViewOnce(message: any): any {
        if (!message) return null;
        try {
            if (message.viewOnceMessageV2?.message) return message.viewOnceMessageV2.message;
            if (message.viewOnceMessageV2Extension?.message) return message.viewOnceMessageV2Extension.message;
            if (message.viewOnceMessage?.message) return message.viewOnceMessage.message;
            if (message.ephemeralMessage?.message) return message.ephemeralMessage.message;
            return null;
        } catch (e) {
            return null;
        }
    }

    /**
     * Extrai conteúdo de view-once
     */
    async extractViewOnceContent(quoted: any): Promise<any> {
        try {
            if (!quoted) {
                return { sucesso: false, error: 'Nenhuma mensagem citada' };
            }

            let target = quoted;
            if (quoted.viewOnceMessageV2?.message) target = quoted.viewOnceMessageV2.message;
            else if (quoted.viewOnceMessageV2Extension?.message) target = quoted.viewOnceMessageV2Extension.message;
            else if (quoted.viewOnceMessage?.message) target = quoted.viewOnceMessage.message;
            else if (quoted.ephemeralMessage?.message) target = quoted.ephemeralMessage.message;

            const hasImage = target.imageMessage;
            const hasVideo = target.videoMessage;
            const hasAudio = target.audioMessage;
            const hasSticker = target.stickerMessage;

            if (!hasImage && !hasVideo && !hasAudio && !hasSticker) {
                return { sucesso: false, error: 'Não é view-once ou não contém mídia' };
            }

            let buffer: Buffer | null = null;
            let tipo = '';
            let mimeType = '';

            if (hasImage) {
                const res = await this.downloadMedia(target.imageMessage, 'image');
                buffer = res?.buffer || null;
                tipo = 'image';
                mimeType = target.imageMessage.mimetype || 'image/jpeg';
            } else if (hasVideo) {
                const res = await this.downloadMedia(target.videoMessage, 'video');
                buffer = res?.buffer || null;
                tipo = 'video';
                mimeType = target.videoMessage.mimetype || 'video/mp4';
            } else if (hasAudio) {
                const res = await this.downloadMedia(target.audioMessage, 'audio');
                buffer = res?.buffer || null;
                tipo = 'audio';
                mimeType = target.audioMessage.mimetype || 'audio/mpeg';
            } else if (hasSticker) {
                const res = await this.downloadMedia(target.stickerMessage, 'sticker');
                buffer = res?.buffer || null;
                tipo = 'sticker';
                mimeType = target.stickerMessage.mimetype || 'image/webp';
            }

            if (!buffer) {
                return { sucesso: false, error: 'Erro ao baixar conteúdo' };
            }

            return { sucesso: true, tipo, buffer, size: buffer.length, mimeType };
        } catch (error: any) {
            return { sucesso: false, error: error.message };
        }
    }

    /**
     * Formata números grandes (visualizações, curtidas) para formato K, M, B
     */
    private _formatStats(num: number | string | undefined): string {
        if (num === undefined || num === null || num === '') return 'N/A';
        const n = Number(num);
        if (isNaN(n)) return String(num);
        if (n >= 1000000000) return (n / 1000000000).toFixed(1) + 'B';
        if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
        if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
        return n.toString();
    }

    /**
     * Formata datas como YYYYMMDD para visualização mais amigável
     */
    private _formatDate(dateStr: string | undefined): string {
        if (!dateStr || typeof dateStr !== 'string') return 'N/A';
        if (dateStr.length === 8 && /^\d{8}$/.test(dateStr)) {
            const year = dateStr.substring(0, 4);
            const month = dateStr.substring(4, 6);
            const day = dateStr.substring(6, 8);
            return `${day}/${month}/${year}`;
        }
        return dateStr;
    }
}

export default MediaProcessor;
