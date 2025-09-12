import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const CONFIG = {
    CLIENT_TTL: 35, // 35s
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
    },

    // Message moderation configuration
    MODERATION: {
        ENABLED: process.env.MODERATION_ENABLED !== 'false', // Default true
        
        // Maximum repeated characters allowed
        MAX_REPEATED_CHARS: parseInt(process.env.MAX_REPEATED_CHARS || '10'),
        
        // Block URLs in messages
        BLOCK_URLS: process.env.BLOCK_URLS === 'true',
        
        // Profanity patterns (English)
        PROFANITY_EN: [
            /\b(fuck|shit|bitch|damn|hell|ass|bastard|cunt|dick)\b/gi,
            /\b(asshole|motherfucker|cocksucker|dickhead)\b/gi,
        ],
        
        // Profanity patterns (Italian)
        PROFANITY_IT: [
            /\b(merda|cazzo|puttana|stronzo|bastardo|figlio di puttana)\b/gi,
            /\b(idiota|stupido|imbecille|coglione|porco dio|madonna)\b/gi,
            /\b(vaffanculo|fanculo|testa di cazzo)\b/gi,
        ],
        
        // Spam patterns
        SPAM_PATTERNS: [
            /(.)\1{10,}/g, // Repeated characters
            /^[A-Z\s!]{25,}$/g, // Excessive caps (25+ chars)
            /https?:\/\/[^\s]+/gi, // URLs (if BLOCK_URLS is true)
        ],
        
        // Custom word blacklist (can be extended via env)
        CUSTOM_BLACKLIST: process.env.CUSTOM_BLACKLIST ? 
            process.env.CUSTOM_BLACKLIST.split(',').map(word => 
                new RegExp(`\\b${word.trim()}\\b`, 'gi')
            ) : [],
    }
} as const;