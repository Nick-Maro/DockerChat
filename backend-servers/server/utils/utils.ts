import { CONFIG } from '../config.ts';

export function isExpired(timestampIso: string, ttlSeconds: number): boolean {
    try {
        const timestamp = new Date(timestampIso);
        return (Date.now() - timestamp.getTime()) > (ttlSeconds * 1000);
    } catch {
        return true;
    }
}

export function generateUUID(): string {
    return crypto.randomUUID();
}

export function getCurrentISOString(): string {
    return new Date().toISOString();
}

export function printDebug(message: string, level: DebugLevel) {
    if (CONFIG.DEBUG) {
        switch(level) {
            case DebugLevel.LOG:
                console.log(message);
                break;
            case DebugLevel.WARN:
                console.log(message);
                break;
            case DebugLevel.ERROR:
                console.error(message);
                break;
            default:
                break;
        }
    }
}

export enum DebugLevel {
    LOG,
    WARN,
    ERROR
}