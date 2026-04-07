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
import { execSync } from 'child_process';
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

// User-Agent padrão
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

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
    public sock: any;
    private ytInstance: any = null;

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

    public setSocket(sock: any): void {
        this.sock = sock;
    }

    /**
     * ═══════════════════════════════════════════════════════════════════════
     * INICIALIZA INSTÂNCIA YOUTUBEI.JS (InnerTube API) — SINGLETON
     * A API InnerTube é nativa do YouTube e bypass detection anti-bot.
     * ═══════════════════════════════════════════════════════════════════════
     */
    private async getYT(): Promise<any> {
        if (this.ytInstance) return this.ytInstance;
        const { Innertube } = await import('youtubei.js');
        this.ytInstance = await Innertube.create();
        return this.ytInstance;
    }

    /**
     * ═══════════════════════════════════════════════════════════════════════
     * DOWNLOAD DE ÁUDIO YOUTUBE — youtubei.js (API InnerTube)
     * ═══════════════════════════════════════════════════════════════════════
     */
    async downloadYouTubeAudio(url: string): Promise<{ sucesso: boolean; buffer?: Buffer; filePath?: string; error?: string; metadata?: any }> {
        try {
            this.logger?.info(`🎧 Download áudio: ${url}`);

            const metadata = await this._getYouTubeMetadataSimple(url);
            if (!metadata.sucesso) {
                return { sucesso: false, error: 'Não foi possível encontrar música para esse nome.' };
            }

            const finalUrl = metadata.url || url;
            const videoId = metadata.videoId || this._extractVideoId(finalUrl);

            const result = await this._downloadViaInnertube(videoId, 'audio');
            if (!result.sucesso) {
                return { sucesso: false, error: result.error || 'Falha no download de áudio.' };
            }

            const finalMeta = metadata.sucesso ? metadata : result.metadata;

            // Converte para MP3 se necessário
            if (result.format?.mimeType && !result.format.mimeType.includes('mp3')) {
                const inputPath = result.filePath!;
                const outputPath = this.generateRandomFilename('mp3');

                await new Promise<void>((resolve, reject) => {
                    ffmpeg(inputPath)
                        .toFormat('mp3')
                        .audioCodec('libmp3lame')
                        .audioBitrate('192k')
                        .on('end', () => resolve())
                        .on('error', (err: Error) => reject(err))
                        .save(outputPath);
                });

                const mp3Buffer = await fs.promises.readFile(outputPath);
                await this.cleanupFile(inputPath);
                await this.cleanupFile(outputPath);

                return { sucesso: true, buffer: mp3Buffer, metadata: finalMeta };
            }

            if (result.filePath) {
                const buffer = await fs.promises.readFile(result.filePath);
                await this.cleanupFile(result.filePath);
                return { sucesso: true, buffer, metadata: finalMeta };
            }

            return { sucesso: true, buffer: result.buffer, metadata: finalMeta };

        } catch (error: any) {
            this.logger?.error(`❌ Erro download audio: ${error.message}`);
            return { sucesso: false, error: error.message };
        }
    }

    /**
     * ═══════════════════════════════════════════════════════════════════════
     * DOWNLOAD DE VÍDEO YOUTUBE — youtubei.js (API InnerTube)
     * ═══════════════════════════════════════════════════════════════════════
     */
    async downloadYouTubeVideo(url: string): Promise<{ sucesso: boolean; buffer?: Buffer; filePath?: string; error?: string; metadata?: any }> {
        try {
            this.logger?.info(`🎬 Download vídeo: ${url}`);

            const metadata = await this._getYouTubeMetadataSimple(url);
            if (!metadata.sucesso) {
                return { sucesso: false, error: 'Não foi possível encontrar vídeo para esse nome.' };
            }

            const finalUrl = metadata.url || url;
            const videoId = metadata.videoId || this._extractVideoId(finalUrl);

            const result = await this._downloadViaInnertube(videoId, 'video');
            if (!result.sucesso) {
                return { sucesso: false, error: result.error || 'Falha no download de vídeo.' };
            }

            const finalMeta = metadata.sucesso ? metadata : result.metadata;

            // Verifica tamanho máximo
            const stats = fs.statSync(result.filePath || '');
            if (stats.size > this.config.YT_MAX_SIZE_MB * 1024 * 1024) {
                await this.cleanupFile(result.filePath);
                return { sucesso: false, error: 'O vídeo final excedeu o tamanho máximo permitido.' };
            }

            if (stats.size < 50 * 1024 * 1024) {
                const buffer = await fs.promises.readFile(result.filePath);
                await this.cleanupFile(result.filePath);
                return { sucesso: true, buffer, metadata: finalMeta };
            }

            return { sucesso: true, filePath: result.filePath, metadata: finalMeta };

        } catch (error: any) {
            this.logger?.error(`❌ Erro download vídeo: ${error.message}`);
            return { sucesso: false, error: error.message };
        }
    }

    /**
     * Download usando InnerTube API (youtubei.js).
     * A API InnerTube é nativa do YouTube e não é detectada como bot.
     *
     * Para áudio: baixa o melhor formato audio-only
     * Para vídeo: baixa muxed (áudio+vídeo juntos) <= 720p
     */
    private async _downloadViaInnertube(videoId: string, type: 'audio' | 'video'): Promise<{
        sucesso: boolean; buffer?: Buffer; filePath?: string; error?: string; metadata?: any; format?: any;
    }> {
        try {
            const yt = await this.getYT();
            const info = await yt.getInfo(videoId as never);

            if (!info || !info.streaming_data) {
                return { sucesso: false, error: 'Vídeo não encontrado ou indisponível.' };
            }

            const basic = info.basic_info || {};
            const title = basic.title || 'Título desconhecido';
            const author = typeof basic.author === 'string' ? basic.author : (basic.author?.name || 'Canal desconhecido');
            const duration = basic.duration || 0;

            const thumbnails = basic.thumbnail;
            const thumbnail = Array.isArray(thumbnails)
                ? (thumbnails[thumbnails.length - 1]?.url || `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`)
                : (typeof thumbnails === 'object' && thumbnails !== null
                    ? (thumbnails as any).url
                    : `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`);

            const metadata = {
                titulo: title,
                canal: author,
                duracao: duration ? Math.floor(duration) : 0,
                duracaoFormatada: duration ? this._formatDuration(Math.floor(duration)) : '0:00',
                thumbnail,
                url: `https://www.youtube.com/watch?v=${videoId}`,
                videoId
            };

            const adaptive = info.streaming_data.adaptive_formats || [];

            if (type === 'audio') {
                // Filtra formatos audio-only
                const audioFormats = adaptive.filter((f: any) => f.has_audio && !f.has_video);
                if (audioFormats.length === 0) {
                    return { sucesso: false, error: 'Nenhum formato de áudio disponível.' };
                }

                this.logger?.info(`📥 innertube: selecionando melhor áudio...`);

                // Prefere opus, depois m4a, depois qualquer um
                let format = audioFormats.find((f: any) => f.mime_type?.includes('opus'))
                    || audioFormats.find((f: any) => f.mime_type?.includes('mp4'))
                    || audioFormats[0];

                const downloadUrl = format.decipher(yt.session.player as never) as string;
                this.logger?.info(`📥 Baixando áudio: ${format.mime_type || 'desconhecido'}`);

                const outputPath = this.generateRandomFilename(this._extFromMime(format.mime_type || 'webm'));
                await this._downloadToStream(downloadUrl, UA, outputPath);

                return { sucesso: true, filePath: outputPath, metadata, format: { mimeType: format.mime_type || 'webm' }, buffer: undefined };

            } else {
                // Vídeo — tenta muxed (áudio+vídeo juntos) <= 720p
                const muxed = adaptive.filter(
                    (f: any) => f.has_video && f.has_audio && f.quality_label && (f.width || 0) <= 1280
                );

                let format: any;
                if (muxed.length > 0) {
                    format = muxed.sort((a: any, b: any) => (b.width || 0) - (a.width || 0))[0];
                } else {
                    // Senão precisa mux separadamente ou pega qualquer
                    const videoOnly = adaptive.filter((f: any) => f.has_video && !f.has_audio);
                    if (videoOnly.length > 0) {
                        // Tenta encontrar um muxed em formats (não adaptive)
                        const muxedFormats = info.streaming_data.formats || [];
                        const muxedAlt = muxedFormats.filter((f: any) => f.has_video && f.has_audio);
                        if (muxedAlt.length > 0) {
                            format = muxedAlt.sort((a: any, b: any) => (b.width || 0) - (a.width || 0))[0];
                        } else {
                            // Melhor vídeo (sem áudio) — youtubei.js pode mux automaticamente
                            format = videoOnly.sort((a: any, b: any) => (b.width || 0) - (a.width || 0)).find(
                                (f: any) => (f.width || 0) <= 1280
                            ) || videoOnly[0];
                            this.logger?.info('⚠️ Usando vídeo sem áudio (muxed indisponível)');
                        }
                    } else {
                        const anyFmt = info.streaming_data.formats?.find((f: any) => f.has_video);
                        if (!anyFmt) {
                            return { sucesso: false, error: 'Nenhum formato de vídeo disponível.' };
                        }
                        format = anyFmt;
                    }
                }

                const downloadUrl = format.decipher(yt.session.player as never) as string;
                this.logger?.info(`📥 Baixando vídeo: ${format.mime_type || 'desconhecido'} ${format.width || '?'}x${format.height || '?'}`);

                const outputPath = this.generateRandomFilename(this._extFromMime(format.mime_type || 'mp4'));
                await this._downloadToStream(downloadUrl, UA, outputPath);

                return { sucesso: true, filePath: outputPath, metadata, format: { mimeType: format.mime_type || 'mp4' }, buffer: undefined };
            }

        } catch (error: any) {
            this.logger?.error(`❌ Erro innertube: ${error.message}`);
            return { sucesso: false, error: error.message };
        }
    }

    /**
     * Faz download de uma URL para um arquivo local via stream
     */
    private async _downloadToStream(streamUrl: string, userAgent: string, outputPath: string): Promise<void> {
        const response = await axios({
            url: streamUrl,
            method: 'GET',
            responseType: 'stream',
            timeout: 300000,
            headers: {
                'User-Agent': userAgent,
                'Referer': 'https://www.youtube.com/'
            }
        });

        const writer = fs.createWriteStream(outputPath);
        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', () => resolve());
            writer.on('error', reject);
        });
    }

    /**
     * Determina extensão de arquivo pelo MIME type
     */
    private _extFromMime(mime: string): string {
        if (!mime) return 'webm';
        if (mime.includes('mp4')) return 'mp4';
        if (mime.includes('webm')) return 'webm';
        if (mime.includes('ogg')) return 'ogg';
        if (mime.includes('mp3')) return 'mp3';
        if (mime.includes('opus')) return 'opus';
        if (mime.startsWith('audio')) return 'webm';
        return 'mp4';
    }

    /**
     * Obtém metadados usando método simples - VERSÃO ROBUSTA
     * Tenta múltiplas fontes: APIs Invidious, Piped, youtubei.js, yt-search
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
            this.logger?.warn(`⚠️ Busca inicial falhou para "${url}", tentando youtubei.js...`);
        } else {
            this.logger?.info(`🔍 Extraindo metadados para video ID: ${videoId || '(URL sem ID)'}`);
        }

        // PRIORIDADE 1: Invidious API
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

        // PRIORIDADE 3: youtubei.js via getInfo
        try {
            const yt = await this.getYT();
            const basic = await yt.getBasicInfo(videoId as never || url as never);
            if (basic.basic_info) {
                const vd = basic.basic_info;
                const resolvedId = vd.video_id || videoId;
                const author = typeof vd.author === 'string' ? vd.author : (vd.author?.name || 'Canal desconhecido');
                const thumb = Array.isArray(vd.thumbnail)
                    ? (vd.thumbnail[vd.thumbnail.length - 1]?.url || `https://img.youtube.com/vi/${resolvedId}/maxresdefault.jpg`)
                    : (typeof vd.thumbnail === 'object' && vd.thumbnail !== null ? (vd.thumbnail as any).url : `https://img.youtube.com/vi/${resolvedId}/maxresdefault.jpg`);
                return {
                    sucesso: true,
                    titulo: vd.title || 'Título desconhecido',
                    canal: author,
                    duracao: vd.duration ? Math.floor(vd.duration) : 0,
                    duracaoFormatada: vd.duration ? this._formatDuration(Math.floor(vd.duration)) : '0:00',
                    thumbnail: thumb,
                    url: `https://www.youtube.com/watch?v=${resolvedId}`,
                    videoId: resolvedId,
                    visualizacoes: this._formatStats(vd.view_count),
                    curtidas: 'N/A',
                    dataPublicacao: vd.publish_date || 'N/A'
                };
            }
        } catch (err: any) {
            this.logger?.debug(`⚠️ youtubei.js metadata falhou: ${err.message.substring(0, 50)}`);
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
                url,
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
     * Busca um vídeo por nome nas APIs públicas (yt-search)
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
        // Instâncias Invidious VERIFICADAS e ATIVAS (Abril 2026)
        const invidiousInstances = [
            'https://inv.tux.pizza',
            'https://iv.ggtyler.dev',
            'https://iv.datura.network',
            'https://inv.bpbonline.co',
            'https://invidious.fdn.frml.xyz',
            'https://invidious.lunar.icu',
            'https://vid.puffyan.us',
            'https://inv.zzls.xyz',
            'https://yewtu.be',
            'https://invidious.ducks.party'
        ];

        for (const instance of invidiousInstances) {
            try {
                const response = await axios.get(`${instance}/api/v1/videos/${videoId}`, {
                    timeout: 10000,
                    headers: { 'User-Agent': UA }
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
            'https://api.piped.yt',
            'https://pipedapi.in.projectsegfau.lt',
            'https://piped-api.privacy.com.de',
            'https://pi.ppedata.live',
            'https://pipedapi.adminforge.de',
            'https://piped.kavin.rocks'
        ];

        for (const instance of pipedInstances) {
            try {
                const response = await axios.get(`${instance}/streams/${videoId}`, {
                    timeout: 10000,
                    headers: { 'User-Agent': UA }
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

                // Wrapper: known wrappers
                const wraps = [
                    msgObj.viewOnceMessageV2?.message,
                    msgObj.viewOnceMessageV2Extension?.message,
                    msgObj.viewOnceMessage?.message,
                    msgObj.ephemeralMessage?.message,
                    msgObj.documentWithCaptionMessage?.message,
                    msgObj.editMessage?.message,
                    msgObj.protocolMessage?.editedMessage,
                    msgObj.extendedTextMessage?.contextInfo?.quotedMessage,
                    msgObj.message
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
                        if (msgObj[k].mediaKey) return msgObj[k];
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

            typesToTry = [...new Set(typesToTry)];

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

            // ✅ Carregar sharp dinamicamente
            const sharpLib = await loadSharp();

            if (sharpLib) {
                // ✅ Usar Sharp em vez de ffmpeg (mais confiável)
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
