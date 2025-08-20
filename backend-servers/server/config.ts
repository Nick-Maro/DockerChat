import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const CONFIG = {
    CLIENT_TTL: 3600, // 1h
    ROOM_TTL: 7200, // 2h
    MESSAGE_TTL: 86400, // 24h
    DEBUG: process.env.DEBUG || false,

    METRICS: {
        ENABLED: true,
        INTERVAL: 36000,
    },

    SERVER: {
        PORT: process.env.PORT ? parseInt(process.env.PORT) : 5000,
        HOST: process.env.HOST || '0.0.0.0'
    },

    REDIS: {
        HOST: process.env.REDIS_HOST || 'redis',
        PORT: process.env.REDIS_PORT ? parseInt(process.env.REDIS_PORT) : 6379,
        PASSWORD: process.env.REDIS_PASSWORD || 'password',
        DB: process.env.REDIS_DB ? parseInt(process.env.REDIS_DB) : 0
    }
} as const;