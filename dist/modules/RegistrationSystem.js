import fs from 'fs';
import path from 'path';
import ConfigManager from './ConfigManager.js';
class RegistrationSystem {
    config;
    logger;
    dbPath;
    users;
    sock;
    constructor(logger = console) {
        this.config = ConfigManager.getInstance();
        this.logger = logger;
        // HF SPACES: Usar /tmp para garantir permissões de escrita, ou DATABASE_FOLDER local
        const basePath = this.config.DATABASE_FOLDER || './database';
        this.dbPath = path.join(basePath, 'datauser', 'registered.json');
        this._ensureFiles();
        this.users = this._load(this.dbPath, []);
    }
    setSocket(sock) {
        this.sock = sock;
    }
    _ensureFiles() {
        try {
            const dir = path.dirname(this.dbPath);
            if (!fs.existsSync(dir))
                fs.mkdirSync(dir, { recursive: true });
            if (!fs.existsSync(this.dbPath))
                fs.writeFileSync(this.dbPath, JSON.stringify([], null, 2));
        }
        catch (e) {
            this.logger.warn('RegistrationSystem: erro ao garantir arquivos:', e.message);
        }
    }
    _load(p, fallback) {
        try {
            const raw = fs.readFileSync(p, 'utf8');
            return JSON.parse(raw || '[]');
        }
        catch (e) {
            return fallback;
        }
    }
    _save() {
        try {
            fs.writeFileSync(this.dbPath, JSON.stringify(this.users, null, 2));
        }
        catch (e) {
            this.logger.warn('RegistrationSystem save erro:', e.message);
        }
    }
    /**
     * Generate a unique serial number
     */
    generateSerial() {
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
    generateLink(serial) {
        return `https://wa.me/${serial}`;
    }
    /**
     * Register a new user (alias for registerUser for compatibility)
     * Auto-generates serial if not provided
     */
    register(uid, name, age, serial) {
        return this.registerUser(uid, name, age, serial);
    }
    registerUser(uid, name, age, serial) {
        const existing = this.users.find(u => u.id === uid);
        if (existing) {
            return { success: false, message: 'Usuário já registrado.' };
        }
        // Auto-generate serial if not provided
        const userSerial = serial || this.generateSerial();
        const userLink = this.generateLink(userSerial);
        const now = new Date().toISOString();
        const newUser = {
            id: uid,
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
    getProfile(uid) {
        return this.getUser(uid);
    }
    isRegistered(uid) {
        // Normaliza UID para multi-device
        const normalizedUid = uid.split(':')[0] + (uid.includes('@') ? '' : '@s.whatsapp.net');
        return !!this.users.find(u => u.id.split(':')[0] === normalizedUid.split(':')[0]);
    }
    getUser(uid) {
        const normalizedUid = uid.split(':')[0];
        return this.users.find(u => u.id.split(':')[0] === normalizedUid);
    }
    unregisterUser(uid) {
        const normalizedUid = uid.split(':')[0];
        const index = this.users.findIndex(u => u.id.split(':')[0] === normalizedUid);
        if (index > -1) {
            this.users.splice(index, 1);
            this._save();
            return true;
        }
        return false;
    }
    getTotalUsers() {
        return this.users.length;
    }
}
export default RegistrationSystem;
