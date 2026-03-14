/**
 * ═══════════════════════════════════════════════════════════════════════
 * CLASSE: APIClient
 * ═══════════════════════════════════════════════════════════════════════
 * Cliente HTTP com retry automático, conformidade com api.py payload
 * Gerencia todas as comunicações com o backend Python
 * ═══════════════════════════════════════════════════════════════════════
 */

import axios from 'axios';
import ConfigManager from './ConfigManager.js';

class APIClient {
    private config: any;
    private logger: any;
    private requestCount: number;
    private errorCount: number;

    constructor(logger: any = null) {
        this.config = ConfigManager.getInstance();
        this.logger = logger || console;
        this.requestCount = 0;
        this.errorCount = 0;
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
            tipo_mensagem: ['texto', 'image', 'audio', 'video', 'document', 'documentWithCaption'].includes(tipo_mensagem) ? tipo_mensagem : 'texto',
            historico: [],
            forcar_busca: Boolean(forcar_pesquisa),
            analise_doc: String(analise_doc || '')
        };

        // Adiciona contexto de reply se existir
        if (mensagem_citada || reply_metadata.is_reply) {
            payload.mensagem_citada = String(mensagem_citada || '').substring(0, 3000);
            payload.reply_metadata = {
                is_reply: true,
                reply_to_bot: Boolean(reply_metadata.reply_to_bot),
                quoted_author_name: String(reply_metadata.quoted_author_name || 'desconhecido').substring(0, 50),
                quoted_author_numero: String(reply_metadata.quoted_author_numero || 'desconhecido'),
                quoted_type: String(reply_metadata.quoted_type || 'texto'),
                quoted_text_original: String(reply_metadata.quoted_text_original || '').substring(0, 2000),
                context_hint: String(reply_metadata.context_hint || '')
            };
        } else {
            payload.reply_metadata = {
                is_reply: false,
                reply_to_bot: false
            };
        }

        // Adiciona dados de imagem se existirem
        if (imagem_dados && (imagem_dados.dados || imagem_dados.path)) {
            payload.imagem = {
                dados: imagem_dados.dados || null,
                path: imagem_dados.path || null,
                mime_type: imagem_dados.mime_type || 'image/jpeg',
                descricao: imagem_dados.descricao || 'Imagem enviada',
                analise_visao: imagem_dados.analise_visao || {}
            };
        }

        // Adiciona info de grupo se existir
        if (grupo_id) {
            payload.grupo_id = grupo_id;
            payload.contexto_grupo = grupo_nome || 'Grupo';
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

        const url = `${this.config.API_URL}${endpoint}`;
        const maxRetries = options.retries || this.config.API_RETRY_ATTEMPTS;
        let lastError = null;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                this.requestCount++;

                if (this.config.LOG_API_REQUESTS) {
                    this.logger.info(`[API] ${method.toUpperCase()} ${endpoint} (tentativa ${attempt}/${maxRetries})`);
                }

                const axiosConfig = {
                    method,
                    url,
                    timeout: this.config.API_TIMEOUT,
                    headers: {
                        'Content-Type': 'application/json',
                        'User-Agent': `AkiraBot/${this.config.BOT_VERSION}`
                    },
                    ...options
                };

                if (data) {
                    axiosConfig.data = data;
                }

                const response = await axios(axiosConfig);

                if (response.status >= 200 && response.status < 300) {
                    if (this.config.LOG_API_REQUESTS) {
                        this.logger.info(`[API] ✅ ${endpoint} (${response.status})`);
                    }
                    return { success: true, data: response.data, status: response.status };
                }

            } catch (error: any) {
                lastError = error;
                const statusCode = (error.response && error.response.status) || undefined;
                const errorMsg = (error.response && error.response.data && error.response.data.error) || error.message;

                if (this.config.LOG_API_REQUESTS) {
                    this.logger.warn(`[API] ⚠️ Erro ${statusCode || 'NETWORK'}: ${errorMsg} (tentativa ${attempt}/${maxRetries})`);
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
        const errorMsg = (lastError && lastError.response && lastError.response.data && lastError.response.data.error) || (lastError && lastError.message) || 'Erro desconhecido';

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
            const payload = this.buildPayload(messageData);

            const result = await this.request('POST', '/akira', payload);

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
            this.logger.error('[API] Erro ao processar mensagem:', error.message);
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
            const result = await this.request('POST', '/vision/analyze', {
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
            const result = await this.request('POST', '/vision/ocr', {
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
            const result = await this.request('POST', '/reset', payload);

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
            const result = await this.request('GET', '/health');
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
