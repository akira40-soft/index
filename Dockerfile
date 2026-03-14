# Dockerfile — AKIRA BOT RAILWAY (Otimizado Janeiro 2026)
# ✅ Configurado especificamente para Railway
# ✅ Pino logging compatível com Railway
# ✅ Sem pino-pretty transport para evitar erros
# ✅ Configurações otimizadas para Railway

FROM node:20-alpine

# ═══════════════════════════════════════════════════════════════════
# VARIÁVEIS DE AMBIENTE PARA RAILWAY
# ═══════════════════════════════════════════════════════════════════
ENV NODE_ENV=production \
    RAILWAY_ENVIRONMENT=true \
    # Pino sem transport para evitar erros no Railway
    PINO_NO_PRETTY=true \
    # Configurações de rede
    NODE_OPTIONS="--dns-result-order=ipv4first --no-warnings" \
    UV_THREADPOOL_SIZE=128 \
    LANG=C.UTF-8

# ═══════════════════════════════════════════════════════════════════
# INSTALAR DEPENDÊNCIAS DO SISTEMA ESSENCIAIS PARA RAILWAY
# ═══════════════════════════════════════════════════════════════════

RUN apk add --no-cache \
    git \
    curl \
    wget \
    python3 \
    py3-pip \
    make \
    g++ \
    cairo-dev \
    pango-dev \
    jpeg-dev \
    giflib-dev \
    ffmpeg \
    yt-dlp \
    ca-certificates \
    openssl \
    openssl-dev \
    zlib-dev \
    bash \
    # Cybersecurity tools
    nmap \
    hydra \
    nikto \
    unzip \
    perl

# ═══════════════════════════════════════════════════════════════════
# CONFIGURAÇÃO DE DIRETÓRIOS PARA RAILWAY
# ═══════════════════════════════════════════════════════════════════

RUN mkdir -p /app/data && \
    mkdir -p /app/data/auth_info_baileys && \
    mkdir -p /app/data/database && \
    mkdir -p /app/data/logs && \
    mkdir -p /app/data/temp && \
    chmod -R 755 /app/data

# ═══════════════════════════════════════════════════════════════════
# DIRETÓRIO DE TRABALHO
# ═══════════════════════════════════════════════════════════════════

WORKDIR /app

# ═══════════════════════════════════════════════════════════════════
# INSTALAÇÃO DE DEPENDÊNCIAS NODE.JS PARA RAILWAY
# ═══════════════════════════════════════════════════════════════════

COPY package*.json ./

# Instalação otimizada para Railway
RUN npm config set fetch-retry-mintimeout 20000 && \
    npm config set fetch-retry-maxtimeout 120000 && \
    npm install --omit=dev --no-audit --progress=false --fetch-retries=5 --legacy-peer-deps

# ═══════════════════════════════════════════════════════════════════
# COPIAR CÓDIGO DA APLICAÇÃO
# ═══════════════════════════════════════════════════════════════════

COPY . .

# ═══════════════════════════════════════════════════════════════════
# VERIFICAÇÃO FINAL PARA RAILWAY
# ═══════════════════════════════════════════════════════════════════

RUN echo "🔍 Verificando instalação para Railway..." && \
    node -v && \
    npm -v && \
    python3 --version && \
    ffmpeg -version | head -1 && \
    echo "✅ Build verificado com sucesso" && \
    echo "✅ Dockerfile construído com sucesso para Railway"

# Limpar cache para reduzir tamanho da imagem
RUN npm cache clean --force 2>/dev/null || true

# ═══════════════════════════════════════════════════════════════════
# EXPOR PORTA PARA RAILWAY
# ═══════════════════════════════════════════════════════════════════
# Railway usa $PORT automaticamente
EXPOSE $PORT

# ═══════════════════════════════════════════════════════════════════
# HEALTHCHECK PARA RAILWAY
# ═══════════════════════════════════════════════════════════════════

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:$PORT/health 2>/dev/null || exit 1

# ═══════════════════════════════════════════════════════════════════
# COMANDO DE INICIALIZAÇÃO PARA RAILWAY
# ═══════════════════════════════════════════════════════════════════

CMD ["node", "index.js"]
