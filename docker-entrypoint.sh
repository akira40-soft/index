#!/bin/sh
# ═══════════════════════════════════════════════════════
# AKIRA BOT — Docker Entrypoint (sh compatível Alpine)
# ═══════════════════════════════════════════════════════

set -e

# Usa DATA_DIR se definido, senão padrão /app/data
BASE_PATH=${DATA_DIR:-"/app/data"}
echo "📁 Configurando persistência em: $BASE_PATH"

mkdir -p "$BASE_PATH/auth_info_baileys" "$BASE_PATH/database" "$BASE_PATH/logs" "$BASE_PATH/temp"
chmod -R 755 "$BASE_PATH"

# ─── Limpar sessões Signal corrompidas (Bad MAC Error) ───────────────────────
# Os arquivos session-*.json armazenam o estado do protocolo Signal por contato.
# Quando ficam dessincronizados com o servidor do WhatsApp, causam "Bad MAC Error"
# e o bot não consegue mais descriptografar mensagens.
# Removê-los é seguro: o Baileys negocia novas sessões automaticamente na próxima
# mensagem. As credenciais (creds.json), pré-chaves e chaves de grupo são preservadas.
AUTH_DIR="$BASE_PATH/auth_info_baileys"
if [ -d "$AUTH_DIR" ]; then
    SESSION_COUNT=$(find "$AUTH_DIR" -maxdepth 1 -name "session-*.json" 2>/dev/null | wc -l)
    if [ "$SESSION_COUNT" -gt 0 ]; then
        echo "🧹 [SESSION REPAIR] Removendo $SESSION_COUNT arquivo(s) de sessão Signal corrompidos em $AUTH_DIR..."
        find "$AUTH_DIR" -maxdepth 1 -name "session-*.json" -delete
        echo "✅ [SESSION REPAIR] Sessões limpas. O bot negociará novas sessões automaticamente."
    else
        echo "✅ [SESSION REPAIR] Nenhuma sessão Signal encontrada para limpar."
    fi
fi
# ─────────────────────────────────────────────────────────────────────────────

# ─── Gerar cookies.txt a partir de Base64 (Railway Variable) ───
if [ -n "$YT_COOKIES_BASE64" ] && [ ! -f "/app/cookies.txt" ]; then
    echo "🍪 Gerando /app/cookies.txt a partir de YT_COOKIES_BASE64..."
    echo "$YT_COOKIES_BASE64" | base64 -d > /app/cookies.txt
    echo "✅ cookies.txt criado em /app/cookies.txt"
elif [ -f "/app/cookies.txt" ]; then
    echo "🍪 cookies.txt encontrado em /app/cookies.txt"
else
    echo "⚠️  Sem cookies.txt — downloads do YouTube podem ser limitados"
fi

echo "🚀 Iniciando Akira Bot..."
exec npm start
