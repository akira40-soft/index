#!/bin/bash

#═══════════════════════════════════════════════════════════════════════════
# VERIFY-TOOLS.SH - VERIFICAÇÃO DE FERRAMENTAS INSTALADAS
#═══════════════════════════════════════════════════════════════════════════
# ✅ Verifica se todas as ferramentas de pentesting foram instaladas
# ✅ Testa se são executáveis
# ✅ Gera relatório JSON
#═══════════════════════════════════════════════════════════════════════════

set -e

# Cores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}✅ VERIFICAÇÃO DE FERRAMENTAS DE PENTESTING${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}\n"

# Variáveis de rastreamento
TOTAL=0
OK=0
FALHAS=0
WARNINGS=0

# Diretório de saída
REPORT_DIR="/tmp/pentest_results"
mkdir -p "$REPORT_DIR"

# ═══════════════════════════════════════════════════════════════════════════
# FUNÇÕES AUXILIARES
# ═══════════════════════════════════════════════════════════════════════════

test_tool() {
    local tool_name=$1
    local test_cmd=$2
    local description=$3
    
    ((TOTAL++))
    echo -n "   [$((TOTAL))/7] Verificando $tool_name... "
    
    if eval "$test_cmd" > /dev/null 2>&1; then
        echo -e "${GREEN}✅ OK${NC}"
        ((OK++))
        return 0
    else
        echo -e "${RED}❌ FALHA${NC}"
        ((FALHAS++))
        return 1
    fi
}

get_version() {
    local tool=$1
    
    case $tool in
        yt-dlp)
            yt-dlp --version 2>/dev/null || echo "unknown"
            ;;
        nmap)
            nmap --version 2>/dev/null | head -1 || echo "unknown"
            ;;
        sqlmap)
            python3 /opt/sqlmap/sqlmap.py --version 2>/dev/null | head -1 || echo "unknown"
            ;;
        hydra)
            hydra -h 2>/dev/null | head -1 || echo "unknown"
            ;;
        nuclei)
            nuclei -version 2>/dev/null || echo "unknown"
            ;;
        masscan)
            masscan --version 2>/dev/null || echo "unknown"
            ;;
        nikto)
            nikto -version 2>/dev/null || echo "unknown"
            ;;
        *)
            echo "unknown"
            ;;
    esac
}

# ═══════════════════════════════════════════════════════════════════════════
# TESTES DE FERRAMENTAS
# ═══════════════════════════════════════════════════════════════════════════

echo -e "${YELLOW}📋 Testando ferramentas instaladas:${NC}\n"

# 1. YT-DLP
test_tool "yt-dlp" "command -v yt-dlp" "Downloader de YouTube"
YT_DLP_STATUS=$?

# 2. NMAP
test_tool "nmap" "command -v nmap && nmap -h > /dev/null" "Port scanner REAL"
NMAP_STATUS=$?

# 3. SQLMAP
test_tool "sqlmap" "test -f /opt/sqlmap/sqlmap.py && python3 /opt/sqlmap/sqlmap.py --version" "SQL injection tester REAL"
SQLMAP_STATUS=$?

# 4. HYDRA
test_tool "hydra" "command -v hydra" "Password cracker REAL"
HYDRA_STATUS=$?

# 5. NUCLEI
test_tool "nuclei" "command -v nuclei" "Vulnerability scanner (ProjectDiscovery)"
NUCLEI_STATUS=$?

# 6. MASSCAN
test_tool "masscan" "command -v masscan" "Fast port scanner"
MASSCAN_STATUS=$?

# 7. NIKTO
test_tool "nikto" "command -v nikto" "Web server scanner"
NIKTO_STATUS=$?

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}📊 VERIFICAÇÃO DE DEPENDÊNCIAS${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}\n"

# Verificar dependências do sistema
DEPS_OK=0
DEPS_TOTAL=0

check_dependency() {
    local dep=$1
    local description=$2
    
    ((DEPS_TOTAL++))
    echo -n "   [$DEPS_TOTAL] $description... "
    
    if command -v "$dep" &> /dev/null || dpkg -l | grep -q "^ii.*$dep" 2>/dev/null || rpm -q "$dep" 2>/dev/null; then
        echo -e "${GREEN}✅${NC}"
        ((DEPS_OK++))
    else
        echo -e "${YELLOW}⚠️  (pode ser necessário)${NC}"
    fi
}

check_dependency "git" "Git"
check_dependency "curl" "Curl"
check_dependency "python3" "Python3"
check_dependency "perl" "Perl"
check_dependency "libssl-dev" "OpenSSL dev libs"

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}📁 DIRETÓRIOS DE RESULTADO${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}\n"

# Verificar diretórios importantes
echo "   📂 /tmp/pentest_results: "
if [ -d "/tmp/pentest_results" ]; then
    SIZE=$(du -sh /tmp/pentest_results 2>/dev/null | cut -f1)
    echo -e "      ${GREEN}✅ Existe (tamanho: $SIZE)${NC}"
else
    mkdir -p /tmp/pentest_results
    echo -e "      ${GREEN}✅ Criado${NC}"
fi

echo ""
echo "   📂 /opt/sqlmap: "
if [ -d "/opt/sqlmap" ]; then
    FILES=$(find /opt/sqlmap -type f 2>/dev/null | wc -l)
    echo -e "      ${GREEN}✅ Existe ($FILES arquivos)${NC}"
else
    echo -e "      ${RED}❌ Não encontrado${NC}"
fi

# ═══════════════════════════════════════════════════════════════════════════
# TESTE DE EXECUÇÃO
# ═══════════════════════════════════════════════════════════════════════════

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}🧪 TESTES DE EXECUÇÃO${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}\n"

# 1. YT-DLP - Test help
echo -n "   YT-DLP (--help): "
if yt-dlp --help > /dev/null 2>&1; then
    echo -e "${GREEN}✅${NC}"
else
    echo -e "${RED}❌${NC}"
fi

# 2. NMAP - Test help
echo -n "   NMAP (-h): "
if nmap -h > /dev/null 2>&1; then
    echo -e "${GREEN}✅${NC}"
else
    echo -e "${RED}❌${NC}"
fi

# 3. SQLMAP - Test --version
echo -n "   SQLMAP (--version): "
if python3 /opt/sqlmap/sqlmap.py --version > /dev/null 2>&1; then
    echo -e "${GREEN}✅${NC}"
else
    echo -e "${RED}❌${NC}"
fi

# 4. HYDRA - Test help
echo -n "   HYDRA (-h): "
if hydra -h > /dev/null 2>&1; then
    echo -e "${GREEN}✅${NC}"
else
    echo -e "${RED}❌${NC}"
fi

# ═══════════════════════════════════════════════════════════════════════════
# GERAR RELATÓRIO JSON
# ═══════════════════════════════════════════════════════════════════════════

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}📝 GERANDO RELATÓRIO${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}\n"

REPORT_FILE="/tmp/pentest_results/tools-verification-$(date +%Y%m%d_%H%M%S).json"

cat > "$REPORT_FILE" << EOF
{
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "hostname": "$(hostname)",
  "system": "$(uname -a)",
  "architecture": "$(uname -m)",
  "verification_summary": {
    "total_tools": $TOTAL,
    "installed": $OK,
    "failed": $FALHAS,
    "success_rate": $(( OK * 100 / TOTAL ))%
  },
  "tools": {
    "yt-dlp": {
      "installed": $([ $YT_DLP_STATUS -eq 0 ] && echo 'true' || echo 'false'),
      "path": "$(command -v yt-dlp 2>/dev/null || echo 'NOT_FOUND')",
      "version": "$(get_version yt-dlp)",
      "type": "Media Downloader"
    },
    "nmap": {
      "installed": $([ $NMAP_STATUS -eq 0 ] && echo 'true' || echo 'false'),
      "path": "$(command -v nmap 2>/dev/null || echo 'NOT_FOUND')",
      "version": "$(get_version nmap)",
      "type": "Port Scanner",
      "github": "https://github.com/nmap/nmap"
    },
    "sqlmap": {
      "installed": $([ $SQLMAP_STATUS -eq 0 ] && echo 'true' || echo 'false'),
      "path": "/opt/sqlmap/sqlmap.py",
      "version": "$(get_version sqlmap)",
      "type": "SQL Injection Tester",
      "github": "https://github.com/sqlmapproject/sqlmap"
    },
    "hydra": {
      "installed": $([ $HYDRA_STATUS -eq 0 ] && echo 'true' || echo 'false'),
      "path": "$(command -v hydra 2>/dev/null || echo 'NOT_FOUND')",
      "version": "$(get_version hydra)",
      "type": "Password Cracker",
      "github": "https://github.com/vanhauser-thc/thc-hydra"
    },
    "nuclei": {
      "installed": $([ $NUCLEI_STATUS -eq 0 ] && echo 'true' || echo 'false'),
      "path": "$(command -v nuclei 2>/dev/null || echo 'NOT_FOUND')",
      "version": "$(get_version nuclei)",
      "type": "Vulnerability Scanner",
      "github": "https://github.com/projectdiscovery/nuclei"
    },
    "masscan": {
      "installed": $([ $MASSCAN_STATUS -eq 0 ] && echo 'true' || echo 'false'),
      "path": "$(command -v masscan 2>/dev/null || echo 'NOT_FOUND')",
      "version": "$(get_version masscan)",
      "type": "Fast Port Scanner",
      "github": "https://github.com/robertdavidgraham/masscan"
    },
    "nikto": {
      "installed": $([ $NIKTO_STATUS -eq 0 ] && echo 'true' || echo 'false'),
      "path": "$(command -v nikto 2>/dev/null || echo 'NOT_FOUND')",
      "version": "$(get_version nikto)",
      "type": "Web Server Scanner",
      "github": "https://github.com/sullo/nikto"
    }
  },
  "deployment_ready": $([ $OK -ge 5 ] && echo 'true' || echo 'false'),
  "notes": {
    "minimum_required": ["yt-dlp", "nmap", "sqlmap", "hydra"],
    "optional": ["nuclei", "masscan", "nikto"],
    "storage": "/tmp/pentest_results",
    "hugging_face_ready": $([ $OK -ge 4 ] && echo 'true' || echo 'false')
  }
}
EOF

echo -e "${GREEN}✅ Relatório salvo: $REPORT_FILE${NC}"

# ═══════════════════════════════════════════════════════════════════════════
# RESUMO FINAL
# ═══════════════════════════════════════════════════════════════════════════

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}🎯 RESUMO FINAL${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}\n"

SUCCESS_RATE=$(( OK * 100 / TOTAL ))

echo -e "   Ferramentas Instaladas: ${GREEN}$OK/$TOTAL${NC}"
echo -e "   Taxa de Sucesso: ${GREEN}$SUCCESS_RATE%${NC}"
echo -e "   Falhas: ${RED}$FALHAS${NC}"
echo ""

if [ $OK -ge 4 ]; then
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}✅ SISTEMA PRONTO PARA HUGGING FACE SPACES!${NC}"
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    exit 0
elif [ $OK -ge 2 ]; then
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}⚠️  SISTEMA COM FUNCIONALIDADE LIMITADA${NC}"
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    exit 0
else
    echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${RED}❌ FALHA: Ferramentas críticas não foram instaladas!${NC}"
    echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    exit 1
fi
