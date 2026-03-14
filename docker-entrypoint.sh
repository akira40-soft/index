#!/bin/sh
# ═══════════════════════════════════════════════════════
# AKIRA BOT — Docker Entrypoint
# ═══════════════════════════════════════════════════════
# Descodifica cookies do YouTube se fornecidos em Base64
# (útil no Railway onde não existe volume persistente)
# ═══════════════════════════════════════════════════════

set -e

# Se YT_COOKIES_BASE64 estiver definido, descodifica e guarda em ficheiro
if [ -n "$YT_COOKIES_BASE64" ]; then
    COOKIES_DIR="/tmp/akira_data/cookies"
    mkdir -p "$COOKIES_DIR"
    COOKIES_FILE="$COOKIES_DIR/youtube_cookies.txt"
    echo "$YT_COOKIES_BASE64" | base64 -d > "$COOKIES_FILE"
    export YT_COOKIES_PATH="$COOKIES_FILE"
    echo "✅ Cookies do YouTube descodificados para: $COOKIES_FILE"
fi

# Se houver cookies em /app/cookies.txt, exporta como YT_COOKIES_PATH
if [ -f /app/cookies.txt ]; then
    export YT_COOKIES_PATH="/app/cookies.txt"
    echo "✅ Cookies do YouTube encontrados em: /app/cookies.txt"
fi

# Se COOKIES_PATH estiver definido, exporta como YT_COOKIES_PATH
if [ -n "$COOKIES_PATH" ] && [ -f "$COOKIES_PATH" ]; then
    export YT_COOKIES_PATH="$COOKIES_PATH"
    echo "✅ Usando cookies de: $COOKIES_PATH"
fi

# Cria directorias de dados necessárias
mkdir -p /tmp/akira_data/temp
mkdir -p /tmp/akira_data/auth_info_baileys
mkdir -p /tmp/akira_data/database
mkdir -p /tmp/akira_data/logs
mkdir -p /tmp/akira_data/subscriptions

# ═══════════════════════════════════════════════════════
# FIXAR SYMLINKS DAS FERRAMENTAS (Runtime Fallback)
# ═══════════════════════════════════════════════════════
echo "🔧 Corrigindo symlinks de ferramentas..."

# Ferramentas pip mais agressivas
for tool in theHarvester theharvester sherlock holehe impacket-psexec impacket-secretsdump; do
    if ! command -v "$tool" >/dev/null 2>&1; then
        # Procurar em múltiplos locais com find
        FOUND=$(find / -name "$tool" -type f 2>/dev/null | grep -v "\.git" | head -1)
        if [ -n "$FOUND" ] && [ -x "$FOUND" ]; then
            mkdir -p /usr/local/bin
            ln -sf "$FOUND" "/usr/local/bin/$tool" 2>/dev/null || true
            echo "✅ $tool: linked from $FOUND"
        fi
    fi
done

# Verificar searchsploit especificamente
if [ -f /opt/exploitdb/searchsploit ] && ! command -v searchsploit >/dev/null 2>&1; then
    chmod +x /opt/exploitdb/searchsploit
    ln -sf /opt/exploitdb/searchsploit /usr/local/bin/searchsploit 2>/dev/null || true
    echo "✅ searchsploit: linked"
fi

# Verificar blackeye especificamente
if [ -f /opt/blackeye/blackeye.sh ] && ! command -v blackeye >/dev/null 2>&1; then
    chmod +x /opt/blackeye/blackeye.sh
    ln -sf /opt/blackeye/blackeye.sh /usr/local/bin/blackeye 2>/dev/null || true
    echo "✅ blackeye: linked"
fi

echo "✅ Symlinks corrigidos com sucesso"
# Verificar e reparar ferramentas Python que podem não ter sido linkadas corretamente
echo "🔧 Reparando ferramentas Python..."
for tool in theHarvester theharvester sherlock holehe impacket-psexec impacket_psexec; do
    if ! command -v "$tool" >/dev/null 2>&1; then
        # Procurar em site-packages
        FOUND=$(find /usr -name "$tool" -o -name "${tool}.py" 2>/dev/null | grep -v ".git" | grep -v "__pycache__" | head -1)
        if [ -n "$FOUND" ] && [ -x "$FOUND" ]; then
            ln -sf "$FOUND" "/usr/local/bin/$tool" 2>/dev/null || true
            echo "✅ $tool: linked from $FOUND"
        fi
    fi
done

# Reparar searchsploit especificamente
if ! command -v searchsploit >/dev/null 2>&1; then
    if [ -f /opt/exploitdb/searchsploit ] && [ -x /opt/exploitdb/searchsploit ]; then
        ln -sf /opt/exploitdb/searchsploit /usr/local/bin/searchsploit 2>/dev/null || true
        echo "✅ searchsploit: linked"
    else
        # Tentar pip como fallback
        pip3 install exploitdb --break-system-packages 2>/dev/null || true
    fi
fi
# Verificar yt-dlp e atualizar se necessário
echo "🔍 Verificando yt-dlp..."
if command -v yt-dlp >/dev/null 2>&1; then
    YT_DLP_VERSION=$(yt-dlp --version 2>/dev/null || echo "unknown")
    echo "✅ yt-dlp encontrado: $YT_DLP_VERSION"
    # Atualizar se disponível (rápido com pip)
    pip install -U yt-dlp 2>/dev/null || true
else
    echo "⚠️  yt-dlp não encontrado, tentando instalar..."
    pip install yt-dlp 2>/dev/null || curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && chmod +x /usr/local/bin/yt-dlp || true
fi

# Arranca a aplicação com os argumentos passados ao CMD
exec "$@"
