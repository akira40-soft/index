/**
 * ═══════════════════════════════════════════════════════════════════════
 * CLASSE: ConfigManager
 * ═══════════════════════════════════════════════════════════════════════
 * Gerencia todas as configurações, constantes e variáveis de ambiente
 * Singleton pattern para acesso global consistente
 * ═══════════════════════════════════════════════════════════════════════
 */
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import fs from 'fs';
// ── Carrega .env da raiz do projecto de forma segura (sem expor chaves no código) ──
try {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const envPath = path.resolve(__dirname, '..', '.env');
    if (fs.existsSync(envPath)) {
        // dotenv carrega variáveis para process.env sem sobrescrever as que já existem
        const { config: loadEnv } = createRequire(import.meta.url)('dotenv');
        loadEnv({ path: envPath, override: false });
        console.log('✅ ConfigManager: .env carregado da raiz do projecto');
    }
}
catch (_e) {
    // Em Railway as vars já vêm por process.env — sem fallback necessário
}
class ConfigManager {
    static instance = null;
    // Propriedades declaradas para TypeScript
    PORT = 0;
    API_URL;
    API_TIMEOUT = 0;
    API_RETRY_ATTEMPTS = 0;
    API_RETRY_DELAY = 0;
    BASE_URL = "";
    BOT_NUMERO_REAL = "";
    BOT_NAME = "";
    BOT_VERSION = "";
    PREFIXO = "";
    TEMP_FOLDER = "";
    AUTH_FOLDER = "";
    DATABASE_FOLDER = "";
    LOGS_FOLDER = "";
    DEEPGRAM_API_KEY;
    DEEPGRAM_API_URL = "";
    DEEPGRAM_MODEL = "";
    STT_LANGUAGE = "";
    TTS_LANGUAGE = "";
    TTS_SLOW = false;
    RATE_LIMIT_WINDOW = 0;
    RATE_LIMIT_MAX_CALLS = 0;
    MUTE_DEFAULT_MINUTES = 0;
    MUTE_MAX_DAILY = 0;
    AUTO_BAN_AFTER_MINUTES = 0;
    YT_MAX_SIZE_MB = 0;
    YT_TIMEOUT_MS = 0;
    YT_QUALITY = "";
    YT_MAX_DURATION_SECONDS = 0;
    STICKER_SIZE = 0;
    STICKER_MAX_ANIMATED_SECONDS = 0;
    IMAGE_QUALITY = 0;
    MAX_AUDIO_SIZE_MB = 0;
    MAX_RESPONSE_CHARS = 0;
    TYPING_SPEED_MS = 0;
    MIN_TYPING_TIME_MS = 0;
    MAX_TYPING_TIME_MS = 0;
    CACHE_TTL_SECONDS = 0;
    HISTORY_LIMIT_PER_USER = 0;
    MESSAGE_DEDUP_TIME_MS = 0;
    LOG_LEVEL = "";
    LOG_API_REQUESTS = false;
    LOG_DETAILED_MESSAGES = false;
    DONO_USERS = [];
    FEATURE_STT_ENABLED = false;
    FEATURE_TTS_ENABLED = false;
    FEATURE_YT_DOWNLOAD = false;
    FEATURE_STICKERS = false;
    FEATURE_MODERATION = false;
    FEATURE_LEVELING = false;
    FEATURE_VISION = false;
    YT_COOKIES_PATH = "";
    YT_PO_TOKEN = "";
    constructor() {
        if (ConfigManager.instance) {
            return ConfigManager.instance;
        }
        // ═══ PORTAS E URLS ═══
        this.PORT = Number(process.env?.PORT || process.env?.HF_PORT || 3000);
        this.API_URL = process.env?.API_URL || process.env?.HF_API_URL || 'https://akra35567-akira-softedge.hf.space/api';
        this.API_TIMEOUT = Number(process.env?.API_TIMEOUT || 120000);
        this.API_RETRY_ATTEMPTS = Number(process.env?.API_RETRY_ATTEMPTS || 3);
        this.API_RETRY_DELAY = Number(process.env?.API_RETRY_DELAY || 1000);
        this.BASE_URL = process.env?.BASE_URL || 'https://index-js21-production.up.railway.app'; // URL de Produção
        // ═══ BOT IDENTITY ═══
        this.BOT_NUMERO_REAL = process.env?.BOT_NUMERO || '37839265886398';
        this.BOT_NAME = process.env?.BOT_NAME || 'Akira';
        this.BOT_VERSION = 'v21.1.02.2025';
        this.PREFIXO = process.env?.PREFIXO || '#';
        // ═══ PATHS E FOLDERS ═══
        const isHuggingFaceSpace = process.env?.HF_SPACE === 'true';
        const isRailway = process.env?.RAILWAY_ENVIRONMENT === 'true' || !!process.env?.RAILWAY_STATIC_URL;
        const baseDataPath = (isHuggingFaceSpace || isRailway) ? '/tmp/akira_data' : '.';
        this.TEMP_FOLDER = process.env?.TEMP_FOLDER || path.join(baseDataPath, 'temp');
        this.AUTH_FOLDER = process.env?.AUTH_FOLDER || path.join(baseDataPath, 'auth_info_baileys');
        this.DATABASE_FOLDER = process.env?.DATABASE_FOLDER || path.join(baseDataPath, 'database');
        this.LOGS_FOLDER = process.env?.LOGS_FOLDER || path.join(baseDataPath, 'logs');
        // ═══ STT (SPEECH-TO-TEXT) ═══
        // ⚠️  Nunca coloque chaves de API directamente aqui.
        //     Configure DEEPGRAM_API_KEY no ficheiro .env (local) ou nas variáveis do Railway.
        this.DEEPGRAM_API_KEY = process.env?.DEEPGRAM_API_KEY || undefined;
        this.DEEPGRAM_API_URL = 'https://api.deepgram.com/v1/listen';
        this.DEEPGRAM_MODEL = process.env?.DEEPGRAM_MODEL || 'nova-3';
        this.STT_LANGUAGE = process.env?.STT_LANGUAGE || 'pt';
        // ═══ TTS (TEXT-TO-SPEECH) ═══
        this.TTS_LANGUAGE = process.env?.TTS_LANGUAGE || 'pt';
        this.TTS_SLOW = process.env?.TTS_SLOW === 'true';
        // ═══ RATE LIMITING ═══
        this.RATE_LIMIT_WINDOW = Number(process.env?.RATE_LIMIT_WINDOW || 8);
        this.RATE_LIMIT_MAX_CALLS = Number(process.env?.RATE_LIMIT_MAX_CALLS || 6);
        // ═══ MODERAÇÃO ═══
        this.MUTE_DEFAULT_MINUTES = Number(process.env?.MUTE_DEFAULT_MINUTES || 5);
        this.MUTE_MAX_DAILY = Number(process.env?.MUTE_MAX_DAILY || 5);
        this.AUTO_BAN_AFTER_MINUTES = Number(process.env?.AUTO_BAN_AFTER_MINUTES || process.env?.AUTO_BAN_AFTER_MUTES || 3);
        // ═══ YOUTUBE DOWNLOAD ═══
        this.YT_MAX_SIZE_MB = Number(process.env?.YT_MAX_SIZE_MB || 2048); // Aumentado para 2GB
        this.YT_TIMEOUT_MS = Number(process.env?.YT_TIMEOUT_MS || 3600000); // Aumentado para 1 hora (era 15 min)
        this.YT_QUALITY = process.env?.YT_QUALITY || 'highestaudio';
        this.YT_MAX_DURATION_SECONDS = Number(process.env?.YT_MAX_DURATION_SECONDS || 21600); // Aumentado para 6 horas
        this.YT_COOKIES_PATH = process.env?.YT_COOKIES_PATH || "";
        this.YT_PO_TOKEN = process.env?.YT_PO_TOKEN || "";
        // 🔓 Decode de cookies via Base64 (Railway Variable)
        if (process.env?.YT_COOKIES_BASE64 && !this.YT_COOKIES_PATH) {
            try {
                const cookiesDir = path.join(baseDataPath, 'cookies');
                if (!fs.existsSync(cookiesDir))
                    fs.mkdirSync(cookiesDir, { recursive: true });
                const cookiesFile = path.join(cookiesDir, 'youtube_cookies.txt');
                const decoded = Buffer.from(process.env.YT_COOKIES_BASE64, 'base64').toString('utf-8');
                // Non-blocking write; set path immediately for downstream code
                fs.promises.writeFile(cookiesFile, decoded).then(() => {
                    console.log(`✅ ConfigManager: Cookies descodificados de YT_COOKIES_BASE64 para ${cookiesFile}`);
                }).catch((err) => {
                    console.error(`❌ ConfigManager: Falha ao escrever cookies: ${err.message}`);
                });
                this.YT_COOKIES_PATH = cookiesFile;
            }
            catch (err) {
                console.error(`❌ ConfigManager: Erro ao descodificar YT_COOKIES_BASE64: ${err.message}`);
            }
        }
        // 🔎 Auto-detecção de cookies se ainda não configurado
        if (!this.YT_COOKIES_PATH) {
            const possiblePaths = [
                path.join(process.cwd(), 'cookies.txt'),
                path.join(process.cwd(), 'youtube_cookies.txt'),
                '/app/cookies.txt',
                '/app/youtube_cookies.txt',
                path.join(baseDataPath, 'cookies', 'youtube_cookies.txt')
            ];
            for (const p of possiblePaths) {
                if (fs.existsSync(p)) {
                    this.YT_COOKIES_PATH = p;
                    console.log(`🍪 ConfigManager: Cookies detectados automaticamente em: ${p}`);
                    break;
                }
            }
        }
        // ═══ MÍDIA ═══
        this.STICKER_SIZE = Number(process.env?.STICKER_SIZE || 512);
        this.STICKER_MAX_ANIMATED_SECONDS = Number(process.env?.STICKER_MAX_ANIMATED_SECONDS || 30);
        this.IMAGE_QUALITY = Number(process.env?.IMAGE_QUALITY || 85);
        this.MAX_AUDIO_SIZE_MB = Number(process.env?.MAX_AUDIO_SIZE_MB || 500); // Aumentado para 100MB
        // ═══ CONVERSAÇÃO ═══
        this.MAX_RESPONSE_CHARS = Number(process.env?.MAX_RESPONSE_CHARS || 280);
        this.TYPING_SPEED_MS = Number(process.env?.TYPING_SPEED_MS || 50);
        this.MIN_TYPING_TIME_MS = Number(process.env?.MIN_TYPING_TIME_MS || 1500);
        this.MAX_TYPING_TIME_MS = Number(process.env?.MAX_TYPING_TIME_MS || 30000); // Aumentado para 30s
        // ═══ CACHE E PERFORMANCE ═══
        this.CACHE_TTL_SECONDS = Number(process.env?.CACHE_TTL_SECONDS || 3600);
        this.HISTORY_LIMIT_PER_USER = Number(process.env?.HISTORY_LIMIT_PER_USER || 50);
        this.MESSAGE_DEDUP_TIME_MS = Number(process.env?.MESSAGE_DEDUP_TIME_MS || 30000);
        // ═══ LOGGING ═══
        this.LOG_LEVEL = process.env?.LOG_LEVEL || 'info';
        this.LOG_API_REQUESTS = process.env?.LOG_API_REQUESTS !== 'false';
        this.LOG_DETAILED_MESSAGES = process.env?.LOG_DETAILED_MESSAGES !== 'false';
        // ═══ PERMISSÕES - DONO(S) ═══
        this.DONO_USERS = [
            { numero: '37839265886398', nomeExato: 'Bot Admin' }, // PRIMARY: Multi-device LID number (fixes replies/owner checks)
            { numero: '244952786417', nomeExato: 'Isaac Quarenta' }, // Current session JID
            { numero: '244937035662', nomeExato: 'Isaac Quarenta' },
            { numero: '244978787009', nomeExato: 'Isaac Quarenta' },
            { numero: '202391978787009', nomeExato: 'Isaac Quarenta' },
            { numero: '24491978787009', nomeExato: 'Isaac Quarenta' },
            { numero: '24478787009', nomeExato: 'Isaac Quarenta' }
        ];
        // ═══ FEATURES ═══
        this.FEATURE_STT_ENABLED = process.env?.FEATURE_STT !== 'false';
        this.FEATURE_TTS_ENABLED = process.env?.FEATURE_TTS !== 'false';
        this.FEATURE_YT_DOWNLOAD = process.env?.FEATURE_YT !== 'false';
        this.FEATURE_STICKERS = process.env?.FEATURE_STICKERS !== 'false';
        this.FEATURE_MODERATION = process.env?.FEATURE_MODERATION !== 'false';
        this.FEATURE_LEVELING = process.env?.FEATURE_LEVELING === 'true';
        this.FEATURE_VISION = process.env?.FEATURE_VISION !== 'false';
        ConfigManager.instance = this;
    }
    static getInstance() {
        if (!ConfigManager.instance) {
            new ConfigManager();
        }
        return ConfigManager.instance;
    }
    /**
    * Valida se um usuário é dono do bot
    */
    isDono(numero, nomeBot = '') {
        try {
            const numeroBase = String(numero).split(':')[0];
            const numeroLimpo = numeroBase.replace(/\D/g, '').trim();
            const porNumero = this.DONO_USERS?.some(dono => String(dono.numero).replace(/\D/g, '') === numeroLimpo);
            // Se não for por número, tenta pelo nome especial (Morema/Morena)
            if (!porNumero && typeof nomeBot === 'string') {
                const n = nomeBot.toLowerCase();
                if (n.includes('morema') || n.includes('morena'))
                    return true;
            }
            return porNumero;
        }
        catch (e) {
            return false;
        }
    }
    /**
    * Retorna configuração por chave com fallback
    */
    get(key, defaultValue = null) {
        return this[key] !== undefined ? this[key] : defaultValue;
    }
    /**
    * Define configuração dinamicamente
    */
    set(key, value) {
        this[key] = value;
    }
    /**
    * Retorna todas as configurações (CUIDADO: dados sensíveis)
    */
    getAll(includeSensitive = false) {
        const config = { ...this };
        if (!includeSensitive) {
            delete config.DEEPGRAM_API_KEY;
            delete config.API_URL;
        }
        return config;
    }
    /**
    * Valida configurações críticas na inicialização
    */
    validate() {
        const errors = [];
        if (!this.API_URL)
            errors.push('API_URL não configurada');
        if (!this.BOT_NUMERO_REAL)
            errors.push('BOT_NUMERO não configurada');
        if (this.FEATURE_STT_ENABLED && !this.DEEPGRAM_API_KEY) {
            console.warn('⚠️ STT habilitado mas DEEPGRAM_API_KEY não configurada');
        }
        if (errors.length > 0) {
            console.error('❌ ERROS DE CONFIGURAÇÃO:');
            errors.forEach(e => console.error(` - ${e}`));
            return false;
        }
        console.log('✅ Configurações validadas com sucesso');
        return true;
    }
    /**
    * Log com contexto
    */
    logConfig() {
        console.log('\n' + '═'.repeat(70));
        console.log('⚙️ CONFIGURAÇÕES DO BOT');
        console.log('═'.repeat(70));
        console.log(` 🤖 Nome: ${this.BOT_NAME}`);
        console.log(` 📱 Número: ${this.BOT_NUMERO_REAL} (Multi-device Primary)`);
        console.log(` 📌 Versão: ${this.BOT_VERSION}`);
        console.log(` 🎛️ Prefixo: ${this.PREFIXO}`);
        console.log(` 🔌 API: ${this.API_URL?.substring(0, 50)}...`);
        console.log(` 🎤 STT: ${this.FEATURE_STT_ENABLED ? 'Ativado (Deepgram)' : 'Desativado'}`);
        console.log(` 🔊 TTS: ${this.FEATURE_TTS_ENABLED ? 'Ativado (Google)' : 'Desativado'}`);
        console.log(` 📥 YT Download: ${this.FEATURE_YT_DOWNLOAD ? 'Ativado' : 'Desativado'}`);
        console.log(` 🎨 Stickers: ${this.FEATURE_STICKERS ? 'Ativado' : 'Desativado'}`);
        console.log(` 🛡️ Moderação: ${this.FEATURE_MODERATION ? 'Ativado' : 'Desativado'}`);
        console.log(` 👤 Donos: ${this.DONO_USERS?.length} configurado(s)`);
        console.log('═'.repeat(70) + '\n');
    }
}
export default ConfigManager;
