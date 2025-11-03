# Usa Node 20 (requisito do Baileys)
FROM node:20-alpine

# Instala ferramentas básicas (git, python3, make, g++, etc)
RUN apk add --no-cache git python3 make g++

# Atualiza o npm (corrige bugs do Alpine)
RUN npm install -g npm@latest

# Cria usuário não-root (boa prática)
RUN addgroup -S app && adduser -S app -G app

# Define diretório de trabalho
WORKDIR /app

# Copia dependências primeiro (cache eficiente)
COPY package*.json ./

# Instala dependências (sem dev)
RUN npm install --omit=dev

# Copia o restante do código
COPY . .

# Ajusta permissões e muda para usuário não-root
RUN chown -R app:app /app
USER app

# Porta usada pelo Express
EXPOSE 3000

# Comando padrão
CMD ["npm", "start"]
