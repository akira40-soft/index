import fs from 'fs';
import path from 'path';
import ConfigManager from './ConfigManager.js';
import JidUtils from './JidUtils.js';

interface RegisteredUser {
    id: string;
    name: string;
    age: number;
    serial: string;
    date: string;
    platform: string;
}

class RegistrationSystem {
    private static instance: RegistrationSystem;
    private config: any;
    private logger: any;
    private dbPath: string;
    private users: RegisteredUser[];

    private constructor(logger = console) {
        this.config = ConfigManager.getInstance();
        this.logger = logger;

        // HF SPACES: Usar /tmp para garantir permissões de escrita, ou DATABASE_FOLDER local
        const basePath = this.config.DATABASE_FOLDER || './database';
        this.dbPath = path.join(basePath, 'datauser', 'registered.json');

        this._ensureFiles();
        this.users = this._load(this.dbPath, []);
    }

    public static getInstance(logger = console): RegistrationSystem {
        if (!RegistrationSystem.instance) {
            RegistrationSystem.instance = new RegistrationSystem(logger);
        }
        return RegistrationSystem.instance;
    }

    private _ensureFiles(): void {
        try {
            const dir = path.dirname(this.dbPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            if (!fs.existsSync(this.dbPath)) fs.writeFileSync(this.dbPath, JSON.stringify([], null, 2));
        } catch (e: any) {
            this.logger.warn('RegistrationSystem: erro ao garantir arquivos:', e.message);
        }
    }

    private _load(p: string, fallback: any[]): RegisteredUser[] {
        try {
            const raw = fs.readFileSync(p, 'utf8');
            let loaded = JSON.parse(raw || '[]');

            // ═══════════════════════════════════════════════════════════════════
            // MIGRATION: JID -> NUMERIC ID (Digits Only)
            // ═══════════════════════════════════════════════════════════════════
            if (Array.isArray(loaded)) {
                let migratedCount = 0;
                loaded = loaded.map(u => {
                    const numericId = JidUtils.toNumeric(u.id);
                    if (u.id !== numericId) {
                        u.id = numericId;
                        migratedCount++;
                    }
                    return u;
                });
                if (migratedCount > 0) {
                    this.logger.info(`✨ [RegistrationSystem] Migrados ${migratedCount} registros para ID Numérico.`);
                    this.users = loaded;
                    this._save();
                }
            }
            return loaded;
        } catch (e) {
            return fallback;
        }
    }

    private _save(): void {
        try {
            fs.writeFileSync(this.dbPath, JSON.stringify(this.users, null, 2));
        } catch (e: any) {
            this.logger.warn('RegistrationSystem save erro:', e.message);
        }
    }

    /**
     * Generate a unique serial number
     */
    private generateSerial(): string {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let serial = '';
        for (let i = 0; i < 8; i++) {
            serial += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return serial;
    }

    /**
     * Generate a unique link for the user
     */
    private generateLink(serial: string): string {
        return `https://wa.me/${serial}`;
    }

    /**
     * Register a new user (alias for registerUser for compatibility)
     * Auto-generates serial if not provided
     */
    public register(uid: string, name: string, age: number, serial?: string): { success: boolean; message?: string; user?: RegisteredUser, link?: string } {
        return this.registerUser(uid, name, age, serial);
    }

    public registerUser(uid: string, name: string, age: number, serial?: string): { success: boolean; message?: string, user?: any, link?: string } {
        const numericId = JidUtils.toNumeric(uid);
        const existing = this.users.find(u => JidUtils.toNumeric(u.id) === numericId);
        if (existing) {
            return { success: false, message: 'Usuário já registrado.' };
        }

        // Auto-generate serial if not provided
        const userSerial = serial || this.generateSerial();
        const userLink = this.generateLink(userSerial);
        const now = new Date().toISOString();

        const newUser: any = {
            id: numericId,
            name: name,
            age: age,
            serial: userSerial,
            link: userLink,
            registeredAt: now,
            date: now,
            platform: 'WhatsApp'
        };

        this.users.push(newUser);
        this._save();

        return { success: true, user: newUser, link: userLink };
    }

    /**
     * Get user profile (alias for getUser for compatibility)
     */
    public getProfile(uid: string): any | undefined {
        return this.getUser(uid);
    }

    public isRegistered(uid: string): boolean {
        const numericId = JidUtils.toNumeric(uid);
        return !!this.users.find(u => JidUtils.toNumeric(u.id) === numericId);
    }

    public getUser(uid: string): RegisteredUser | undefined {
        const numericId = JidUtils.toNumeric(uid);
        return this.users.find(u => JidUtils.toNumeric(u.id) === numericId);
    }

    public unregisterUser(uid: string): boolean {
        const numericId = JidUtils.toNumeric(uid);
        const index = this.users.findIndex(u => JidUtils.toNumeric(u.id) === numericId);
        if (index > -1) {
            this.users.splice(index, 1);
            this._save();
            return true;
        }
        return false;
    }

    public getTotalUsers(): number {
        return this.users.length;
    }
}

export default RegistrationSystem;
