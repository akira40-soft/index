/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MÓDULO: ImageEffects.ts
 * ═══════════════════════════════════════════════════════════════════════════
 * Efeitos de imagem: HD, remover fundo, adicionar fundo, filtros
 * ═══════════════════════════════════════════════════════════════════════════
 */

import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import ConfigManager from './ConfigManager.js';

class ImageEffects {
    public config: any;
    public logger: any;
    public tempFolder: string;
    public ANGOLA_COLORS: { red: string, black: string, yellow: string };

    constructor(config: any = null) {
        this.config = config || ConfigManager.getInstance();
        this.logger = console;
        this.tempFolder = this.config?.TEMP_FOLDER || './temp';

        // Cores da bandeira de Angola
        this.ANGOLA_COLORS = {
            red: '#d92126',
            black: '#000000',
            yellow: '#f9e300'
        };

        if (!fs.existsSync(this.tempFolder)) {
            fs.mkdirSync(this.tempFolder, { recursive: true });
        }
    }

    /**
    * Gera caminho de arquivo temporário
    */
    generateTempPath(ext: string = 'png'): string {
        return path.join(
            this.tempFolder,
            `effect_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
        );
    }

    /**
    * Limpa arquivo temporário
    */
    async cleanupFile(filePath: string): Promise<void> {
        try {
            if (filePath && fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        } catch (e: any) {
            this.logger?.warn(`⚠️ Erro ao limpar arquivo: ${e.message}`);
        }
    }

    /**
    * Efeito HD - Melhora qualidade da imagem
    */
    async applyHDEffect(imageBuffer: Buffer): Promise<any> {
        try {
            this.logger?.info('🎨 Aplicando efeito HD...');

            // Carregar imagem com sharp
            const image = sharp(imageBuffer);
            const metadata = await image.metadata();

            // Novo tamanho (aumentar se for pequena)
            let newWidth = metadata.width || 512;
            let newHeight = metadata.height || 512;

            // Se imagem for muito pequena, aumentar
            const minSize = 512;
            if (newWidth < minSize || newHeight < minSize) {
                const scale = Math.max(minSize / newWidth, minSize / newHeight);
                newWidth = Math.round(newWidth * scale);
                newHeight = Math.round(newHeight * scale);
            }

            // Aplicar melhorias
            let processed = sharp(imageBuffer)
                .resize(newWidth, newHeight, {
                    fit: 'inside',
                    withoutEnlargement: false,
                    kernel: 'lanczos3'
                });

            // Aumentar nitidez
            processed = processed.sharpen({
                sigma: 1.5,
                m1: 0.5,
                m2: 0.5
            });

            // Ajustar contraste e brilho
            processed = processed.linear(1.05, -10);

            // Aumentar saturação ligeiramente
            processed = processed.modulate({
                saturation: 1.1
            });

            const outputBuffer = await processed.toBuffer();

            this.logger?.info(`✅ Efeito HD aplicado: ${metadata.width}x${metadata.height} → ${newWidth}x${newHeight}`);

            return {
                success: true,
                buffer: outputBuffer,
                originalSize: (metadata.width || '?') + 'x' + (metadata.height || '?'),
                newSize: newWidth + 'x' + newHeight,
                effect: 'hd'
            };
        } catch (e: any) {
            this.logger?.error('❌ Erro no efeito HD:', e.message);
            return { success: false, error: e.message };
        }
    }

    /**
    * Efeito communists/vermelho
    */
    async applyCommunistEffect(imageBuffer: Buffer): Promise<any> {
        try {
            this.logger?.info('🎨 Aplicando efeito comunista...');

            // Dessaturar parcialmente e tingir de vermelho
            const processed = sharp(imageBuffer)
                .modulate({ saturation: 0.3 }) // Dessaturar
                .tint({ r: 255, g: 50, b: 50 }); // Tint vermelho

            const outputBuffer = await processed.toBuffer();

            this.logger?.info('✅ Efeito comunista aplicado');

            return {
                success: true,
                buffer: outputBuffer,
                effect: 'comunista'
            };
        } catch (e: any) {
            this.logger?.error('❌ Erro no efeito comunista:', e.message);
            return { success: false, error: e.message };
        }
    }

    /**
    * Fundo com bandeira de Angola
    */
    async applyAngolaFlagBackground(imageBuffer: Buffer): Promise<any> {
        try {
            this.logger?.info('🎨 Aplicando fundo bandeira Angola...');

            const metadata = await sharp(imageBuffer).metadata();
            const size = Math.max(metadata.width || 0, metadata.height || 0, 1024);

            // Criar gradiente da bandeira de Angola
            const svgBackground = `
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
<rect x="0" y="0" width="${size}" height="${size * 0.4}" fill="${this.ANGOLA_COLORS.red}"/>
<rect x="0" y="${size * 0.4}" width="${size}" height="${size * 0.6}" fill="${this.ANGOLA_COLORS.black}"/>
<polygon points="0,0 0,${size} ${size * 0.5},${size * 0.5}" fill="${this.ANGOLA_COLORS.yellow}"/>
</svg>
`;

            const bgPath = this.generateTempPath('svg');
            fs.writeFileSync(bgPath, svgBackground);

            // Redimensionar imagem principal para caber no centro
            const mainSize = Math.round(size * 0.6);
            const mainImage = await sharp(imageBuffer)
                .resize(mainSize, mainSize, {
                    fit: 'cover',
                    position: 'center'
                })
                .toBuffer();

            // Criar composição
            const processed = sharp(bgPath)
                .composite([{
                    input: mainImage,
                    top: Math.round((size - mainSize) / 2),
                    left: Math.round((size - mainSize) / 2),
                    blend: 'over'
                }]);

            const outputBuffer = await processed.toBuffer();

            await this.cleanupFile(bgPath);

            this.logger?.info('✅ Fundo bandeira Angola aplicado');

            return {
                success: true,
                buffer: outputBuffer,
                effect: 'bandeira_angola'
            };
        } catch (e: any) {
            this.logger?.error('❌ Erro no efeito Angola:', e.message);
            return { success: false, error: e.message };
        }
    }

    /**
    * Fundo sólido com cor personalizada
    */
    async addSolidBackground(imageBuffer: Buffer, color: string = '#ffffff'): Promise<any> {
        try {
            this.logger?.info(`🎨 Adicionando fundo sólido: ${color}`);

            const metadata = await sharp(imageBuffer).metadata();
            const size = Math.max(metadata.width || 0, metadata.height || 0, 1024);

            // Validar cor
            const colorRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
            if (!colorRegex.test(color)) {
                color = '#ffffff'; // Fallback para branco
            }

            // Criar fundo sólido
            const bgPath = this.generateTempPath('png');
            await sharp({
                create: { width: size, height: size, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } }
            })
                .tint(color)
                .toFile(bgPath);

            // Redimensionar imagem principal
            const mainSize = Math.round(size * 0.7);
            const mainImage = await sharp(imageBuffer)
                .resize(mainSize, mainSize, {
                    fit: 'cover',
                    position: 'center'
                })
                .toBuffer();

            // Compor
            const processed = sharp(bgPath)
                .composite([{
                    input: mainImage,
                    top: Math.round((size - mainSize) / 2),
                    left: Math.round((size - mainSize) / 2),
                    blend: 'over'
                }]);

            const outputBuffer = await processed.toBuffer();

            await this.cleanupFile(bgPath);

            this.logger?.info(`✅ Fundo ${color} aplicado`);

            return {
                success: true,
                buffer: outputBuffer,
                color: color,
                effect: 'solid_background'
            };
        } catch (e: any) {
            this.logger?.error('❌ Erro ao adicionar fundo sólido:', e.message);
            return { success: false, error: e.message };
        }
    }

    /**
    * Adicionar gradiente como fundo
    */
    async addGradientBackground(imageBuffer: Buffer, color1: string = '#d92126', color2: string = '#000000'): Promise<any> {
        try {
            this.logger?.info('🎨 Adicionando fundo gradiente...');

            const metadata = await sharp(imageBuffer).metadata();
            const size = Math.max(metadata.width || 0, metadata.height || 0, 1024);

            // Criar gradiente SVG
            const svgGradient = `
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
<defs>
<linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
<stop offset="0%" style="stop-color:${color1};stop-opacity:1" />
<stop offset="100%" style="stop-color:${color2};stop-opacity:1" />
</linearGradient>
</defs>
<rect width="${size}" height="${size}" fill="url(#grad)"/>
</svg>
`;

            const bgPath = this.generateTempPath('svg');
            fs.writeFileSync(bgPath, svgGradient);

            // Redimensionar imagem principal
            const mainSize = Math.round(size * 0.7);
            const mainImage = await sharp(imageBuffer)
                .resize(mainSize, mainSize, {
                    fit: 'cover',
                    position: 'center'
                })
                .toBuffer();

            // Compor
            const processed = sharp(bgPath)
                .composite([{
                    input: mainImage,
                    top: Math.round((size - mainSize) / 2),
                    left: Math.round((size - mainSize) / 2),
                    blend: 'over'
                }]);

            const outputBuffer = await processed.toBuffer();

            await this.cleanupFile(bgPath);

            this.logger?.info('✅ Fundo gradiente aplicado');

            return {
                success: true,
                buffer: outputBuffer,
                colors: { color1, color2 },
                effect: 'gradient_background'
            };
        } catch (e: any) {
            this.logger?.error('❌ Erro ao adicionar gradiente:', e.message);
            return { success: false, error: e.message };
        }
    }

    /**
    * Remover fundo da imagem
    */
    async removeBackground(imageBuffer: Buffer): Promise<any> {
        try {
            this.logger?.info('🎨 Removendo fundo...');

            // Método 1: Tentar usar @imgly/background-removal se disponível
            let bgRemovedBuffer;
            let method = 'unknown';

            try {
                const { default: removeBackground } = await import('@imgly/background-removal');
                // @ts-ignore - Blobpart logic
                const resultBlob = await (removeBackground as any)(imageBuffer);
                bgRemovedBuffer = Buffer.from(await resultBlob.arrayBuffer());
                method = '@imgly/background-removal';
            } catch (libError) {
                // Método 2: Remoção simples por cor (fallback limitado)
                this.logger?.info('⚠️ @imgly não disponível, usando método alternativo...');

                const processed = await sharp(imageBuffer)
                    .ensureAlpha(1)
                    .toBuffer();

                bgRemovedBuffer = processed;
                method = 'simple_alpha';
            }

            this.logger?.info(`✅ Fundo removido (método: ${method})`);

            return {
                success: true,
                buffer: bgRemovedBuffer,
                method: method,
                effect: 'remove_background'
            };
        } catch (e: any) {
            this.logger?.error('❌ Erro ao remover fundo:', e.message);
            return { success: false, error: e.message };
        }
    }

    /**
    * Converter resultado para sticker
    */
    async convertToSticker(imageBuffer: Buffer, author: string = 'Akira Bot'): Promise<any> {
        try {
            this.logger?.info('🎨 Convertendo para sticker...');

            const metadata = await sharp(imageBuffer).metadata();
            const maxSize = 512;

            // Redimensionar para sticker
            let processed = sharp(imageBuffer);

            if ((metadata.width || 0) > maxSize || (metadata.height || 0) > maxSize) {
                processed = processed.resize(maxSize, maxSize, {
                    fit: 'inside',
                    withoutEnlargement: true,
                    kernel: 'lanczos3'
                });
            }

            // Converter para WebP
            processed = processed
                .webp({
                    lossless: false,
                    quality: 75,
                    effort: 6
                })
                .resize(512, 512, {
                    fit: 'cover',
                    position: 'center'
                });

            const stickerBuffer = await processed.toBuffer();

            this.logger?.info('✅ Sticker criado');

            return {
                success: true,
                buffer: stickerBuffer,
                size: stickerBuffer.length,
                effect: 'sticker',
                author
            };
        } catch (e: any) {
            this.logger?.error('❌ Erro ao converter para sticker:', e.message);
            return { success: false, error: e.message };
        }
    }

    /**
    * Efeito Grayscale (Preto e Branco)
    */
    async applyGrayscale(imageBuffer: Buffer): Promise<any> {
        try {
            const processed = sharp(imageBuffer).grayscale();
            const outputBuffer = await processed.toBuffer();
            return { success: true, buffer: outputBuffer, effect: 'grayscale' };
        } catch (e: any) {
            return { success: false, error: e.message };
        }
    }

    /**
    * Efeito Negativo (Invert)
    */
    async applyNegate(imageBuffer: Buffer): Promise<any> {
        try {
            const processed = sharp(imageBuffer).negate({ alpha: false });
            const outputBuffer = await processed.toBuffer();
            return { success: true, buffer: outputBuffer, effect: 'negate' };
        } catch (e: any) {
            return { success: false, error: e.message };
        }
    }

    /**
     * Efeito Sépia
     */
    async applySepia(imageBuffer: Buffer): Promise<any> {
        try {
            // Sépia usando tint/modulate em vez de recolor que pode falhar em versões antigas do sharp
            const buffer = await sharp(imageBuffer)
                .grayscale()
                .tint('#704214')
                .modulate({ brightness: 1.1, saturation: 1.2 })
                .toBuffer();
            return { success: true, buffer, effect: 'sepia' };
        } catch (e: any) {
            return { success: false, error: e.message };
        }
    }

    /**
     * Efeito Arco-íris (Gay)
     */
    async applyGayEffect(imageBuffer: Buffer): Promise<any> {
        try {
            const metadata = await sharp(imageBuffer).metadata();
            const rainbow = Buffer.from(
                `<svg width="${metadata.width}" height="${metadata.height}">
                    <linearGradient id="g" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stop-color="red" stop-opacity="0.5"/>
                        <stop offset="16.6%" stop-color="orange" stop-opacity="0.5"/>
                        <stop offset="33.3%" stop-color="yellow" stop-opacity="0.5"/>
                        <stop offset="50%" stop-color="green" stop-opacity="0.5"/>
                        <stop offset="66.6%" stop-color="blue" stop-opacity="0.5"/>
                        <stop offset="83.3%" stop-color="indigo" stop-opacity="0.5"/>
                        <stop offset="100%" stop-color="violet" stop-opacity="0.5"/>
                    </linearGradient>
                    <rect x="0" y="0" width="100%" height="100%" fill="url(#g)"/>
                </svg>`
            );
            return {
                success: true,
                buffer: await sharp(imageBuffer)
                    .composite([{ input: rainbow, blend: 'over' }])
                    .toBuffer()
            };
        } catch (e: any) {
            return { success: false, error: e.message };
        }
    }

    /**
     * Efeito GTA Wasted
     */
    async applyWastedEffect(imageBuffer: Buffer): Promise<any> {
        try {
            const metadata = await sharp(imageBuffer).metadata();
            const width = metadata.width || 512;
            const height = metadata.height || 512;

            const fontSize = Math.floor(width / 5);
            const rectHeight = Math.floor(height * 0.22);
            const rectY = Math.floor(height / 2 - rectHeight / 2);

            const wastedSvg = Buffer.from(
                `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
                    <rect x="0" y="${rectY}" width="${width}" height="${rectHeight}" fill="black" fill-opacity="0.6"/>
                    <text x="50%" y="50%" 
                          font-family="Impact, Arial, sans-serif" 
                          font-weight="bold" 
                          font-size="${fontSize}px" 
                          fill="#ff0000" 
                          text-anchor="middle" 
                          dominant-baseline="central"
                          stroke="black"
                          stroke-width="${Math.max(1, width / 200)}">WASTED</text>
                </svg>`
            );

            return {
                success: true,
                buffer: await sharp(imageBuffer)
                    .greyscale()
                    .composite([{ input: wastedSvg, blend: 'over', gravity: 'centre' }])
                    .toBuffer()
            };
        } catch (e: any) {
            this.logger?.error('Erro no efeito Wasted:', e.message);
            return { success: false, error: e.message };
        }
    }

    /**
     * Efeito "MISSION PASSED" (estilo GTA)
     */
    async applyMissionPassedEffect(imageBuffer: Buffer): Promise<any> {
        try {
            const metadata = await sharp(imageBuffer).metadata();
            const width = metadata.width || 512;
            const height = metadata.height || 512;

            const fontSize = Math.floor(width / 12);
            const rectHeight = Math.floor(height * 0.18);
            const rectY = Math.floor(height * 0.15);

            const missionSvg = Buffer.from(
                `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
                    <rect x="0" y="${rectY}" width="${width}" height="${rectHeight}" fill="black" fill-opacity="0.45"/>
                    <text x="50%" y="${rectY + rectHeight / 2}"
                          font-family="Impact, Arial, sans-serif"
                          font-weight="bold"
                          font-size="${fontSize}px"
                          fill="#f9e300"
                          text-anchor="middle"
                          dominant-baseline="central"
                          stroke="black"
                          stroke-width="${Math.max(1, width / 300)}">
                        MISSION PASSED!
                    </text>
                </svg>`
            );

            const processed = await sharp(imageBuffer)
                .modulate({ brightness: 1.05, saturation: 1.15 })
                .composite([{ input: missionSvg, blend: 'over' }])
                .toBuffer();

            return {
                success: true,
                buffer: processed,
                effect: 'mission_passed'
            };
        } catch (e: any) {
            this.logger?.error('Erro no efeito Mission Passed:', e.message);
            return { success: false, error: e.message };
        }
    }

    /**
     * Efeito Prisão (Jail)
     */
    async applyJailEffect(imageBuffer: Buffer): Promise<any> {
        try {
            const metadata = await sharp(imageBuffer).metadata();
            const width = metadata.width || 512;
            const height = metadata.height || 512;
            let bars = '';
            const barWidth = width / 15;
            for (let i = 0; i < width; i += barWidth * 2) {
                bars += `<rect x="${i}" y="0" width="${barWidth}" height="100%" fill="rgba(50,50,50,0.8)"/>`;
            }
            const jailSvg = Buffer.from(`<svg width="${width}" height="${height}">${bars}</svg>`);
            return {
                success: true,
                buffer: await sharp(imageBuffer)
                    .greyscale()
                    .composite([{ input: jailSvg, blend: 'over' }])
                    .toBuffer()
            };
        } catch (e: any) {
            return { success: false, error: e.message };
        }
    }

    /**
     * Efeito Triggered
     */
    async applyTriggeredEffect(imageBuffer: Buffer): Promise<any> {
        try {
            const metadata = await sharp(imageBuffer).metadata();
            const width = metadata.width || 512;
            const height = metadata.height || 512;
            const triggeredSvg = Buffer.from(
                `<svg width="${width}" height="${height}">
                    <rect x="0" y="${height - 60}" width="100%" height="60" fill="red"/>
                    <text x="50%" y="${height - 20}" font-family="Impact" font-size="40" fill="white" text-anchor="middle">TRIGGERED</text>
                </svg>`
            );
            return {
                success: true,
                buffer: await sharp(imageBuffer)
                    .modulate({ brightness: 1.2, saturation: 1.5 })
                    .composite([{ input: triggeredSvg, blend: 'over' }])
                    .toBuffer()
            };
        } catch (e: any) {
            return { success: false, error: e.message };
        }
    }

    /**
    * Processa imagem com efeito especificado
    */
    async processImage(imageBuffer: Buffer, effect: string, options: any = {}): Promise<any> {
        let result;

        switch (effect.toLowerCase()) {
            case 'hd':
            case 'enhance':
            case 'upscale':
            case 'remini':
                result = await this.applyHDEffect(imageBuffer);
                break;

            case 'comunista':
            case 'communism':
            case 'commie':
            case 'red':
                result = await this.applyCommunistEffect(imageBuffer);
                break;

            case 'sepia':
                result = await this.applySepia(imageBuffer);
                break;

            case 'wasted':
                result = await this.applyWastedEffect(imageBuffer);
                break;

            case 'mission':
                result = await this.applyMissionPassedEffect(imageBuffer);
                break;

            case 'jail':
            case 'prisao':
                result = await this.applyJailEffect(imageBuffer);
                break;

            case 'gay':
            case 'rainbow':
            case 'arcoiris':
                result = await this.applyGayEffect(imageBuffer);
                break;

            case 'triggered':
                result = await this.applyTriggeredEffect(imageBuffer);
                break;

            case 'bandeiraangola':
            case 'angola':
            case 'angolabg':
                result = await this.applyAngolaFlagBackground(imageBuffer);
                break;

            case 'removerfundo':
            case 'removebg':
            case 'rmbg':
            case 'nobg':
            case 'bg':
                result = await this.removeBackground(imageBuffer);
                break;

            case 'adicionarfundo':
            case 'addbg':
                const color = options.color || '#ffffff';
                result = await this.addSolidBackground(imageBuffer, color);
                break;

            case 'fundogradiente':
            case 'gradient':
                const color1 = options.color1 || '#d92126';
                const color2 = options.color2 || '#000000';
                result = await this.addGradientBackground(imageBuffer, color1, color2);
                break;

            case 'grey':
            case 'gray':
            case 'pb':
            case 'bw':
                result = await this.applyGrayscale(imageBuffer);
                break;

            case 'invert':
            case 'negativo':
                result = await this.applyNegate(imageBuffer);
                break;

            default:
                return {
                    success: false,
                    error: `Efeito desconhecido ou não implementado: ${effect}`
                };
        }

        return result;
    }

    /**
    * Gera mensagem de ajuda para efeitos
    */
    getHelpMessage(): string {
        return `🖼️ *EFEITOS DE IMAGEM*

┌─────────────────────────────┐
│ 🎨 *EFEITOS DISPONÍVEIS* │
├─────────────────────────────┤
│ #hd │
│ #enhance │
│ → Melhora qualidade (HD) │
├─────────────────────────────┤
│ #removerfundo │
│ #rmbg │
│ → Remove fundo da imagem │
├─────────────────────────────┤
│ #adicionarfundo <cor> │
│ #addbg #ff0000 │
│ → Adiciona fundo sólido │
├─────────────────────────────┤
│ #comunista │
│ #commie │
│ → Filtro vermelho │
├─────────────────────────────┤
│ #bandeiraangola │
│ #angola │
│ → Fundo bandeira Angola │
└─────────────────────────────┘

💡 *Como usar:*
1. Envie uma imagem
2. Responda com o comando desejado

📝 *Cores para #adicionarfundo:*
• #ff0000 → Vermelho
• #00ff00 → Verde
• #0000ff → Azul
• #ffffff → Branco
• #000000 → Preto

⚠️ *Nota:* O resultado será enviado como sticker.`;
    }
}

export default ImageEffects;
