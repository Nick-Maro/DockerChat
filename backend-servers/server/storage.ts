import { createClient } from 'redis';
import type { RedisClientType } from 'redis';
import { CONFIG } from './config';
import type { Client, Room, PrivateMessage } from './types';
import { printDebug } from './utils';

class Storage {
    private redis: RedisClientType | null = null;
    private localClients: { [clientId: string]: Client } = {};
    private localRooms: { [roomId: string]: Room } = {};
    private localPrivateMessages: { [messageId: string]: PrivateMessage } = {};

    async initialize(): Promise<void> {
        if (CONFIG.REDIS.HOST) {
            try {
                this.redis = createClient({
                    socket: {
                        host: CONFIG.REDIS.HOST,
                        port: CONFIG.REDIS.PORT,
                    },
                    password: CONFIG.REDIS.PASSWORD,
                    database: CONFIG.REDIS.DB,
                });
                await this.redis.connect();
                await this.redis.ping();
                console.log('Connected to Redis');
            } catch (error) {
                console.log('Redis unavailable, using local storage');
                printDebug(`[DEBUG] Error during Redis connection: ${error}`);
                this.redis = null;
            }
        } else {
            console.log('No Redis host configured, using local storage');
            this.redis = null;
        }
    }

    async disconnect(): Promise<void> {
        if (this.redis) {
            await this.redis.quit();
            console.log("Redis disconnected");
        }
    }

    async getClients(): Promise<{ [clientId: string]: Client }> {
        if (this.redis) {
            try {
                const clientsData = await this.redis.get('clients');
                return clientsData ? JSON.parse(clientsData) : {};
            } catch (error) {
                console.error("[ERROR] Error getting clients: ", error);
                return {};
            }
        }
        return { ...this.localClients };
    }

    async setClients(clients: { [clientId: string]: Client }): Promise<void> {
        if (this.redis) {
            try {
                await this.redis.set('clients', JSON.stringify(clients));
            } catch (error) {
                console.error(`[ERROR] Failed to update Redis clients: ${error}`);
            }
        }
        this.localClients = { ...clients };
    }

    async getRooms(): Promise<{ [roomId: string]: Room }> {
        if (this.redis) {
            try {
                const roomsData = await this.redis.get('rooms');
                return roomsData ? JSON.parse(roomsData) : {};
            } catch (error) {
                console.error("[ERROR] Error getting rooms: ", error);
                return {};
            }
        }
        return { ...this.localRooms };
    }

    async setRooms(rooms: { [roomId: string]: Room }): Promise<void> {
        if (this.redis) {
            try {
                await this.redis.set('rooms', JSON.stringify(rooms));
            } catch (error) {
                console.error(`[ERROR] Failed to update Rooms: ${error}`);
            }
        }
        this.localRooms = { ...rooms };
    }

    async getPrivateMessages(): Promise<{ [messageId: string]: PrivateMessage }> {
        if (this.redis) {
            try {
                const privateData = await this.redis.get('private_messages');
                return privateData ? JSON.parse(privateData) : {};
            } catch (error) {
                console.error(`[ERROR] Failed getting private messages: ${error}`);
                return {};
            }
        }
        return { ...this.localPrivateMessages };
    }

    async setPrivateMessages(privateMessages: { [messageId: string]: PrivateMessage }): Promise<void> {
        if (this.redis) {
            try {
                await this.redis.set('private_messages', JSON.stringify(privateMessages));
            } catch (error) {
                console.error(`[ERROR] Failed setting private messages: ${error}`);
            }
        }
        this.localPrivateMessages = { ...privateMessages };
    }

    get isRedisAvailable(): boolean {
        return this.redis?.isOpen ?? false;
    }
}

export const storage = new Storage();