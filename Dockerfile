# Dockerfile — use node 20
FROM node:20-alpine

# criar usuario não-root (opcional, mas bom para segurança)
RUN addgroup -S app && adduser -S app -G app

WORKDIR /app

# copia dependencias primeiro (cache)
COPY package*.json ./

# instala sem dev deps
RUN npm ci --omit=dev

# copia o restante do projeto
COPY . .

# ajusta permissões e troca usuário
RUN chown -R app:app /app
USER app

EXPOSE 3000

CMD ["npm", "start"]
