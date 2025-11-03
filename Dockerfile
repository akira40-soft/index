# Usa Node 20 (necessário para Baileys)
FROM node:20-alpine

# Define diretório de trabalho
WORKDIR /app

# Copia apenas arquivos de dependências para melhor cache
COPY package*.json ./

# Instala dependências (omitindo dev)
RUN npm install --omit=dev

# Copia o restante do projeto
COPY . .

# Expõe a porta do Express (usada no health check)
EXPOSE 3000

# Comando padrão
CMD ["npm", "start"]
