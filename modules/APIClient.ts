/**
 * ═══════════════════════════════════════════════════════════════════════
 * CLASSE: APIClient
 * ═══════════════════════════════════════════════════════════════════════
 * Cliente HTTP com retry automático, conformidade com api.py payload
 * Gerencia todas as comunicações com o backend Python
 * ═══════════════════════════════════════════════════════════════════════
 */

import ConfigManager from './ConfigManager.js';
import MediaProcessor from './MediaProcessor.js';

class APIClient {
    private config: any;
    private logger: any;
    private requestCount: number;
    private errorCount: number;
    private mediaProcessor: MediaProcessor;

    constructor(logger: any = null) {
        this.config = ConfigManager.getInstance();
        this.logger = logger || console;
        this.requestCount = 0;
        this.errorCount = 0;
        this.mediaProcessor = new MediaProcessor(this.logger);
        this.logger.info(`🔌 [API] Cliente inicializado. URL Base: ${this.config.API_URL}`);
    }

    /**
    * Formata payload conforme esperado por api.py
    */
    buildPayload(messageData: any): any {
        const {
            usuario,
            numero,
            mensagem,
            tipo_conversa = 'pv',
            tipo_mensagem = 'texto',
            mensagem_citada = '',
            reply_metadata = {},
            imagem_dados = null,
            video_dados = null,
            documento_dados = null,
            grupo_id = null,
            grupo_nome = null,
            forcar_pesquisa = false,
            analise_doc = ''
        } = messageData;

        const payload: any = {
            usuario: String(usuario || 'anonimo').substring(0, 50),
            numero: String(numero || 'desconhecido').substring(0, 20),
            mensagem: String(mensagem || '').substring(0, 2000),
            tipo_conversa: ['pv', 'grupo'].includes(tipo_conversa) ? tipo_conversa : 'pv',
            tipo_mensagem: ['texto', 'image', 'imagem', 'audio', 'video', 'document', 'documento', 'documentWithCaption'].includes(tipo_mensagem) ? tipo_mensagem : 'texto',
            historico: [],
            forcar_busca: Boolean(forcar_pesquisa),
            analise_doc: String(analise_doc || '')
        };

        // Adiciona contexto de reply se existir
        const safeReplyMeta = reply_metadata || {};
        const isReply = Boolean(mensagem_citada || safeReplyMeta.is_reply || safeReplyMeta.isReply);

        if (isReply) {
            // Se mensagem_citada raiz for vazia, puxa do metadado gerado pelo MessageProcessor
            const textoCitadoReal = mensagem_citada || safeReplyMeta.textoMensagemCitada || safeReplyMeta.quotedTextOriginal || '';
            payload.mensagem_citada = String(textoCitadoReal).substring(0, 3000);

            payload.reply_metadata = {
                is_reply: true,
                reply_to_bot: Boolean(safeReplyMeta.reply_to_bot || safeReplyMeta.ehRespostaAoBot),
                quoted_author_name: String(safeReplyMeta.quoted_author_name || safeReplyMeta.quemEscreveuCitacaoName || 'desconhecido').substring(0, 50),
                quoted_author_numero: String(safeReplyMeta.quoted_author_numero || safeReplyMeta.quemEscreveuCitacao || 'desconhecido'),
                quoted_type: String(safeReplyMeta.quoted_type || safeReplyMeta.tipoMidiaCitada || 'texto'),
                quoted_text_original: String(safeReplyMeta.quoted_text_original || safeReplyMeta.quotedTextOriginal || '').substring(0, 2000),
                context_hint: String(safeReplyMeta.context_hint || safeReplyMeta.contextHint || '')
            };
        } else {
            payload.reply_metadata = {
                is_reply: false,
                reply_to_bot: false
            };
        }

        // 📷 Mapeia Imagem (Sincronizado com api.py)
        if (imagem_dados && (imagem_dados.dados || imagem_dados.path)) {
            payload.imagem_dados = {
                dados: imagem_dados.dados || null,
                path: imagem_dados.path || null,
                mime_type: imagem_dados.mime_type || 'image/jpeg',
                descricao: imagem_dados.descricao || 'Imagem enviada',
                analise_visao: imagem_dados.analise_visao || {}
            };
        }

        // 🎥 Mapeia Vídeo
        if (video_dados && (video_dados.dados || video_dados.path)) {
            payload.video_dados = {
                dados: video_dados.dados || null,
                path: video_dados.path || null,
                mime_type: video_dados.mime_type || 'video/mp4',
                descricao: video_dados.descricao || 'Vídeo enviado'
            };
        }

        // 📄 Mapeia Documento
        if (documento_dados && (documento_dados.dados || documento_dados.path)) {
            payload.documento_dados = {
                dados: documento_dados.dados || null,
                path: documento_dados.path || null,
                mime_type: documento_dados.mime_type || 'application/octet-stream',
                nome_arquivo: documento_dados.nome_arquivo || 'documento'
            };
        }

        // Adiciona info de grupo se existir
        if (grupo_id) {
            payload.grupo_id = grupo_id;
            payload.grupo_nome = grupo_nome || 'Grupo';
        }

        return payload;
    }

    /**
    * Realiza requisição com retry exponencial
    */
    async request(method: string, endpoint: string, data: any = null, options: any = {}): Promise<any> {
        // Validate method parameter
        if (!method || typeof method !== 'string') {
            this.logger.error(`[API] Invalid method parameter: ${method}`);
            return {
                success: false,
                error: 'Invalid HTTP method provided'
            };
        }

        // Normalização simples: garante que não termine em barra para evitar // no endpoint
        let baseUrl = (this.config.API_URL || '').trim();
        if (baseUrl.endsWith('/')) {
            baseUrl = baseUrl.slice(0, -1);
        }

        let url = `${baseUrl}${endpoint}`;
        // Remove duplicatas de /api/api/ caso o usuário tenha configurado a base com o prefixo
        url = url.replace(/\/api\/api\//g, '/api/');

        const parsedUrl = new URL(url);
        const maxRetries = options.retries || this.config.API_RETRY_ATTEMPTS;
        let lastError = null;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                this.requestCount++;

                if (this.config.LOG_API_REQUESTS) {
                    this.logger.info(`[API] ${method.toUpperCase()} ${url} (tentativa ${attempt}/${maxRetries})`);
                }

                const fetchOptions: any = {
                    method,
                    headers: {
                        'Content-Type': 'application/json',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
                    },
                    ...options
                };

                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), this.config.API_TIMEOUT);
                fetchOptions.signal = controller.signal;

                if (data) {
                    fetchOptions.body = JSON.stringify(data);
                }

                const response = await fetch(url, fetchOptions);
                clearTimeout(timeoutId);

                let responseData: any = {};
                const contentType = response.headers.get("content-type");
                if (contentType && contentType.includes("application/json")) {
                    responseData = await response.json();
                } else {
                    const textData = await response.text();
                    try { responseData = JSON.parse(textData); } catch (e) { responseData = { error: textData }; }
                }

                if (response.ok) {
                    if (this.config.LOG_API_REQUESTS) {
                        this.logger.info(`[API] ✅ ${endpoint} (${response.status})`);
                    }
                    return { success: true, data: responseData, status: response.status };
                } else {
                    // Dispara exceção similar ao axios para o catch capturar
                    throw {
                        response: {
                            status: response.status,
                            data: responseData
                        },
                        message: `HTTP error! status: ${response.status}`,
                        code: `HTTP_${response.status}`
                    };
                }

            } catch (error: any) {
                lastError = error;
                const statusCode = error.response?.status;
                const errorMsg = error.response?.data?.error || error.message;

                if (this.config.LOG_API_REQUESTS) {
                    let code = error.code || 'UNKNOWN';
                    if (error.name === 'AbortError') {
                        code = 'ETIMEDOUT';
                    }
                    const syscall = error.syscall ? `| syscall: ${error.syscall}` : '';
                    this.logger.warn(`[API] ⚠️ Erro ${statusCode || 'NETWORK'} (${code}${syscall}): ${errorMsg} | URL: ${url} (tentativa ${attempt}/${maxRetries})`);
                    if (error.stack && attempt === maxRetries) {
                        this.logger.debug(`[API] Stack: ${error.stack.substring(0, 200)}...`);
                    }
                }

                // Não retry em erros 4xx (exceto timeout)
                if (statusCode >= 400 && statusCode < 500 && statusCode !== 408) {
                    this.errorCount++;
                    return { success: false, error: errorMsg, status: statusCode };
                }

                // Retry com delay exponencial
                if (attempt < maxRetries) {
                    const delayMs = this.config.API_RETRY_DELAY * Math.pow(2, attempt - 1);
                    await new Promise(resolve => setTimeout(resolve, delayMs));
                }
            }
        }

        this.errorCount++;
        let errorMsg = 'Erro desconhecido';
        if (lastError) {
            if (lastError.response?.data?.error) {
                errorMsg = lastError.response.data.error;
            } else if (lastError.name === 'AbortError') {
                errorMsg = 'Timeout da API excedido';
            } else {
                errorMsg = lastError.message || String(lastError);
            }
        }

        if (this.config.LOG_API_REQUESTS) {
            this.logger.error(`[API] ❌ Falhou após ${maxRetries} tentativas: ${errorMsg}`);
        }

        return { success: false, error: errorMsg, lastError };
    }

    /**
    * Envia mensagem para processar na API
    */
    async processMessage(messageData: any): Promise<any> {
        try {
            // Se houver m: m nos dados de mídia e não houver dados/path, tenta baixar
            if (messageData.imagem_dados?.m && !messageData.imagem_dados.dados && !messageData.imagem_dados.path) {
                const buffer = await this.mediaProcessor.downloadMedia(messageData.imagem_dados.m, 'image');
                if (buffer) {
                    messageData.imagem_dados.dados = buffer.toString('base64');
                }
            }
            if (messageData.video_dados?.m && !messageData.video_dados.dados && !messageData.video_dados.path) {
                const buffer = await this.mediaProcessor.downloadMedia(messageData.video_dados.m, 'video');
                if (buffer) {
                    messageData.video_dados.dados = buffer.toString('base64');
                }
            }
            if (messageData.documento_dados?.m && !messageData.documento_dados.dados && !messageData.documento_dados.path) {
                const buffer = await this.mediaProcessor.downloadMedia(messageData.documento_dados.m, 'document');
                if (buffer) {
                    messageData.documento_dados.dados = buffer.toString('base64');
                }
            }

            this.logger.info(`[API] Construindo payload...`);
            const payload = this.buildPayload(messageData);
            this.logger.info(`[API] Payload pronto. Enviando this.request('POST') url: /api/akira`);

            const result = await this.request('POST', '/api/akira', payload);

            if (result.success) {
                return {
                    success: true,
                    resposta: (result.data && result.data.resposta) || 'Sem resposta',
                    tipo_mensagem: (result.data && result.data.tipo_mensagem) || 'texto',
                    pesquisa_feita: (result.data && result.data.pesquisa_feita) || false,
                    metadata: result.data
                };
            } else {
                return {
                    success: false,
                    resposta: 'Eita! Tive um problema aqui. Tenta de novo em um segundo?',
                    error: result.error
                };
            }
        } catch (error: any) {
            const status = error.response?.status || 'NETWORK';
            const code = error.code || 'NETWORK_ERR';
            const errDetails = error.stack || error.message || String(error);
            this.logger.error(`[API] Erro FATAL ao processar mensagem (Status: ${status} | Code: ${code}):\n${errDetails}`);

            return {
                success: false,
                resposta: 'Deu um erro interno aqui. Tenta depois?',
                error: error.message
            };
        }
    }

    /**
    * Faz requisição para análise de visão
    */
    async analyzeImage(imageBase64: string, usuario: string = 'anonimo', numero: string = ''): Promise<any> {
        try {
            const result = await this.request('POST', '/api/vision/analyze', {
                imagem: imageBase64,
                usuario,
                numero,
                include_ocr: true,
                include_shapes: true,
                include_objects: true
            });

            if (result.success) {
                return {
                    success: true,
                    analise: result.data
                };
            } else {
                return {
                    success: false,
                    error: result.error
                };
            }
        } catch (error: any) {
            this.logger.error('[VISION] Erro ao analisar imagem:', error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
    * Faz OCR em imagem
    */
    async performOCR(imageBase64: string, numero: string = ''): Promise<any> {
        try {
            const result = await this.request('POST', '/api/vision/ocr', {
                imagem: imageBase64,
                numero
            });

            if (result.success) {
                return {
                    success: true,
                    text: (result.data && result.data.text) || '',
                    confidence: (result.data && result.data.confidence) || 0,
                    word_count: (result.data && result.data.word_count) || 0
                };
            } else {
                return {
                    success: false,
                    error: result.error
                };
            }
        } catch (error: any) {
            this.logger.error('[OCR] Erro ao fazer OCR:', error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
    * Requisita reset da API
    */
    async reset(usuario: string | null = null): Promise<any> {
        try {
            const payload = usuario ? { usuario } : {};
            const result = await this.request('POST', '/api/reset', payload);

            return {
                success: result.success,
                status: (result.data && result.data.status) || 'reset_attempted',
                message: (result.data && result.data.message) || 'Reset solicitado'
            };
        } catch (error: any) {
            this.logger.error('[RESET] Erro ao fazer reset:', error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
    * Health check
    */
    async healthCheck(): Promise<any> {
        try {
            const result = await this.request('GET', '/api/health');
            return {
                success: result.success,
                status: (result.data && result.data.status) || 'unknown',
                version: (result.data && result.data.version) || 'unknown'
            };
        } catch (error: any) {
            return {
                success: false,
                status: 'down',
                error: error.message
            };
        }
    }

    /**
    * Retorna estatísticas
    */
    getStats(): any {
        return {
            totalRequests: this.requestCount,
            totalErrors: this.errorCount,
            errorRate: this.requestCount > 0 ? (this.errorCount / this.requestCount * 100).toFixed(2) + '%' : '0%'
        };
    }
}

export default APIClient;
