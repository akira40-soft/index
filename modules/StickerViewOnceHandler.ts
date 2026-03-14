/**
 * ═══════════════════════════════════════════════════════════════════════
 * HANDLER: Sticker + View-Once Commands (CORRIGIDO)
 * ═══════════════════════════════════════════════════════════════════════
 * 🎨 Comandos de sticker com metadados personalizados
 * 👁️ Comandos para revelar e converter view-once
 * ✅ Suporta imagens/vídeos/stickers ENVIADOS DIRETAMENTE com comando
 * ✅ Suporta view-once com comandos #sticker e #gif
 * ✅ Pack Name = nome do usuário, Author = Akira-Bot
 * ═══════════════════════════════════════════════════════════════════════
 */

import MediaProcessor from './MediaProcessor.js';
import { getContentType } from '@whiskeysockets/baileys';

class StickerViewOnceHandler {
    public sock: any;
    public config: any;
    public media: MediaProcessor;

    constructor(sock: any, config: any) {
        this.sock = sock;
        this.config = config;
        this.media = new MediaProcessor();
    }

    public setSocket(sock: any): void {
        this.sock = sock;
    }


    /**
    * Processa comando #sticker / #s / #fig
    * Cria sticker a partir de imagem ou sticker existente
    * ✅ Suporta view-once e imagens/stickers enviados DIRETAMENTE
    */
    async handleSticker(m: any, userData: any, texto: string, ehGrupo: boolean, isOwnerOrAdmin: boolean) {
        try {
            // userData tem 'name', não 'nome'
            const userName = userData?.name || 'User';

            // ✅ Verificar view-once DIRETO na mensagem atual
            const viewOnceDirect = this.media?.detectViewOnce(m.message);
            const hasViewOnceImage = viewOnceDirect?.imageMessage;
            const hasViewOnceVideo = viewOnceDirect?.videoMessage;

            // Verificar imagem/sticker NA MENSAGEM ATUAL
            const hasDirectImage = m.message?.imageMessage;
            const hasDirectSticker = m.message?.stickerMessage;

            // Procura mensagem citada
            let quoted = m.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            if (quoted?.viewOnceMessageV2?.message) quoted = quoted.viewOnceMessageV2?.message;
            else if (quoted?.viewOnceMessageV2Extension?.message) quoted = quoted.viewOnceMessageV2Extension?.message;
            else if (quoted?.viewOnceMessage?.message) quoted = quoted.viewOnceMessage?.message;

            // Verificar view-once na mensagem citada
            const viewOnceQuoted = this.media?.detectViewOnce(quoted);
            const hasQuotedViewOnceImage = viewOnceQuoted?.imageMessage;
            const hasQuotedViewOnceVideo = viewOnceQuoted?.videoMessage;

            const hasQuotedImage = quoted?.imageMessage;
            const hasQuotedSticker = quoted?.stickerMessage;

            // Se não tem imagem/sticker/view-once direto nem citado
            if (!hasDirectImage && !hasDirectSticker && !hasQuotedImage && !hasQuotedSticker &&
                !hasViewOnceImage && !hasViewOnceVideo && !hasQuotedViewOnceImage && !hasQuotedViewOnceVideo) {
                await this.sock?.sendMessage(m.key?.remoteJid, {
                    text: '📸 *COMANDO #sticker*\n\n' +
                        '✅ Envie uma imagem com legenda `#sticker`\n' +
                        '✅ OU responda uma imagem com `#sticker`\n' +
                        '✅ OU responda um sticker com `#sticker`\n' +
                        '✅ OU envie/imagem view-once com `#sticker`\n\n' +
                        '⚠️ Para stickers animados de vídeos, use `#gif`\n\n' +
                        '📝 Metadados:\n' +
                        `🏷️ Pack: ${userName.split(' ')[0]}\n` +
                        '👤 Autor: Akira-Bot\n' +
                        '✨ Automaticamente personalizados!'
                }, { quoted: m });
                return true;
            }

            // ✅ Processa sticker ENVIADO DIRETAMENTE
            if (hasDirectSticker) {
                const stickerMsg = m.message?.stickerMessage;
                const stickerBuf = await this.media?.downloadMedia(stickerMsg, 'sticker');

                if (!stickerBuf) {
                    await this.sock?.sendMessage(m.key?.remoteJid, {
                        text: '❌ Erro ao baixar sticker.'
                    }, { quoted: m });
                    return true;
                }

                const out = await this.media?.addStickerMetadata(
                    stickerBuf,
                    userName.split(' ')[0].toLowerCase(),
                    'Akira-Bot'
                );

                if (!out) {
                    await this.sock?.sendMessage(m.key?.remoteJid, {
                        text: '❌ Erro ao personalizar sticker.'
                    }, { quoted: m });
                    return true;
                }

                await this.sock?.sendMessage(m.key?.remoteJid, {
                    sticker: out
                }, { quoted: m });
                return true;
            }

            // ✅ Processa sticker CITADO
            if (hasQuotedSticker) {
                const stickerMsg = quoted.stickerMessage;
                const stickerBuf = await this.media?.downloadMedia(stickerMsg, 'sticker');

                if (!stickerBuf) {
                    await this.sock?.sendMessage(m.key?.remoteJid, {
                        text: '❌ Erro ao baixar sticker.'
                    }, { quoted: m });
                    return true;
                }

                const out = await this.media?.addStickerMetadata(
                    stickerBuf,
                    userName.split(' ')[0].toLowerCase(),
                    'Akira-Bot'
                );

                if (!out) {
                    await this.sock?.sendMessage(m.key?.remoteJid, {
                        text: '❌ Erro ao personalizar sticker.'
                    }, { quoted: m });
                    return true;
                }

                await this.sock?.sendMessage(m.key?.remoteJid, {
                    sticker: out
                }, { quoted: m });
                return true;
            }

            // ✅ Processa view-once DIRETO (imagem)
            if (hasViewOnceImage) {
                const imgBuf = await this.media?.downloadMedia(viewOnceDirect.imageMessage, 'image');

                if (!imgBuf) {
                    await this.sock?.sendMessage(m.key?.remoteJid, {
                        text: '❌ Erro ao baixar imagem view-once.'
                    }, { quoted: m });
                    return true;
                }

                const result = await this.media?.createStickerFromImage(imgBuf, {
                    userName,
                    author: 'Akira-Bot'
                });

                if (!result.sucesso) {
                    await this.sock?.sendMessage(m.key?.remoteJid, {
                        text: `❌ ${result.error}`
                    }, { quoted: m });
                    return true;
                }

                await this.sock?.sendMessage(m.key?.remoteJid, {
                    sticker: result.buffer
                }, { quoted: m });
                return true;
            }

            // ✅ Processa view-once CITADO (imagem)
            if (hasQuotedViewOnceImage) {
                const imgBuf = await this.media?.downloadMedia(viewOnceQuoted.imageMessage, 'image');

                if (!imgBuf) {
                    await this.sock?.sendMessage(m.key?.remoteJid, {
                        text: '❌ Erro ao baixar imagem view-once.'
                    }, { quoted: m });
                    return true;
                }

                const result = await this.media?.createStickerFromImage(imgBuf, {
                    userName,
                    author: 'Akira-Bot'
                });

                if (!result.sucesso) {
                    await this.sock?.sendMessage(m.key?.remoteJid, {
                        text: `❌ ${result.error}`
                    }, { quoted: m });
                    return true;
                }

                await this.sock?.sendMessage(m.key?.remoteJid, {
                    sticker: result.buffer
                }, { quoted: m });
                return true;
            }

            // ✅ Processa imagem ENVIADA DIRETAMENTE → sticker
            if (hasDirectImage) {
                const imgBuf = await this.media?.downloadMedia(m.message?.imageMessage, 'image');

                if (!imgBuf) {
                    await this.sock?.sendMessage(m.key?.remoteJid, {
                        text: '❌ Erro ao baixar imagem.'
                    }, { quoted: m });
                    return true;
                }

                const result = await this.media?.createStickerFromImage(imgBuf, {
                    userName,
                    author: 'Akira-Bot'
                });

                if (!result.sucesso) {
                    await this.sock?.sendMessage(m.key?.remoteJid, {
                        text: `❌ ${result.error}`
                    }, { quoted: m });
                    return true;
                }

                await this.sock?.sendMessage(m.key?.remoteJid, {
                    sticker: result.buffer
                }, { quoted: m });
                return true;
            }

            // Processa imagem CITADA → sticker
            if (hasQuotedImage) {
                const mediaMsg = quoted.imageMessage;
                const imgBuf = await this.media?.downloadMedia(mediaMsg, 'image');

                if (!imgBuf) {
                    await this.sock?.sendMessage(m.key?.remoteJid, {
                        text: '❌ Erro ao baixar imagem.'
                    }, { quoted: m });
                    return true;
                }

                const result = await this.media?.createStickerFromImage(imgBuf, {
                    userName,
                    author: 'Akira-Bot'
                });

                if (!result.sucesso) {
                    await this.sock?.sendMessage(m.key?.remoteJid, {
                        text: `❌ ${result.error}`
                    }, { quoted: m });
                    return true;
                }

                await this.sock?.sendMessage(m.key?.remoteJid, {
                    sticker: result.buffer
                }, { quoted: m });
                return true;
            }

        } catch (e: any) {
            console.error('❌ Erro em handleSticker:', e);
            await this.sock?.sendMessage(m.key?.remoteJid, {
                text: '❌ Erro ao processar sticker.'
            }, { quoted: m });
        }

        return true;
    }

    /**
    * Processa comando #gif
    * Cria sticker animado de vídeo
    * ✅ Suporta view-once e vídeos/stickers enviados DIRETAMENTE
    */
    async handleGif(m: any, userData: any, texto: string, ehGrupo: boolean) {
        try {
            // userData tem 'name', não 'nome'
            const userName = userData?.name || 'User';

            // ✅ Verificar view-once DIRETO na mensagem atual
            const viewOnceDirect = this.media?.detectViewOnce(m.message);
            const hasViewOnceVideo = viewOnceDirect?.videoMessage;

            // ✅ Verificar vídeo/sticker NA MENSAGEM ATUAL
            const hasDirectVideo = m.message?.videoMessage;
            const hasDirectSticker = m.message?.stickerMessage;

            // Procura mensagem citada
            let quoted = m.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            if (quoted?.viewOnceMessageV2?.message) quoted = quoted.viewOnceMessageV2?.message;
            else if (quoted?.viewOnceMessageV2Extension?.message) quoted = quoted.viewOnceMessageV2Extension?.message;
            else if (quoted?.viewOnceMessage?.message) quoted = quoted.viewOnceMessage?.message;

            // ✅ Verificar view-once na mensagem citada
            const viewOnceQuoted = this.media?.detectViewOnce(quoted);
            const hasQuotedViewOnceVideo = viewOnceQuoted?.videoMessage;

            const hasQuotedVideo = quoted?.videoMessage;
            const hasQuotedSticker = quoted?.stickerMessage;

            // Se não tem vídeo/sticker/view-once direto nem citado
            if (!hasDirectVideo && !hasDirectSticker && !hasQuotedVideo && !hasQuotedSticker &&
                !hasViewOnceVideo && !hasQuotedViewOnceVideo) {
                await this.sock?.sendMessage(m.key?.remoteJid, {
                    text: '🎥 *COMANDO #gif*\n\n' +
                        '✅ Envie um vídeo com legenda `#gif`\n' +
                        '✅ OU responda um vídeo com `#gif`\n' +
                        '✅ OU responda um sticker animado com `#gif`\n' +
                        '✅ OU envie vídeo view-once com `#gif`\n\n' +
                        '⏱️ Máximo: 30 segundos\n' +
                        '📏 Dimensão: 512x512 (automático)\n' +
                        '💾 Máximo: 500KB\n\n' +
                        '✨ Seu sticker será automaticamente personalizado!'
                }, { quoted: m });
                return true;
            }

            // ✅ Processa sticker animado ENVIADO DIRETAMENTE
            if (hasDirectSticker) {
                const stickerMsg = m.message?.stickerMessage;
                const stickerBuf = await this.media?.downloadMedia(stickerMsg, 'sticker');

                if (!stickerBuf) {
                    await this.sock?.sendMessage(m.key?.remoteJid, {
                        text: '❌ Erro ao baixar sticker.'
                    }, { quoted: m });
                    return true;
                }

                const out = await this.media?.addStickerMetadata(
                    stickerBuf,
                    userName.split(' ')[0].toLowerCase(),
                    'Akira-Bot'
                );

                if (out) {
                    await this.sock?.sendMessage(m.key?.remoteJid, {
                        sticker: out
                    }, { quoted: m });
                } else {
                    await this.sock?.sendMessage(m.key?.remoteJid, {
                        text: '❌ Erro ao personalizar sticker animado.'
                    }, { quoted: m });
                }
                return true;
            }

            // ✅ Processa sticker animado CITADO
            if (hasQuotedSticker) {
                const stickerMsg = quoted.stickerMessage;
                const stickerBuf = await this.media?.downloadMedia(stickerMsg, 'sticker');

                if (!stickerBuf) {
                    await this.sock?.sendMessage(m.key?.remoteJid, {
                        text: '❌ Erro ao baixar sticker.'
                    }, { quoted: m });
                    return true;
                }

                const out = await this.media?.addStickerMetadata(
                    stickerBuf,
                    userName.split(' ')[0].toLowerCase(),
                    'Akira-Bot'
                );

                if (out) {
                    await this.sock?.sendMessage(m.key?.remoteJid, {
                        sticker: out
                    }, { quoted: m });
                } else {
                    await this.sock?.sendMessage(m.key?.remoteJid, {
                        text: '❌ Erro ao personalizar sticker animado.'
                    }, { quoted: m });
                }
                return true;
            }

            // ✅ Processa view-once DIRETO (vídeo) → sticker animado
            if (hasViewOnceVideo) {
                await this.sock?.sendMessage(m.key?.remoteJid, {
                    text: '⏳ Processando vídeo view-once...'
                }, { quoted: m });

                const vidBuf = await this.media?.downloadMedia(viewOnceDirect.videoMessage, 'video');

                if (!vidBuf) {
                    await this.sock?.sendMessage(m.key?.remoteJid, {
                        text: '❌ Erro ao baixar vídeo view-once.'
                    }, { quoted: m });
                    return true;
                }

                const result = await this.media?.createAnimatedStickerFromVideo(vidBuf, 30, {
                    userName,
                    author: 'Akira-Bot'
                });

                if (!result.sucesso) {
                    await this.sock?.sendMessage(m.key?.remoteJid, {
                        text: `❌ ${result.error}`
                    }, { quoted: m });
                    return true;
                }

                await this.sock?.sendMessage(m.key?.remoteJid, {
                    sticker: result.buffer
                }, { quoted: m });
                return true;
            }

            // ✅ Processa view-once CITADO (vídeo) → sticker animado
            if (hasQuotedViewOnceVideo) {
                await this.sock?.sendMessage(m.key?.remoteJid, {
                    text: '⏳ Processando vídeo view-once...'
                }, { quoted: m });

                const vidBuf = await this.media?.downloadMedia(viewOnceQuoted.videoMessage, 'video');

                if (!vidBuf) {
                    await this.sock?.sendMessage(m.key?.remoteJid, {
                        text: '❌ Erro ao baixar vídeo view-once.'
                    }, { quoted: m });
                    return true;
                }

                const result = await this.media?.createAnimatedStickerFromVideo(vidBuf, 30, {
                    userName,
                    author: 'Akira-Bot'
                });

                if (!result.sucesso) {
                    await this.sock?.sendMessage(m.key?.remoteJid, {
                        text: `❌ ${result.error}`
                    }, { quoted: m });
                    return true;
                }

                await this.sock?.sendMessage(m.key?.remoteJid, {
                    sticker: result.buffer
                }, { quoted: m });
                return true;
            }

            // ✅ Processa vídeo ENVIADO DIRETAMENTE → sticker animado
            if (hasDirectVideo) {
                await this.sock?.sendMessage(m.key?.remoteJid, {
                    text: '⏳ Processando vídeo... Isto pode levar alguns segundos.'
                }, { quoted: m });

                const vidBuf = await this.media?.downloadMedia(m.message?.videoMessage, 'video');

                if (!vidBuf) {
                    await this.sock?.sendMessage(m.key?.remoteJid, {
                        text: '❌ Erro ao baixar vídeo.'
                    }, { quoted: m });
                    return true;
                }

                const result = await this.media?.createAnimatedStickerFromVideo(vidBuf, 30, {
                    userName,
                    author: 'Akira-Bot'
                });

                if (!result.sucesso) {
                    await this.sock?.sendMessage(m.key?.remoteJid, {
                        text: `❌ ${result.error}`
                    }, { quoted: m });
                    return true;
                }

                await this.sock?.sendMessage(m.key?.remoteJid, {
                    sticker: result.buffer
                }, { quoted: m });
                return true;
            }

            // Processa vídeo CITADO → sticker animado
            if (hasQuotedVideo) {
                await this.sock?.sendMessage(m.key?.remoteJid, {
                    text: '⏳ Processando vídeo... Isto pode levar alguns segundos.'
                }, { quoted: m });

                const vidMsg = quoted.videoMessage;
                const vidBuf = await this.media?.downloadMedia(vidMsg, 'video');

                if (!vidBuf) {
                    await this.sock?.sendMessage(m.key?.remoteJid, {
                        text: '❌ Erro ao baixar vídeo.'
                    }, { quoted: m });
                    return true;
                }

                const result = await this.media?.createAnimatedStickerFromVideo(vidBuf, 30, {
                    userName,
                    author: 'Akira-Bot'
                });

                if (!result.sucesso) {
                    await this.sock?.sendMessage(m.key?.remoteJid, {
                        text: `❌ ${result.error}`
                    }, { quoted: m });
                    return true;
                }

                await this.sock?.sendMessage(m.key?.remoteJid, {
                    sticker: result.buffer
                }, { quoted: m });
                return true;
            }

        } catch (e: any) {
            console.error('❌ Erro em handleGif:', e);
            await this.sock?.sendMessage(m.key?.remoteJid, {
                text: '❌ Erro ao criar sticker animado.'
            }, { quoted: m });
        }

        return true;
    }

    /**
    * Processa comando #reveal / #revelar / #openvo
    * Revela view-once (apenas dono/admin)
    */
    async handleReveal(m: any, userData: any, ehGrupo: boolean, isOwnerOrAdmin: boolean) {
        try {
            if (!isOwnerOrAdmin) {
                await this.sock?.sendMessage(m.key?.remoteJid, {
                    text: '🚫 Comando restrito ao dono ou admin do grupo.'
                }, { quoted: m });
                return true;
            }

            const quoted = m.message?.extendedTextMessage?.contextInfo?.quotedMessage;

            if (!quoted) {
                await this.sock?.sendMessage(m.key?.remoteJid, {
                    text: '👁️ *COMANDO #reveal*\n\n' +
                        'Responda uma mensagem view-once com `#reveal`\n\n' +
                        '✅ Imagens view-once\n' +
                        '✅ Vídeos view-once\n' +
                        '✅ Áudios view-once\n' +
                        '✅ Stickers animados view-once\n\n' +
                        '🔒 Apenas dono/admin podem usar.'
                }, { quoted: m });
                return true;
            }

            const result = await this.media?.extractViewOnceContent(quoted);

            if (!result.sucesso) {
                await this.sock?.sendMessage(m.key?.remoteJid, {
                    text: `❌ ${result.error}`
                }, { quoted: m });
                return true;
            }

            const tipoEmoji: Record<string, string> = {
                'image': '🖼️',
                'video': '🎬',
                'audio': '🎤',
                'sticker': '🎨'
            };

            const caption = `${tipoEmoji[result.tipo || ''] || '📦'} *Conteúdo Revelado (View-Once)*\n\nTipo: ${result.tipo}\nTamanho: ${((result.size || 0) / 1024).toFixed(2)}KB`;

            const msgObj: any = {};
            if (result.tipo === 'image') {
                msgObj.image = result.buffer;
                msgObj.caption = caption;
            } else if (result.tipo === 'video') {
                msgObj.video = result.buffer;
                msgObj.mimetype = 'video/mp4';
                msgObj.caption = caption;
            } else if (result.tipo === 'audio') {
                msgObj.audio = result.buffer;
                msgObj.mimetype = 'audio/mpeg';
                msgObj.ptt = false;
            } else if (result.tipo === 'sticker') {
                msgObj.sticker = result.buffer;
            }

            await this.sock?.sendMessage(m.key?.remoteJid, msgObj, { quoted: m });
            return true;

        } catch (e: any) {
            console.error('❌ Erro em handleReveal:', e);
            await this.sock?.sendMessage(m.key?.remoteJid, {
                text: '❌ Erro ao revelar view-once.'
            }, { quoted: m });
        }

        return true;
    }

    /**
    * Processa comando #toimg
    * Converte sticker para imagem PNG
    */
    async handleToImage(m: any, userData: any, texto: string, ehGrupo: boolean) {
        try {
            // ✅ Verificar sticker NA MENSAGEM ATUAL
            const hasDirectSticker = m.message?.stickerMessage;

            let quoted = m.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            if (quoted?.viewOnceMessageV2?.message) quoted = quoted.viewOnceMessageV2?.message;
            else if (quoted?.viewOnceMessageV2Extension?.message) quoted = quoted.viewOnceMessageV2Extension?.message;
            else if (quoted?.viewOnceMessage?.message) quoted = quoted.viewOnceMessage?.message;

            const hasQuotedSticker = quoted?.stickerMessage;

            if (!hasDirectSticker && !hasQuotedSticker) {
                await this.sock?.sendMessage(m.key?.remoteJid, {
                    text: '🖼️ *COMANDO #toimg*\n\n' +
                        '✅ Envie um sticker com legenda `#toimg`\n' +
                        '✅ OU responda um sticker com `#toimg`\n\n' +
                        '📝 Converte qualquer sticker para imagem PNG\n' +
                        '⚠️ Stickers animados não podem ser convertidos'
                }, { quoted: m });
                return true;
            }

            await this.sock?.sendMessage(m.key?.remoteJid, {
                text: '⏳ Convertendo sticker para imagem..'
            }, { quoted: m });

            // ✅ Processa sticker ENVIADO DIRETAMENTE
            let stickerBuf;
            if (hasDirectSticker) {
                stickerBuf = await this.media?.downloadMedia(m.message?.stickerMessage, 'sticker');
            } else {
                stickerBuf = await this.media?.downloadMedia(quoted.stickerMessage, 'sticker');
            }

            if (!stickerBuf) {
                await this.sock?.sendMessage(m.key?.remoteJid, {
                    text: '❌ Erro ao baixar sticker.'
                }, { quoted: m });
                return true;
            }

            const result = await this.media?.convertStickerToImage(stickerBuf);

            if (!result.sucesso) {
                await this.sock?.sendMessage(m.key?.remoteJid, {
                    text: `❌ ${result.error || 'Erro ao converter sticker.'}`
                }, { quoted: m });
                return true;
            }

            await this.sock?.sendMessage(m.key?.remoteJid, {
                image: result.buffer,
                caption: '🖼️ Convertido de sticker para imagem PNG'
            }, { quoted: m });

            return true;

        } catch (e: any) {
            console.error('❌ Erro em handleToImage:', e);
            await this.sock?.sendMessage(m.key?.remoteJid, {
                text: '❌ Erro ao converter sticker para imagem.'
            }, { quoted: m });
        }

        return true;
    }

    /**
    * Processa comando #vosticker / #vostk
    * Converte view-once image/video em sticker
    */
    async handleViewOnceToSticker(m: any, userData: any, ehGrupo: boolean) {
        try {
            // userData tem 'name', não 'nome'
            const userName = userData?.name || 'User';
            const quoted = m.message?.extendedTextMessage?.contextInfo?.quotedMessage;

            if (!quoted) {
                await this.sock?.sendMessage(m.key?.remoteJid, {
                    text: '👁️➡️🎨 *COMANDO #vosticker*\n\n' +
                        'Converte imagem/vídeo view-once em sticker\n\n' +
                        'Uso: Responda uma view-once com `#vosticker`\n\n' +
                        '✅ View-once image → sticker\n' +
                        '✅ View-once video → sticker animado'
                }, { quoted: m });
                return true;
            }

            const result = await this.media?.extractViewOnceContent(quoted);

            if (!result.sucesso) {
                await this.sock?.sendMessage(m.key?.remoteJid, {
                    text: `❌ ${result.error}`
                }, { quoted: m });
                return true;
            }

            let stickerResult;

            if (result.tipo === 'image') {
                stickerResult = await this.media?.createStickerFromImage(result.buffer, {
                    userName,
                    author: 'Akira-Bot'
                });
            } else if (result.tipo === 'video') {
                await this.sock?.sendMessage(m.key?.remoteJid, {
                    text: '⏳ Convertendo vídeo view-once para sticker animado...'
                }, { quoted: m });

                stickerResult = await this.media?.createAnimatedStickerFromVideo(result.buffer, 30, {
                    userName,
                    author: 'Akira-Bot'
                });
            } else {
                await this.sock?.sendMessage(m.key?.remoteJid, {
                    text: `❌ Tipo ${result.tipo} não pode ser convertido.`
                }, { quoted: m });
                return true;
            }

            if (!stickerResult.sucesso) {
                await this.sock?.sendMessage(m.key?.remoteJid, {
                    text: `❌ ${stickerResult.error}`
                }, { quoted: m });
                return true;
            }

            await this.sock?.sendMessage(m.key?.remoteJid, {
                sticker: stickerResult.buffer
            }, { quoted: m });

            return true;

        } catch (e: any) {
            console.error('❌ Erro em handleViewOnceToSticker:', e);
            await this.sock?.sendMessage(m.key?.remoteJid, {
                text: '❌ Erro ao converter view-once para sticker.'
            }, { quoted: m });
        }

        return true;
    }
}

export default StickerViewOnceHandler;
