import {storage} from './storage';
import {CONFIG} from './config';
import {DebugLevel, generateUUID, getCurrentISOString, isExpired, printDebug} from './utils/utils.ts';
import type {Client, ClientInRoom, Message, PrivateMessage, Room} from './types';

export class DataManager {
    private cleanupLock = false;
    private lastCleanup = 0;
    private readonly CLEANUP_INTERVAL = 60000; // 1 minute

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
        const expiredClientIds = await storage.getExpiredClientIds(CONFIG.CLIENT_TTL);
        if (expiredClientIds.length > 0) {
            for (const clientId of expiredClientIds) {
                const client = await storage.getClient(clientId);
                if (client?.room_id) await this.removeClientFromRoom(clientId, client.room_id);
                await storage.setClientOnline(clientId, false, false);
            }
            /* await storage.batchDeleteClients(expiredClientIds); */
        }
        await this.cleanExpiredRooms();
        await this.cleanExpiredMessages();
    }

    async setClientOnline(clientId: string, online: boolean, touchLastSeen: boolean = false): Promise<void> {
        return storage.setClientOnline(clientId, online, touchLastSeen);
    }

    private async cleanExpiredRooms(): Promise<void> {
        const rooms = await storage.getRooms();
        const roomsToDelete: string[] = [];

        for (const [roomId, roomData] of Object.entries(rooms)) {
            const clientIds = await storage.getRoomClients(roomId);
            const hasActiveClients = clientIds.length > 0;
            if (!hasActiveClients && isExpired(roomData.last_activity, CONFIG.ROOM_TTL)) roomsToDelete.push(roomId);
        }

        for (const roomId of roomsToDelete) {
            await storage.deleteRoom(roomId);
        }
    }

    private async cleanExpiredMessages(): Promise<void> {
        const rooms = await storage.getRooms();
        let cleanedRooms = 0;

        for (const [roomId, roomData] of Object.entries(rooms)) {
            if (roomData.messages && roomData.messages.length > 0) {
                const originalCount = roomData.messages.length;
                roomData.messages = roomData.messages.filter(msg => !isExpired(msg.timestamp, CONFIG.MESSAGE_TTL));
                if (roomData.messages.length !== originalCount) {
                    await storage.setRoom(roomId, roomData);
                    cleanedRooms++;
                }
            }
        }
    }

    async addMessageToRoom(roomId: string, message: Message): Promise<void> {
        let room = await storage.getRoom(roomId);
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
        await storage.setRoom(roomId, room);
    }

    async addClientToRoom(roomId: string, clientId: string, clientData: ClientInRoom): Promise<void> {
        let room = await storage.getRoom(roomId);
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
        await storage.setRoom(roomId, room);
    }

    async addPrivateMessage(
        fromClient: string, 
        toClient: string, 
        messageText: string, 
        message_id: string,
        signature?: string,
        isFile?: boolean,
        filename?: string,
        mimetype?: string,
        content?: string,
        encrypted?: boolean,
    ): Promise<string> {
        const message: PrivateMessage = {
            id: message_id,
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
        return message_id;
    }

    async updateClientLastSeen(clientId: string): Promise<void> {
        const client = await storage.getClient(clientId);
        if (client) {
            client.last_seen = getCurrentISOString();
            await storage.setClient(clientId, client);
        }
    }

    async removeClientFromRoom(clientId: string, roomId: string): Promise<void> {
        try {
            const [room, client] = await Promise.all([
                storage.getRoom(roomId),
                storage.getClient(clientId)
            ]);
            if (room && room.clients[clientId]) {
                delete room.clients[clientId];
                room.last_activity = getCurrentISOString();
                await storage.setRoom(roomId, room);
            }
            if (client && client.room_id === roomId) {
                client.room_id = null;
                await storage.setClient(clientId, client);
            }
            await storage.removeClientFromRoom(clientId, roomId);
        } catch (error) {
            console.error(`[ERROR] Failed to remove client from room: ${error}`);
            try {
                await storage.removeClientFromRoom(clientId, roomId);
            } catch (cleanupError) {
                console.error(`[ERROR] Failed cleanup: ${cleanupError}`);
            }
            throw error;
        }
    }

    async removeClient(clientId: string): Promise<void> {
        const client = await storage.getClient(clientId);
        if (!client) return;
        const roomId = client.room_id;
        if (roomId) await this.removeClientFromRoom(clientId, roomId);
        await storage.deleteClient(clientId);
    }

    async setPrivateMessagesAsRead(clientId: string): Promise<void> {
        const messages = await storage.getClientPrivateMessages(clientId, 100);
        for (const message of messages) {
            if (message.to_client === clientId && !message.read) await storage.setPrivateMessageAsRead(message.id);
        }
    }

    async getClient(clientId: string): Promise<Client | null> {
        return storage.getClient(clientId);
    }

    async getRoom(roomId: string): Promise<Room | null> {
        return storage.getRoom(roomId);
    }

    async getRoomClients(roomId: string): Promise<string[]> {
        return storage.getRoomClients(roomId);
    }

    async getUserPrivateMessages(userId: string, limit: number = 50): Promise<PrivateMessage[]> {
        const messages = await storage.getClientPrivateMessages(userId, limit);
        return messages;
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
        const room = await storage.getRoom(roomId);
        if (!room) return null;
        const clientIds = await storage.getRoomClients(roomId);
        return {
            clientCount: clientIds.length,
            messageCount: room.messages?.length || 0
        };
    }

    async isClientInRoom(clientId: string, roomId: string): Promise<boolean> {
        const client = await storage.getClient(clientId);
        return client?.room_id === roomId;
    }

    async getClientECDHKey(clientId: string): Promise<string | null> {
        return await storage.getClientECDHKey(clientId);
    }

    async getRoomECDHKeys(roomId: string): Promise<Map<string, string>> {
        const clientIds = await storage.getRoomClients(roomId);
        return await storage.getBatchClientECDHKeys(clientIds);
    }

    // to fix
    async deletePrivateMessage(messageId: string, requestingClientId?: string): Promise<{ success: boolean; error?: string; message?: string }> {
        try {
            if(!messageId || typeof messageId !== 'string' || messageId.trim() === ''){
                return {
                    success: false,
                    error: 'INVALID_MESSAGE_ID',
                    message: 'Message ID not valid'
                };
            }

            const trimmedMessageId = messageId.trim();

            if (requestingClientId) {
                const privateMessages = await storage.getPrivateMessages();
                const messageToDelete = privateMessages[trimmedMessageId];
                
                if (!messageToDelete) {
                    return {
                        success: false,
                        error: 'MESSAGE_NOT_FOUND',
                        message: 'Message not found'
                    };
                }

                const isAuthorized = messageToDelete.from_client === requestingClientId;
                if (!isAuthorized){
                    return {
                        success: false,
                        error: 'UNAUTHORIZED',
                        message: "You don't have permission for do this"
                    };
                }

                const requestingClient = await storage.getClient(requestingClientId);
                if (!requestingClient){
                    return {
                        success: false,
                        error: 'CLIENT_NOT_FOUND',
                        message: 'Client not found'
                    };
                }

                await this.updateClientLastSeen(requestingClientId);
            }

            const deletionResult = await storage.deletePrivateMessage(trimmedMessageId);

            if (deletionResult){
                return {
                    success: true,
                    message: 'Message delete successfully'
                };
            } else {
                return {
                    success: false,
                    error: 'DELETION_FAILED',
                    message: 'Failed message deletion: the message probably not exists.'
                };
            }
        } catch(error){
            printDebug(`[ERROR] DataManager.deletePrivateMessage failed: ${error}`, DebugLevel.ERROR);
            return {
                success: false,
                error: 'INTERNAL_ERROR',
                message: "Error during message deletion"
            };
        }
    }

    async updatePrivateMessage(messageId: string, updatedFields: Partial<PrivateMessage>): Promise<boolean> {
        try { return await storage.updatePrivateMessage(messageId, updatedFields); }
        catch(err){
            printDebug(`[ERROR] DataManager.updatePrivateMessage failed: ${err}`, DebugLevel.ERROR);
            return false;
        }
    }

    async deleteMultiplePrivateMessages(messageIds: string[], requestingClientId?: string): Promise<{ 
        success: boolean; 
        deletedCount: number; 
        failedCount: number; 
        errors: Array<{ messageId: string; error: string }> 
    }> {
        const results = {
            success: true,
            deletedCount: 0,
            failedCount: 0,
            errors: [] as Array<{ messageId: string; error: string }>
        };

        if(!messageIds || messageIds.length === 0){
            results.success = false;
            results.errors.push({ messageId: '', error: 'Nessun ID messaggio fornito' });
            return results;
        }

        if(requestingClientId) await this.updateClientLastSeen(requestingClientId);

        for(const messageId of messageIds){
            try {
                const result = await this.deletePrivateMessage(messageId, requestingClientId);
                if (result.success) {
                    results.deletedCount++;
                } else {
                    results.failedCount++;
                    results.errors.push({ 
                        messageId, 
                        error: result.error || result.message || 'Errore sconosciuto' 
                    });
                }
            } catch (error) {
                results.failedCount++;
                results.errors.push({ 
                    messageId, 
                    error: `Errore durante l'eliminazione: ${error}` 
                });
            }
        }

        if(results.failedCount > 0) results.success = false;
        return results;
    }
}