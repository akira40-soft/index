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
import { EdgeTTS } from 'node-edge-tts';

// ═══ Microsoft Edge TTS — Config da voz Fatima (PT-AO — Natural/Jovem) ═══
const EDGE_VOICE_ID = 'pt-AO-FatimaNeural';
const EDGE_RATE = '+5%';  // Jovem fala um pouco mais rápido
const EDGE_PITCH = '+10%'; // Tom mais alto para soar mais jovem (jovem/teen)

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
            const cacheKey = `el_${text.substring(0, 50)}_${language}`;
            if (this.ttsCache?.has(cacheKey)) {
                this.logger?.debug('💾 TTS from cache');
                return this.ttsCache.get(cacheKey);
            }

            // ════════════════════════════════════════════════
            // MICROSOFT EDGE TTS (Primário)
            // ════════════════════════════════════════════════
            try {
                this.logger?.info('🎙️ Iniciando TTS (Microsoft Edge — FatimaNeural PT-AO)...');

                // Edge TTS suporta textos mais longos, limitando por segurança
                const maxChars = 5000;
                const textTruncated = text.substring(0, maxChars);

                const mp3Path = this.generateRandomFilename('mp3');
                const opusPath = this.generateRandomFilename('opus');

                const tts = new EdgeTTS({
                    voice: EDGE_VOICE_ID,
                    rate: EDGE_RATE,
                    pitch: EDGE_PITCH
                });
                await tts.ttsPromise(textTruncated, mp3Path);

                // Converte MP3 → OGG Opus (WhatsApp voice note)
                this.logger?.info('🛠️ Convertendo Edge MP3 → Ogg Opus...');

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
                        fonte: 'Edge TTS — Fatima PT-AO (Ogg Opus)',
                        size: finalBuffer.length,
                        mimetype: 'audio/ogg; codecs=opus'
                    };

                    // Cache (máx 50 entradas)
                    this.ttsCache.set(cacheKey, result);
                    if (this.ttsCache.size > 50) {
                        const firstKey = this.ttsCache.keys().next().value;
                        this.ttsCache.delete(firstKey);
                    }

                    this.logger?.info(`🎙️ Edge TTS OK: "${textTruncated.substring(0, 50)}..." (${finalBuffer.length} bytes)`);
                    return result;

                } catch (opusError: any) {
                    // Ops: falha na conversão → devolve MP3 direto
                    this.logger?.warn(`⚠️ Opus falhou, enviando MP3 do Edge: ${opusError.message}`);
                    const finalBuffer = await fs.promises.readFile(mp3Path);
                    await this.cleanupFile(mp3Path).catch(() => { });
                    return {
                        sucesso: true,
                        buffer: finalBuffer,
                        fonte: 'Edge TTS — Fatima PT-AO (MP3)',
                        size: finalBuffer.length,
                        mimetype: 'audio/mpeg'
                    };
                }
            } catch (edgeError: any) {
                this.logger?.warn(`⚠️ Edge TTS falhou: ${edgeError.message}. Iniciando fallback para Google TTS...`);
                // Permite cair direto no bloco do Google TTS abaixo!
            }

            // ════════════════════════════════════════════════
            // GOOGLE TTS (Fallback — se o Edge falhar)
            // ════════════════════════════════════════════════
            this.logger?.info('🔊 Iniciando TTS (Google Fallback)...');

            const maxCharsGoogle = 500;
            const textTruncatedGoogle = text.substring(0, maxCharsGoogle);

            const audioUrl = googleTTS.getAudioUrl(textTruncatedGoogle, {
                lang: language || this.config?.TTS_LANGUAGE,
                slow: this.config?.TTS_SLOW,
                host: 'https://translate.google.com'
            });

            if (!audioUrl || typeof audioUrl !== 'string') {
                throw new Error('URL de áudio TTS inválida');
            }

            const outputPath = this.generateRandomFilename('mp3');
            const dlResp = await axios({
                url: audioUrl,
                method: 'GET',
                responseType: 'arraybuffer',
                timeout: 20000,
                validateStatus: (status) => status >= 200 && status < 300
            });

            const audioBuffer = Buffer.from(dlResp.data || []);
            if (!audioBuffer || audioBuffer.length === 0) {
                throw new Error('Audio buffer vazio ou inválido');
            }

            await fs.promises.writeFile(outputPath, audioBuffer);

            const opusPath2 = this.generateRandomFilename('opus');
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
                        .save(opusPath2);
                });

                const finalBuffer = await fs.promises.readFile(opusPath2);
                await Promise.all([this.cleanupFile(outputPath), this.cleanupFile(opusPath2)]);

                const result = {
                    sucesso: true,
                    buffer: finalBuffer,
                    fonte: 'Google TTS Fallback (Ogg Opus)',
                    size: finalBuffer.length,
                    mimetype: 'audio/ogg; codecs=opus'
                };

                this.ttsCache.set(cacheKey, result);
                if (this.ttsCache.size > 50) {
                    const firstKey = this.ttsCache.keys().next().value;
                    this.ttsCache.delete(firstKey);
                }

                this.logger?.info(`🔊 Google TTS Fallback OK: ${textTruncatedGoogle.substring(0, 50)}... (${finalBuffer.length} bytes)`);
                return result;

            } catch (opusError: any) {
                this.logger?.error('⚠️ Opus falhou (Google fallback), enviando MP3:', opusError.message);
                const finalBuffer = await fs.promises.readFile(outputPath);
                await this.cleanupFile(outputPath);
                return {
                    sucesso: true,
                    buffer: finalBuffer,
                    fonte: 'Google TTS Fallback (MP3)',
                    size: finalBuffer.length,
                    mimetype: 'audio/mpeg'
                };
            }

        } catch (error: any) {
            this.logger?.error('❌ Erro TTS:', error.message);
            if (error.response) {
                this.logger?.error(`Status: ${error.response?.status} — ${JSON.stringify(error.response?.data)?.substring(0, 120)}`);
            }
            return { sucesso: false, error: 'Erro ao gerar TTS: ' + error.message };
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
            primaryEngine: 'Edge TTS (FatimaNeural PT-AO)',
            fallbackEngine: 'Google TTS',
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
