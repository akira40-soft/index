#!/bin/bash
# ═══════════════════════════════════════════════════════
# AKIRA BOT — Docker Entrypoint MÍNIMO
# ═══════════════════════════════════════════════════════

set -e

echo "🍪 ConfigManager: Cookies detectados automaticamente em: $YT_COOKIES_PATH" 2>/dev/null || true

# Usa DATA_DIR se definido, senão padrão /app/data
BASE_PATH=${DATA_DIR:-"/app/data"}
echo "📁 Configurando persistência em: $BASE_PATH"

mkdir -p "$BASE_PATH/auth_info_baileys" "$BASE_PATH/database" "$BASE_PATH/logs" "$BASE_PATH/temp"
chmod -R 755 "$BASE_PATH"

if [ $# -eq 0 ]; then
  echo "🚀 Iniciando Akira Bot..."
  exec npm start
else
  exec "$@"
fi


