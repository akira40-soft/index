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
    public static normalize(jid: string | null | undefined): string {
        if (!jid) return "";

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
    public static getNumber(jid: string | null | undefined): string {
        if (!jid) return "";
        const norm = this.normalize(jid);
        return norm.split('@')[0];
    }

    /**
     * Retorna apenas os dígitos do JID/LID.
     * Útil para chaves de banco de dados que devem ser independentes de JID/LID.
     */
    public static toNumeric(jid: string | null | undefined): string {
        return this.getNumber(jid);
    }

    /**
     * Extrai número de phone_number vindo do socket WhatsApp.
     * Prioriza phone_number quando disponível, fallback para JID.
     * Exemplo: "244956464620@s.whatsapp.net" -> "244956464620"
     */
    public static extractPhoneNumber(phoneNumberOrJid: string | null | undefined): string {
        if (!phoneNumberOrJid) return "";

        // Se contém @, é um JID/phone_number do WhatsApp
        if (phoneNumberOrJid.includes('@')) {
            return phoneNumberOrJid.split('@')[0];
        }

        // Se é apenas número puro
        return phoneNumberOrJid.replace(/\D/g, '');
    }

    /**
     * Garante que um número de telefone seja apenas dígitos, removendo qualquer JID/LID/sufixo/prefixo.
     * Útil para garantir que o payload enviado à API contenha apenas números limpos.
     * Exemplo: "244956464620@lid" -> "244956464620"
     * Exemplo: "244956464620@s.whatsapp.net" -> "244956464620"
     * Exemplo: "lid_244956464620" -> "244956464620"
     * Exemplo: "lid_244956464620:1@s.whatsapp.net" -> "244956464620"
     */
    public static cleanPhoneNumber(input: string | null | undefined): string {
        if (!input) return "";

        // Remove tudo exceto dígitos
        let cleaned = String(input).replace(/\D/g, '');
        return cleaned;
    }

    /**
     * Normaliza um ID de usuário respeitando identidades LID e números reais.
     * ✅ Se for um LID, mantém a estrutura (ou apenas remove o sufixo de dispositivo)
     * ✅ Se for um JID, mantém o número base
     * ═══════════════════════════════════════════════════════════════════════
     */
    public static normalizeUserNumber(input: string | null | undefined): string {
        if (!input) return "";

        const jid = String(input).trim();

        // 1. Remove sufixo de dispositivo (:1, :2...) mas mantém o domínio (@lid ou @s.whatsapp.net)
        const baseJid = jid.split(':')[0].split('@')[0];

        // 2. Remove prefixos de sistema se existirem (como 'lid_')
        let normalized = baseJid;
        if (normalized.startsWith('lid_')) {
            normalized = normalized.substring(4);
        }

        // Retorna a identidade base (seja número puro ou LID alfa-numérico)
        return normalized;
    }
}

export default JidUtils;
