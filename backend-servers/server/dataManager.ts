import { storage } from './storage';
import { CONFIG } from './config';
import { isExpired, generateUUID, getCurrentISOString } from './utils';
import type { Message, PrivateMessage, ClientInRoom, Client, Room } from './types';

export class DataManager {
    async cleanExpiredData(): Promise<void> {
        const clients = await storage.getClients();
        const rooms = await storage.getRooms();
        const privateMessages = await storage.getPrivateMessages();

        const expiredClients: string[] = [];
        for (const [clientId, clientData] of Object.entries(clients)) {
            if (isExpired(clientData.last_seen, CONFIG.CLIENT_TTL)) expiredClients.push(clientId);
        }

        for (const clientId of expiredClients) {
            delete clients[clientId];
            for (const room of Object.values(rooms)) {
                if (room.clients && clientId in room.clients) {
                    delete room.clients[clientId];
                    room.last_activity = getCurrentISOString();
                }
            }
        }

        for (const room of Object.values(rooms)) {
            if (room.messages) room.messages = room.messages.filter(msg => !isExpired(msg.timestamp, CONFIG.MESSAGE_TTL));
        }

        const emptyRooms: string[] = [];
        for (const [roomId, roomData] of Object.entries(rooms)) {
            const noClients = !roomData.clients || Object.keys(roomData.clients).length === 0;
            if (noClients && isExpired(roomData.last_activity, CONFIG.ROOM_TTL)) emptyRooms.push(roomId);
        }

        for (const roomId of emptyRooms) {
            delete rooms[roomId];
        }

        const expiredPrivateMessages: string[] = [];
        for (const [msgId, msgData] of Object.entries(privateMessages)) {
            if (isExpired(msgData.timestamp, CONFIG.MESSAGE_TTL)) expiredPrivateMessages.push(msgId);
        }
        for (const msgId of expiredPrivateMessages) {
            delete privateMessages[msgId];
        }

        await storage.setClients(clients);
        await storage.setRooms(rooms);
        await storage.setPrivateMessages(privateMessages);
    }

    async addMessageToRoom(roomId: string, message: Message): Promise<void> {
        const rooms = await storage.getRooms();

        if (!rooms[roomId]) {
            rooms[roomId] = {
                clients: {},
                messages: [],
                created_at: getCurrentISOString(),
                last_activity: getCurrentISOString()
            };
        }

        rooms[roomId]!.messages.push(message);
        rooms[roomId]!.last_activity = getCurrentISOString();

        await storage.setRooms(rooms);
    }

    async addClientToRoom(roomId: string, clientId: string, clientData: ClientInRoom): Promise<void> {
        const rooms = await storage.getRooms();
        if (!rooms[roomId]) {
            rooms[roomId] = {
                clients: {},
                messages: [],
                created_at: getCurrentISOString(),
                last_activity: getCurrentISOString()
            };
        }

        rooms[roomId]!.clients[clientId] = clientData;
        rooms[roomId]!.last_activity = getCurrentISOString();

        await storage.setRooms(rooms);
    }

    async addPrivateMessage(fromClient: string, toClient: string, messageText: string, signature?: string): Promise<string> {
        const privateMessages = await storage.getPrivateMessages();
        const messageId = generateUUID();

        const message: PrivateMessage = {
            id: messageId,
            from_client: fromClient,
            to_client: toClient,
            text: messageText,
            signature,
            timestamp: getCurrentISOString(),
            read: false
        };

        privateMessages[messageId] = message;
        await storage.setPrivateMessages(privateMessages);

        return messageId;
    }

    async updateClientLastSeen(clientId: string): Promise<void> {
        const clients = await storage.getClients();
        if (clients[clientId]) {
            clients[clientId]!.last_seen = getCurrentISOString();
            await storage.setClients(clients);
        }
    }

    async removeClientFromRoom(clientId: string, roomId: string): Promise<void> {
        const rooms = await storage.getRooms();
        if (rooms[roomId] && rooms[roomId]!.clients[clientId]) {
            delete rooms[roomId]!.clients[clientId];
            rooms[roomId]!.last_activity = getCurrentISOString();
            await storage.setRooms(rooms);
        }
    }

    async removeClient(clientId: string): Promise<void> {
        const clients = await storage.getClients();
        const client = clients[clientId];
        if (!client) return;

        const roomId = client.room_id;

        delete clients[clientId];
        await storage.setClients(clients);

        if (roomId) await this.removeClientFromRoom(clientId, roomId);
    }

    async markPrivateMessagesAsRead(clientId: string): Promise<void> {
        const privateMessages = await storage.getPrivateMessages();
        let changed = false;
        for (const message of Object.values(privateMessages)) {
            if (message.to_client === clientId && !message.read) {
                message.read = true;
                changed = true;
            }
        }
        if (changed) await storage.setPrivateMessages(privateMessages);
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
}