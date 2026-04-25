/**
 * ═══════════════════════════════════════════════════════════════════════
 * PERMISSION MANAGER - AKIRA BOT V21
 * ═══════════════════════════════════════════════════════════════════════
 * Sistema centralizado de gerenciamento de permissões
 * NOVO: Integração com RegistrationSystem para controle por registro
 * ═══════════════════════════════════════════════════════════════════════
 */

import RegistrationSystem from './RegistrationSystem.js';
import ConfigManager from './ConfigManager.js';
import fs from 'fs';
import path from 'path';

class PermissionManager {
    public registrationSystem: RegistrationSystem;
    public groupRegistrationConfig: any;
    public owners: any[];
    public commandPermissions: any;
    public actionLimits: any;
    public securityConfig: any;
    public config: any;

    public logger: any;
    public sock: any;

    constructor(logger: any = console, registrationSystem: any = null) {
        this.config = ConfigManager.getInstance();
        this.logger = logger;
        this.sock = null;

        // Integração com sistema de registro
        this.registrationSystem = registrationSystem || new RegistrationSystem(this.logger);

        // Configurações de registro por grupo
        this.groupRegistrationConfig = this.loadGroupRegistrationConfig();

        // Proprietários - acesso total
        this.owners = [
            {
                numero: '244937035662',
                nome: 'Isaac Quarenta',
                descricao: 'Desenvolvedor Principal',
                nivel: 'ROOT'
            },
            {
                numero: '244978787009',
                nome: 'Isaac Quarenta',
                descricao: 'Segundo Proprietário',
                nivel: 'ROOT'
            },
            {
                numero: '202391978787009',
                nome: 'Isaac Quarenta',
                descricao: 'Proprietário Principal',
                nivel: 'ROOT'
            }
        ];

        // Permissões por comando
        this.commandPermissions = {
            // Comandos SEMPRE LIVRES (não requerem registro)
            'help': { nivel: 'public', requiresRegistration: false, rateLimitMultiplier: 0.5 },
            'menu': { nivel: 'public', requiresRegistration: false, rateLimitMultiplier: 0.5 },
            'ping': { nivel: 'public', requiresRegistration: false, rateLimitMultiplier: 0.5 },
            'info': { nivel: 'public', requiresRegistration: false, rateLimitMultiplier: 0.5 },
            'registrar': { nivel: 'public', requiresRegistration: false, rateLimitMultiplier: 1 },
            'register': { nivel: 'public', requiresRegistration: false, rateLimitMultiplier: 1 },
            // aliases and synonyms
            'lvl': { nivel: 'public', requiresRegistration: false, rateLimitMultiplier: 1 },
            'nivel': { nivel: 'public', requiresRegistration: false, rateLimitMultiplier: 1 },
            'ranking': { nivel: 'public', requiresRegistration: false, rateLimitMultiplier: 1 },
            'top': { nivel: 'public', requiresRegistration: false, rateLimitMultiplier: 1 },

            // Comandos PÚBLICOS (requerem registro se grupo configurado)
            // Account aliases missing
            'reg': { nivel: 'public', requiresRegistration: false, rateLimitMultiplier: 0.5 },
            'deposit': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 1 },
            'withdraw': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 1 },
            'transactions': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 1 },
            'perfil': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 1 },
            'profile': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 1 },
            'level': { nivel: 'public', requiresRegistration: false, rateLimitMultiplier: 1 },
            'rank': { nivel: 'public', requiresRegistration: false, rateLimitMultiplier: 1 },
            'sticker': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 2 },
            's': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 2 },
            'gif': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 2.5 },
            'toimg': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 1.5 },
            'play': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 2 },
            'p': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 2 },
            'video': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 3 },
            'ytmp4': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 3 },
            'playvid': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 3 },
            'tts': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 2 },
            'daily': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 1 },
            'atm': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 1 },
            'transfer': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 1.5 },
            'pinterest': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 2 },
            'img': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 2 },
            'ship': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 1 },
            'gay': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 1 },
            'dado': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 1 },
            'moeda': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 1 },
            'slot': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 1 },
            'chance': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 1 },
            'hd': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 3 },
            'upscale': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 3 },
            'wasted': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 2 },
            'removebg': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 3 },
            'piada': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 1 },
            'joke': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 1 },
            'frases': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 1 },
            'quote': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 1 },
            'fatos': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 1 },
            'curiosidade': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 1 },
            'enquete': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 1.5, grupo: true },
            'poll': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 1.5, grupo: true },

            // Aliases e comandos adicionais alinhados com CommandHandler
            // Conta & Economia
            'diario': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 1 },
            'banco': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 1 },
            'saldo': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 1 },
            'balance': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 1 },
            'transferir': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 1.5 },
            'pagar': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 1.5 },
            'depositar': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 1 },
            'sacar': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 1 },
            'transacoes': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 1 },

            // Mídia & Busca
            'pin': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 2 },
            'image': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 2 },
            'tomp3': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 2 },
            'mp3': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 2 },

            // Efeitos de Áudio
            'nightcore': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 2 },
            'slow': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 2 },
            'bass': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 2 },
            'bassboost': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 2 },
            'deep': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 2 },
            'robot': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 2 },
            'reverse': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 2 },
            'squirrel': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 2 },
            'echo': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 2 },
            '8d': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 2 },

            // Efeitos de Imagem (aliases adicionais)
            'triggered': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 2 },
            'communism': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 2 },
            'sepia': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 2 },
            'grey': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 2 },
            'invert': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 2 },
            'mission': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 2 },
            'angola': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 2 },
            'addbg': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 2 },

            // Jogos & Diversão
            'ttt': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 1 },
            'tictactoe': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 1 },
            'jogodavelha': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 1 },
            'rps': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 1 },
            'ppt': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 1 },
            'pedrapapeltesoura': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 1 },
            'guess': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 1 },
            'adivinhe': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 1 },
            'advinha': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 1 },
            'forca': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 1 },
            'hangman': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 1 },
            'gridtactics': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 1 },
            'grid': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 1 },

            // Menu & Info aliases
            'ajuda': { nivel: 'public', requiresRegistration: false, rateLimitMultiplier: 0.5 },
            'comandos': { nivel: 'public', requiresRegistration: false, rateLimitMultiplier: 0.5 },
            'dono': { nivel: 'public', requiresRegistration: false, rateLimitMultiplier: 0.5 },
            'owner': { nivel: 'public', requiresRegistration: false, rateLimitMultiplier: 0.5 },
            'criador': { nivel: 'public', requiresRegistration: false, rateLimitMultiplier: 0.5 },
            'creator': { nivel: 'public', requiresRegistration: false, rateLimitMultiplier: 0.5 },

            // Grupo & Administração - aliases adicionais
            'infogrupo': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 1, grupo: true },
            'ginfo': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 1, grupo: true },
            'close': { nivel: 'admin', requiresRegistration: true, rateLimitMultiplier: 1, grupo: true },
            'open': { nivel: 'admin', requiresRegistration: true, rateLimitMultiplier: 1, grupo: true },
            'desafixar': { nivel: 'admin', requiresRegistration: true, rateLimitMultiplier: 1, grupo: true },
            'unpin': { nivel: 'admin', requiresRegistration: true, rateLimitMultiplier: 1, grupo: true },
            'reagir': { nivel: 'admin', requiresRegistration: true, rateLimitMultiplier: 1, grupo: true },
            'react': { nivel: 'admin', requiresRegistration: true, rateLimitMultiplier: 1, grupo: true },
            'descricao': { nivel: 'admin', requiresRegistration: true, rateLimitMultiplier: 1, grupo: true },
            'fotodogrupo': { nivel: 'admin', requiresRegistration: true, rateLimitMultiplier: 2, grupo: true },
            'bemvindo': { nivel: 'admin', requiresRegistration: true, rateLimitMultiplier: 1, grupo: true },
            'antifake': { nivel: 'admin', requiresRegistration: true, rateLimitMultiplier: 1, grupo: true },
            'antiimage': { nivel: 'admin', requiresRegistration: true, rateLimitMultiplier: 1, grupo: true },
            'antisticker': { nivel: 'admin', requiresRegistration: true, rateLimitMultiplier: 1, grupo: true },
            'apagar': { nivel: 'admin', requiresRegistration: true, rateLimitMultiplier: 1, grupo: true },
            'delete': { nivel: 'admin', requiresRegistration: true, rateLimitMultiplier: 1, grupo: true },
            'del': { nivel: 'admin', requiresRegistration: true, rateLimitMultiplier: 1, grupo: true },

            // Stickers adicionais
            'take': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 1.5 },
            'roubar': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 1.5 },

            // Premium management (owner)
            'addpremium': { nivel: 'owner', requiresRegistration: true, rateLimitMultiplier: 1 },
            'addvip': { nivel: 'owner', requiresRegistration: true, rateLimitMultiplier: 1 },
            'delpremium': { nivel: 'owner', requiresRegistration: true, rateLimitMultiplier: 1 },
            'delvip': { nivel: 'owner', requiresRegistration: true, rateLimitMultiplier: 1 },
            'restart': { nivel: 'owner', requiresRegistration: true, rateLimitMultiplier: 1 },
            'comprar': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 1 },
            'doar': { nivel: 'public', requiresRegistration: false, rateLimitMultiplier: 0.5 },

            // OSINT operacionais (apenas dono)
            'dork': { nivel: 'owner', requiresRegistration: true, rateLimitMultiplier: 3 },
            'email': { nivel: 'owner', requiresRegistration: true, rateLimitMultiplier: 3 },
            'phone': { nivel: 'owner', requiresRegistration: true, rateLimitMultiplier: 3 },
            'username': { nivel: 'owner', requiresRegistration: true, rateLimitMultiplier: 3 },
            'sherlock': { nivel: 'owner', requiresRegistration: true, rateLimitMultiplier: 3 },
            'holehe': { nivel: 'owner', requiresRegistration: true, rateLimitMultiplier: 3 },
            'theharvester': { nivel: 'owner', requiresRegistration: true, rateLimitMultiplier: 3 },
            'shodan': { nivel: 'owner', requiresRegistration: true, rateLimitMultiplier: 3 },
            'cve': { nivel: 'owner', requiresRegistration: true, rateLimitMultiplier: 3 },
            'whois': { nivel: 'owner', requiresRegistration: true, rateLimitMultiplier: 2 },
            'dns': { nivel: 'owner', requiresRegistration: true, rateLimitMultiplier: 2 },
            'geo': { nivel: 'owner', requiresRegistration: true, rateLimitMultiplier: 2 },

            // Cybersecurity (apenas dono)
            'nuclei': { nivel: 'owner', requiresRegistration: true, rateLimitMultiplier: 5 },
            'nikto': { nivel: 'owner', requiresRegistration: true, rateLimitMultiplier: 5 },
            'masscan': { nivel: 'owner', requiresRegistration: true, rateLimitMultiplier: 5 },
            'commix': { nivel: 'owner', requiresRegistration: true, rateLimitMultiplier: 5 },
            'searchsploit': { nivel: 'owner', requiresRegistration: true, rateLimitMultiplier: 5 },
            'socialfish': { nivel: 'owner', requiresRegistration: true, rateLimitMultiplier: 5 },
            'blackeye': { nivel: 'owner', requiresRegistration: true, rateLimitMultiplier: 5 },
            'netexec': { nivel: 'owner', requiresRegistration: true, rateLimitMultiplier: 5 },
            'winrm': { nivel: 'owner', requiresRegistration: true, rateLimitMultiplier: 5 },
            'impacket': { nivel: 'owner', requiresRegistration: true, rateLimitMultiplier: 5 },

            // Comandos de GRUPO (Requerem Admin/Dono + Registro)
            'add': { nivel: 'admin', requiresRegistration: true, rateLimitMultiplier: 1, grupo: true },
            'remove': { nivel: 'admin', requiresRegistration: true, rateLimitMultiplier: 1, grupo: true },
            'kick': { nivel: 'admin', requiresRegistration: true, rateLimitMultiplier: 1, grupo: true },
            'ban': { nivel: 'admin', requiresRegistration: true, rateLimitMultiplier: 1, grupo: true },
            'promote': { nivel: 'admin', requiresRegistration: true, rateLimitMultiplier: 1, grupo: true },
            'demote': { nivel: 'admin', requiresRegistration: true, rateLimitMultiplier: 1, grupo: true },
            'mute': { nivel: 'admin', requiresRegistration: true, rateLimitMultiplier: 1, grupo: true },
            'desmute': { nivel: 'admin', requiresRegistration: true, rateLimitMultiplier: 1, grupo: true },
            'unmute': { nivel: 'admin', requiresRegistration: true, rateLimitMultiplier: 1, grupo: true },
            'fechar': { nivel: 'admin', requiresRegistration: true, rateLimitMultiplier: 1, grupo: true },
            'abrir': { nivel: 'admin', requiresRegistration: true, rateLimitMultiplier: 1, grupo: true },
            'antilink': { nivel: 'admin', requiresRegistration: true, rateLimitMultiplier: 1, grupo: true },
            'tagall': { nivel: 'admin', requiresRegistration: true, rateLimitMultiplier: 1, grupo: true },
            'hidetag': { nivel: 'admin', requiresRegistration: true, rateLimitMultiplier: 1, grupo: true },
            'totag': { nivel: 'admin', requiresRegistration: true, rateLimitMultiplier: 1, grupo: true },
            'welcome': { nivel: 'admin', requiresRegistration: true, rateLimitMultiplier: 1, grupo: true },
            'setwelcome': { nivel: 'admin', requiresRegistration: true, rateLimitMultiplier: 1, grupo: true },
            'goodbye': { nivel: 'admin', requiresRegistration: true, rateLimitMultiplier: 1, grupo: true },
            'setgoodbye': { nivel: 'admin', requiresRegistration: true, rateLimitMultiplier: 1, grupo: true },
            'revlink': { nivel: 'admin', requiresRegistration: true, rateLimitMultiplier: 1, grupo: true },
            'revogar': { nivel: 'admin', requiresRegistration: true, rateLimitMultiplier: 1, grupo: true },
            'setdesc': { nivel: 'admin', requiresRegistration: true, rateLimitMultiplier: 1, grupo: true },
            'setfoto': { nivel: 'admin', requiresRegistration: true, rateLimitMultiplier: 2, grupo: true },
            'antispam': { nivel: 'admin', requiresRegistration: true, rateLimitMultiplier: 1, grupo: true },
            'antipalavrao': { nivel: 'admin', requiresRegistration: true, rateLimitMultiplier: 1, grupo: true },
            'antipalavras': { nivel: 'admin', requiresRegistration: true, rateLimitMultiplier: 1, grupo: true },
            'antibadwords': { nivel: 'admin', requiresRegistration: true, rateLimitMultiplier: 1, grupo: true },
            'mutelist': { nivel: 'admin', requiresRegistration: true, rateLimitMultiplier: 1, grupo: true },
            'silenciados': { nivel: 'admin', requiresRegistration: true, rateLimitMultiplier: 1, grupo: true },
            'sortear': { nivel: 'admin', requiresRegistration: true, rateLimitMultiplier: 2, grupo: true },
            'sorteio': { nivel: 'admin', requiresRegistration: true, rateLimitMultiplier: 2, grupo: true },
            'except': { nivel: 'owner', requiresRegistration: true, rateLimitMultiplier: 1, grupo: true },
            'excep': { nivel: 'owner', requiresRegistration: true, rateLimitMultiplier: 1, grupo: true },
            'groupinfo': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 1, grupo: true },
            'listar': { nivel: 'admin', requiresRegistration: true, rateLimitMultiplier: 1, grupo: true },
            'admins': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 1, grupo: true },
            'requireregister': { nivel: 'admin', requiresRegistration: true, rateLimitMultiplier: 1, grupo: true },

            // Comandos de ADMIN/DONO
            'broadcast': { nivel: 'owner', requiresRegistration: true, rateLimitMultiplier: 1 },
            'setbotphoto': { nivel: 'owner', requiresRegistration: true, rateLimitMultiplier: 1 },
            'setbotname': { nivel: 'owner', requiresRegistration: true, rateLimitMultiplier: 1 },
            'setbotstatus': { nivel: 'owner', requiresRegistration: true, rateLimitMultiplier: 1 },
            'setbotpic': { nivel: 'owner', requiresRegistration: true, rateLimitMultiplier: 1 },
            'setphoto': { nivel: 'owner', requiresRegistration: true, rateLimitMultiplier: 1 },
            'setbio': { nivel: 'owner', requiresRegistration: true, rateLimitMultiplier: 1 },
            'setname': { nivel: 'owner', requiresRegistration: true, rateLimitMultiplier: 1 },
            'blacklist': { nivel: 'owner', requiresRegistration: true, rateLimitMultiplier: 1 },
            'getprofile': { nivel: 'owner', requiresRegistration: true, rateLimitMultiplier: 1 },
            'getuser': { nivel: 'owner', requiresRegistration: true, rateLimitMultiplier: 1 },
            'nmap': { nivel: 'owner', requiresRegistration: true, rateLimitMultiplier: 5 },
            'sqlmap': { nivel: 'owner', requiresRegistration: true, rateLimitMultiplier: 5 },
            'hydra': { nivel: 'owner', requiresRegistration: true, rateLimitMultiplier: 5 },

            // INFO & REPORT — qualquer registrado pode reportar
            'report': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 0.5 },
            'reportar': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 0.5 },
            'bug': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 0.5 },
            'premium': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 0.5 },
            'vip': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 0.5 },
            'donate': { nivel: 'public', requiresRegistration: false, rateLimitMultiplier: 0.5 }, // already above but keep alias coverage

            // Pagamento
            'buy': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 1 },

            // Stickers (fig and caracoroa were missing)
            'fig': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 2 },
            'caracoroa': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 1 },

            // Efeitos de imagem (jail, remini, enhance were missing)
            'jail': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 2 },
            'remini': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 3 },
            'enhance': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 3 },
            'bg': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 3 },
            'rmbg': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 3 },

            // Group commands missing from PM
            'fixar': { nivel: 'admin', requiresRegistration: true, rateLimitMultiplier: 1, grupo: true },
            'link': { nivel: 'admin', requiresRegistration: true, rateLimitMultiplier: 1, grupo: true },
            'membros': { nivel: 'admin', requiresRegistration: true, rateLimitMultiplier: 1, grupo: true },
            'listadmins': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 1, grupo: true },
            'raffle': { nivel: 'admin', requiresRegistration: true, rateLimitMultiplier: 2, grupo: true },
            'motivar': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 1 },
            'warn': { nivel: 'admin', requiresRegistration: true, rateLimitMultiplier: 1, grupo: true },
            'unwarn': { nivel: 'admin', requiresRegistration: true, rateLimitMultiplier: 1, grupo: true },
            'resetwarns': { nivel: 'admin', requiresRegistration: true, rateLimitMultiplier: 1, grupo: true },

            // Cyber commands that have handler but are disabled (setoolkit/metasploit still informational)
            'setoolkit': { nivel: 'owner', requiresRegistration: true, rateLimitMultiplier: 3 },
            'metasploit': { nivel: 'owner', requiresRegistration: true, rateLimitMultiplier: 3 },

            // Reset memory command
            'reset': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 1 },
            'resetar': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 1 },
            'limparmemoria': { nivel: 'public', requiresRegistration: true, rateLimitMultiplier: 1 },

            // Menu / submenu category commands (no-op, just show menus)
            'menucyber': { nivel: 'public', requiresRegistration: false, rateLimitMultiplier: 0.5 },
            'menumedia': { nivel: 'public', requiresRegistration: false, rateLimitMultiplier: 0.5 },
            'menuconta': { nivel: 'public', requiresRegistration: false, rateLimitMultiplier: 0.5 },
            'menudiversao': { nivel: 'public', requiresRegistration: false, rateLimitMultiplier: 0.5 },
            'menujogos': { nivel: 'public', requiresRegistration: false, rateLimitMultiplier: 0.5 },
            'menugrupo': { nivel: 'public', requiresRegistration: false, rateLimitMultiplier: 0.5 },
            'menuadm': { nivel: 'public', requiresRegistration: false, rateLimitMultiplier: 0.5 },
            'menuinfo': { nivel: 'public', requiresRegistration: false, rateLimitMultiplier: 0.5 },
            'menupremium': { nivel: 'public', requiresRegistration: false, rateLimitMultiplier: 0.5 },
            'menuosint': { nivel: 'public', requiresRegistration: false, rateLimitMultiplier: 0.5 },
            'menuaudio': { nivel: 'public', requiresRegistration: false, rateLimitMultiplier: 0.5 },
            'menuimagem': { nivel: 'public', requiresRegistration: false, rateLimitMultiplier: 0.5 },
            'cyber': { nivel: 'public', requiresRegistration: false, rateLimitMultiplier: 0.5 },
            'grupos': { nivel: 'public', requiresRegistration: false, rateLimitMultiplier: 0.5 },
            'grupo': { nivel: 'public', requiresRegistration: false, rateLimitMultiplier: 0.5 },
            'admin': { nivel: 'public', requiresRegistration: false, rateLimitMultiplier: 0.5 },
            'moderacao': { nivel: 'public', requiresRegistration: false, rateLimitMultiplier: 0.5 },
            'diversao': { nivel: 'public', requiresRegistration: false, rateLimitMultiplier: 0.5 },
            'fun': { nivel: 'public', requiresRegistration: false, rateLimitMultiplier: 0.5 },
            'jogos': { nivel: 'public', requiresRegistration: false, rateLimitMultiplier: 0.5 },
            'game': { nivel: 'public', requiresRegistration: false, rateLimitMultiplier: 0.5 },
            'osint': { nivel: 'public', requiresRegistration: false, rateLimitMultiplier: 0.5 },
            'inteligencia': { nivel: 'public', requiresRegistration: false, rateLimitMultiplier: 0.5 },
            'informacoes': { nivel: 'public', requiresRegistration: false, rateLimitMultiplier: 0.5 },
            'about': { nivel: 'public', requiresRegistration: false, rateLimitMultiplier: 0.5 },
            'extras': { nivel: 'public', requiresRegistration: false, rateLimitMultiplier: 0.5 },

            // Comandos CYBERSEGURANÇA (requerem pagamento - já implementado)
            // Menu OSINT (somente exibição de menu)
        };

        // Tipos de ações e seus limites
        this.actionLimits = {
            // Premium features com limite de 1x a cada 90 dias
            'premium_feature': {
                maxUsos: 1,
                janelaDias: 90,
                message: 'Feature Premium - Acesso 1x a cada 90 dias'
            },
            // Comandos normais com rate limiting
            'normal_command': {
                janelaSec: 8,
                maxPorJanela: 6,
                message: 'Aguarde antes de usar outro comando'
            },
            // Comandos de admin
            'admin_command': {
                janelaSec: 3,
                maxPorJanela: 10,
                message: 'Muitos comandos de admin muito rapido'
            }
        };

        // Configurações de segurança
        this.securityConfig = {
            // Máximo de mutes antes de remover automaticamente
            maxMutesBeforeRemove: 5,

            // Progressão de duração de mute (multiplicador)
            muteProgressionMultiplier: 2,

            // Duração base de mute em minutos
            baseMuteDuration: 5,

            // Padrões de link a detectar
            linkPatterns: [
                'https://',
                'http://',
                'www.',
                'bit.ly/',
                't.me/',
                'wa.me/',
                'chat.whatsapp.com/',
                'whatsapp.com/'
            ],

            // Comportamento ao detectar abuso
            abuseDetection: {
                enabled: true,
                deleteMessage: true,
                removeUser: true,
                logAction: true
            }
        };
    }

    /**
    * Verifica se usuário é proprietário
    */
    isOwner(numero: string, nome: string = '') {
        try {
            // Remove sufixos de dispositivo (:1, :2, etc) que o Baileys costuma incluir
            const numeroBase = String(numero).split(':')[0];
            const numeroLimpo = numeroBase.replace(/\D/g, '').trim();

            // Prioridade absoluta: número na lista de owners
            const matchByNumber = this.owners?.some(owner =>
                String(owner.numero).replace(/\D/g, '') === numeroLimpo
            );

            if (matchByNumber) return true;

            // Fallback (menos confiável): nome exato (removido para evitar spoofing, mas mantido se numero bater)
            // Por segurança, exigimos que o numero SEJA o identificador principal
            return false;
        } catch (e: any) {
            return false;
        }
    }

    /**
    * Obtém informações do proprietário
    */
    getOwnerInfo(numero: string) {
        const numeroLimpo = String(numero).trim();
        return this.owners?.find(owner => numeroLimpo === owner.numero);
    }

    /**
    * Verifica permissão para comando específico
    */
    hasPermissionForCommand(comando: string, numero: string, nome: string, ehGrupo: boolean = false) {
        const permConfig = this.commandPermissions[comando];

        if (!permConfig) {
            return false; // Comando não existe
        }

        // Comando público - todos podem usar
        if (permConfig.nivel === 'public') {
            return true;
        }

        // Comando de dono
        if (permConfig.nivel === 'owner') {
            const isOwner = this.isOwner(numero, nome);
            if (!isOwner) return false;

            // Se requer grupo, verifica se está em grupo
            if (permConfig.grupo && !ehGrupo) {
                return false;
            }

            return true;
        }

        return false;
    }

    /**
    * Obtém configuração de permissão para comando
    */
    getCommandConfig(comando: string) {
        return this.commandPermissions[comando] || null;
    }

    /**
    * Obtém múltiplo de rate limit para comando
    */
    getRateLimitMultiplier(comando: string) {
        const config = this.commandPermissions[comando];
        return config?.rateLimitMultiplier || 1;
    }

    /**
    * Valida padrão de link
    */
    containsLink(texto: string) {
        if (!texto) return false;
        const textLower = String(texto).toLowerCase();
        return this.securityConfig?.linkPatterns?.some((pattern: string) =>
            textLower.includes(pattern.toLowerCase())
        );
    }

    /**
    * Obtém configuração de limite de ação
    */
    getActionLimitConfig(tipoAcao: string) {
        return this.actionLimits[tipoAcao];
    }

    /**
    * Calcula próxima duração de mute progressivo
    */
    getNextMuteDuration(muteCount: number) {
        const baseDuration = this.securityConfig?.baseMuteDuration;
        const multiplier = this.securityConfig?.muteProgressionMultiplier;

        // Fórmula: 5 * 2^(n-1)
        return Math.min(
            baseDuration * Math.pow(multiplier, muteCount),
            1440 // Máximo de 1 dia (1440 minutos)
        );
    }

    /**
    * Verifica se deve remover após muitos mutes
    */
    shouldRemoveAfterMute(muteCount: number) {
        return muteCount >= this.securityConfig?.maxMutesBeforeRemove;
    }

    /**
    * Lista todos os proprietários
    */
    listOwners() {
        return this.owners?.map(owner => ({
            numero: owner.numero,
            nome: owner.nome,
            descricao: owner.descricao
        }));
    }

    /**
    * Valida estrutura de permissões
    */
    validateStructure() {
        const errors = [];

        // Valida proprietários
        if (!Array.isArray(this.owners) || this.owners?.length === 0) {
            errors.push('Nenhum proprietário definido');
        }

        this.owners?.forEach((owner, idx) => {
            if (!owner.numero || !owner.nome) {
                errors.push(`Proprietário ${idx} incompleto`);
            }
        });

        // Valida comandos
        if (!this.commandPermissions || Object.keys(this.commandPermissions)?.length === 0) {
            errors.push('Nenhuma permissão de comando definida');
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }

    // ═════════════════════════════════════════════════════════════════
    // SISTEMA DE PERMISSÕES POR REGISTRO
    // ═════════════════════════════════════════════════════════════════

    /**
     * Carrega configurações de registro por grupo
     */
    loadGroupRegistrationConfig() {
        try {
            const basePath = this.config.DATABASE_FOLDER || './database';
            const configPath = path.join(basePath, 'data', 'group_registration_config.json');
            if (fs.existsSync(configPath)) {
                const data = fs.readFileSync(configPath, 'utf8');
                return JSON.parse(data || '{}');
            }
        } catch (e: any) {
            console.warn('⚠️ Erro ao carregar config de registro:', e.message);
        }
        return {};
    }

    /**
     * Salva configurações de registro por grupo
     */
    saveGroupRegistrationConfig() {
        try {
            const basePath = this.config.DATABASE_FOLDER || './database';
            const configPath = path.join(basePath, 'data', 'group_registration_config.json');
            const dir = path.dirname(configPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(configPath, JSON.stringify(this.groupRegistrationConfig, null, 2));
        } catch (e: any) {
            console.error('❌ Erro ao salvar config de registro:', e.message);
        }
    }

    /**
     * Verifica se grupo exige registro para comandos comuns
     */
    groupRequiresRegistration(groupJid: string) {
        // Padrão: grupos NÃO exigem registro (para não quebrar comportamento atual)
        return this.groupRegistrationConfig[groupJid]?.requireRegistration === true;
    }

    /**
     * Define se grupo exige registro
     */
    setGroupRequireRegistration(groupJid: string, require: boolean) {
        if (!this.groupRegistrationConfig[groupJid]) {
            this.groupRegistrationConfig[groupJid] = {};
        }
        this.groupRegistrationConfig[groupJid].requireRegistration = require;
        this.saveGroupRegistrationConfig();
    }

    /**
     * Verifica se usuário pode executar comando (NOVO SISTEMA)
     * @param {string} comando - Nome do comando
     * @param {string} userId - ID do usuário (número@s.whatsapp.net)
     * @param {string} userName - Nome do usuário
     * @param {boolean} isGroup - Se está em grupo
     * @param {string} groupJid - JID do grupo (se aplicável)
     * @returns {Object} { allowed: boolean, reason: string }
     */
    canExecuteCommand(comando: string, userId: string, userName: string, isGroup: boolean = false, groupJid: string | null = null) {
        const permConfig = this.commandPermissions[comando];

        if (!permConfig) {
            return { allowed: false, reason: 'Comando não encontrado.' };
        }

        // REGRA 1: Dono SEMPRE pode tudo
        const userNumber = userId.split('@')[0];
        if (this.isOwner(userNumber, userName)) {
            return { allowed: true, reason: 'Owner access' };
        }

        // REGRA 2: Verificar se requer pagamento (cybersegurança)
        if (permConfig.requiresPayment) {
            return {
                allowed: false,
                reason: '⚠️ Este comando requer assinatura premium.\n\nUse #subscribe para conhecer os planos.'
            };
        }

        // REGRA 3: Comandos de grupo só funcionam em grupos
        if (permConfig.grupo && !isGroup) {
            return {
                allowed: false,
                reason: '📵 Este comando só funciona em grupos.'
            };
        }

        // REGRA 4: Comandos de dono (owner level)
        if (permConfig.nivel === 'owner') {
            return {
                allowed: false,
                reason: '🔒 Este comando é restrito ao proprietário do bot.'
            };
        }

        // REGRA 5: Verificar registro (se comando requer E grupo exige)
        if (permConfig.requiresRegistration) {
            // Se não está em grupo, sempre requer registro
            // Se está em grupo, verifica se grupo exige
            const mustCheckRegistration = !isGroup || (isGroup && groupJid && this.groupRequiresRegistration(groupJid));

            if (mustCheckRegistration) {
                const isRegistered = this.registrationSystem.isRegistered(userId);
                if (!isRegistered) {
                    return {
                        allowed: false,
                        reason: '📝 **Registro Necessário**\n\n' +
                            'Para usar este comando, você precisa se registrar.\n' +
                            'Use: `#registrar Nome|Idade`\n' +
                            'Exemplo: `#registrar João Silva|25`'
                    };
                }
            }
        }

        // Se passou por todas as verificações
        return { allowed: true, reason: 'Authorized' };
    }

    /**
     * Obtém mensagem de ajuda sobre registro
     */
    getRegistrationHelpMessage() {
        return '📝 **Como se Registrar**\n\n' +
            'Use o comando: `#registrar Nome|Idade`\n\n' +
            '**Exemplos:**\n' +
            '• `#registrar João Silva|25`\n' +
            '• `#registrar Maria Santos|30`\n\n' +
            '✅ Após o registro, você terá acesso a todos os comandos comuns do bot!';
    }

    public setSocket(sock: any): void {
        this.sock = sock;
    }
}

export default PermissionManager;
