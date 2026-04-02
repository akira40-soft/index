/**
 * ═══════════════════════════════════════════════════════════════════════════
 * JID UTILS - NORMALIZAÇÃO DE IDENTIDADE WHATSAPP MULTI-DEVICE
 * ═══════════════════════════════════════════════════════════════════════════
 * ✅ Remove sufixos de dispositivo (:1, :2, etc)
 * ✅ Garante o sufixo @s.whatsapp.net para usuários individuais
 * ✅ Mantém JIDs de grupos (@g.us) intactos
 * ✅ Evita duplicidade de contas em sistemas de Economia, Level e Jogos
 * ═══════════════════════════════════════════════════════════════════════════
 */
export class JidUtils {
    /**
     * Normaliza um JID para o formato base sem informações de dispositivo.
     * Exemplo: "123456789:1@s.whatsapp.net" -> "123456789@s.whatsapp.net"
     * @param jid O JID original (pode vir de participantJid ou remoteJid)
     */
    static normalize(jid) {
        if (!jid)
            return "";
        // Se já for @g.us (grupo), não remove nada além de espaços (ou formata conforme necessidade)
        if (jid.endsWith('@g.us')) {
            return jid.trim();
        }
        // Divide por : e @ para extrair apenas o número puro
        // Ex: "244900000000:2@s.whatsapp.net"
        // parts[0] = "244999999999"
        const domain = jid.split('@')[1] || 's.whatsapp.net';
        const parts = jid.split('@')[0].split(':');
        return `${parts[0]}@${domain}`;
    }
    /**
     * Extrai apenas o número puro (sem @s.whatsapp.net)
     * Alias para toNumeric para manter consistência com o plano de estabilização.
     */
    static getNumber(jid) {
        if (!jid)
            return "";
        const norm = this.normalize(jid);
        return norm.split('@')[0];
    }
    /**
     * Retorna apenas os dígitos do JID/LID.
     * Útil para chaves de banco de dados que devem ser independentes de JID/LID.
     */
    static toNumeric(jid) {
        return this.getNumber(jid);
    }
    /**
     * Extrai número de phone_number vindo do socket WhatsApp.
     * Prioriza phone_number quando disponível, fallback para JID.
     * Exemplo: "244956464620@s.whatsapp.net" -> "244956464620"
     */
    static extractPhoneNumber(phoneNumberOrJid) {
        if (!phoneNumberOrJid)
            return "";
        // Se contém @, é um JID/phone_number do WhatsApp
        if (phoneNumberOrJid.includes('@')) {
            return phoneNumberOrJid.split('@')[0];
        }
        // Se é apenas número puro
        return phoneNumberOrJid.replace(/\D/g, '');
    }
    /**
     * Garante que um número de telefone seja apenas dígitos, remover qualquer JID/LID/sufixo.
     * Útil para garantir que o payload enviado à API contenha apenas números limpos.
     * Exemplo: "244956464620@lid" -> "244956464620"
     * Exemplo: "244956464620@s.whatsapp.net" -> "244956464620"
     */
    static cleanPhoneNumber(input) {
        if (!input)
            return "";
        // Remove tudo exceto dígitos
        return String(input).replace(/\D/g, '');
    }
}
export default JidUtils;
