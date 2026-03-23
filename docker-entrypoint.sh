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

echo "🚀 Iniciando Akira Bot..."
exec npm start
