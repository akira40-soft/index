/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MÓDULO: UserProfile.js
 * ═══════════════════════════════════════════════════════════════════════════
 * Obtém e exibe dados de perfil de usuários: foto, nome, bio, número
 * ═══════════════════════════════════════════════════════════════════════════
 */
import ConfigManager from './ConfigManager.js';
import JidUtils from './JidUtils.js';
class UserProfile {
    sock;
    config;
    logger;
    constructor(sock, logger = console, config = null) {
        this.sock = sock;
        this.logger = logger;
        this.config = config || ConfigManager.getInstance();
    }
    setSocket(sock) {
        this.sock = sock;
    }
    /**
    * Formata JID para número legível
    */
    formatJidToNumber(jid) {
        if (!jid)
            return 'Desconhecido';
        return JidUtils.getNumber(jid);
    }
    /**
    * Formata número para JID
    */
    formatNumberToJid(number) {
        if (!number)
            return null;
        // Remove caracteres não numéricos
        const cleaned = number.replace(/\D/g, '');
        // Adiciona sufixo do WhatsApp
        return `${cleaned}@s.whatsapp.net`;
    }
    /**
    * Obtém foto de perfil do usuário
    */
    async getProfilePicture(userJid) {
        try {
            const photoUrl = await this.sock?.profilePictureUrl(userJid, 'image');
            return {
                success: true,
                hasPhoto: !!photoUrl,
                url: photoUrl || null
            };
        }
        catch (e) {
            this.logger?.warn(`⚠️ Erro ao obter foto de ${userJid}:`, e.message);
            return { success: false, error: e.message, hasPhoto: false, url: null };
        }
    }
    /**
    * Obtém foto em miniatura
    */
    async getProfileThumbnail(userJid) {
        try {
            const photoUrl = await this.sock?.profilePictureUrl(userJid, 'preview');
            return {
                success: true,
                hasPhoto: !!photoUrl,
                url: photoUrl || null
            };
        }
        catch (e) {
            return { success: false, error: e.message, hasPhoto: false, url: null };
        }
    }
    /**
    * Obtém status/bio do usuário
    */
    async getStatus(userJid) {
        try {
            const status = await this.sock?.fetchStatus(userJid);
            return {
                success: true,
                status: status?.status || 'Sem status',
                setAt: status?.date ? new Date(status.date).toLocaleString('pt-BR') : 'Desconhecido'
            };
        }
        catch (e) {
            this.logger?.warn(`⚠️ Erro ao obter status de ${userJid}:`, e.message);
            return { success: false, error: e.message, status: 'Indisponível', setAt: 'Desconhecido' };
        }
    }
    /**
    * Obtém informações do perfil do usuário
    */
    async getUserInfo(userJid) {
        try {
            const [photoResult, statusResult] = await Promise.all([
                this.getProfilePicture(userJid),
                this.getStatus(userJid)
            ]);
            return {
                success: true,
                jid: JidUtils.normalize(userJid),
                number: JidUtils.getNumber(userJid),
                hasPhoto: photoResult.hasPhoto,
                photoUrl: photoResult.url,
                status: statusResult.status,
                statusSetAt: statusResult.setAt
            };
        }
        catch (e) {
            this.logger?.error('❌ Erro ao obter informações do usuário:', e.message);
            return { success: false, error: e.message, jid: userJid, number: 'Erro', hasPhoto: false, photoUrl: null, status: 'Erro', statusSetAt: 'Desconhecido' };
        }
    }
    /**
    * Gera mensagem formatada com dados do usuário
    */
    formatUserDataMessage(userInfo, requesterName = 'Usuário') {
        if (!userInfo.success) {
            return `❌ Erro ao obter dados do usuário: ${userInfo.error}`;
        }
        let message = `👤 *DADOS DO USUÁRIO*\n\n`;
        message += `┌─────────────────────────────┐\n`;
        message += `│ 📱 *Número:* ${userInfo.number}\n`;
        message += `│ 🆔 *JID:* ${userInfo.jid}\n`;
        message += `└─────────────────────────────┘\n\n`;
        if (userInfo.hasPhoto) {
            message += `✅ *Foto de perfil:* Disponível\n`;
        }
        else {
            message += `❌ *Foto de perfil:* Não disponível\n`;
        }
        message += `\n📝 *Bio/Status:*\n`;
        message += `\`${userInfo.status}\`\n`;
        if (userInfo.statusSetAt && userInfo.statusSetAt !== 'Desconhecido') {
            message += `\n📅 *Definido em:* ${userInfo.statusSetAt}\n`;
        }
        return message;
    }
    /**
    * Gera mensagem formatada apenas com foto
    */
    formatPhotoMessage(userInfo, requesterName = 'Usuário') {
        if (!userInfo.success) {
            return `❌ Erro ao obter foto: ${userInfo.error}`;
        }
        let message = `📸 *FOTO DE PERFIL*\n\n`;
        message += `┌─────────────────────────────┐\n`;
        message += `│ 📱 *Número:* ${userInfo.number}\n`;
        message += `└─────────────────────────────┘\n\n`;
        if (userInfo.hasPhoto) {
            message += `✅ *Foto disponível*\n`;
            message += `\n💡 Responda esta mensagem com #toimg para converter sticker em imagem.`;
        }
        else {
            message += `❌ *Usuário não tem foto de perfil*`;
        }
        return message;
    }
    /**
    * Gera mensagem formatada com bio
    */
    formatBioMessage(userInfo, requesterName = 'Usuário') {
        if (!userInfo.success) {
            return `❌ Erro ao obter bio: ${userInfo.error}`;
        }
        let message = `📝 *BIOGRAFIA*\n\n`;
        message += `┌─────────────────────────────┐\n`;
        message += `│ 📱 *Número:* ${userInfo.number}\n`;
        message += `└─────────────────────────────┘\n\n`;
        message += `*Status:*\n`;
        message += `\`${userInfo.status}\`\n`;
        if (userInfo.statusSetAt && userInfo.statusSetAt !== 'Desconhecido') {
            message += `\n📅 *Última atualização:* ${userInfo.statusSetAt}\n`;
        }
        return message;
    }
    /**
    * Processa comando de dados de usuário
    */
    async handleUserData(userJid, replyToMessage = null) {
        const userInfo = await this.getUserInfo(userJid);
        const message = this.formatUserDataMessage(userInfo);
        const result = { success: userInfo.success, message };
        if (userInfo.hasPhoto && userInfo.photoUrl) {
            result.photoUrl = userInfo.photoUrl;
        }
        return result;
    }
    /**
    * Processa comando de foto de perfil
    */
    async handleProfilePhoto(userJid) {
        const photoResult = await this.getProfilePicture(userJid);
        if (!photoResult.success) {
            return { success: false, message: `❌ Erro ao obter foto: ${photoResult.error}` };
        }
        let message = `📸 *FOTO DE PERFIL*\n\n`;
        message += `┌─────────────────────────────┐\n`;
        message += `│ 📱 *Número:* ${this.formatJidToNumber(userJid)}\n`;
        message += `└─────────────────────────────┘\n\n`;
        if (photoResult.hasPhoto) {
            message += `✅ *Foto encontrada!*`;
        }
        else {
            message += `❌ *Usuário não tem foto de perfil configurada*`;
        }
        return {
            success: true,
            message,
            photoUrl: photoResult.url,
            hasPhoto: photoResult.hasPhoto
        };
    }
    /**
    * Processa comando de biografia
    */
    async handleUserBio(userJid) {
        const statusResult = await this.getStatus(userJid);
        let message = `📝 *BIOGRAFIA*\n\n`;
        message += `┌─────────────────────────────┐\n`;
        message += `│ 📱 *Número:* ${this.formatJidToNumber(userJid)}\n`;
        message += `└─────────────────────────────┘\n\n`;
        if (statusResult.success) {
            message += `*Status:* ${statusResult.status}`;
            if (statusResult.setAt && statusResult.setAt !== 'Desconhecido') {
                message += `\n\n📅 *Última atualização:* ${statusResult.setAt}`;
            }
        }
        else {
            message += `❌ *Erro ao obter status:* ${statusResult.error}`;
        }
        return { success: true, message };
    }
    /**
    * Extrai JID de menção ou citação
    */
    extractUserJidFromMessage(message, m) {
        // Prioridade 1: Menção explícita (@)
        if (message?.extendedTextMessage?.contextInfo?.mentionedJid?.length > 0) {
            return message.extendedTextMessage.contextInfo.mentionedJid[0];
        }
        // Prioridade 2: Resposta a mensagem (citação)
        if (m?.message?.extendedTextMessage?.contextInfo?.participant) {
            return m.message.extendedTextMessage.contextInfo.participant;
        }
        // Prioridade 3: Se for citação direta
        if (m?.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
            // Obter autor da mensagem citada
            return m.message.extendedTextMessage.contextInfo.participant;
        }
        return null;
    }
}
export default UserProfile;
