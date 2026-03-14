/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SECURITY LOGGER - LOG DETALHADO DE OPERAÇÕES DE CYBERSECURITY
 * ═══════════════════════════════════════════════════════════════════════════
 * ✅ Registra todas as operações com timestamps
 * ✅ Armazena em database segura
 * ✅ Fornece relatórios de auditoria
 * ✅ Detecta atividade suspeita
 * ✅ Integração com alertas
 * ═══════════════════════════════════════════════════════════════════════════
 */

import fs from 'fs';
import path from 'path';

class SecurityLogger {
    public config: any;
    public logsPath: string | null;
    public alertsPath: string;
    public opsPath: string;
    public operations: any[];
    public alerts: any[];

    constructor(config: any) {
        this.config = config;

        // ═══════════════════════════════════════════════════════════════════
        // HF SPACES: Usar /tmp para garantir permissões de escrita
        // O HF Spaces tem sistema de arquivos somente-leitura em /
        // ═══════════════════════════════════════════════════════════════════

        // Forçar uso de /tmp no HF Spaces (sistema read-only)
        this.logsPath = '/tmp/akira_data/security_logs';
        this.alertsPath = path.join(this.logsPath, 'alerts.json');
        this.opsPath = path.join(this.logsPath, 'operations.json');

        // Cria diretórios com tratamento de erro
        try {
            if (this.logsPath && !fs.existsSync(this.logsPath)) {
                fs.mkdirSync(this.logsPath, { recursive: true });
                console.log(`✅ SecurityLogger: Diretório criado: ${this.logsPath}`);
            }
        } catch (error: any) {
            console.warn(`⚠️ SecurityLogger: Não foi possível criar diretório em ${this.logsPath}:`, error.message);

            // Fallback para /tmp direto
            const tmpPath = '/tmp/security_logs';
            try {
                fs.mkdirSync(tmpPath, { recursive: true });
                this.logsPath = tmpPath;
                this.alertsPath = path.join(this.logsPath, 'alerts.json');
                this.opsPath = path.join(this.logsPath, 'operations.json');
                console.log(`✅ SecurityLogger: Usando fallback: ${this.logsPath}`);
            } catch (fallbackError: any) {
                console.error('❌ SecurityLogger: Erro crítico ao criar diretório:', fallbackError.message);
                this.logsPath = null;
                this.alertsPath = '';
                this.opsPath = '';
            }
        }

        // Carrega logs
        this.operations = this.logsPath ? this._loadJSON(this.opsPath, []) : [];
        this.alerts = this.logsPath ? this._loadJSON(this.alertsPath, []) : [];

        console.log('✅ SecurityLogger inicializado');
    }

    /**
    * Registra operação de cybersecurity
    */
    public logOperation(operacao: any): any {
        try {
            const entry: any = {
                id: `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
                timestamp: new Date().toISOString(),
                usuario: operacao.usuario || 'UNKNOWN',
                tipoOperacao: operacao.tipo,
                alvo: operacao.alvo,
                resultado: operacao.resultado,
                risco: operacao.risco || 'BAIXO',
                detalhes: operacao.detalhes || {},
                ipOrigem: operacao.ipOrigem || 'N/A',
                duracao: operacao.duracao || 0
            };

            // Adiciona ao log
            this.operations.push(entry);
            this._saveJSON(this.opsPath, this.operations);

            // Verifica se é atividade suspeita
            if (this._isSuspicious(entry)) {
                this._createAlert(entry);
            }

            console.log(`📋 [SECURITY LOG] ${entry.tipoOperacao} em ${entry.alvo}`);
            return entry;
        } catch (e: any) {
            console.error('Erro ao logar operação:', e);
        }
    }

    /**
    * Cria alerta de atividade suspeita
    */
    private _createAlert(operacao: any): any {
        try {
            const alert = {
                id: `alert_${Date.now()}`,
                timestamp: new Date().toISOString(),
                severidade: 'ALTO',
                operacaoId: operacao.id,
                usuario: operacao.usuario,
                descricao: `Operação suspeita: ${operacao.tipoOperacao} em ${operacao.alvo}`,
                motivo: this._getSuspiciousReason(operacao),
                status: 'NOVO'
            };

            this.alerts.push(alert);
            this._saveJSON(this.alertsPath, this.alerts);

            console.log(`🚨 [ALERT] ${alert.descricao}`);
            return alert;
        } catch (e: any) {
            console.error('Erro ao criar alerta:', e);
        }
    }

    /**
    * Obtém relatório de operações
    */
    public getOperationReport(filtros: any = {}): any {
        try {
            let ops = [...this.operations];

            // Filtra por usuário
            if (filtros.usuario) {
                ops = ops.filter((o: any) => o.usuario === filtros.usuario);
            }

            // Filtra por tipo
            if (filtros.tipo) {
                ops = ops.filter((o: any) => o.tipoOperacao === filtros.tipo);
            }

            // Filtra por período
            if (filtros.dataInicio && filtros.dataFim) {
                const inicio = new Date(filtros.dataInicio);
                const fim = new Date(filtros.dataFim);
                ops = ops.filter((o: any) => {
                    const data = new Date(o.timestamp);
                    return data >= inicio && data <= fim;
                });
            }

            // Agrupa por tipo
            const porTipo: { [key: string]: number } = {};
            const porRisco: { [key: string]: number } = {};

            ops.forEach((op: any) => {
                porTipo[op.tipoOperacao] = (porTipo[op.tipoOperacao] || 0) + 1;
                porRisco[op.risco] = (porRisco[op.risco] || 0) + 1;
            });

            return {
                totalOperacoes: ops.length,
                operacoes: ops.slice(-50), // Últimas 50
                resumoPorTipo: porTipo,
                resumoPorRisco: porRisco,
                operacoesSuspeitas: ops.filter((o: any) => o.risco === 'ALTO' || o.risco === 'CRÍTICO').length
            };
        } catch (e: any) {
            console.error('Erro ao gerar relatório:', e);
            return { erro: e.message };
        }
    }

    /**
    * Obtém relatório de alertas
    */
    public getAlertReport(): any {
        try {
            const alertasNovos = this.alerts.filter((a: any) => a.status === 'NOVO');
            const alertasResolvidos = this.alerts.filter((a: any) => a.status === 'RESOLVIDO');

            return {
                totalAlertas: this.alerts.length,
                alertasNovos: alertasNovos.length,
                alertasResolvidos: alertasResolvidos.length,
                ultimos: this.alerts.slice(-20)
            };
        } catch (e: any) {
            return { erro: e.message };
        }
    }

    /**
    * Marca alerta como resolvido
    */
    public resolveAlert(alertId: string): boolean {
        try {
            const alert = this.alerts.find((a: any) => a.id === alertId);
            if (alert) {
                alert.status = 'RESOLVIDO';
                alert.resolvidoEm = new Date().toISOString();
                this._saveJSON(this.alertsPath, this.alerts);
                return true;
            }
            return false;
        } catch (e: any) {
            return false;
        }
    }

    /**
    * Detecção de atividade suspeita
    */
    private _isSuspicious(operacao: any): boolean {
        // Operações em múltiplos domínios em curto espaço
        const recentOps = this.operations.filter((o: any) => {
            const timeDiff = new Date(operacao.timestamp).getTime() - new Date(o.timestamp).getTime();
            return timeDiff < 60000; // últimos 60s
        });

        if (recentOps.length > 5) return true;

        // Scan agressivo
        if (operacao.tipoOperacao === 'NMAP_SCAN' && operacao.risco === 'ALTO') return true;

        // Múltiplas tentativas de SQL injection
        if (operacao.tipoOperacao === 'SQLMAP_TEST' && operacao.resultado === 'VULNERÁVEL') return true;

        // Breach search repetido
        if (operacao.tipoOperacao === 'BREACH_SEARCH') {
            const recent = recentOps.filter((o: any) => o.tipoOperacao === 'BREACH_SEARCH');
            if (recent.length > 3) return true;
        }

        return false;
    }

    private _getSuspiciousReason(operacao: any): string {
        const razoes: string[] = [];

        if (operacao.tipoOperacao === 'NMAP_SCAN') {
            razoes.push('Port scan detectado');
        }

        if (operacao.tipoOperacao === 'SQLMAP_TEST') {
            razoes.push('Teste de SQL Injection');
        }

        if (operacao.risco === 'CRÍTICO') {
            razoes.push('Risco crítico detectado');
        }

        return razoes.length > 0 ? razoes.join(', ') : 'Atividade incomum';
    }

    /**
    * FUNÇÕES AUXILIARES
    */

    private _loadJSON(filepath: string, defaultValue: any = {}): any {
        try {
            if (fs.existsSync(filepath)) {
                return JSON.parse(fs.readFileSync(filepath, 'utf8'));
            }
        } catch (e: any) {
            console.warn(`Erro ao carregar ${filepath}:`, e);
        }
        return defaultValue;
    }

    private _saveJSON(filepath: string, data: any): void {
        try {
            if (!filepath) return;
            fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
        } catch (e: any) {
            console.error(`Erro ao salvar ${filepath}:`, e);
        }
    }
}

export default SecurityLogger;
