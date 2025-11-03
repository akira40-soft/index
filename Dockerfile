# Usa Node 20
FROM node:20-alpine

# Evita travamentos em dependências nativas do npm
RUN apk add --no-cache python3 make g++

# Atualiza o npm para evitar bugs de versão
RUN npm install -g npm@latest

# Cria um usuário de execução seguro
RUN addgroup -S app && adduser -S app -G app

# Define o diretório de trabalho
WORKDIR /app

# Copia os arquivos de dependências
COPY package*.json ./

# Instala dependências (sem dev)
RUN npm install --omit=dev

# Copia o restante do código
COPY . .

# Ajusta permissões
RUN chown -R app:app /app
USER app

# Porta usada pelo Express (para o health check)
EXPOSE 3000

# Comando de inicialização
CMD ["npm", "start"]
