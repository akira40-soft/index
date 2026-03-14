<<<<<<< HEAD
# 🚀 Configuração do Akira Bot no Railway

## ⚙️ Variáveis de Ambiente Necessárias

Para que o bot funcione completamente no Railway, configure estas variáveis:

### 1. **YouTube Cookies (Para yt-dlp)**

**Onde configurar:**
1. Acesse https://index-js21-production.up.railway.app/settings (substituir pela sua URL)
2. Ou vá a: Railway Dashboard → index-js2.1 → Variables

**Variáveis:**
```
COOKIES_PATH=/app/cookies.txt
YT_COOKIES_PATH=/app/cookies.txt
```

**Arquivo cookies.txt:**
- Coloque seu arquivo `cookies.txt` na raiz do repositório GitHub
- Será copiado automaticamente para o container

---

### 2. **PO_TOKEN (YouTube Bypass)**

Para ativar o bypass do YouTube Premium:

```
YT_PO_TOKEN=seu_po_token_aqui
```

**Como obter PO_TOKEN:**
1. Faça login no YouTube com sua conta
2. Abra o DevTools (F12) → Network
3. Procure por requests para `youtubei.googleapis.com`
4. Procure pelo header `X-Goog-Visitor-Id` ou cookie `VISITOR_ID_POLICY`
5. Use esse valor como `PO_TOKEN`

Alternativa: Use ferramentas como `yt-dlp --dump-user-agent` ou `pogtoken` para extrair

---

### 3. **Outras Variáveis Importantes**

```bash
# WhatsApp
WHATSAPP_BOT_JID=seu_numero@s.whatsapp.net
WHATSAPP_API_KEY=sua_chave_api

# YouTube
YT_COOKIES_BASE64=cookies_em_base64_opcional
YT_API_KEY=sua_api_key_opcional

# Deepgram (STT - Speech to Text)
DEEPGRAM_API_KEY=sua_chave_deepgram

# Database
DATABASE_URL=sua_url_postgres
MONGODB_URI=sua_uri_mongodb

# Logging
LOG_LEVEL=info
PINO_NO_PRETTY=true
```

---

## 🔐 Como Configurar no Railway

### **Opção 1: Via Dashboard Web**

1. Acesse [Railway Dashboard](https://railway.app)
2. Selecione o projeto **index-js2.1**
3. Clique em **Variables** (menu esquerdo)
4. Clique **+ New Variable**
5. Digite a chave (ex: `YT_PO_TOKEN`)
6. Cole o valor
7. Clique **Save**

### **Opção 2: Via CLI Railway**

```bash
# Instale a CLI
npm install -g @railway/cli

# Login
railway login

# Configure a variável
railway variables:set YT_PO_TOKEN "seu_token_aqui"

# Verifique
railway variables:get YT_PO_TOKEN
```

### **Opção 3: Atualizar railway.json**

Edite o arquivo `railway.json`:

```json
{
  "environments": {
    "production": {
      "variables": {
        "NODE_ENV": "production",
        "YT_PO_TOKEN": "seu_po_token_aqui",
        "YT_COOKIES_PATH": "/app/cookies.txt",
        "DEEPGRAM_API_KEY": "sua_chave_aqui"
      }
    }
  }
}
```

---

## 📋 Checklist de Configuração

- [ ] `YT_PO_TOKEN` configurado
- [ ] `COOKIES_PATH` / `YT_COOKIES_PATH` configurado
- [ ] `cookies.txt` adicionado ao repositório
- [ ] `DEEPGRAM_API_KEY` (opcional, para STT)
- [ ] `DATABASE_URL` (se usar database externo)
- [ ] Deploy realizado após configurar variáveis

---

## ✅ Verificar Configuração

Verifique se as variáveis estão carregadas:

1. Acesse: `http://index-js21-production.up.railway.app/health`
2. Você verá um JSON com status

Ou envie comando no bot:
```
#status
ou
#info
```

---

## 🎯 Ativar YouTube Bypass

Após configurar `YT_PO_TOKEN`:

1. Envie comando: `#ytmp4 https://youtube.com/seu_video`
2. Se funcionar, o bypass está ativo ✅
3. Se não funcionar, tente atualizar o `PO_TOKEN`

---

## 🐛 Troubleshooting

### ❌ "Cookies não configurados"

**Solução:**
1. Verifique se `COOKIES_PATH` está definida
2. Confirme se `cookies.txt` existe na raiz
3. Redeploy: `git push` (vai fazer rebuild)

### ❌ "PO_TOKEN inválido"

**Solução:**
1. Extraia um novo `PO_TOKEN` (procedimento acima)
2. Atualize a variável no Railway
3. Force um redeploy manual no Dashboard

### ❌ "YouTube bloqueado/restringido"

**Tente:**
```
1. Usar proxy (adicionar ao railway.json)
2. Trocar user-agent
3. Aguardar 24h para limpar rate limiting
```

---

## 📞 Suporte

Se continuar com problemas:

1. Verifique os logs: Railway Dashboard → Logs
2. Verifique se o bot conectou ao WhatsApp (procure por "Bot pronto!")
3. Envie `#debug` para obter informações do sistema

---

_Akira Bot V21 — Desenvolvido por Isaac Quarenta_
=======
# 🚀 Configuração do Akira Bot no Railway

## ⚙️ Variáveis de Ambiente Necessárias

Para que o bot funcione completamente no Railway, configure estas variáveis:

### 1. **YouTube Cookies (Para yt-dlp)**

**Onde configurar:**
1. Acesse https://index-js21-production.up.railway.app/settings (substituir pela sua URL)
2. Ou vá a: Railway Dashboard → index-js2.1 → Variables

**Variáveis:**
```
COOKIES_PATH=/app/cookies.txt
YT_COOKIES_PATH=/app/cookies.txt
```

**Arquivo cookies.txt:**
- Coloque seu arquivo `cookies.txt` na raiz do repositório GitHub
- Será copiado automaticamente para o container

---

### 2. **PO_TOKEN (YouTube Bypass)**

Para ativar o bypass do YouTube Premium:

```
YT_PO_TOKEN=seu_po_token_aqui
```

**Como obter PO_TOKEN:**
1. Faça login no YouTube com sua conta
2. Abra o DevTools (F12) → Network
3. Procure por requests para `youtubei.googleapis.com`
4. Procure pelo header `X-Goog-Visitor-Id` ou cookie `VISITOR_ID_POLICY`
5. Use esse valor como `PO_TOKEN`

Alternativa: Use ferramentas como `yt-dlp --dump-user-agent` ou `pogtoken` para extrair

---

### 3. **Outras Variáveis Importantes**

```bash
# WhatsApp
WHATSAPP_BOT_JID=seu_numero@s.whatsapp.net
WHATSAPP_API_KEY=sua_chave_api

# YouTube
YT_COOKIES_BASE64=cookies_em_base64_opcional
YT_API_KEY=sua_api_key_opcional

# Deepgram (STT - Speech to Text)
DEEPGRAM_API_KEY=sua_chave_deepgram

# Database
DATABASE_URL=sua_url_postgres
MONGODB_URI=sua_uri_mongodb

# Logging
LOG_LEVEL=info
PINO_NO_PRETTY=true
```

---

## 🔐 Como Configurar no Railway

### **Opção 1: Via Dashboard Web**

1. Acesse [Railway Dashboard](https://railway.app)
2. Selecione o projeto **index-js2.1**
3. Clique em **Variables** (menu esquerdo)
4. Clique **+ New Variable**
5. Digite a chave (ex: `YT_PO_TOKEN`)
6. Cole o valor
7. Clique **Save**

### **Opção 2: Via CLI Railway**

```bash
# Instale a CLI
npm install -g @railway/cli

# Login
railway login

# Configure a variável
railway variables:set YT_PO_TOKEN "seu_token_aqui"

# Verifique
railway variables:get YT_PO_TOKEN
```

### **Opção 3: Atualizar railway.json**

Edite o arquivo `railway.json`:

```json
{
  "environments": {
    "production": {
      "variables": {
        "NODE_ENV": "production",
        "YT_PO_TOKEN": "seu_po_token_aqui",
        "YT_COOKIES_PATH": "/app/cookies.txt",
        "DEEPGRAM_API_KEY": "sua_chave_aqui"
      }
    }
  }
}
```

---

## 📋 Checklist de Configuração

- [ ] `YT_PO_TOKEN` configurado
- [ ] `COOKIES_PATH` / `YT_COOKIES_PATH` configurado
- [ ] `cookies.txt` adicionado ao repositório
- [ ] `DEEPGRAM_API_KEY` (opcional, para STT)
- [ ] `DATABASE_URL` (se usar database externo)
- [ ] Deploy realizado após configurar variáveis

---

## ✅ Verificar Configuração

Verifique se as variáveis estão carregadas:

1. Acesse: `http://index-js21-production.up.railway.app/health`
2. Você verá um JSON com status

Ou envie comando no bot:
```
#status
ou
#info
```

---

## 🎯 Ativar YouTube Bypass

Após configurar `YT_PO_TOKEN`:

1. Envie comando: `#ytmp4 https://youtube.com/seu_video`
2. Se funcionar, o bypass está ativo ✅
3. Se não funcionar, tente atualizar o `PO_TOKEN`

---

## 🐛 Troubleshooting

### ❌ "Cookies não configurados"

**Solução:**
1. Verifique se `COOKIES_PATH` está definida
2. Confirme se `cookies.txt` existe na raiz
3. Redeploy: `git push` (vai fazer rebuild)

### ❌ "PO_TOKEN inválido"

**Solução:**
1. Extraia um novo `PO_TOKEN` (procedimento acima)
2. Atualize a variável no Railway
3. Force um redeploy manual no Dashboard

### ❌ "YouTube bloqueado/restringido"

**Tente:**
```
1. Usar proxy (adicionar ao railway.json)
2. Trocar user-agent
3. Aguardar 24h para limpar rate limiting
```

---

## 📞 Suporte

Se continuar com problemas:

1. Verifique os logs: Railway Dashboard → Logs
2. Verifique se o bot conectou ao WhatsApp (procure por "Bot pronto!")
3. Envie `#debug` para obter informações do sistema

---

_Akira Bot V21 — Desenvolvido por Isaac Quarenta_
>>>>>>> bca33df3e80ad01e3a871bb67a7d0a8ff9a621a3
