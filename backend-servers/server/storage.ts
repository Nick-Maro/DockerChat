import type {RedisClientType} from 'redis';
import {createClient} from 'redis';
import {CONFIG} from './config';
import type {Client, PrivateMessage, Room} from './types';
import {printDebug} from './utils/utils.ts';

class Storage {
    private redis: RedisClientType | null = null;
    private localClients: Map<string, Client> = new Map();
    private localRooms: Map<string, Room> = new Map();
    private localPrivateMessages: Map<string, PrivateMessage> = new Map();
    private clientCache: Map<string, { data: Client; timestamp: number }> = new Map();
    private roomCache: Map<string, { data: Room; timestamp: number }> = new Map();
    private readonly CACHE_TTL = 30000;
    private readonly MAX_CACHE_SIZE = 1000;
    private readonly REDIS_KEYS = {
        CLIENT: (id: string) => `client:${id}`,
        ROOM: (id: string) => `room:${id}`,
        PRIVATE_MSG: (id: string) => `pm:${id}`,
        CLIENT_ROOM_INDEX: (roomId: string) => `room_clients:${roomId}`,
        USER_MESSAGES_INDEX: (userId: string) => `user_messages:${userId}`
    };

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

                this.redis.on('error', (err) => {
                    console.error('[Redis Error]:', err);
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

    async getClient(clientId: string): Promise<Client | null> {
        const cached = this.clientCache.get(clientId);
        if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) return cached.data;
        if (this.redis) {
            try {
                const clientData = await this.redis.get(this.REDIS_KEYS.CLIENT(clientId));
                if (clientData) {
                    const client = JSON.parse(clientData) as Client;
                    this.clientCache.set(clientId, { data: client, timestamp: Date.now() });
                    this.localClients.set(clientId, client);
                    return client;
                }
                return null;
            } catch (error) {
                console.error("[ERROR] Error getting client: ", error);
            }
        }
        return this.localClients.get(clientId) || null;
    }

    async createClient(clientId: string, client: Client): Promise<boolean> {
        if (this.redis) {
            try {
                const result = await this.redis.set(this.REDIS_KEYS.CLIENT(clientId), JSON.stringify(client), { NX: true });
                if (result) {
                    this.clientCache.set(clientId, { data: client, timestamp: Date.now() });
                    return true;
                }
                return false;
            } catch (error) {
                console.error(`[ERROR] Failed to create client atomically: ${error}`);
                throw error;
            }
        } else {
            if (this.localClients.has(clientId)) return false;
            this.localClients.set(clientId, client);
            return true;
        }
    }

    async setClient(clientId: string, client: Client): Promise<void> {
        this.cleanupCache(this.clientCache);
        if (this.redis) {
            try {
                const pipeline = this.redis.multi();
                pipeline.set(this.REDIS_KEYS.CLIENT(clientId), JSON.stringify(client));
                if (client.room_id) pipeline.sAdd(this.REDIS_KEYS.CLIENT_ROOM_INDEX(client.room_id), clientId);
                await pipeline.exec();
                this.clientCache.set(clientId, { data: client, timestamp: Date.now() });
            } catch (error) {
                this.clientCache.delete(clientId);
                console.error(`[ERROR] Failed to update Redis client: ${error}`);
                throw error;
            }
        } else {
            this.localClients.set(clientId, client);
            this.clientCache.set(clientId, { data: client, timestamp: Date.now() });
        }
    }

    async getRoom(roomId: string): Promise<Room | null> {
        const cached = this.roomCache.get(roomId);
        if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) return cached.data;
        if (this.redis) {
            try {
                const roomData = await this.redis.get(this.REDIS_KEYS.ROOM(roomId));
                if (roomData) {
                    const room = JSON.parse(roomData) as Room;
                    this.roomCache.set(roomId, { data: room, timestamp: Date.now() });
                    return room;
                }
                return null;
            } catch (error) {
                console.error("[ERROR] Error getting room: ", error);
                return this.localRooms.get(roomId) || null;
            }
        }
        return this.localRooms.get(roomId) || null;
    }

    async setRoom(roomId: string, room: Room): Promise<void> {
        this.roomCache.set(roomId, { data: room, timestamp: Date.now() });
        if (this.redis) {
            try {
                await this.redis.set(this.REDIS_KEYS.ROOM(roomId), JSON.stringify(room));
            } catch (error) {
                console.error(`[ERROR] Failed to update room: ${error}`);
            }
        }
        this.localRooms.set(roomId, room);
    }

    async getRoomClients(roomId: string): Promise<string[]> {
        if (this.redis) {
            try {
                return await this.redis.sMembers(this.REDIS_KEYS.CLIENT_ROOM_INDEX(roomId)) || [];
            } catch (error) {
                console.error("[ERROR] Error getting room clients: ", error);
            }
        }

        const clients: string[] = [];
        for (const [clientId, client] of this.localClients) {
            if (client.room_id === roomId) clients.push(clientId);
        }
        return clients;
    }

    async removeClientFromRoom(clientId: string, roomId: string): Promise<void> {
        if (this.redis) {
            try {
                await this.redis.sRem(this.REDIS_KEYS.CLIENT_ROOM_INDEX(roomId), clientId);
            } catch (error) {
                console.error(`[ERROR] Failed to remove client from room: ${error}`);
            }
        }
    }

    async deleteClient(clientId: string): Promise<void> {
        this.clientCache.delete(clientId);
        if (this.redis) {
            try {
                const client = await this.getClient(clientId);
                const pipeline = this.redis.multi();
                pipeline.del(this.REDIS_KEYS.CLIENT(clientId));
                if (client?.room_id) pipeline.sRem(this.REDIS_KEYS.CLIENT_ROOM_INDEX(client.room_id), clientId);
                await pipeline.exec();
            } catch (error) {
                this.localClients.delete(clientId);
                console.error(`[ERROR] Failed to delete client: ${error}`);
            }
        }
        this.localClients.delete(clientId);
    }

    async deleteRoom(roomId: string): Promise<void> {
        this.roomCache.delete(roomId);
        if (this.redis) {
            try {
                const clients = await this.getRoomClients(roomId);
                const pipeline = this.redis.multi();
                if(clients.length > 0) {
                    const clientKeys = clients.map(id => this.REDIS_KEYS.CLIENT(id));
                    const clientsData = await this.redis.mGet(clientKeys);

                    clientsData.forEach((clientJson) => {
                        if (clientJson) {
                            const client = JSON.parse(clientJson) as Client;
                            client.room_id = null;
                            pipeline.set(this.REDIS_KEYS.CLIENT(client.id), JSON.stringify(client));
                            this.clientCache.set(client.id, { data: client, timestamp: Date.now() });
                            const localClient = this.localClients.get(client.id);
                            if (localClient) localClient.room_id = null;
                        }
                    });
                }
                pipeline.del(this.REDIS_KEYS.ROOM(roomId));
                pipeline.del(this.REDIS_KEYS.CLIENT_ROOM_INDEX(roomId));
                await pipeline.exec();
            } catch (error) {
                console.error(`[ERROR] Failed to delete room: ${error}`);
                throw error;
            }
        }
        const room = this.localRooms.get(roomId);
        if (room && room.clients) {
            for (const clientId of Object.keys(room.clients)) {
                const client = this.localClients.get(clientId);
                if (client) client.room_id = null;
            }
        }
        this.localRooms.delete(roomId);
    }

    async addPrivateMessage(message: PrivateMessage): Promise<void> {
        if (this.redis) {
            try {
                const pipeline = this.redis.multi();
                pipeline.set(this.REDIS_KEYS.PRIVATE_MSG(message.id), JSON.stringify(message));
                pipeline.lPush(this.REDIS_KEYS.USER_MESSAGES_INDEX(message.to_client), message.id);
                pipeline.lPush(this.REDIS_KEYS.USER_MESSAGES_INDEX(message.from_client), message.id);
                await pipeline.exec();
            } catch (error) {
                console.error(`[ERROR] Failed to add private message: ${error}`);
            }
        }
        this.localPrivateMessages.set(message.id, message);
    }

    async getClientPrivateMessages(userId: string, limit: number = 50): Promise<PrivateMessage[]> {
        if (this.redis) {
            try {
                const messageIds = await this.redis.lRange(this.REDIS_KEYS.USER_MESSAGES_INDEX(userId), 0, limit - 1);
                if (!messageIds || messageIds.length === 0) return [];
                const messageKeys = messageIds.map(id => this.REDIS_KEYS.PRIVATE_MSG(id));
                const messagesData = await this.redis.mGet(messageKeys);
                const messages = messagesData
                    .filter((data): data is string => data !== null)
                    .map(data => JSON.parse(data) as PrivateMessage);
                return messages.slice(0, limit);
            } catch (error) {
                console.error(`[ERROR] Error getting user messages: ${error}`);
            }
        }
        const messages: PrivateMessage[] = [];
        for (const message of this.localPrivateMessages.values()) {
            if (message.to_client === userId || message.from_client === userId) messages.push(message);
        }
        return messages.slice(0, limit);
    }

    async setPrivateMessageAsRead(messageId: string): Promise<void> {
        if (this.redis) {
            try {
                const messageData = await this.redis.get(this.REDIS_KEYS.PRIVATE_MSG(messageId));
                if (messageData) {
                    const message = JSON.parse(messageData) as PrivateMessage;
                    if (message.read) return;
                    message.read = true;
                    await this.redis.set(this.REDIS_KEYS.PRIVATE_MSG(messageId), JSON.stringify(message));
                }
            } catch (error) {
                console.error(`[ERROR] Failed to mark message as read: ${error}`);
            }
        }
        const localMessage = this.localPrivateMessages.get(messageId);
        if (localMessage) localMessage.read = true;
    }

    async getExpiredClientIds(ttl: number): Promise<string[]> {
        const expiredIds: string[] = [];
        const now = Date.now();

        if (this.redis) {
            try {
                const allClientKeys: string[] = [];
                let cursor = '0';
                do {
                    const result = await this.redis.scan(cursor, { MATCH: 'client:*', COUNT: 100 });
                    cursor = result.cursor;
                    allClientKeys.push(...result.keys);
                } while (cursor !== '0');
                if(allClientKeys.length === 0) return [];
                const clientsData = await this.redis.mGet(allClientKeys);
                clientsData.forEach((clientData) => {
                    if (clientData) {
                        const client = JSON.parse(clientData) as Client;
                        if (now - new Date(client.last_seen).getTime() > ttl * 1000) {
                            expiredIds.push(client.id);
                        }
                    }
                });
            } catch (error) {
                console.error("[ERROR] Error scanning for expired clients: ", error);
            }
        } else {
            for (const [clientId, client] of this.localClients) {
                if (now - new Date(client.last_seen).getTime() > ttl * 1000) expiredIds.push(clientId);
            }
        }
        return expiredIds;
    }

    async batchDeleteClients(clientIds: string[]): Promise<void> {
        if (clientIds.length === 0) return;
        for (const clientId of clientIds) {
            this.clientCache.delete(clientId);
            this.localClients.delete(clientId);
        }
        if (this.redis) {
            try {
                const pipeline = this.redis.multi();
                for (const clientId of clientIds) {
                    pipeline.del(this.REDIS_KEYS.CLIENT(clientId));
                }
                await pipeline.exec();
            } catch (error) {
                console.error(`[ERROR] Failed to batch delete clients: ${error}`);
            }
        }
    }

    async getClients(): Promise<{ [clientId: string]: Client }> {
        const result: { [clientId: string]: Client } = {};
        if (this.redis) {
            try {
                const clientKeys = await this.getAllKeysByPattern('client:*');
                if (clientKeys.length === 0) return {};
                const clientsData = await this.redis.mGet(clientKeys);
                clientsData.forEach((clientJson) => {
                    if (clientJson) {
                        const client = JSON.parse(clientJson) as Client;
                        result[client.id] = client;
                    }
                });
            } catch (error) {
                console.error("[ERROR] Error getting all clients: ", error);
                return Object.fromEntries(this.localClients);
            }
        } else return Object.fromEntries(this.localClients);
        return result;
    }

    async getRooms(): Promise<{ [roomId: string]: Room }> {
        const result: { [roomId: string]: Room } = {};
        if (this.redis) {
            try {
                const roomKeys = await this.getAllKeysByPattern('room:*');
                if (roomKeys.length === 0) return {};
                const roomsData = await this.redis.mGet(roomKeys);
                roomsData.forEach((roomJson, index) => {
                    const roomKey = roomKeys[index];
                    if (roomJson && roomKey) {
                        const room = JSON.parse(roomJson) as Room;
                        const roomId = roomKey.replace('room:', '');
                        result[roomId] = room;
                    }
                });
            } catch (error) {
                console.error("[ERROR] Error getting all rooms: ", error);
                return Object.fromEntries(this.localRooms);
            }
        } else return Object.fromEntries(this.localRooms);
        return result;
    }

    async getPrivateMessages(): Promise<{ [messageId: string]: PrivateMessage }> {
        const result: { [messageId: string]: PrivateMessage } = {};
        if (this.redis) {
            try {
                const messageKeys = await this.getAllKeysByPattern('pm:*');
                if (messageKeys.length === 0) return {};
                const messagesData = await this.redis.mGet(messageKeys);
                messagesData.forEach((messageJson) => {
                    if (messageJson) {
                        const message = JSON.parse(messageJson) as PrivateMessage;
                        result[message.id] = message;
                    }
                });
            } catch (error) {
                console.error("[ERROR] Error getting private messages: ", error);
                return Object.fromEntries(this.localPrivateMessages);
            }
        } else return Object.fromEntries(this.localPrivateMessages);
        return result;
    }

    get isRedisAvailable(): boolean {
        return this.redis?.isOpen ?? false;
    }

    async getAllKeysByPattern(pattern: string): Promise<string[]> {
        if (!this.redis) return [];
        const keys: string[] = [];
        let cursor = '0';
        do {
            const result = await this.redis.scan(cursor, { MATCH: pattern, COUNT: 100 });
            cursor = result.cursor;
            keys.push(...result.keys);
        } while (cursor !== '0');
        return keys;
    }

    private cleanupCache<T>(cache: Map<string, { data: T; timestamp: number }>) {
        if (cache.size > this.MAX_CACHE_SIZE) {
            const entries = Array.from(cache.entries());
            entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
            const toRemove = Math.floor(this.MAX_CACHE_SIZE * 0.2);
            for (let i = 0; i < toRemove; i++) {
                const entry = entries[i];
                if(entry) cache.delete(entry[0]);
            }
        }
    }
}

export const storage = new Storage();