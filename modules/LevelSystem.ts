import fs from 'fs';
import path from 'path';
import ConfigManager from './ConfigManager.js';
import JidUtils from './JidUtils.js';

class LevelSystem {
    private static instance: LevelSystem;
    public config: any;
    public logger: any;
    public dbPath: string;
    public promoPath: string;
    public data: any[];
    public promos: any;
    public windowDays: number;
    public maxLevel: number;
    public topForAdm: number;
    public enableDetailedLogging: boolean;

    private constructor(logger: any = console) {
        this.config = ConfigManager.getInstance();
        this.logger = logger;

        const basePath = process.env.DATA_DIR || this.config.DATABASE_FOLDER || './database';
        this.dbPath = path.join(basePath, 'data', 'group_levels.json');
        this.promoPath = path.join(basePath, 'datauser', 'level_adm_promotion.json');

        this._ensureFiles();
        this.data = this._load(this.dbPath, []);
        this.promos = this._load(this.promoPath, {});
        this.windowDays = this.config.LEVEL_WINDOW_DAYS || 3;
        this.maxLevel = this.config.LEVEL_MAX || 60;
        this.topForAdm = this.config.LEVEL_TOP_FOR_ADM || 3;
        this.enableDetailedLogging = true;
    }

    public static getInstance(logger: any = console): LevelSystem {
        if (!LevelSystem.instance) {
            LevelSystem.instance = new LevelSystem(logger);
        }
        return LevelSystem.instance;
    }

    _ensureFiles() {
        try {
            if (!fs.existsSync(path.dirname(this.dbPath))) fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
            if (!fs.existsSync(path.dirname(this.promoPath))) fs.mkdirSync(path.dirname(this.promoPath), { recursive: true });
            if (!fs.existsSync(this.dbPath)) fs.writeFileSync(this.dbPath, JSON.stringify([], null, 2));
            if (!fs.existsSync(this.promoPath)) fs.writeFileSync(this.promoPath, JSON.stringify({}, null, 2));
        } catch (e: any) {
            this.logger.warn('LevelSystem: erro ao garantir arquivos:', e.message);
            // Silenciosamente falha em caso de erro no HF Spaces
        }
    }

    _load(p: string, fallback: any) {
        try {
            const raw = fs.readFileSync(p, 'utf8');
            let loaded = JSON.parse(raw || (Array.isArray(fallback) ? '[]' : '{}'));

            // ═══════════════════════════════════════════════════════════════════
            // MIGRATION: JID -> NUMERIC ID (Digits Only)
            // ═══════════════════════════════════════════════════════════════════
            if (Array.isArray(loaded) && p.includes('group_levels.json')) {
                let migratedCount = 0;
                loaded = loaded.map(r => {
                    const numericUid = JidUtils.toNumeric(r.uid);
                    if (r.uid !== numericUid) {
                        r.uid = numericUid;
                        migratedCount++;
                    }
                    return r;
                });
                if (migratedCount > 0) {
                    this.logger.info(`✨ [LevelSystem] Migrados ${migratedCount} registros para ID Numérico.`);
                    this._save(p, loaded);
                }
            } else if (!Array.isArray(loaded) && p.includes('level_adm_promotion.json')) {
                // Migração para os dicionários de promoção
                let migrated = false;
                for (const gid in loaded) {
                    const window = loaded[gid];
                    if (window.maxLevelUsers) {
                        window.maxLevelUsers = window.maxLevelUsers.map((u: any) => {
                            const num = JidUtils.toNumeric(u.uid);
                            if (u.uid !== num) { migrated = true; u.uid = num; }
                            return u;
                        });
                    }
                    if (window.promotedToADM) {
                        window.promotedToADM = window.promotedToADM.map((u: any) => {
                            const num = JidUtils.toNumeric(u);
                            if (u !== num) { migrated = true; return num; }
                            return u;
                        });
                    }
                }
                if (migrated) this._save(p, loaded);
            }

            return loaded;
        } catch (e: any) {
            return fallback;
        }
    }

    _save(p: string, obj: any) {
        try { fs.writeFileSync(p, JSON.stringify(obj, null, 2)); } catch (e: any) { this.logger.warn('LevelSystem save erro:', e.message); }
    }

    getGroupRecord(gid: string, uid: string, createIfMissing: boolean = false) {
        const normUid = JidUtils.toNumeric(uid);
        const rec = this.data.find(r => r.gid === gid && JidUtils.toNumeric(r.uid) === normUid);
        if (rec) return rec;
        if (createIfMissing) {
            const n = { gid, uid: normUid, level: 0, xp: 0 };
            this.data.push(n);
            this._save(this.dbPath, this.data);
            return n;
        }
        return { gid, uid: normUid, level: 0, xp: 0 };
    }

    saveRecord(rec: any) {
        const normUid = JidUtils.toNumeric(rec.uid);
        const i = this.data.findIndex(r => r.gid === rec.gid && JidUtils.toNumeric(r.uid) === normUid);
        if (i === -1) {
            rec.uid = normUid;
            this.data.push(rec);
        } else {
            this.data[i] = rec;
        }
        this._save(this.dbPath, this.data);
    }

    // Fórmula POLINOMIAL: level * 100 + level^2 * 10
    // Ex.: level 1 -> 110 XP, level 2 -> 240 XP, level 3 -> 390 XP...
    // Esta fórmula é mais justa e permite subir níveis mais facilmente
    requiredXp(level: number) {
        // Usa as variáveis da config (agora com defaults no ConfigManager)
        const base = this.config.LEVEL_BASE_XP || 100;
        const multiplier = this.config.LEVEL_XP_MULTIPLIER || 10;

        if (level >= this.maxLevel) return Infinity;

        // Fórmula polinomial otimizada: (level * base) + (level^2 * multiplier)
        // Se nível for 0, o XP necessário para o nível 1 é o baseXP (ex: 100)
        // Se a config falhar, garantimos que nunca retorne 0
        const req = Math.floor((level * base) + (Math.pow(level, 2) * multiplier));
        return Math.max(req, base);
    }

    awardXp(gid: string, uid: string, xpAmount: number = 10) {
        const rec = this.getGroupRecord(gid, uid, true);
        rec.xp = (rec.xp || 0) + xpAmount;
        let leveled = false;

        // Permitir múltiplos level-ups se receber muito XP de uma vez
        while (rec.level < this.maxLevel) {
            const req = this.requiredXp(rec.level || 0);
            if (!isFinite(req)) break;
            if (rec.xp >= req) {
                rec.xp = rec.xp - req; // mantém overflow de XP
                rec.level = (rec.level || 0) + 1;
                leveled = true;
                continue; // verifica próximo nível
            }
            break;
        }

        // Se atingiu nível máximo, zera XP para evitar overflow
        if (rec.level >= this.maxLevel) {
            rec.level = this.maxLevel;
            rec.xp = 0;
        }

        this.saveRecord(rec);
        return { rec, leveled };
    }

    /**
     * Verifica se o socket está conectado e pronto
     */
    private _checkSocket(sock: any): boolean {
        if (!sock) {
            this.logger.warn('⚠️ [LevelSystem] Socket não disponível');
            return false;
        }

        if (typeof sock.groupUpdateDescription !== 'function') {
            this.logger.warn('⚠️ [LevelSystem] Socket não tem groupUpdateDescription');
            return false;
        }

        return true;
    }

    // Auto-ADM promotion window logic
    // REGRA: Cada usuário tem APENAS uma chance em 3 dias para chegar ao nível 60
    // Se falhar, NUNCA mais poderá tentar novamente para se tornar ADM
    async registerMaxLevelUser(gid: string, uid: string, userName: string, sock: any) {
        let normUid = JidUtils.toNumeric(uid);
        try {
            const failedPath = path.join(this.config.DATABASE_FOLDER, 'datauser', 'level_adm_failed.json');

            // ═══ VERIFICA SE JÁ FALHOU ANTES ═══
            // Se falhou uma vez, nunca mais pode tentar
            try {
                if (fs.existsSync(failedPath)) {
                    const failedData = JSON.parse(fs.readFileSync(failedPath, 'utf8') || '{}');
                    if (failedData[normUid] && failedData[normUid].failed === true) {
                        const failedDate = new Date(failedData[normUid].failedAt).toLocaleDateString('pt-BR');
                        return {
                            success: false,
                            message: `❌ Você já teve sua chance e falhou em ${failedDate}.\n\n⚠️ Não há mais tentativas disponíveis para se tornar ADM via level.`,
                            permanentFailure: true
                        };
                    }
                }
            } catch (e: any) {
                // Continua mesmo se falhar a leitura
            }

            // ═══ INICIA JANELA DE 3 DIAS ═══
            if (!this.promos[gid]) {
                this.promos[gid] = {
                    windowStart: Date.now(),
                    windowEnd: Date.now() + (this.windowDays * 24 * 60 * 60 * 1000),
                    maxLevelUsers: [],
                    promotedToADM: [],
                    failedUsers: []
                };
            }

            const window = this.promos[gid];

            // ═══ SE JANELA EXPIROU, REGISTRA FALHA PERMANENTE ═══
            if (Date.now() > window.windowEnd) {
                // Verificar quem estava na janela e registrar falhas permanentes
                const failedUsersInWindow = window.maxLevelUsers || [];

                // Salvar falhas permanentes para usuários que não foram promovidos
                let failedData: { [key: string]: any } = {};
                try {
                    if (fs.existsSync(failedPath)) {
                        failedData = JSON.parse(fs.readFileSync(failedPath, 'utf8') || '{}');
                    }
                } catch (e: any) {
                    failedData = {};
                }

                // Registrar falha permanente para todos que estavam na janela mas não foram promovidos
                for (const user of failedUsersInWindow) {
                    const wasPromoted = window.promotedToADM && window.promotedToADM.includes(user.uid);
                    if (!wasPromoted) {
                        failedData[user.uid] = {
                            failed: true,
                            failedAt: Date.now(),
                            groupId: gid,
                            levelReached: this.maxLevel,
                            reason: 'Janela de 3 dias expirada sem promoção a ADM'
                        };
                    }
                }

                // Salvar arquivo de falhas
                try {
                    const failedDir = path.dirname(failedPath);
                    if (!fs.existsSync(failedDir)) {
                        fs.mkdirSync(failedDir, { recursive: true });
                    }
                    fs.writeFileSync(failedPath, JSON.stringify(failedData, null, 2));
                } catch (e: any) {
                    this.logger.warn('LevelSystem: erro ao salvar falhas:', e.message);
                }

                // Resetar janela
                this.promos[gid] = {
                    windowStart: Date.now(),
                    windowEnd: Date.now() + (this.windowDays * 24 * 60 * 60 * 1000),
                    maxLevelUsers: [],
                    promotedToADM: [],
                    failedUsers: []
                };
            }

            // ═══ VERIFICAÇÕES ═══
            if (window.promotedToADM.includes(normUid)) {
                return { success: false, message: '❌ Você já foi promovido a ADM nesta janela.' };
            }

            // Adiciona usuário à lista de max level users
            if (!window.maxLevelUsers.find((u: any) => JidUtils.toNumeric(u.uid) === normUid)) {
                window.maxLevelUsers.push({
                    uid: normUid,
                    userName,
                    timestamp: Date.now(),
                    position: window.maxLevelUsers.length + 1
                });
            }

            const cfg = this._load(path.join(this.config.DATABASE_FOLDER, 'datauser', 'level_adm_config.json'), {});
            const auto = cfg[gid]?.autoADMEnabled === true;

            this._save(this.promoPath, this.promos);

            // ═══ PROMOÇÃO A ADM ═══
            if (auto && window.maxLevelUsers.length <= this.topForAdm) {
                const positionInMaxLevel = window.maxLevelUsers.findIndex((u: any) => JidUtils.toNumeric(u.uid) === normUid) + 1;

                // Se o usuário está dentro do Top 3
                if (positionInMaxLevel > 0 && positionInMaxLevel <= this.topForAdm) {
                    try {
                        // Verifica se este usuário já foi promovido nesta janela para evitar loops
                        if (window.promotedToADM.includes(normUid)) {
                            return { success: true, promoted: true, message: `✅ Você já é um Auto-ADM nesta janela (Top ${positionInMaxLevel}).` };
                        }

                        // 1. Registra a promoção nos dados
                        window.promotedToADM.push(normUid);
                        this._save(this.promoPath, this.promos);

                        // 2. Realiza a promoção técnica no WhatsApp
                        if (this._checkSocket(sock)) {
                            // Promoção Real
                            await sock.groupParticipantsUpdate(gid, [uid], 'promote')
                                .then(() => {
                                    this.logger.info(`✨ [LevelSystem] Usuário @${normUid} promovido a ADM via Level em ${gid}`);
                                })
                                .catch((err: any) => {
                                    this.logger.error(`🚨 [LevelSystem] Falha na promoção técnica: ${err.message}`);
                                });

                            // Atualiza Descrição (Histórico)
                            sock.groupUpdateDescription(gid, `Akira Auto-ADM: ${userName} (Nível ${this.maxLevel} - Top ${positionInMaxLevel}/${this.topForAdm})`)
                                .catch(() => { });

                            // Notifica o grupo com menção
                            const msgPromo = `👑 *NOVO ADMINISTRADOR DETECTADO!* 👑\n\n` +
                                `🔥 [@${normUid}] atingiu o Nível Máximo (*${this.maxLevel}*) e conquistou sua vaga no **TOP ${positionInMaxLevel}** deste grupo!\n\n` +
                                `🛡️ *Privilégios Administrativos Concedidos.*\n\n` +
                                `🎯 *Janela:* 3 Dias\n` +
                                `🏆 *Vagas Restantes:* ${this.topForAdm - positionInMaxLevel}/${this.topForAdm}`;

                            await sock.sendMessage(gid, { text: msgPromo, mentions: [uid] });
                        }

                        return {
                            success: true,
                            promoted: true,
                            position: positionInMaxLevel,
                            message: `🎉 PARABÉNS! Você conquistou sua vaga como ADM! (Top ${positionInMaxLevel}/${this.topForAdm})`
                        };
                    } catch (e: any) {
                        this.logger.error('❌ [LevelSystem] Erro ao promover ADM:', e.message);
                        return { success: false, message: '❌ Erro ao processar promoção administrativa.' };
                    }
                }
            }

            // ═══ STATUS ATUAL ═══
            const daysRemaining = Math.ceil((window.windowEnd - Date.now()) / (24 * 60 * 60 * 1000));
            return {
                success: true,
                promoted: false,
                message: `📊 Max level registrado!\n\n🎯 Posição: ${window.maxLevelUsers.length}/${this.topForAdm}\n⏰ Tempo restante: ${daysRemaining} dias\n\n⚠️ Atenção: Esta é sua ÚNICA chance em 3 dias para se tornar ADM!\nSe a janela expirar sem você estar no Top ${this.topForAdm}, NÃO haverá mais tentativas.`,
                daysRemaining,
                position: window.maxLevelUsers.length,
                maxPositions: this.topForAdm
            };
        } catch (e: any) {
            this.logger.error('❌ [LevelSystem] Erro em registerMaxLevelUser:', e.message);
            return { success: false, message: e.message };
        }
    }

    // Retorna o nome da patente baseado no nível
    getPatente(nivelAtual: number) {
        let patt = 'Recruta 🔰';
        if (nivelAtual >= 61) patt = 'A Lenda  легенда 🛐';
        else if (nivelAtual >= 60) patt = 'Transcendente V ✨';
        else if (nivelAtual >= 59) patt = 'Transcendente IV ✨';
        else if (nivelAtual >= 58) patt = 'Transcendente III ✨';
        else if (nivelAtual >= 57) patt = 'Transcendente II ✨';
        else if (nivelAtual >= 56) patt = 'Transcendente I ✨';
        else if (nivelAtual >= 55) patt = 'Divino V 💠';
        else if (nivelAtual >= 54) patt = 'Divino IV 💠';
        else if (nivelAtual >= 53) patt = 'Divino III 💠';
        else if (nivelAtual >= 52) patt = 'Divino II 💠';
        else if (nivelAtual >= 51) patt = 'Divino I 💠';
        else if (nivelAtual >= 50) patt = 'Imortal V ⚡';
        else if (nivelAtual >= 49) patt = 'Imortal IV ⚡';
        else if (nivelAtual >= 48) patt = 'Imortal III ⚡';
        else if (nivelAtual >= 47) patt = 'Imortal II ⚡';
        else if (nivelAtual >= 46) patt = 'Imortal I ⚡';
        else if (nivelAtual >= 45) patt = 'Lendário V 🎖️';
        else if (nivelAtual >= 44) patt = 'Lendário IV 🎖️';
        else if (nivelAtual >= 43) patt = 'Lendário III 🎖️';
        else if (nivelAtual >= 42) patt = 'Lendário II 🎖️';
        else if (nivelAtual >= 41) patt = 'Lendário I 🎖️';
        else if (nivelAtual >= 40) patt = 'God V 🕴️';
        else if (nivelAtual >= 39) patt = 'God IV 🕴️';
        else if (nivelAtual >= 38) patt = 'God III 🕴️';
        else if (nivelAtual >= 37) patt = 'God II 🕴️';
        else if (nivelAtual >= 36) patt = 'God I 🕴️';
        else if (nivelAtual >= 35) patt = 'Mítico V 🔮';
        else if (nivelAtual >= 34) patt = 'Mítico IV 🔮';
        else if (nivelAtual >= 33) patt = 'Mítico III 🔮';
        else if (nivelAtual >= 32) patt = 'Mítico II 🔮';
        else if (nivelAtual >= 31) patt = 'Mítico I 🔮';
        else if (nivelAtual >= 30) patt = 'Mestre V 🐂';
        else if (nivelAtual >= 29) patt = 'Mestre IV 🐂';
        else if (nivelAtual >= 28) patt = 'Mestre III 🐂';
        else if (nivelAtual >= 27) patt = 'Mestre II 🐂';
        else if (nivelAtual >= 26) patt = 'Mestre I 🐂';
        else if (nivelAtual >= 25) patt = 'Diamante V 💎';
        else if (nivelAtual >= 24) patt = 'Diamante IV 💎';
        else if (nivelAtual >= 23) patt = 'Diamante III 💎';
        else if (nivelAtual >= 22) patt = 'Diamante II 💎';
        else if (nivelAtual >= 21) patt = 'Diamante I 💎';
        else if (nivelAtual >= 20) patt = 'Campeão V 🏆';
        else if (nivelAtual >= 19) patt = 'Campeão IV 🏆';
        else if (nivelAtual >= 18) patt = 'Campeão III 🏆';
        else if (nivelAtual >= 17) patt = 'Campeão II 🏆';
        else if (nivelAtual >= 16) patt = 'Campeão I 🏆';
        else if (nivelAtual >= 15) patt = 'Ouro V 🥇';
        else if (nivelAtual >= 14) patt = 'Ouro IV 🥇';
        else if (nivelAtual >= 13) patt = 'Ouro III 🥇';
        else if (nivelAtual >= 12) patt = 'Ouro II 🥇';
        else if (nivelAtual >= 11) patt = 'Ouro I 🥇';
        else if (nivelAtual >= 10) patt = 'Prata V 🥈';
        else if (nivelAtual >= 9) patt = 'Prata IV 🥈';
        else if (nivelAtual >= 8) patt = 'Prata III 🥈';
        else if (nivelAtual >= 7) patt = 'Prata II 🥈';
        else if (nivelAtual >= 6) patt = 'Prata I 🥈';
        else if (nivelAtual >= 5) patt = 'Bronze V 🥉';
        else if (nivelAtual >= 4) patt = 'Bronze IV 🥉';
        else if (nivelAtual >= 3) patt = 'Bronze III 🥉';
        else if (nivelAtual >= 2) patt = 'Bronze II 🥉';
        else if (nivelAtual >= 1) patt = 'Bronze I 🥉';

        return patt;
    }

    // status info
    getStatus(gid: string) {
        const window = this.promos[gid];
        if (!window) return { isActive: false };
        const daysRemaining = Math.max(0, Math.ceil((window.windowEnd - Date.now()) / (24 * 60 * 60 * 1000)));
        return { isActive: true, daysRemaining, maxLevelUsers: window.maxLevelUsers, promotedToADM: window.promotedToADM, failedUsers: window.failedUsers };
    }
    /**
     * Ativa/Desativa o sistema de Auto-ADM por grupo
     */
    public setAutoADM(gid: string, enabled: boolean): boolean {
        try {
            const configPath = path.join(this.config.DATABASE_FOLDER, 'datauser', 'level_adm_config.json');
            const cfg = this._load(configPath, {});

            if (!cfg[gid]) cfg[gid] = {};
            cfg[gid].autoADMEnabled = enabled;
            cfg[gid].updatedAt = Date.now();

            this._save(configPath, cfg);
            return true;
        } catch (e: any) {
            this.logger.error(`🚨 [LevelSystem] Erro ao salvar config de Auto-ADM: ${e.message}`);
            return false;
        }
    }

    public isAutoADMEnabled(gid: string): boolean {
        const configPath = path.join(this.config.DATABASE_FOLDER, 'datauser', 'level_adm_config.json');
        const cfg = this._load(configPath, {});
        return cfg[gid]?.autoADMEnabled === true;
    }
}

export default LevelSystem;
