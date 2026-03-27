/// <reference path="./declarations.d.ts" />
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
import { exec } from 'child_process';
import util from 'util';
const execAsync = util.promisify(exec);
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { downloadContentFromMessage } from '@whiskeysockets/baileys';
import ConfigManager from './ConfigManager.js';

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

    constructor(logger: any = null) {
        this.config = ConfigManager.getInstance();
        this.logger = logger || console;
        this.tempFolder = this.config?.TEMP_FOLDER || './temp';
        this.downloadCache = new Map();

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

    /**
     * Encontra o caminho do cookie válido
     */
    private _findCookiePath(): string {
        const possiblePaths = [
            this.config?.YT_COOKIES_PATH,
            './cookies.txt',
            './cookie.txt',
            '/app/cookies.txt',
            '/app/cookie.txt',
            './youtube_cookies.txt',
            '/tmp/akira_data/cookies/youtube_cookies.txt',
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

    /**
     * Constrói o comando yt-dlp seguindo as NORMAS TÉCNICAS de 2026
     * Usa Deno como runtime JS para decifrar assinaturas complexas (SABR/DPI)
     */
    private _buildYtdlpCommand(
        url: string,
        options: {
            type: 'audio' | 'video' | 'json',
            output?: string,
            isSearch?: boolean,
            clientOverride?: string,
            userAgent?: string,
            useCookies?: boolean // Permite desativar cookies por tentativa
        }
    ): string {
        const cookiePath = this._findCookiePath();
        // Cookies OPCIONAIS por tentativa - cookies de conta + IP datacenter = bloqueio
        const cookieArg = (options.useCookies !== false && cookiePath) ? `--cookies "${cookiePath}"` : '';
        const poToken = this.config?.YT_PO_TOKEN;

        // FORÇAR RUNTIME JS (Essencial para resolver assinaturas no YouTube V3/2026)
        // No Railway/Docker, o binário 'node' sempre está no PATH.
        const jsRuntime = '--js-runtime node';

        const clients = options.clientOverride || 'android,ios,web';

        // SEM formats=missing_pot quando não temos POT - causa bugs de formato
        let extractorArgs = `youtube:player_client=${clients}`;
        if (poToken) {
            extractorArgs += `;formats=missing_pot;po_token=web+${poToken}`;
        }
        // Gambiarra para vídeos que forçam SABR
        extractorArgs += ';skip=hls,dash';

        const ua = options.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';

        const bypassFlags = [
            `--extractor-args "${extractorArgs}"`,
            jsRuntime,
            '--remote-components ejs:github', // GAMBIARRA CRUCIAL: Baixa o decifrador de assinaturas dinamicamente
            '--cache-dir "/tmp/yt-dlp-cache"', // Garante permissão de escrita para plugins
            '--no-check-certificates',
            `--user-agent "${ua}"`,
            '--add-header "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7"',
            '--add-header "Accept-Language: pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7"',
            '--add-header "Sec-Ch-Ua: \'Not A(Brand\';v=\'8\', \'Chromium\';v=\'134\', \'Google Chrome\';v=\'134\'"',
            '--add-header "Sec-Ch-Ua-Mobile: ?0"',
            '--add-header "Sec-Ch-Ua-Platform: \'Windows\'"',
            '--add-header "Sec-Fetch-Dest: document"',
            '--add-header "Sec-Fetch-Mode: navigate"',
            '--add-header "Sec-Fetch-Site: cross-site"',
            '--add-header "Upgrade-Insecure-Requests: 1"',
            '--rm-cache-dir',
            '--ignore-config',
            '--no-playlist',
            '--geo-bypass',
            '--socket-timeout 30',
            '--retries 5',
            '--buffer-size 16K',
            '--verbose'
        ].filter(Boolean).join(' ');

        let actionFlags = '';
        if (options.type === 'audio') {
            // Tentativa de melhor áudio, com fallback para o formato mais comum (140)
            actionFlags = `-f "ba/ba*[asr=44100]/b" -x --audio-format mp3 --audio-quality 0 -o "${options.output}"`;
        } else if (options.type === 'video') {
            // GAMBIARRA DE FORMATO: Tenta 720p, depois 480p, e por fim o ITAG 18 (360p mp4) que quase nunca falha
            actionFlags = `-f "bv*[height<=720]+ba/b[height<=720] / 18 / b[height<=720]" --merge-output-format mp4 -o "${options.output}"`;
        } else if (options.type === 'json') {
            actionFlags = '--dump-json --no-download';
        }

        const target = options.isSearch ? `ytsearch1:${url}` : url;
        // Log do comando completo para debug (sem mostrar cookies)
        return `yt-dlp ${cookieArg} ${bypassFlags} ${actionFlags} "${target}"`;
    }

    /**
     * ═══════════════════════════════════════════════════════
     * DOWNLOAD DE ÁUDIO - yt-dlp PURO COM ANTI-BLOQUEIO
     * ═══════════════════════════════════════════════════════
     */
    async downloadYouTubeAudio(url: string): Promise<{ sucesso: boolean; buffer?: Buffer; filePath?: string; error?: string; metadata?: any }> {
        try {
            this.logger?.info(`🎧 Download áudio: ${url}`);

            const metadata = await this._getYouTubeMetadataSimple(url);
            if (!metadata.sucesso) {
                if (url.startsWith('http')) return await this._downloadWithYtdlCore(url, 'audio');
                return { sucesso: false, error: 'Não foi possível encontrar música para esse nome.' };
            }

            const finalUrl = metadata.url || url;
            const outputPath = this.generateRandomFilename('mp3');
            const cookiePath = this._findCookiePath();

            // ================================================================
            // ESTRATÉGIA ANTI-DATACENTER S/ API: Uso de clientes mobile nativos
            // Aplicativos iOS e Android não exigem verificação JS/Login pesada
            // e ignoram a maioria dos blocos "Sign in to confirm you're not a bot"
            // ================================================================
            const tentativas = [
                // 1. Android s/ Cookies
                { cliente: 'android', ua: 'com.google.android.youtube/19.45.36 (Linux; U; Android 15; pt_BR)', sleepMs: 0, useCookies: false },
                // 2. iOS c/ Cookies (iOS costuma aceitar cookies melhor sem travar bot)
                { cliente: 'ios', ua: 'com.google.ios.youtube/19.45.2 (iPhone16,2; U; CPU iOS 18_2 like Mac OS X; pt_BR)', sleepMs: 200, useCookies: true },
                // 3. Web Safari c/ Cookies (Fallback que quase funcionou no log)
                { cliente: 'web_safari', ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', sleepMs: 400, useCookies: true },
                // 4. mweb (Navegador Mobile)
                { cliente: 'mweb', ua: 'Mozilla/5.0 (Linux; Android 15; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Mobile Safari/537.36', sleepMs: 600, useCookies: false },
                // 5. tv (Cliente TV é o mais estável para vídeos protegidos)
                { cliente: 'tv', ua: 'Mozilla/5.0 (SMART-TV; Linux; Tizen 8.0) AppleWebKit/538.1 (KHTML, like Gecko) Version/8.0 TV Safari/538.1', sleepMs: 800, useCookies: true }
            ];

            for (let i = 0; i < tentativas.length; i++) {
                if (fs.existsSync(outputPath)) break;
                const t = tentativas[i];
                if (t.sleepMs > 0) await new Promise(r => setTimeout(r, t.sleepMs));

                this.logger?.info(`[AUDIO ${i + 1}/${tentativas.length}] Cliente: ${t.cliente} | Cookies: ${t.useCookies ? 'SIM' : 'NAO'}`);
                const cmd = this._buildYtdlpCommand(finalUrl, {
                    type: 'audio',
                    output: outputPath,
                    clientOverride: t.cliente,
                    userAgent: t.ua,
                    useCookies: t.useCookies
                });
                try {
                    await execAsync(cmd, { timeout: 180000, maxBuffer: 150 * 1024 * 1024 });
                } catch (e: any) {
                    const fullErr = e.stderr || e.message || '';
                    this.logger?.warn(`⚠️ [yt-dlp ${t.cliente}] FALHOU. Comando: \n${cmd}\n\n=== LOG DETALHADO ERROR ===\n${fullErr}\n==========================\n`);
                }
            }

            if (fs.existsSync(outputPath)) {
                const buffer = await fs.promises.readFile(outputPath);
                await this.cleanupFile(outputPath);
                return { sucesso: true, buffer, metadata };
            }

            // ÚLTIMA INSTÂNCIA: ytdl-core (Mais estável que APIs de terceiros para o Railway)
            this.logger?.warn('⚠️ [LAST RESORT] ytdl-core...');
            return await this._downloadWithYtdlCore(finalUrl, 'audio', metadata);

        } catch (error: any) {
            this.logger?.error(`❌ Erro download audio: ${error.message}`);
            return { sucesso: false, error: error.message };
        }
    }

    /**
     * ═══════════════════════════════════════════════════════
     * DOWNLOAD DE VÍDEO - yt-dlp PURO COM ANTI-BLOQUEIO
     * ═══════════════════════════════════════════════════════
     */
    async downloadYouTubeVideo(url: string, quality: string = '720'): Promise<{ sucesso: boolean; buffer?: Buffer; error?: string; metadata?: any }> {
        try {
            // Normaliza URL de Shorts para o formato padrão
            // YouTube Shorts (/shorts/ID) às vezes é tratado diferente pelo yt-dlp
            const normalizeUrl = (u: string) => {
                const shortsMatch = u.match(/youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/);
                if (shortsMatch) return `https://www.youtube.com/watch?v=${shortsMatch[1]}`;
                return u;
            };
            const normalizedUrl = normalizeUrl(url);
            if (normalizedUrl !== url) this.logger?.info(`🔄 Short detectado! Normalizado: ${normalizedUrl}`);

            this.logger?.info(`🎥 Download vídeo: ${normalizedUrl} (qualidade: ${quality})`);

            const metadata = await this._getYouTubeMetadataSimple(normalizedUrl);
            if (!metadata.sucesso) {
                if (normalizedUrl.startsWith('http')) return await this._downloadWithYtdlCore(normalizedUrl, 'video');
                return { sucesso: false, error: 'Metadados não encontrados.' };
            }

            const finalUrl = metadata.url || normalizedUrl;
            const outputPath = this.generateRandomFilename('mp4');

            // ================================================================
            // ESTRATÉGIA ANTI-DATACENTER S/ API: Uso de clientes mobile nativos
            // Aplicativos iOS e Android não exigem verificação JS/Login pesada
            // e ignoram a maioria dos blocos "Sign in to confirm you're not a bot"
            // ================================================================
            const tentativas = [
                // 1. App Android Nativo s/ Cookies
                { cliente: 'android', ua: 'com.google.android.youtube/19.45.36 (Linux; U; Android 15; pt_BR; SM-S928B)', sleepMs: 0, useCookies: false },
                // 2. App iOS Nativo s/ Cookies
                { cliente: 'ios', ua: 'com.google.ios.youtube/19.45.2 (iPhone16,2; U; CPU iOS 18_2 like Mac OS X; pt_BR)', sleepMs: 200, useCookies: false },
                // 3. Android VR (Excelente para bypass em datacenter)
                { cliente: 'android_vr', ua: 'com.google.android.apps.youtube.vr/1.60.10 (Linux; U; Android 15; pt_BR)', sleepMs: 400, useCookies: false },
                // 4. mweb (Navegador Mobile)
                { cliente: 'mweb', ua: 'Mozilla/5.0 (Linux; Android 15; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Mobile Safari/537.36', sleepMs: 600, useCookies: false },
                // 5. tv_embedded c/ Cookies (Último recurso)
                { cliente: 'tv_embedded', ua: 'Mozilla/5.0 (SMART-TV; Linux; Tizen 8.0) AppleWebKit/538.1 (KHTML, like Gecko) Version/8.0 TV Safari/538.1', sleepMs: 1000, useCookies: true }
            ];

            for (let i = 0; i < tentativas.length; i++) {
                if (fs.existsSync(outputPath)) break;
                const t = tentativas[i];
                if (t.sleepMs > 0) await new Promise(r => setTimeout(r, t.sleepMs));

                this.logger?.info(`[VÍDEO ${i + 1}/${tentativas.length}] Cliente: ${t.cliente} | Cookies: ${t.useCookies ? 'SIM' : 'NAO'}`);
                const cmd = this._buildYtdlpCommand(finalUrl, {
                    type: 'video',
                    output: outputPath,
                    clientOverride: t.cliente,
                    userAgent: t.ua,
                    useCookies: t.useCookies
                });
                try {
                    await execAsync(cmd, { timeout: 360000, maxBuffer: 500 * 1024 * 1024 });
                } catch (e: any) {
                    const fullErr = e.stderr || e.message || '';
                    this.logger?.warn(`⚠️ [yt-dlp ${t.cliente}] FALHOU. Comando: \n${cmd}\n\n=== LOG DETALHADO ERROR ===\n${fullErr}\n==========================\n`);
                }
            }

            if (fs.existsSync(outputPath)) {
                const buffer = await fs.promises.readFile(outputPath);
                await this.cleanupFile(outputPath);
                return { sucesso: true, buffer, metadata };
            }

            // ÚLTIMA INSTÂNCIA: ytdl-core
            this.logger?.warn('⚠️ [LAST RESORT] ytdl-core...');
            return await this._downloadWithYtdlCore(finalUrl, 'video', metadata);

        } catch (error: any) {
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

        // PRIORIDADE 1: yt-dlp (busca ou URL)
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
    async downloadMedia(message: any, mimeType: string = 'image'): Promise<Buffer | null> {
        try {
            if (!message) {
                this.logger?.error('❌ Mensagem é null');
                return null;
            }

            const extractMediaContainer = (msgObj: any, depth: number = 0): any => {
                if (!msgObj || typeof msgObj !== 'object' || depth > 10) return null;

                // Se já é o container direto
                if (msgObj.mediaKey && (msgObj.url || msgObj.directPath)) return msgObj;

                // Lista de wrappers comuns no Baileys/WhatsApp
                const possibleWrappers = [
                    'viewOnceMessageV2', 'viewOnceMessageV2Extension', 'viewOnceMessage',
                    'ephemeralMessage', 'documentWithCaptionMessage', 'editMessage',
                    'protocolMessage', 'editedMessage', 'message', 'quotedMessage'
                ];

                for (const key of possibleWrappers) {
                    if (msgObj[key]) {
                        const found = extractMediaContainer(msgObj[key], depth + 1);
                        if (found) return found;
                    }
                }

                // Tipos de mídia conhecidos
                const subTypes = ['imageMessage', 'videoMessage', 'stickerMessage', 'audioMessage', 'documentMessage'];
                for (const type of subTypes) {
                    if (msgObj[type]) {
                        const found = extractMediaContainer(msgObj[type], depth + 1);
                        if (found) return found;
                    }
                }

                // Busca exaustiva em qualquer objeto filho (exceto os já testados)
                for (const key in msgObj) {
                    if (msgObj[key] && typeof msgObj[key] === 'object' && !possibleWrappers.includes(key) && !subTypes.includes(key)) {
                        const found = extractMediaContainer(msgObj[key], depth + 1);
                        if (found) return found;
                    }
                }

                return null;
            };

            const mediaContent = extractMediaContainer(message);
            if (!mediaContent) {
                this.logger?.error('❌ Mídia não encontrada. Estrutura recebida:', Object.keys(message || {}).join(', '));
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

            return buffer;
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
        try {
            const inputPath = this.generateRandomFilename('jpg');
            const outputPath = this.generateRandomFilename('webp');

            await fs.promises.writeFile(inputPath, imageBuffer);

            const { packName = 'akira-bot', author = 'Akira-Bot' } = metadata;
            const videoFilter = 'scale=512:512:flags=lanczos:force_original_aspect_ratio=increase,crop=512:512';

            await new Promise((resolve, reject) => {
                ffmpeg(inputPath)
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
                    .on('end', () => resolve(void 0))
                    .on('error', (err) => reject(err))
                    .save(outputPath);
            });

            if (!fs.existsSync(outputPath)) {
                throw new Error('Arquivo não criado');
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
        } catch (error: any) {
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
                buffer = await this.downloadMedia(target.imageMessage, 'image');
                tipo = 'image';
                mimeType = target.imageMessage.mimetype || 'image/jpeg';
            } else if (hasVideo) {
                buffer = await this.downloadMedia(target.videoMessage, 'video');
                tipo = 'video';
                mimeType = target.videoMessage.mimetype || 'video/mp4';
            } else if (hasAudio) {
                buffer = await this.downloadMedia(target.audioMessage, 'audio');
                tipo = 'audio';
                mimeType = target.audioMessage.mimetype || 'audio/mpeg';
            } else if (hasSticker) {
                buffer = await this.downloadMedia(target.stickerMessage, 'sticker');
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
