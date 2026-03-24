import fs from 'fs';
import path from 'path';
import ConfigManager from './ConfigManager.js';

class EconomySystem {
    private static instance: EconomySystem;
    public config: any;
    public logger: any;
    public dbPath: string;
    public users: any;
    public dailyAmount: number;
    public dailyCooldown: number;

    private constructor(logger: any = console) {
        this.config = ConfigManager.getInstance();
        this.logger = logger;

        // Configurar persistência centralizada
        const basePath = this.config.DATABASE_FOLDER || './database';
        this.dbPath = path.join(basePath, 'economy', 'economy.json');

        this._ensureFiles();
        this.users = this._load(this.dbPath, {});

        // Configurações
        this.dailyAmount = 500; // Moedas por daily
        this.dailyCooldown = 24 * 60 * 60 * 1000; // 24 horas
    }

    public static getInstance(logger: any = console): EconomySystem {
        if (!EconomySystem.instance) {
            EconomySystem.instance = new EconomySystem(logger);
        }
        return EconomySystem.instance;
    }

    _ensureFiles() {
        try {
            const dir = path.dirname(this.dbPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            if (!fs.existsSync(this.dbPath)) {
                fs.writeFileSync(this.dbPath, JSON.stringify({}, null, 2));
            }
        } catch (e: any) {
            this.logger.warn('EconomySystem: erro ao garantir arquivos:', e.message);
        }
    }

    _load(filePath: string, fallback: any) {
        try {
            if (!fs.existsSync(filePath)) return fallback;
            const raw = fs.readFileSync(filePath, 'utf8');
            return JSON.parse(raw || JSON.stringify(fallback));
        } catch (e: any) {
            this.logger.warn(`EconomySystem: erro ao ler ${filePath}:`, e.message);
            return fallback;
        }
    }

    _save() {
        try {
            // async save to avoid blocking main thread
            fs.promises.writeFile(this.dbPath, JSON.stringify(this.users, null, 2)).catch((err) => {
                this.logger?.error('EconomySystem: erro ao salvar (async):', err.message);
            });
        } catch (e: any) {
            this.logger.error('EconomySystem: erro ao salvar:', e.message);
        }
    }

    /**
     * Inicializa usuário se não existir
     */
    _initUser(userId: string) {
        if (!this.users[userId]) {
            this.users[userId] = {
                wallet: 0,
                bank: 0,
                lastDaily: 0,
                transactions: []
            };
        }
        return this.users[userId];
    }

    /**
     * Retorna saldo do usuário
     */
    getBalance(userId: string) {
        const user = this._initUser(userId);
        return {
            wallet: user.wallet,
            bank: user.bank,
            total: user.wallet + user.bank
        };
    }

    /**
     * Adiciona moedas à carteira
     */
    addMoney(userId: string, amount: number) {
        const user = this._initUser(userId);
        user.wallet += amount;
        this._save();
        return user.wallet;
    }

    /**
     * Remove moedas da carteira
     */
    removeMoney(userId: string, amount: number) {
        const user = this._initUser(userId);
        if (user.wallet < amount) {
            return { success: false, error: 'Saldo insuficiente' };
        }
        user.wallet -= amount;
        this._save();
        return { success: true, newBalance: user.wallet };
    }

    /**
     * Recompensa diária
     */
    daily(userId: string) {
        const user = this._initUser(userId);
        const now = Date.now();

        // Verifica cooldown
        if (user.lastDaily && (now - user.lastDaily) < this.dailyCooldown) {
            return {
                success: false,
                error: 'Daily já coletado hoje',
                timeLeft: this.dailyCooldown - (now - user.lastDaily)
            };
        }

        // Adiciona recompensa
        user.wallet += this.dailyAmount;
        user.lastDaily = now;

        user.transactions.push({
            type: 'daily',
            amount: this.dailyAmount,
            timestamp: now
        });

        this._save();

        return {
            success: true,
            amount: this.dailyAmount,
            newBalance: user.wallet
        };
    }

    /**
     * Retorna tempo restante para próximo daily
     */
    getDailyTimeLeft(userId: string) {
        const user = this.users[userId];
        if (!user || !user.lastDaily) return 0;

        const now = Date.now();
        const timeLeft = this.dailyCooldown - (now - user.lastDaily);
        return timeLeft > 0 ? timeLeft : 0;
    }

    /**
     * Transferir moedas entre usuários
     */
    transfer(fromId: string, toId: string, amount: number) {
        if (amount <= 0) {
            return { success: false, error: 'Valor deve ser positivo' };
        }

        const sender = this._initUser(fromId);
        const receiver = this._initUser(toId);

        // Verifica saldo
        if (sender.wallet < amount) {
            return { success: false, error: 'Saldo insuficiente' };
        }

        // Realiza transferência
        sender.wallet -= amount;
        receiver.wallet += amount;

        const now = Date.now();

        sender.transactions.push({
            type: 'transfer_out',
            to: toId,
            amount: amount,
            timestamp: now
        });

        receiver.transactions.push({
            type: 'transfer_in',
            from: fromId,
            amount: amount,
            timestamp: now
        });

        this._save();

        return {
            success: true,
            senderBalance: sender.wallet,
            receiverBalance: receiver.wallet
        };
    }

    /**
     * Depositar na banco
     */
    deposit(userId: string, amount: number) {
        const user = this._initUser(userId);

        if (user.wallet < amount) {
            return { success: false, error: 'Saldo insuficiente na carteira' };
        }

        user.wallet -= amount;
        user.bank += amount;

        this._save();

        return {
            success: true,
            wallet: user.wallet,
            bank: user.bank
        };
    }

    /**
     * Sacar do banco
     */
    withdraw(userId: string, amount: number) {
        const user = this._initUser(userId);

        if (user.bank < amount) {
            return { success: false, error: 'Saldo insuficiente no banco' };
        }

        user.bank -= amount;
        user.wallet += amount;

        this._save();

        return {
            success: true,
            wallet: user.wallet,
            bank: user.bank
        };
    }

    /**
     * Retorna histórico de transações
     */
    getTransactions(userId: string, limit = 10) {
        const user = this.users[userId];
        if (!user || !user.transactions) return [];

        return user.transactions.slice(-limit).reverse();
    }

    /**
     * Retorna ranking de mais ricos
     */
    getRanking(limit = 10) {
        const ranking = Object.entries(this.users)
            .map(([userId, data]: [string, any]) => ({
                userId,
                total: data.wallet + data.bank
            }))
            .sort((a, b) => b.total - a.total)
            .slice(0, limit);

        return ranking;
    }
}

export default EconomySystem;
