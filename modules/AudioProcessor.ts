/**
 * ═══════════════════════════════════════════════════════════════════════
 * CLASSE: AudioProcessor
 * ═══════════════════════════════════════════════════════════════════════
 * Gerencia STT (Speech-to-Text), TTS (Text-to-Speech) e processamento de áudio
 * Integração com Deepgram STT + ElevenLabs TTS (Claudia - JGnWZj684pcXmK2SxYIv)
 * Fallback automático para Google TTS se ELEVENLABS_API_KEY não configurada
 * ═══════════════════════════════════════════════════════════════════════
 */

import axios from 'axios';
import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import googleTTS from 'google-tts-api';
import ConfigManager from './ConfigManager.js';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';

// ═══ Configurações das Vozes TikTok ═══
const TIKTOK_VOICE_BR = 'br_003'; // Ana (Jovem/Amigável)
const TIKTOK_VOICE_PT = 'pt_001'; // Portugal (Feminina)
const TIKTOK_API_URL = 'https://api16-normal-v6.tiktokv.com/media/api/text/speech/invoke/';

// ═══ Microsoft Edge TTS — Config da voz Fernanda (PT-PT — Perfil Jovem/Animado) ═══
const EDGE_VOICE_ID = 'pt-PT-FernandaNeural';
const EDGE_RATE = '+12%';    // Velocidade animada
const EDGE_PITCH = '+30Hz';  // Tom em Hz para efeito "Young" (Aprox +15%)

class AudioProcessor {
    private config: any;
    private logger: any;
    private tempFolder: string;
    private sttCache: Map<string, any>;
    private ttsCache: Map<string, any>;
    private AUDIO_FILTERS: Record<string, string>;
    public sock: any;

    constructor(logger: any = null) {
        this.config = ConfigManager.getInstance();
        this.logger = logger || console;
        this.tempFolder = this.config?.TEMP_FOLDER || './temp';
        this.sttCache = new Map();
        this.ttsCache = new Map();
        this.sock = null;

        // Filtros de Áudio (Legacy + Novos)
        this.AUDIO_FILTERS = {
            'bass': 'firequalizer=gain_entry=\'entry(0,10);entry(250,20);entry(4000,-10)\'',
            'bassboost': 'firequalizer=gain_entry=\'entry(0,12);entry(200,15);entry(4000,-8)\'',
            'esquilo': 'asetrate=44100*2,atempo=0.5',
            'gemuk': 'asetrate=44100*0.5,atempo=2.0',
            'nightcore': 'asetrate=44100*1.25,atempo=1.0',
            'earrape': 'volume=100',
            'fast': 'atempo=1.63,atempo=1.63',
            'fat': 'atempo=1.6,asetrate=22100',
            'reverse': 'areverse',
            'robot': 'afftfilt=real=\'hypot(re,im)*sin(0)\':imag=\'hypot(re,im)*cos(0)\':win_size=512:overlap=0.75',
            'slow': 'atempo=0.7,atempo=0.7',
            'smooth': 'minterpolate=\'mi_mode=mci:mc_mode=aobmc:vsbmc=1:fps=120\'',
            'tupai': 'atempo=0.5,asetrate=65100',
            'treble': 'treble=g=10',
            'echo': 'aecho=0.8:0.9:1000:0.3',
            'deep': 'asetrate=44100*0.7,atempo=0.8,lowpass=f=2000',
            'squirrel': 'asetrate=44100*2.5,atempo=0.5',
            // 8D Audio Effect - Cria sensação de áudio 360 graus
            // Usa filtros de reverb e delay para criar efeito surround
            '8d': 'aecho=0.8:0.88:60:0.4,aecho=0.8:0.88:30:0.3,aecho=0.8:0.88:15:0.2,apulsator=hz=0.5'
        };
    }

    public setSocket(sock: any): void {
        this.sock = sock;
    }

    /**
    * Gera nome de arquivo aleatório
    */
    generateRandomFilename(ext = '') {
        return path.join(
            this.tempFolder,
            `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext ? '.' + ext : ''}`
        );
    }

    /**
    * Limpa arquivo após uso
    */
    async cleanupFile(filePath: string | null | undefined): Promise<void> {
        try {
            if (!filePath || !fs.existsSync(filePath)) return;

            return new Promise((resolve) => {
                fs.unlink(filePath, (err) => {
                    if (err && err.code !== 'ENOENT') {
                        this.logger?.warn(`⚠️ Erro ao limpar ${path.basename(filePath || '')}: ${err.code}`);
                    }
                    resolve();
                });
            });
        } catch (e: any) {
            this.logger?.error('Erro ao limpar arquivo:', e.message);
        }
    }

    /**
    * STT usando Deepgram
    * Transcreve áudio para texto
    */
    async speechToText(audioBuffer: Buffer, language: string = 'pt'): Promise<any> {
        try {
            if (!this.config?.DEEPGRAM_API_KEY) {
                this.logger?.warn('⚠️ Deepgram API Key não configurada');
                return {
                    sucesso: false,
                    texto: '[Audio recebido mas Deepgram não configurado]',
                    erro: 'API_KEY_MISSING'
                };
            }

            this.logger?.info('🔊 Iniciando STT (Deepgram)...');

            // Converte OGG para MP3
            const audioPath = this.generateRandomFilename('ogg');
            const convertedPath = this.generateRandomFilename('mp3');

            const audioData = Buffer.isBuffer(audioBuffer) ? audioBuffer : Buffer.from(audioBuffer);
            await fs.promises.writeFile(audioPath, audioData);

            // Converte para MP3
            await new Promise((resolve, reject) => {
                ffmpeg(audioPath)
                    .toFormat('mp3')
                    .audioCodec('libmp3lame')
                    .on('end', resolve)
                    .on('error', reject)
                    .save(convertedPath);
            });

            const convertedBuffer = await fs.promises.readFile(convertedPath);

            // Chama Deepgram API
            this.logger?.info('📤 Enviando para Deepgram...');

            const response = await axios.post(
                this.config?.DEEPGRAM_API_URL,
                convertedBuffer,
                {
                    headers: {
                        'Authorization': `Token ${this.config?.DEEPGRAM_API_KEY}`,
                        'Content-Type': 'audio/mpeg'
                    },
                    params: {
                        model: this.config?.DEEPGRAM_MODEL,
                        language: language || this.config?.STT_LANGUAGE,
                        smart_format: true,
                        punctuate: true,
                        diarize: false,
                        numerals: true
                    },
                    timeout: 30000
                }
            );

            let textoTranscrito = '';
            if (response.data?.results?.channels?.[0]?.alternatives?.[0]?.transcript) {
                textoTranscrito = response.data.results.channels[0].alternatives[0].transcript.trim();
            }

            if (!textoTranscrito || textoTranscrito.length < 2) {
                textoTranscrito = '[Não consegui entender claramente]';
            }

            // Limpeza
            await Promise.all([
                this.cleanupFile(audioPath),
                this.cleanupFile(convertedPath)
            ]);

            this.logger?.info(`📝 STT Completo: ${textoTranscrito.substring(0, 80)}...`);

            return {
                sucesso: true,
                texto: textoTranscrito,
                fonte: 'Deepgram STT',
                confidence: response.data?.results?.channels?.[0]?.alternatives?.[0]?.confidence || 0
            };

        } catch (error: any) {
            this.logger?.error('❌ Erro STT:', error.message);

            let errorCode = 'UNKNOWN';
            if (error.response?.status === 401) {
                errorCode = 'INVALID_API_KEY';
            } else if (error.code === 'ECONNREFUSED') {
                errorCode = 'CONNECTION_FAILED';
            }

            return {
                sucesso: false,
                texto: '[Recebi seu áudio mas houve um erro na transcrição]',
                erro: errorCode,
                mensagem: error.message
            };
        }
    }

    /**
     * TTS usando TikTok (Neural e Animado)
     * Fallback excelente para o Edge TTS
     */
    async tiktokTTS(text: string, language: string = 'pt'): Promise<Buffer | null> {
        try {
            const voice = language === 'pt' ? TIKTOK_VOICE_PT : TIKTOK_VOICE_BR;
            this.logger?.info(`🎙️ Iniciando TikTok TTS (Voz: ${voice})...`);

            const response = await axios.post(
                TIKTOK_API_URL,
                new URLSearchParams({
                    text_speaker: voice,
                    req_text: text,
                    speaker_map_type: '0',
                    aid: '1233'
                }).toString(),
                {
                    headers: {
                        'User-Agent': 'com.zhiliaoapp.musically/2022600030 (Linux; U; Android 7.1.2; en_US; SM-G988N; Build/NRD90M;tt-ok/3.10.0.2)',
                        'Cookie': `sessionid=${process.env.TIKTOK_SESSION_ID || ''}`,
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    timeout: 10000
                }
            );

            if (response.data?.status_code !== 0) {
                this.logger?.warn(`⚠️ TikTok TTS retornou status ${response.data?.status_code}: ${response.data?.status_msg}`);
                return null;
            }

            const base64Data = response.data?.data?.v_str;
            if (!base64Data) return null;

            return Buffer.from(base64Data, 'base64');
        } catch (error: any) {
            this.logger?.error(`❌ Erro TikTok TTS: ${error.message}`);
            return null;
        }
    }
    /**
    * TTS usando ElevenLabs (Claudia - JGnWZj684pcXmK2SxYIv)
    * Modelo: eleven_multilingual_v2 | Formato: mp3_44100_128
    * Fallback automático para Google TTS se ELEVENLABS_API_KEY não configurada
    */
    async textToSpeech(text: string, language: string = 'pt'): Promise<any> {
        try {
            if (!text || text.length === 0) {
                return { sucesso: false, error: 'Texto vazio' };
            }

            // Verifica cache
            const cacheKey = `tts_${text.substring(0, 50)}_${language}`;
            if (this.ttsCache?.has(cacheKey)) {
                this.logger?.debug('💾 TTS from cache');
                return this.ttsCache.get(cacheKey);
            }

            const maxChars = 5000;
            const textTruncated = text.substring(0, maxChars);
            const mp3Path = this.generateRandomFilename('mp3');
            const opusPath = this.generateRandomFilename('opus');

            // ════════════════════════════════════════════════
            // CAMADA 1: MICROSOFT EDGE TTS (Primário)
            // ════════════════════════════════════════════════
            try {
                this.logger?.info('🎙️ Camada 1: Iniciando Edge TTS...');

                // Configuração de Proxy se disponível
                let agent = undefined;
                const proxyUrl = this.config?.TTS_PROXY;
                if (proxyUrl) {
                    this.logger?.info(`🌐 Usando Proxy para Edge TTS: ${proxyUrl.substring(0, 20)}...`);
                    agent = proxyUrl.startsWith('socks') ? new SocksProxyAgent(proxyUrl) : new HttpsProxyAgent(proxyUrl);
                }

                const tts = new MsEdgeTTS({ enableLogger: false, agent });
                await tts.setMetadata(EDGE_VOICE_ID, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

                const requestDir = path.join(this.tempFolder, `edge-${Date.now()}`);
                if (!fs.existsSync(requestDir)) fs.mkdirSync(requestDir, { recursive: true });

                const { audioFilePath } = await tts.toFile(requestDir, textTruncated, {
                    rate: EDGE_RATE,
                    pitch: EDGE_PITCH
                });

                // Validação de integridade
                const header = Buffer.alloc(4);
                const fd = fs.openSync(audioFilePath, 'r');
                fs.readSync(fd, header, 0, 4, 0);
                fs.closeSync(fd);

                const isMp3 = header.toString('hex').startsWith('494433') || (header[0] === 0xff && (header[1] & 0xe0) === 0xe0);
                if (!isMp3) throw new Error('Dados inválidos do Edge TTS (IP bloqueado?)');

                fs.renameSync(audioFilePath, mp3Path);
                fs.rmSync(requestDir, { recursive: true, force: true });

                this.logger?.info(`✅ Edge TTS OK (${fs.statSync(mp3Path).size} bytes)`);
                return await this.finalizeSpeech(mp3Path, opusPath, cacheKey, 'Edge TTS (Neural)');

            } catch (e: any) {
                this.logger?.warn(`⚠️ Edge TTS falhou: ${e.message}. Tentando TikTok...`);
            }

            // ════════════════════════════════════════════════
            // CAMADA 2: TIKTOK TTS (Fallback Neural Animado)
            // ════════════════════════════════════════════════
            try {
                this.logger?.info('🎙️ Camada 2: Iniciando TikTok TTS...');
                const tiktokBuffer = await this.tiktokTTS(textTruncated, language);

                if (tiktokBuffer) {
                    await fs.promises.writeFile(mp3Path, tiktokBuffer);
                    this.logger?.info(`✅ TikTok TTS OK (${tiktokBuffer.length} bytes)`);
                    return await this.finalizeSpeech(mp3Path, opusPath, cacheKey, 'TikTok TTS (Neural/Animado)');
                }
            } catch (e: any) {
                this.logger?.warn(`⚠️ TikTok TTS falhou: ${e.message}. Usando Google Fallback.`);
            }

            // ════════════════════════════════════════════════
            // CAMADA 3: GOOGLE TTS (Fallback Final)
            // ════════════════════════════════════════════════
            try {
                this.logger?.info('🎙️ Camada 3: Iniciando Google TTS Fallback...');
                const url = googleTTS.getAudioUrl(textTruncated, {
                    lang: language === 'pt' ? 'pt-PT' : 'pt-BR',
                    slow: false,
                    host: 'https://translate.google.com',
                });

                const response = await axios({
                    method: 'get',
                    url: url,
                    responseType: 'arraybuffer',
                    timeout: 10000
                });

                await fs.promises.writeFile(mp3Path, response.data);
                return await this.finalizeSpeech(mp3Path, opusPath, cacheKey, 'Google TTS (Fallback)');
            } catch (googleError: any) {
                this.logger?.error(`❌ Falha no Google TTS: ${googleError.message}`);
                throw googleError;
            }

        } catch (error: any) {
            this.logger?.error('❌ Falha crítica no pipeline de TTS:', error.message);
            return { sucesso: false, error: error.message };
        }
    }

    /**
     * Finaliza o processamento: Converte MP3 -> OGG Opus e limpa arquivos
     */
    private async finalizeSpeech(mp3Path: string, opusPath: string, cacheKey: string, source: string): Promise<any> {
        try {
            await new Promise((resolve, reject) => {
                ffmpeg(mp3Path)
                    .toFormat('opus')
                    .audioCodec('libopus')
                    .audioBitrate('48k')
                    .audioFrequency(48000)
                    .audioChannels(1)
                    .on('end', resolve)
                    .on('error', reject)
                    .save(opusPath);
            });

            const finalBuffer = await fs.promises.readFile(opusPath);
            await Promise.all([this.cleanupFile(mp3Path), this.cleanupFile(opusPath)]);

            const result = {
                sucesso: true,
                buffer: finalBuffer,
                fonte: source,
                size: finalBuffer.length,
                mimetype: 'audio/ogg; codecs=opus'
            };

            this.ttsCache.set(cacheKey, result);
            if (this.ttsCache.size > 100) this.ttsCache.delete(this.ttsCache.keys().next().value);

            return result;
        } catch (e: any) {
            this.logger?.error(`Erro ao finalizar áudio: ${e.message}`);
            // Fallback: se falhar o opus, tenta mandar MP3 original antes de desistir
            try {
                const mp3Buffer = await fs.promises.readFile(mp3Path);
                await this.cleanupFile(mp3Path);
                return {
                    sucesso: true,
                    buffer: mp3Buffer,
                    fonte: `${source} (Fallback MP3)`,
                    size: mp3Buffer.length,
                    mimetype: 'audio/mpeg'
                };
            } catch {
                throw e;
            }
        }
    }



    /**
    * Detecta se é áudio animado (apenas tipo)
    */
    detectAudioType(buffer: Buffer): string {
        if (!buffer || buffer.length < 12) return 'unknown';

        const header = buffer.slice(0, 4).toString('hex').toLowerCase();

        // OGG Vorbis
        if (header === '4f676753') return 'ogg';
        // RIFF (WAV)
        if (header === '52494646') return 'wav';
        // MP3
        if (header === '494433' || header === 'fffb') return 'mp3';
        // FLAC
        if (header === '664c6143') return 'flac';
        // AAC
        if (header === 'fff1' || header === 'fff9') return 'aac';

        return 'unknown';
    }

    /**
    * Aplica efeito de áudio (nightcore, slow, bass, etc)
    */
    /**
    * Aplica efeito de áudio (nightcore, slow, bass, etc)
    */
    async applyAudioEffect(inputBuffer: Buffer, effectName: string = 'normal'): Promise<any> {
        try {
            const effectKey = effectName.toLowerCase();
            const filterStr = this.AUDIO_FILTERS[effectKey];

            if (!filterStr && effectKey !== 'normal') {
                return {
                    sucesso: false,
                    error: `Efeito '${effectName}' não encontrado.`
                };
            }

            // Se for normal ou sem filtro, retorna original
            if (effectKey === 'normal' || !filterStr) {
                return { sucesso: true, buffer: inputBuffer, effect: 'normal' };
            }

            const inputPath = this.generateRandomFilename('mp3');
            const outputPath = this.generateRandomFilename('mp3');

            const audioData = Buffer.isBuffer(inputBuffer) ? inputBuffer : Buffer.from(inputBuffer);
            await fs.promises.writeFile(inputPath, audioData);

            this.logger?.info(`🎵 Aplicando efeito '${effectName}'...`);

            await new Promise((resolve, reject) => {
                ffmpeg(inputPath)
                    .audioFilters(filterStr)
                    .outputOptions('-q:a 5') // Qualidade VBR
                    .save(outputPath)
                    .on('end', resolve)
                    .on('error', (err) => {
                        this.logger?.error(`❌ Erro FFmpeg (${effectName}):`, err.message);
                        reject(err);
                    });
            });

            const processedBuffer = fs.readFileSync(outputPath);

            // 🛠️ CONVERSÃO PARA OGG OPUS (VOICE NOTE STYLE)
            this.logger?.info(`🛠️ Convertendo áudio com efeito '${effectName}' para Ogg Opus...`);
            const opusPath = this.generateRandomFilename('opus');

            try {
                await new Promise((resolve, reject) => {
                    ffmpeg(outputPath)
                        .toFormat('opus')
                        .audioCodec('libopus')
                        .audioBitrate('32k')
                        .audioFrequency(48000)
                        .audioChannels(1)
                        .on('end', resolve)
                        .on('error', reject)
                        .save(opusPath);
                });

                const resultBuffer = fs.readFileSync(opusPath);

                // Cleanup
                await Promise.all([
                    this.cleanupFile(inputPath),
                    this.cleanupFile(outputPath),
                    this.cleanupFile(opusPath)
                ]);

                return {
                    sucesso: true,
                    buffer: resultBuffer,
                    effect: effectName,
                    size: resultBuffer.length,
                    mimetype: 'audio/ogg; codecs=opus'
                };
            } catch (opusError) {
                this.logger?.error('⚠️ Erro na conversão para Opus, enviando MP3 processado:', opusError.message);
                const resultBuffer = fs.readFileSync(outputPath);
                await Promise.all([
                    this.cleanupFile(inputPath),
                    this.cleanupFile(outputPath)
                ]);
                return {
                    sucesso: true,
                    buffer: resultBuffer,
                    effect: effectName,
                    size: resultBuffer.length,
                    mimetype: 'audio/mpeg'
                };
            }

        } catch (error: any) {
            this.logger?.error(`❌ Erro ao aplicar efeito ${effectName}:`, error.message);
            return {
                sucesso: false,
                error: error.message
            };
        }
    }

    /**
    * Alias para textToSpeech (compatibilidade com CommandHandler)
    * Converte códigos de idioma para formato correto (ex: 'en' -> 'en-US')
    */
    async generateTTS(text: string, language: string = 'pt'): Promise<any> {
        const langMap: Record<string, string> = {
            'pt': 'pt-BR',
            'en': 'en-US',
            'es': 'es-ES',
            'fr': 'fr-FR',
            'de': 'de-DE',
            'it': 'it-IT',
            'ja': 'ja-JP',
            'zh': 'zh-CN',
            'ar': 'ar-SA'
        };

        const langCode = langMap[language.toLowerCase()] || language;

        return await this.textToSpeech(text, langCode);
    }

    /**
    * Limpa cache de TTS
    */
    clearCache(): void {
        this.sttCache?.clear();
        this.ttsCache?.clear();
        this.logger?.info('💾 Caches de áudio limpos');
    }

    /**
    * Retorna estatísticas
    */
    getStats(): any {
        return {
            primaryEngine: 'Triple-Threat Pipeline',
            tiers: ['Microsoft Edge (Neural)', 'TikTok (Neural/Animado)', 'Google (Legacy)'],
            proxyConfigured: !!this.config?.TTS_PROXY,
            sttCacheSize: this.sttCache?.size,
            ttsCacheSize: this.ttsCache?.size,
            deepgramConfigured: !!this.config?.DEEPGRAM_API_KEY,
            edgeTtsVoice: EDGE_VOICE_ID,
            sttEnabled: this.config?.FEATURE_STT_ENABLED,
            ttsEnabled: this.config?.FEATURE_TTS_ENABLED
        };
    }
}

export default AudioProcessor;
