// [NEW] Unificação de tipos para corrigir build no Railway
// Todo o conteúdo de custom-types.d.ts foi movido para aqui.

/// <reference types="node" />

declare module 'yt-search';
declare module 'node-webpmux';
declare module 'sharp';
declare module '@imgly/background-removal';

declare module "fs";
declare module "path";
declare module "child_process";
declare module "crypto";
declare module "os";
declare module "util";
declare module "dns";
declare module "url";
declare module "module";
declare module "express";
declare module "qrcode";
declare module "axios";
declare module "fluent-ffmpeg";
declare module "google-tts-api";
declare module "@whiskeysockets/baileys";
declare module "pino";
declare module "https-proxy-agent";
declare module "@distube/ytdl-core";
declare module "libphonenumber-js";
declare module "node:fs";
declare module "node:path";

declare module "https" {
    export class Agent {
        constructor(options?: any);
    }
}
declare module "http" {
    export class Agent {
        constructor(options?: any);
    }
}

declare var Buffer: any;
interface Buffer extends any {
    toString(encoding?: string, start?: number, end?: number): string;
    toString(encoding: string): string;
    length: number;
    writeUIntLE(value: number, offset: number, byteLength: number): number;
    readUIntLE(offset: number, byteLength: number): number;
    slice(start?: number, end?: number): Buffer;
    [key: string]: any;
}

declare var process: any;
declare var console: any;
declare var setTimeout: any;
declare var clearTimeout: any;
declare var setInterval: any;
declare var clearInterval: any;
declare var __dirname: string;
declare var __filename: string;
declare var require: any;
declare var Error: any;

interface ImportMeta {
    url: string;
}
