import { storage } from './storage';
import { CONFIG } from './config';
import { isExpired, generateUUID, getCurrentISOString } from './utils/utils.ts';
import type { Message, PrivateMessage, ClientInRoom, Client, Room } from './types';

export class DataManager {
    private cleanupLock = false;
    private lastCleanup = 0;
    private readonly CLEANUP_INTERVAL = 60000; // 1 minute

    private clientCache = new Map<string, {client: Client, timestamp: number}>();
    private roomCache = new Map<string, {room: Room, timestamp: number}>();
    private readonly CACHE_TTL = 30000; 
    private lastCacheCleanup = 0;
    private readonly CACHE_CLEANUP_INTERVAL = 300000; 

    
    private pendingOperations = new Set<Promise<any>>();

    async cleanExpiredData(): Promise<void> {
        const now = Date.now();
        if (this.cleanupLock || now - this.lastCleanup < this.CLEANUP_INTERVAL) return;
        this.cleanupLock = true;
        this.lastCleanup = now;
        try {
            await this.cleanExpiredDataInternal();
        } finally {
            this.cleanupLock = false;
        }
    }


    private async cleanExpiredDataInternal(): Promise<void> {
        const [expiredClientIds, rooms] = await Promise.all([
            storage.getExpiredClientIds(CONFIG.CLIENT_TTL),
            storage.getRooms()
        ]);

        if (expiredClientIds.length > 0) {
            
            const batchOperations = expiredClientIds.map(async (clientId) => {
                const client = await storage.getClient(clientId);
                if (client?.room_id) await this.removeClientFromRoom(clientId, client.room_id);
                await storage.setClientOnline(clientId, false, false);
                this.clientCache.delete(clientId); 
            });
            await Promise.all(batchOperations);
        }


        await Promise.all([
            this.cleanExpiredRooms(),
            this.cleanExpiredMessages()
        ]);

        this.cleanCacheIfNeeded();
    }


    async getClient(clientId: string): Promise<Client | null> {
        const cached = this.clientCache.get(clientId);
        if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
            return cached.client;
        }

        const client = await storage.getClient(clientId);
        if (client) {
            this.clientCache.set(clientId, {client, timestamp: Date.now()});
        }
        return client;
    }

    
    async getRoom(roomId: string): Promise<Room | null> {
        const cached = this.roomCache.get(roomId);
        if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
            return cached.room;
        }

        const room = await storage.getRoom(roomId);
        if (room) {
            this.roomCache.set(roomId, {room, timestamp: Date.now()});
        }
        return room;
    }

    
    async setClientOnline(clientId: string, online: boolean, touchLastSeen: boolean = false): Promise<void> {
        this.clientCache.delete(clientId); // Invalida cache
        return storage.setClientOnline(clientId, online, touchLastSeen);
    }

    async updateClientLastSeen(clientId: string): Promise<void> {
        const client = await this.getClient(clientId);
        if (client) {
            client.last_seen = getCurrentISOString();
            await storage.setClient(clientId, client);
            this.clientCache.set(clientId, {client, timestamp: Date.now()}); 
        }
    }

    
    private cleanCacheIfNeeded(): void {
        const now = Date.now();
        if (now - this.lastCacheCleanup > this.CACHE_CLEANUP_INTERVAL) {
            for (const [key, value] of this.clientCache.entries()) {
                if (now - value.timestamp > this.CACHE_TTL) {
                    this.clientCache.delete(key);
                }
            }
            for (const [key, value] of this.roomCache.entries()) {
                if (now - value.timestamp > this.CACHE_TTL) {
                    this.roomCache.delete(key);
                }
            }
            this.lastCacheCleanup = now;
        }
    }

    
    private async cleanExpiredRooms(): Promise<void> {
        const rooms = await storage.getRooms();
        const roomsToDelete = [];

        for (const [roomId, roomData] of Object.entries(rooms)) {
            const clientIds = await storage.getRoomClients(roomId);
            const hasActiveClients = clientIds.length > 0;
            if (!hasActiveClients && isExpired(roomData.last_activity, CONFIG.ROOM_TTL)) {
                roomsToDelete.push(roomId);
                this.roomCache.delete(roomId); 
            }
        }

        
        if (roomsToDelete.length > 0) {
            await Promise.all(roomsToDelete.map(roomId => storage.deleteRoom(roomId)));
        }
    }

    
    private async cleanExpiredMessages(): Promise<void> {
        const rooms = await storage.getRooms();
        const roomUpdates: Promise<void>[] = [];

        for (const [roomId, roomData] of Object.entries(rooms)) {
            if (roomData.messages && roomData.messages.length > 0) {
                const originalCount = roomData.messages.length;
                roomData.messages = roomData.messages.filter(msg => !isExpired(msg.timestamp, CONFIG.MESSAGE_TTL));
                
                if (roomData.messages.length !== originalCount) {
                    this.roomCache.delete(roomId); 
                    roomUpdates.push(storage.setRoom(roomId, roomData));
                }
            }
        }

        
        await Promise.all(roomUpdates);
    }

    async addMessageToRoom(roomId: string, message: Message): Promise<void> {
        let room = await this.getRoom(roomId);
        if (!room) {
            room = {
                clients: {},
                messages: [],
                created_at: getCurrentISOString(),
                last_activity: getCurrentISOString()
            };
        }
        room.messages = room.messages || [];
        room.messages.push(message);
        room.last_activity = getCurrentISOString();
        
        this.roomCache.set(roomId, {room, timestamp: Date.now()}); 
        await storage.setRoom(roomId, room);
    }

    async addClientToRoom(roomId: string, clientId: string, clientData: ClientInRoom): Promise<void> {
        let room = await this.getRoom(roomId);
        if (!room) {
            room = {
                clients: {},
                messages: [],
                created_at: getCurrentISOString(),
                last_activity: getCurrentISOString()
            };
        }
        room.clients[clientId] = clientData;
        room.last_activity = getCurrentISOString();
        
        this.roomCache.set(roomId, {room, timestamp: Date.now()}); 
        await storage.setRoom(roomId, room);
    }

    async removeClientFromRoom(clientId: string, roomId: string): Promise<void> {
        try {
            const [room, client] = await Promise.all([
                this.getRoom(roomId),
                this.getClient(clientId)
            ]);
            
            const updates: Promise<any>[] = [];
            
            if (room && room.clients[clientId]) {
                delete room.clients[clientId];
                room.last_activity = getCurrentISOString();
                this.roomCache.set(roomId, {room, timestamp: Date.now()});
                updates.push(storage.setRoom(roomId, room));
            }
            
            if (client && client.room_id === roomId) {
                client.room_id = null;
                this.clientCache.set(clientId, {client, timestamp: Date.now()}); 
                updates.push(storage.setClient(clientId, client));
            }
            
            updates.push(storage.removeClientFromRoom(clientId, roomId));
            

            await Promise.all(updates);
        } catch (error) {
            console.error(`[ERROR] Failed to remove client from room: ${error}`);
            this.clientCache.delete(clientId);
            this.roomCache.delete(roomId);
            try {
                await storage.removeClientFromRoom(clientId, roomId);
            } catch (cleanupError) {
                console.error(`[ERROR] Failed cleanup: ${cleanupError}`);
            }
            throw error;
        }
    }

    async removeClient(clientId: string): Promise<void> {
        const client = await this.getClient(clientId);
        if (!client) return;
        
        const roomId = client.room_id;
        const operations: Promise<any>[] = [];
        
        if (roomId) operations.push(this.removeClientFromRoom(clientId, roomId));
        operations.push(storage.deleteClient(clientId));
        
        this.clientCache.delete(clientId); 
        await Promise.all(operations);
    }


    async setPrivateMessagesAsRead(clientId: string): Promise<void> {
        const messages = await storage.getClientPrivateMessages(clientId, 100);
        const updates = messages
            .filter(message => message.to_client === clientId && !message.read)
            .map(message => storage.setPrivateMessageAsRead(message.id));
        
        await Promise.all(updates);
    }

    async addPrivateMessage(
        fromClient: string, 
        toClient: string, 
        messageText: string, 
        signature?: string,
        isFile?: boolean,
        filename?: string,
        mimetype?: string,
        content?: string,
        encrypted?: boolean
    ): Promise<string> {
        const messageId = generateUUID();
        const message: PrivateMessage = {
            id: messageId,
            from_client: fromClient,
            to_client: toClient,
            text: messageText,
            signature,
            timestamp: getCurrentISOString(),
            read: false,
            file: isFile || false,
            filename: filename || "",
            mimetype: mimetype || "",
            content: content || "",
            encrypted: encrypted || false
        };
        await storage.addPrivateMessage(message);
        return messageId;
    }


    async getRoomClients(roomId: string): Promise<string[]> {
        return storage.getRoomClients(roomId);
    }

    async getUserPrivateMessages(userId: string, limit: number = 50): Promise<PrivateMessage[]> {
        return storage.getClientPrivateMessages(userId, limit);
    }

    async getClients(): Promise<{ [clientId: string]: Client }> {
        return storage.getClients();
    }

    async getRooms(): Promise<{ [roomId: string]: Room }> {
        return storage.getRooms();
    }

    async getPrivateMessages(): Promise<{ [messageId: string]: PrivateMessage }> {
        return storage.getPrivateMessages();
    }

    async getActiveClientsCount(): Promise<number> {
        const clients = await storage.getClients();
        let count = 0;
        for(const client of Object.values(clients)){ if(client.online) count++; }
        return count;
    }

    async getRoomInfo(roomId: string): Promise<{ clientCount: number; messageCount: number } | null> {
        const room = await this.getRoom(roomId);
        if (!room) return null;
        const clientIds = await storage.getRoomClients(roomId);
        return {
            clientCount: clientIds.length,
            messageCount: room.messages?.length || 0
        };
    }

    async isClientInRoom(clientId: string, roomId: string): Promise<boolean> {
        const client = await this.getClient(clientId);
        return client?.room_id === roomId;
    }

    async getClientECDHKey(clientId: string): Promise<string | null> {
        return await storage.getClientECDHKey(clientId);
    }

    async getRoomECDHKeys(roomId: string): Promise<Map<string, string>> {
        const clientIds = await storage.getRoomClients(roomId);
        return await storage.getBatchClientECDHKeys(clientIds);
    }
}