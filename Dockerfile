# Usa Node 20
FROM node:20-alpine

# Instala dependências básicas de build (evita erros de npm install)
RUN apk add --no-cache python3 make g++

# Cria usuário não-root
RUN addgroup -S app && adduser -S app -G app

WORKDIR /app

# Copia dependências primeiro
COPY package*.json ./

# Atualiza npm (corrige bugs de versões antigas do Alpine)
RUN npm install -g npm@latest

# Instala dependências (sem dev)
RUN npm install --omit=dev

# Copia o resto do projeto
COPY . .

# Ajusta permissões
RUN chown -R app:app /app
USER app

# Porta do health check
EXPOSE 3000

CMD ["npm", "start"]
