/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MÓDULO: BotProfile.ts
 * ═══════════════════════════════════════════════════════════════════════════
 * Gerencia o perfil da Akira: foto, nome, bio
 * Apenas o DONO pode alterar estas configurações
 * ═══════════════════════════════════════════════════════════════════════════
 */

import ConfigManager from './ConfigManager.js';
import JidUtils from './JidUtils.js';

class BotProfile {
    public sock: any;
    public config: any;
    public logger: any;

    constructor(sock: any, logger: any = console, config: any = null) {
        this.sock = sock;
        this.logger = logger;
        this.config = config || ConfigManager.getInstance();
    }

    setSocket(sock: any): void {
        this.sock = sock;
    }

    /**
    * Verifica se o bot está conectado
    */
    isConnected(): any {
        return this.sock?.user?.id;
    }

    /**
    * Obtém JID do bot
    */
    getBotJid(): string | null {
        return JidUtils.normalize(this.sock?.user?.id || null);
    }

    /**
    * Obtém foto atual do bot
    */
    async getBotPhoto(): Promise<any> {
        try {
            if (!this.isConnected()) {
                return { success: false, error: 'Bot não conectado' };
            }

            const photoUrl = await this.sock?.profilePictureUrl(this.getBotJid(), 'image');
            return {
                success: true,
                hasPhoto: !!photoUrl,
                url: photoUrl || null
            };
        } catch (e: any) {
            this.logger?.error('❌ Erro ao obter foto do bot:', e.message);
            return { success: false, error: e.message, hasPhoto: false };
        }
    }

    /**
    * Obtém nome atual do bot
    */
    getBotName(): any {
        if (!this.isConnected()) {
            return { success: false, error: 'Bot não conectado' };
        }

        return {
            success: true,
            name: this.sock?.user?.name || this.config?.BOT_NAME
        };
    }

    /**
    * Obtém bio/status atual do bot
    */
    async getBotStatus(): Promise<any> {
        try {
            if (!this.isConnected()) {
                return { success: false, error: 'Bot não conectado' };
            }

            const status = await this.sock?.fetchStatus(this.getBotJid());
            return {
                success: true,
                status: status?.status || 'Sem status'
            };
        } catch (e: any) {
            this.logger?.warn('⚠️ Erro ao obter status do bot:', e.message);
            return { success: false, error: e.message, status: 'Indisponível' };
        }
    }

    /**
    * Define foto do bot
    */
    async setBotPhoto(imageBuffer: Buffer): Promise<any> {
        try {
            if (!this.isConnected()) {
                return { success: false, error: 'Bot não conectado' };
            }

            // Validar que é uma imagem
            if (!imageBuffer || imageBuffer.length === 0) {
                return { success: false, error: 'Buffer de imagem vazio ou inválido' };
            }

            // Verificar se é realmente uma imagem (magic numbers)
            // const validImageTypes = ['image/jpeg', 'image/png', 'image/webp'];
            // Os primeiros bytes podem indicar o tipo
            const isJpg = imageBuffer[0] === 0xFF && imageBuffer[1] === 0xD8;
            const isPng = imageBuffer[0] === 0x89 && imageBuffer[1] === 0x50;
            const isWebp = imageBuffer[0] === 0x52 && imageBuffer[1] === 0x49;

            if (!isJpg && !isPng && !isWebp) {
                return { success: false, error: 'Formato de imagem não suportado. Use JPG, PNG ou WebP.' };
            }

            await this.sock?.updateProfilePicture(this.getBotJid(), imageBuffer);

            this.logger?.info(`✅ Foto do bot atualizada`);
            return {
                success: true,
                message: `✅ *FOTO DA AKIRA ATUALIZADA!*\n\n📸 A foto de perfil foi alterada com sucesso.`
            };
        } catch (e: any) {
            this.logger?.error('❌ Erro ao definir foto do bot:', e.message);
            return { success: false, error: e.message };
        }
    }

    /**
    * Define nome do bot
    */
    async setBotName(newName: string): Promise<any> {
        try {
            if (!this.isConnected()) {
                return { success: false, error: 'Bot não conectado' };
            }

            // Validar nome
            if (!newName || newName.trim().length === 0) {
                return { success: false, error: 'Nome não pode estar vazio' };
            }

            // Limite do WhatsApp é 25 caracteres
            const maxLength = 25;
            if (newName.length > maxLength) {
                newName = newName.substring(0, maxLength);
                this.logger?.info(`📝 Nome truncado para ${maxLength} caracteres`);
            }

            await this.sock?.updateProfileName(newName);

            this.logger?.info(`✅ Nome do bot alterado para: ${newName}`);
            return {
                success: true,
                message: `✅ *NOME DA AKIRA ALTERADO!*\n\n🤖 Novo nome: *${newName}*`
            };
        } catch (e: any) {
            this.logger?.error('❌ Erro ao definir nome do bot:', e.message);
            return { success: false, error: e.message };
        }
    }

    /**
    * Define bio/status do bot
    */
    async setBotStatus(newStatus: string): Promise<any> {
        try {
            if (!this.isConnected()) {
                return { success: false, error: 'Bot não conectado' };
            }

            // Validar status
            if (!newStatus || newStatus.trim().length === 0) {
                return { success: false, error: 'Status não pode estar vazio' };
            }

            // Limite do WhatsApp é 139 caracteres
            const maxLength = 139;
            if (newStatus.length > maxLength) {
                newStatus = newStatus.substring(0, maxLength);
                this.logger?.info(`📝 Status truncado para ${maxLength} caracteres`);
            }

            await this.sock?.updateProfileStatus(newStatus);

            this.logger?.info(`✅ Status do bot alterado para: ${newStatus}`);
            return {
                success: true,
                message: `✅ *BIO DA AKIRA ATUALIZADA!*\n\n📝 Nova bio:\n\`${newStatus}\``
            };
        } catch (e: any) {
            this.logger?.error('❌ Erro ao definir status do bot:', e.message);
            return { success: false, error: e.message };
        }
    }

    /**
    * Obtém informações completas do bot
    */
    async getBotInfo(): Promise<any> {
        try {
            if (!this.isConnected()) {
                return { success: false, error: 'Bot não conectado' };
            }

            const [photoResult, statusResult] = await Promise.all([
                this.getBotPhoto(),
                this.getBotStatus()
            ]);

            const botJid = this.getBotJid();
            const number = JidUtils.getNumber(botJid);

            return {
                success: true,
                jid: botJid,
                number: number,
                name: this.sock?.user?.name || this.config?.BOT_NAME,
                hasPhoto: photoResult.hasPhoto,
                photoUrl: photoResult.url,
                status: statusResult.status,
                isConnected: true
            };
        } catch (e: any) {
            this.logger?.error('❌ Erro ao obter informações do bot:', e.message);
            return { success: false, error: e.message };
        }
    }

    /**
    * Formata mensagem de informações do bot
    */
    formatBotInfoMessage(botInfo: any): string {
        if (!botInfo.success) {
            return `❌ Erro ao obter informações: ${botInfo.error}`;
        }

        let message = `🤖 *INFORMAÇÕES DA AKIRA*\n\n`;
        message += `┌─────────────────────────────┐\n`;
        message += `│ 🤖 *Nome:* ${botInfo.name}\n`;
        message += `│ 📱 *Número:* ${botInfo.number}\n`;
        message += `│ 🆔 *JID:* ${botInfo.jid}\n`;
        message += `│ 🟢 *Status:* ${botInfo.isConnected ? 'Online' : 'Offline'}\n`;
        message += `└─────────────────────────────┘\n\n`;

        if (botInfo.hasPhoto) {
            message += `✅ *Foto de perfil:* Configurada\n`;
        } else {
            message += `❌ *Foto de perfil:* Não configurada\n`;
        }

        message += `\n📝 *Bio:*\n`;
        message += `\`${botInfo.status}\`\n`;

        return message;
    }

    /**
    * Gera mensagem de ajuda para comandos do bot
    */
    getHelpMessage(): string {
        return `⚙️ *CONFIGURAÇÕES DA AKIRA (DONO APENAS)*

┌─────────────────────────────┐
│ 📸 *ALTERAR FOTO* │
├─────────────────────────────┤
│ Responda uma imagem com: │
│ #setbotpic │
│ #botpic │
└─────────────────────────────┘

┌─────────────────────────────┐
│ 📝 *ALTERAR NOME* │
├─────────────────────────────┤
│ #setbotname <novo nome> │
│ #botname Meu Novo Nome │
└─────────────────────────────┘

┌─────────────────────────────┐
│ 📋 *ALTERAR BIO* │
├─────────────────────────────┤
│ #setbotbio <nova bio> │
│ #botstatus Olá, sou Akira! │
└─────────────────────────────┘

┌─────────────────────────────┐
│ 👁️ *VER INFORMAÇÕES* │
├─────────────────────────────┤
│ #verbotinfo │
│ #botinfo │
└─────────────────────────────┘

⚠️ *Nota:* Apenas o proprietário (Isaac Quarenta) pode usar estes comandos.`;
    }
}

export default BotProfile;
