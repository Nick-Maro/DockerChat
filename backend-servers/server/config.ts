import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const CONFIG = {
    CLIENT_TTL: 35, // 35s
    ROOM_TTL: 7200, // 2h
    MESSAGE_TTL: 86400, // 24h
    DEBUG: process.env.DEBUG?.toLowerCase() === 'true',

    METRICS: {
        ENABLED: true,
        INTERVAL: 36000,
    },

    SERVER: {
        PORT: parseInt(process.env.SERVER_PORT || process.env.PORT || '5000'),
        HOST: process.env.HOST || '0.0.0.0',
        // A 10 MiB file becomes a data URL, then AES ciphertext, then base64.
        MAX_PAYLOAD_LENGTH: 24 * 1024 * 1024
    },

    REDIS: {
        HOST: process.env.REDIS_HOST || 'redis',
        PORT: process.env.REDIS_PORT ? parseInt(process.env.REDIS_PORT) : 6379,
        PASSWORD: process.env.REDIS_PASSWORD || 'password',
        DB: process.env.REDIS_DB ? parseInt(process.env.REDIS_DB) : 0
    }
} as const;
