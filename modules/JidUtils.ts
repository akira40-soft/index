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
     */
    public static getNumber(jid: string | null | undefined): string {
        const norm = this.normalize(jid);
        return norm.split('@')[0];
    }
}

export default JidUtils;
