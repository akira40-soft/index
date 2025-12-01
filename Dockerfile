# Dockerfile — AKIRA BOT RAILWAY (Dezembro 2025)
FROM node:20-alpine

# Variáveis de ambiente
ENV NODE_ENV=production \
    PORT=3000

# Instala dependências do sistema
RUN apk add --no-cache \
    git \
    python3 \
    make \
    g++ \
    cairo-dev \
    pango-dev \
    jpeg-dev \
    giflib-dev

# Cria usuário não-root
RUN addgroup -S app && adduser -S app -G app

# Define diretório de trabalho
WORKDIR /app

# Copia package files
COPY package*.json ./

# Atualiza npm e instala dependências
RUN npm install -g npm@latest && \
    npm ci --omit=dev --prefer-offline --no-audit

# Copia código da aplicação
COPY index.js ./

# Ajusta permissões
RUN chown -R app:app /app && \
    mkdir -p /app/auth_info_baileys && \
    chown -R app:app /app/auth_info_baileys

# Muda para usuário não-root
USER app

# Expõe porta
EXPOSE 3000

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Comando de inicialização
CMD ["node", "index.js"]
