# Usa Node 20 (necessário para Baileys)
FROM node:20-alpine

# Cria usuário não-root (opcional)
RUN addgroup -S app && adduser -S app -G app

WORKDIR /app

# Copia dependências primeiro (cache eficiente)
COPY package*.json ./

# Instala dependências (sem dev)
RUN npm install --omit=dev

# Copia o restante do projeto
COPY . .

# Ajusta permissões
RUN chown -R app:app /app
USER app

# Porta do health check
EXPOSE 3000

CMD ["npm", "start"]
