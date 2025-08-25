import { type ServerWebSocket, type Server } from "bun";
import { DataManager } from "./dataManager";
import { storage } from "./storage";
import { CONFIG } from "./config";
import {isExpired, getCurrentISOString, generateUUID} from "./utils/utils.ts";
import { CryptoAuth } from "./utils/cryptography/auth.ts";
import { AuthenticationMiddleware } from "./utils/cryptography/auth-middleware.ts"
import { SecureSession } from "./utils/cryptography/session.ts"
import type {Client, Room, WSMessage, WebSocketData, WSResponse} from './types';

export class CommandHandler {
    constructor(private dataManager: DataManager, private serverId: string, private server: Server){ }

    public async handle(ws: ServerWebSocket<WebSocketData>, message: string | Buffer, wsClientMap: Map<string, ServerWebSocket<WebSocketData>>) {
        await this.dataManager.cleanExpiredData();
        SecureSession.cleanExpiredSessions();
        if(!ws.data.wsId) ws.data.wsId = generateUUID();

        let data: WSMessage;
        try {
            data = JSON.parse(message.toString());
        } catch {
            ws.send(JSON.stringify({ error: "Invalid JSON" }));
            return;
        }

        const { command } = data;
        let { client_id } = data;

        const debug_info = {
            server_instance: this.serverId,
            redis_available: storage.isRedisAvailable,
            command: command || "unknown",
            client_id: client_id,
        };

        if (command === "upload_public_key") {
            const username = data.username;
            if (!username || !/^[a-zA-Z0-9_-]{3,16}$/.test(username)) {
                this.sendResponse(ws, { command, error: "Invalid username format", debug: debug_info });
                return;
            }
            if (!data.public_key || !CryptoAuth.validatePublicKey(data.public_key)) {
                this.sendResponse(ws, {
                    command: data.command,
                    error: "Invalid public key format",
                    debug: debug_info
                });
                return;
            }
            const now = getCurrentISOString();
            const newClient: Client = {
                id: username,
                public_key: data.public_key,
                room_id: null,
                last_seen: now,
                created_at: now
            };

            const created = await storage.createClient(username, newClient);
            if (!created) {
                this.sendResponse(ws, { command, error: `Username '${username}' is already taken.` });
                return;
            }

            await this.dataManager.setClientOnline(username, true, true);

            ws.data.clientId = username;
            wsClientMap.set(username, ws);
            SecureSession.bindSession(ws.data.wsId, username, data.public_key);

            this.server.publish("global", JSON.stringify({
                event: "client_registered",
                client_id: username,
                timestamp: now
            }));

            const response: WSResponse = {
                command: command,
                message: "Client registered with success!",
                client_id: username,
                status: "registered",
                ttl_info: {
                    client_ttl_hours: CONFIG.CLIENT_TTL / 3600,
                    message_ttl_hours: CONFIG.MESSAGE_TTL / 3600
                },
                debug: debug_info
            };
            this.sendResponse(ws, response);
            return;
        }

        let authResult = await AuthenticationMiddleware.authenticate(
            data,
            ws.data.clientId || '',
            async (clientId: string) => {
                const client = await this.dataManager.getClient(clientId);
                return client?.public_key || null;
            }
        );
        if(!authResult.success && authResult.error === 'Client ID mismatch with WebSocket session') {
            if(typeof data.client_id === 'string'){
                const publicKey = await this.dataManager.getClient(data.client_id).then(c => c?.public_key || null);
                if(publicKey){
                    const verify = CryptoAuth.verifyMessage(data, data.client_id, publicKey);
                    if(verify.valid){
                        ws.data.clientId = data.client_id;
                        authResult = { success: true, clientId: data.client_id };
                    }
                }
            }
        }
        if(!authResult.success) {
            this.sendResponse(ws, {
                command: data.command,
                error: `Authentication failed: ${authResult.error}`,
                debug: debug_info
            });
            return;
        }
        const clientId = authResult.clientId!;
        ws.data.clientId = clientId;
        const clientForSession = await this.dataManager.getClient(clientId);
        if (clientForSession?.public_key) {
            SecureSession.bindSession(ws.data.wsId, clientId, clientForSession.public_key);
        } else if (command !== 'upload_public_key') {
            this.sendResponse(ws, {
                command: data.command,
                error: "Could not establish secure session: client key not found.",
                debug: debug_info
            });
            return;
        }

        if (!data.client_id) {
            ws.send(JSON.stringify({ command, error: "Missing client_id" }));
            return;
        }

        const currentClient = await this.dataManager.getClient(clientId);
        if (!currentClient) {
            this.sendResponse(ws, {
                command: data.command,
                error: "Client not found or expired",
                debug: debug_info
            });
            return;
        }

        if (!SecureSession.validateBinding(ws.data.wsId, clientId)) {
            this.sendResponse(ws, {
                command: data.command,
                error: "WebSocket not bound to this client. Session mismatch.",
                debug: debug_info
            });
            return;
        }

        await this.dataManager.updateClientLastSeen(clientId);
        debug_info.client_id = clientId;

        let response: WSResponse = { command, message: "Unknown command", debug: debug_info };

        switch (true) {
            case command.startsWith("create_room:"): {
                const room_name = command.split(":", 2)[1];
                if (!room_name) {
                    response.error = "Command format: create_room:ROOM_NAME";
                    break;
                }
                if(room_name.length > 50) {
                    response.error = "Room name is too long (max 50 characters)";
                    break;
                }
                if (!/^[a-zA-Z0-9_-]+$/.test(room_name)) {
                    response.error = "Room name can only contain letters, numbers, underscores, and hyphens";
                    break;
                }
                const room = await this.dataManager.getRoom(room_name);
                if(room) {
                    response.error = "Name already taken, please change or join it";
                    break;
                }
                const newRoom: Room = {
                    clients: {},
                    messages: [],
                    created_at: getCurrentISOString(),
                    last_activity: getCurrentISOString()
                };
                await storage.setRoom(room_name, newRoom);
                await this.joinRoom(client_id, currentClient, room_name);
                const roomInfo = await this.dataManager.getRoomInfo(room_name);
                response = {
                    ...response,
                    message: `Created room '${room_name}'`,
                    room_name: room_name,
                    clients_in_room: roomInfo?.clientCount || 1,
                    debug: debug_info
                };
                break;
            }
            case command.startsWith("join_room:"): {
                const room_name = command.split(":", 2)[1];
                if (!room_name) {
                    response.error = "Command format: join_room:ROOM_NAME";
                    break;
                }
                const room = await this.dataManager.getRoom(room_name);
                if(!room) {
                    response.error = "Invalid room name";
                    break;
                }
                wsClientMap.set(client_id, ws);
                await this.joinRoom(client_id, currentClient, room_name);
                const roomClients = await this.dataManager.getRoomClients(room_name);
                for (const otherClientId of roomClients) {
                    if (otherClientId === client_id) continue;
                    const otherWs = wsClientMap.get(otherClientId);
                    if (!otherWs) continue;
                    otherWs.send(JSON.stringify({
                        event: 'user_joined',
                        room_name,
                        client_id,
                        clients_in_room: roomClients.length
                    }));
                }
                response = {
                    ...response,
                    message: `Joined room '${room_name}'`,
                    room_name: room_name,
                    clients_in_room: roomClients.length
                };
                break;
            }
            case command.startsWith("send_message:"): {
                const message_text = command.split(":", 2)[1];
                if(!message_text || !this.validateMessage(message_text)){
                    response.error = "Invalid message length";
                    break;
                }
                const room_id = currentClient.room_id;
                if(room_id){
                    const isFile = data?.file === true;
                    const filename = data?.filename;
                    const mimetype = data?.mimetype; 
                    const content = data?.content;

                    await this.dataManager.addMessageToRoom(room_id, {
                        from_client: clientId,
                        text: message_text,
                        signature: data.signature,
                        timestamp: getCurrentISOString(),
                        public_key: currentClient.public_key,
                        verified: true,
                        file: isFile,
                        filename: filename,
                        mimetype: mimetype,
                        content: content
                    });

                    const roomClients = await this.dataManager.getRoomClients(room_id);
                    for(const otherClientId of roomClients){
                        if(otherClientId === client_id) continue;
                        const otherWs = wsClientMap.get(otherClientId);
                        if(!otherWs) continue;
                        

                        const messageData = {
                            event: 'room_message_received',
                            from: client_id,
                            timestamp: getCurrentISOString(),
                            text: message_text,
                            file: isFile
                        };
                        

                        if(isFile){
                            messageData.filename = filename;
                            messageData.mimetype = mimetype;
                            messageData.content = content;
                        }
                        
                        otherWs.send(JSON.stringify(messageData));
                    }
                    
                    response = {
                        ...response,
                        message: `Message sent in room '${room_id}'`,
                        room_name: room_id,
                        message_text: message_text,
                        file: isFile 
                    };
                } else response.error = "You aren't connected to any room";
                break;
            }
case command.startsWith("send_private:"): {
    const parts = command.split(":", 3);
    if(parts.length < 3){
        response.error = "Command format: send_private:CLIENT_USERNAME:MESSAGE";
        break;
    }
    
    const to_client_id = parts[1];
    const message_text = parts[2];
    
    if(!message_text || !this.validateMessage(message_text)){
        response.error = "Invalid message length";
        break;
    }
    
    const client = await this.dataManager.getClient(to_client_id);
    
    if(!client){
        response.error = "Recipient Client not found";
        break;
    }
    
    const isFile = data?.file === true;
    const filename = data?.filename;
    const mimetype = data?.mimetype;
    const content = data?.content;
    
    const message_id = await this.dataManager.addPrivateMessage(
        client_id,
        to_client_id,
        message_text,
        data?.signature,
        isFile,
        filename,
        mimetype,
        content
    );
    
    const messageData = {
        event: "private_message_received",
        from_client: client_id,
        to_client: to_client_id,
        text: message_text,
        timestamp: new Date().toISOString(),
        verified: true,
        file: isFile,
        message_id: message_id
    };
    
    if(isFile){
        messageData.filename = filename;
        messageData.mimetype = mimetype;
        messageData.content = content;
    }
    
    console.log(`Broadcasting private message from ${client_id} to ${to_client_id}${isFile ? ' (with file)' : ''}`);

    // to fix
    this.server.publish("global", JSON.stringify(messageData));
    
    response = {
        ...response,
        message: `Private message sent to ${to_client_id}${isFile ? ' (with file)' : ''}`,
        message_id,
        to_client: to_client_id,
        file: isFile
    };
    break;
}
            case command === "get_private_messages": {
                const all_messages = await this.dataManager.getUserPrivateMessages(client_id);
                const my_messages = all_messages
                    .map(msg => ({
                        ...msg,
                        direction: msg.to_client === client_id ? 'received' : 'sent' as 'sent' | 'received',
                        verified: !!msg.signature,
                        file: msg.file === true 
                    }))
                    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
                await this.dataManager.setPrivateMessagesAsRead(client_id);
                response = {
                    ...response,
                    message: "Retrieved private messages",
                    private_messages: my_messages,
                    total_messages: my_messages.length
                };
                break;
            }
            case command === "get_messages": {
                const room_id = currentClient.room_id;
                if (room_id) {
                    const room = await this.dataManager.getRoom(room_id);
                    if(room) {
                        const messages = (room.messages || []).map(msg => ({
                            ...msg,
                            verified: !!msg.signature,
                            file: msg.file === true 
                        }));
                        response = {
                            ...response,
                            message: `Messages for room '${room_id}'`,
                            room_name: room_id,
                            messages: messages,
                            total_messages: messages.length
                        };
                    }
                } else response.error = "You're not in any room";
                break;
            }
            case command === "list_clients": {
                const clients = await this.dataManager.getClients();
                const client_list = Object.entries(clients)
                    .filter(([cid, _]) => cid !== client_id)
                    .map(([cid, c_data]) => ({
                        client_id: cid,
                        room_id: c_data.room_id,
                        last_seen: c_data.last_seen,
                        online: !!c_data.online
                    }));
                response = {
                    ...response,
                    message: "List of available clients",
                    clients: client_list,
                    total_clients: client_list.length
                };
                break;
            }
            case command === "list_rooms": {
                const rooms = await this.dataManager.getRooms();
                const room_list = Object.entries(rooms).map(([name, r_data]) => ({
                    name: name,
                    clients: Object.keys(r_data.clients || {}).length,
                    messages: (r_data.messages || []).length,
                    created_at: r_data.created_at,
                    last_activity: r_data.last_activity
                }));
                response = {
                    ...response,
                    message: "List of available rooms",
                    rooms: room_list
                };
                break;
            }
            case command === "leave_room": {
                const room_id = currentClient.room_id;
                if (room_id) {
                    await this.dataManager.removeClientFromRoom(client_id, room_id);
                    currentClient.room_id = null;
                    await storage.setClient(client_id, currentClient);
                    await this.leaveBroadcast(client_id, room_id, wsClientMap, "user_left")
                    response.message = `Left the room '${room_id}'`;
                } else response.error = "You're not in any room";
                break;
            }
            case command === "heartbeat": {
                const wasOffline = !currentClient.online;
                await this.dataManager.setClientOnline(client_id, true, true);
                
       
                if (wasOffline) {
                    this.server.publish("global", JSON.stringify({
                        event: "client_online",
                        client_id: client_id,
                        timestamp: getCurrentISOString()
                    }));
                }
                
                response = {
                    ...response,
                    message: "Heartbeat received",
                    client_status: "alive"
                };
                break;
            }
            case command === "disconnect": {
                const room_id = currentClient.room_id || "";
                await this.dataManager.removeClient(client_id);
                wsClientMap.delete(client_id);
                await this.leaveBroadcast(client_id, room_id, wsClientMap, "user_disconnect");
                
      
                this.server.publish("global", JSON.stringify({
                    event: "client_offline",
                    client_id: client_id,
                    timestamp: getCurrentISOString()
                }));
                
                response = {
                    ...response,
                    message: `Client ${client_id} disconnected and removed`,
                    status: 'disconnected'
                };
                this.sendResponse(ws, response);
                ws.close(1000, "Client initiated disconnect");
                return;
            }
        }

        this.sendResponse(ws, response);
    }

    private async joinRoom(client_id: string, currentClient: Client, room_name: string): Promise<void> {
        if (currentClient.room_id) await this.dataManager.removeClientFromRoom(client_id, currentClient.room_id);
        currentClient.room_id = room_name;
        await storage.setClient(client_id, currentClient);
        await this.dataManager.addClientToRoom(room_name, client_id, {
            public_key: currentClient.public_key,
            last_seen: getCurrentISOString()
        });
    }

    private async leaveBroadcast(client_id: string,
                           room_id: string,
                           wsClientMap: Map<string, ServerWebSocket<WebSocketData>>,
                           event_name: string) {
        if(!room_id) return;
        const roomClients = await this.dataManager.getRoomClients(room_id);
        const remainingClients = roomClients.filter(id => id !== client_id);
        for (const otherClientId of remainingClients) {
            if (otherClientId === client_id) continue;
            const otherWs = wsClientMap.get(otherClientId);
            if (!otherWs) continue;
            otherWs.send(JSON.stringify({
                event: event_name,
                room_name: room_id,
                client_id: client_id,
                clients_in_rooms: remainingClients.length
            }));
        }
    }

    private sendResponse(ws: ServerWebSocket<WebSocketData>, response: any): void {
        try {
            if (!CONFIG.DEBUG && response.debug) delete response.debug;
            if (ws.readyState === 1) ws.send(JSON.stringify(response));
        } catch (error) {
            console.error('[ERROR] Failed to send response:', error);
        }
    }

    private validateMessage(message: string): boolean {
        return message.length <= 1024 && message.trim().length > 0;
    }
}