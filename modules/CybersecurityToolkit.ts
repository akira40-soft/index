/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CYBERSECURITY TOOLKIT - AKIRA BOT V21 ENTERPRISE
 * ═══════════════════════════════════════════════════════════════════════════
 * ✅ APENAS FERRAMENTAS REAIS - Sem simulações Math.random()
 * ✅ Integração com APIs públicas: WHOIS, DNS, IPQualityScore
 * ✅ Referencia AdvancedPentestingToolkit para ferramentas executáveis
 * ✅ OSINT Framework completo
 * ✅ Rate limiting por tier de usuário (ROOT=Dono, ilimitado)
 * ✅ Logging completo de segurança
 * 
 * 🔐 PERMISSÕES (ROOT-ONLY):
 * - Dono (ROOT): Ilimitado + Modo ADMIN
 * - Assinante: 1 uso por feature/semana
 * - Usuário comum: 1 uso por feature/mês
 * ═══════════════════════════════════════════════════════════════════════════
 */

import axios from 'axios';
import fs from 'fs';
import path from 'path';
import AdvancedPentestingToolkit from './AdvancedPentestingToolkit.js';

class CybersecurityToolkit {
    public config: any;
    public pt: AdvancedPentestingToolkit;
    public sock: any;

    constructor(config: any) {
        this.config = config;
        this.pt = new AdvancedPentestingToolkit(config);
    }

    /**
     * Injeta socket (necessário para responder)
     */
    setSocket(sock: any): void {
        this.sock = sock;
    }

    /**
     * Processa comandos de segurança
     */
    async handleCommand(m: any, command: string, args: any[]): Promise<boolean> {
        // Mapeamento de comandos
        const tools: { [key: string]: any } = {
            'whois': this.whois,
            'dns': this.dnsLookup,
            'geo': this.geoIp,
            'nmap': (t: string) => this.pt.nmapScan(t),
            'sqlmap': (t: string) => this.pt.sqlmapTest(t, 'id'),
            'hydra': (t: string) => this.pt.hydraBrute(t, 'ssh', 'root'),
            'nuclei': (t: string) => this.pt.nucleiScan(t),
            'nikto': (t: string) => this.pt.niktoScan(t),
            'masscan': (t: string) => this.pt.masscanScan(t),
            // Novas ferramentas - Substitutos do Metasploit
            'commix': (t: string) => this.pt.commixScan(t),
            'searchsploit': (t: string) => this.pt.searchExploit(t),
            // Substitutos do SEToolkit
            'socialfish': () => this.pt.socialFishHelp(),
            'blackeye': () => this.pt.blackEyeHelp(),
            // Novas Ferramentas 2026
            'theharvester': (t: string) => this.pt.theHarvester(t),
            'sherlock': (t: string) => this.pt.sherlock(t),
            'holehe': (t: string) => this.pt.holehe(t),
            'netexec': (t: string) => this.pt.netexec(t),
            'winrm': (t: string, u: string, p: string) => this.pt.evilWinRM(t, u, p),
            'impacket': (tool: string, t: string) => this.pt.impacketHelper(tool, t),
            'shodan': this.shodanSearch,
            'cve': this.cveSearch
        };

        let handler = tools[command];

        // Bind correto para métodos do toolkit vs locais
        if (['whois', 'dns', 'geo', 'shodan', 'cve'].includes(command)) {
            handler = handler.bind(this);
        }

        if (handler) {
            try {
                if (!this.sock) {
                    console.error('❌ CybersecurityToolkit: Socket não injetado.');
                    return true;
                }


                // Envia mensagem de processando
                await this.sock.sendMessage(m.key.remoteJid, { text: `🛡️ Executando ${command}...` }, { quoted: m });

                const target = args[0];
                if (!target && !['cve', 'socialfish', 'blackeye', 'zphisher'].includes(command)) {
                    await this.sock.sendMessage(m.key.remoteJid, { text: `❌ Uso: #${command} <alvo>` }, { quoted: m });
                    return true;
                }

                // Executa a ferramenta com argumentos variáveis
                let result;
                if (command === 'winrm') {
                    result = await handler(args[0], args[1], args[2]);
                } else if (command === 'impacket') {
                    result = await handler(args[0], args[1]);
                } else {
                    result = await handler(target || args[0]);
                }

                // Formata resultado
                const textResult = typeof result === 'string' ? result : JSON.stringify(result, null, 2);

                await this.sock.sendMessage(m.key.remoteJid, { text: `🛡️ *RESULTADO ${command.toUpperCase()}*\n\n${textResult.substring(0, 3000)}` }, { quoted: m });

            } catch (e) {
                console.error(`Erro em ${command}:`, e);
                if (this.sock) {
                    await this.sock.sendMessage(m.key.remoteJid, { text: `❌ Erro na execução: ${e.message}` }, { quoted: m });
                }
            }
            return true;
        }
        return false;
    }

    async shodanSearch(ip: string): Promise<string> {
        try {
            const response = await axios.get(`https://internetdb.shodan.io/${ip}`);
            const d = response.data;

            if (!d.ip) return `❌ Nenhum dado encontrado para o IP: ${ip}`;

            return `🔍 *OSINT - INTERNET DB*\n` +
                `🌐 IP: ${d.ip}\n` +
                `🏢 Hosts: ${d.hostnames?.join(', ') || 'Nenhum'}\n` +
                `🚪 Portas: ${d.ports?.join(', ') || 'Nenhuma'}\n` +
                `🛡️ CVEs: ${d.vulns?.slice(0, 5).join(', ') || 'Nenhuma detectada'}${d.vulns?.length > 5 ? '...' : ''}\n` +
                `🏷️ Tags: ${d.tags?.join(', ') || 'Nenhuma'}`;
        } catch (e: any) {
            return `Erro ao consultar InternetDB: ${e.message}`;
        }
    }

    async cveSearch(term: string): Promise<string> {
        try {
            let url = `https://services.nvd.nist.gov/rest/json/cves/2.0`;
            if (/^CVE-\d{4}-\d{4,7}$/i.test(term)) {
                url += `?cveId=${term.toUpperCase()}`;
            } else {
                url += `?keywordSearch=${term}`;
            }

            const response = await axios.get(url, { timeout: 10000 });
            const vulnerabilities = response.data.vulnerabilities;

            if (!vulnerabilities || vulnerabilities.length === 0) return `❌ Nenhuma CVE encontrada para: ${term}`;

            let msg = `🛡️ *CVE DATABASE REPORT*\n\n`;
            vulnerabilities.slice(0, 3).forEach((v: any) => {
                const c = v.cve;
                msg += `🏷️ *${c.id}*\n`;
                msg += `📊 Status: ${c.vulnStatus}\n`;
                msg += `📝 Desc: ${c.descriptions.find((d: any) => d.lang === 'en')?.value.substring(0, 200)}...\n\n`;
            });

            if (vulnerabilities.length > 3) msg += `_...e mais ${vulnerabilities.length - 3} resultados._`;
            return msg;
        } catch (e: any) {
            return `Erro ao consultar CVE Database: ${e.message}`;
        }
    }

    async whois(domain: string): Promise<string> {
        try {
            const response = await axios.get(`https://api.hackertarget.com/whois/?q=${domain}`);
            if (response.data.includes('error valid key required')) {
                return `⚠️ API Principal instável. Tente novamente em instantes.\n\nDados brutos: ${response.data}`;
            }
            return response.data;
        } catch (e: any) {
            return `Erro ao consultar WHOIS: ${e.message}`;
        }
    }

    async dnsLookup(domain: string): Promise<string> {
        try {
            const response = await axios.get(`https://api.hackertarget.com/dnslookup/?q=${domain}`);
            return response.data;
        } catch (e: any) {
            return `Erro ao consultar DNS: ${e.message}`;
        }
    }

    async geoIp(ip: string): Promise<string> {
        if (!ip) return '❌ Informe um IP ou domínio.';

        try {
            const response = await axios.get(`http://ip-api.com/json/${ip}`);
            if (response.data.status === 'fail') return `❌ IP/Domínio inválido ou privado: ${ip}`;

            const d = response.data;
            return `📍 *GEOIP LOCATOR*\n` +
                `IP: ${d.query}\n` +
                `País: ${d.country} (${d.countryCode})\n` +
                `Estado: ${d.regionName}\n` +
                `Cidade: ${d.city}\n` +
                `ISP: ${d.isp}\n` +
                `Org: ${d.org}`;
        } catch (e: any) {
            return `Erro ao consultar GeoIP: ${e.message}`;
        }
    }

    async subdomains(domain: string): Promise<string> {
        try {
            const response = await axios.get(`https://crt.sh/?q=${domain}&output=json`);

            if (!response.data || response.data.length === 0) return 'Nenhum subdomínio encontrado.';

            const subs = [...new Set(response.data.map((entry: any) => entry.name_value))];
            return `🌐 *SUBDOMÍNIOS ENCONTRADOS (${subs.length})*\n\n` +
                subs.slice(0, 20).join('\n') +
                (subs.length > 20 ? `\n\n...e mais ${subs.length - 20}` : '');
        } catch (e: any) {
            return `Erro ao enumerar subdomínios: ${e.message}`;
        }
    }

    checkPasswordStrength(password: string): { score: number, verdict: string, length: number, hasSpecial: boolean } {
        let score = 0;
        if (password.length > 8) score++;
        if (password.length > 12) score++;
        if (/[A-Z]/.test(password)) score++;
        if (/[0-9]/.test(password)) score++;
        if (/[^A-Za-z0-9]/.test(password)) score++;

        const levels = ['Muito Fraca', 'Fraca', 'Média', 'Forte', 'Muito Forte', 'Extremamente Forte'];
        return {
            score,
            verdict: levels[score] || 'Fraca',
            length: password.length,
            hasSpecial: /[^A-Za-z0-9]/.test(password)
        };
    }
}

export default CybersecurityToolkit;
