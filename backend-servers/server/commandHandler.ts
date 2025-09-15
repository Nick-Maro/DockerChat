import {type Server, type ServerWebSocket} from "bun";
import {DataManager} from "./dataManager";
import {storage} from "./storage";
import {CONFIG} from "./config";
import {DebugLevel, generateUUID, getCurrentISOString, printDebug } from "./utils/utils.ts";
import {CryptoAuth} from "./utils/cryptography/auth.ts";
import {AuthenticationMiddleware} from "./utils/cryptography/auth-middleware.ts"
import {SecureSession} from "./utils/cryptography/session.ts"
import {MessageFilter} from "./src/filters/MessageFilter.ts";
import type {Client, Room, WebSocketData, WSMessage, WSResponse} from './types';

export class CommandHandler {
    private messageFilter: MessageFilter;

    constructor(private dataManager: DataManager, private serverId: string, private server: Server){ 
        this.messageFilter = new MessageFilter();
        this.loadCustomFilters();
    }

    private async loadCustomFilters(): Promise<void> {
        try {
            await this.messageFilter.loadLDNOOBWLists('./src/filters');
            await this.messageFilter.loadPatternsFromFile('./src/filters/custom-filters.json');
            printDebug('[FILTER] Filters loaded successfully', DebugLevel.INFO);
        } catch (error) {
            printDebug('[FILTER] Failed to load filters: ' + error, DebugLevel.WARN);
        }
    }

    private filterMessage(message: string): string {
        return this.messageFilter.filterMessage(message);
    }

    private containsFilteredContent(message: string): boolean {
        return this.messageFilter.containsFilteredContent(message);
    }

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
        try {
            const incomingPreview = {
                command: (data && data.command) || null,
                client_id: (data && data.client_id) || null,
                encrypted: data?.encrypted === true,
                contentLength: typeof data?.content === 'string' ? data.content.length : undefined
            };
            printDebug('[CMD] Incoming WS message preview:' + JSON.stringify(incomingPreview), DebugLevel.LOG);
        }
        catch (diagErr) { printDebug('[CMD] Failed to log incoming preview:' + diagErr, DebugLevel.WARN); }

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

        if (command === "upload_ecdh_key") {
            const username = data.username;
            if (!username || !/^[a-zA-Z0-9_-]{3,16}$/.test(username)) {
                this.sendResponse(ws, { command, error: "Invalid username format", debug: debug_info });
                return;
            }

            const existingClient = await this.dataManager.getClient(username);
            if (!existingClient) {
                this.sendResponse(ws, {
                    command,
                    error: "Client not found. Please upload public key first.",
                    debug: debug_info
                });
                return;
            }

            if (!data.ecdh_key || !CryptoAuth.validateECDHKey(data.ecdh_key)) {
                this.sendResponse(ws, {
                    command: data.command,
                    error: "Invalid ECDH key format",
                    debug: debug_info
                });
                return;
            }

            const now = getCurrentISOString();

            const updatedClient: Client = {
                ...existingClient,
                ecdh_key: data.ecdh_key,
                last_seen: now
            };

            await storage.setClient(username, updatedClient);
            await this.dataManager.setClientOnline(username, true, true);

            ws.data.clientId = username;
            wsClientMap.set(username, ws);

            SecureSession.updateECDHKey(ws.data.wsId, username, data.ecdh_key);

            this.server.publish("global", JSON.stringify({
                event: "client_ecdh_updated",
                client_id: username,
                timestamp: now
            }));

            const response: WSResponse = {
                command: command,
                message: "ECDH key uploaded successfully!",
                client_id: username,
                status: "ecdh_updated",
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
            case command.startsWith("get_ecdh_key:"): {
                const target_username = command.split(":", 2)[1];
                if (!target_username) {
                    response.error = "Command format: get_ecdh_key:USERNAME";
                    break;
                }

                if (!/^[a-zA-Z0-9_-]{3,16}$/.test(target_username)) {
                    response.error = "Invalid username format";
                    break;
                }

                if (target_username === clientId) {
                    response.error = "Cannot request your own ECDH key";
                    break;
                }

                const targetClient = await this.dataManager.getClient(target_username);
                if (!targetClient) {
                    response.error = "User not found";
                    break;
                }

                if (!targetClient.ecdh_key) {
                    response.error = "User has not uploaded ECDH key yet";
                    try {
                        const targetWs = wsClientMap.get(target_username);
                        if (targetWs && targetWs.readyState === 1) {
                            targetWs.send(JSON.stringify({ event: 'request_upload_ecdh', requester: clientId }));
                            printDebug(`[CMD] Requested ECDH upload from ${target_username} on behalf of ${clientId}`, DebugLevel.LOG);
                        }
                    } catch (notifyErr) {
                        printDebug(`[CMD] Failed to request ECDH upload for ${target_username}:` + notifyErr, DebugLevel.WARN);
                    }

                    break;
                }

                const sameRoom = currentClient.room_id && targetClient.room_id === currentClient.room_id;
                response = {
                    ...response,
                    message: `ECDH key retrieved for user '${target_username}'`,
                    target_user: target_username,
                    ecdh_key: targetClient.ecdh_key,
                    user_online: !!targetClient.online,
                    same_room: sameRoom,
                    debug: debug_info
                };
                (response as any).event = 'get_ecdh_key';
                break;
            }
            case command.startsWith("create_room:"): {
                let room_name = command.split(":", 2)[1];
                if (!room_name) {
                    response.error = "Command format: create_room:ROOM_NAME";
                    break;
                }

                if (this.containsFilteredContent(room_name)) {
                    printDebug(`[FILTER] Inappropriate room name by ${clientId}: ${room_name}`, DebugLevel.WARN);
                    room_name = this.filterMessage(room_name);
                }

                if(room_name.length > 50) {
                    response.error = "Room name is too long (max 50 characters)";
                    break;
                }
                if (!/^[a-zA-Z0-9_\-\s*]+$/.test(room_name)) {
                    response.error = "Room name can only contain letters, numbers, underscores, hyphens, spaces, and asterisks";
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
                for (const [otherClientId, otherWs] of wsClientMap.entries()) {
                    if (otherClientId === client_id) continue;
                    if (otherWs.readyState === 1) {
                        otherWs.send(JSON.stringify({
                            event: "room_created",
                            room_name: room_name,
                            client_id: client_id,
                            clients_in_room: roomInfo?.clientCount || 1
                        }));
                    }
                }

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
                let message_text = command.split(":", 2)[1];
                const isFile = data?.file === true;
                const filename = data?.filename;
                const mimetype = data?.mimetype; 
                const content = data?.content;
                const encrypted = data?.encrypted === true;
                const reply_to = data?.reply_to;
                const reply_to_text = data?.reply_to_text;
                const reply_to_user = data?.reply_to_user;
                
                if(!encrypted && !isFile && message_text) {
                    if (this.containsFilteredContent(message_text)) {
                        printDebug(`[FILTER] Inappropriate content in room message from ${clientId}`, DebugLevel.WARN);
                    }
                    message_text = this.filterMessage(message_text);
                }
                
                if(!encrypted && !isFile && (!message_text || !this.validateMessage(message_text))){
                    response.error = "Invalid message length";
                    break;
                }
                const room_id = currentClient.room_id;
                if(room_id){
                    await this.dataManager.addMessageToRoom(room_id, {
                        from_client: clientId,
                        text: encrypted ? (data?.content || '') : message_text,
                        signature: data.signature,
                        timestamp: getCurrentISOString(),
                        public_key: currentClient.public_key,
                        verified: true,
                        file: isFile,
                        filename: filename,
                        mimetype: mimetype,
                        content: content,
                        encrypted: encrypted,
                        reply_to: reply_to,
                        reply_to_text: reply_to_text,
                        reply_to_user: reply_to_user
                    });

                    const roomClients = await this.dataManager.getRoomClients(room_id);
                    for(const otherClientId of roomClients){
                        if(otherClientId === client_id) continue;
                        const otherWs = wsClientMap.get(otherClientId);
                        if(!otherWs) continue;                
                        const messageData = {
                            event: 'room_message_received',
                            from_client: client_id,
                            room_name: room_id,
                            timestamp: getCurrentISOString(),
                            text: encrypted ? (data?.content || '') : message_text,
                            file: isFile,
                            encrypted: encrypted,
                            content: encrypted ? (data?.content || '') : (isFile ? content : message_text),
                            reply_to: reply_to,
                            reply_to_text: reply_to_text,
                            reply_to_user: reply_to_user
                        };                       
                        if(isFile){
                            (messageData as any).filename = filename;
                            (messageData as any).mimetype = mimetype;
                        }

                        if(encrypted) {
                            if(data?.sk_fingerprint) (messageData as any).sk_fingerprint = data.sk_fingerprint;
                            if(data?.sender_ecdh_public) (messageData as any).sender_ecdh_public = data.sender_ecdh_public;
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
                if (parts.length < 3) {
                    response.error = "Command format: send_private:CLIENT_USERNAME:MESSAGE";
                    break;
                }

                const to_client_id = parts[1];
                let message_text = parts[2];
                const reply_to = data?.reply_to;
                const reply_to_text = data?.reply_to_text;
                const reply_to_user = data?.reply_to_user;

                if(data?.encrypted === true && data?.content) {
                    message_text = data.content;
                } else if(message_text) {
                    if (this.containsFilteredContent(message_text)) {
                        printDebug(`[FILTER] Inappropriate content in private message from ${clientId} to ${to_client_id}`, DebugLevel.WARN);
                    }
                    message_text = this.filterMessage(message_text);
                }
                
                if (!(data?.encrypted === true)){
                    if(!message_text || !this.validateMessage(message_text)){
                        response.error = "Invalid message length";
                        break;
                    }
                }

                const client = await this.dataManager.getClient(to_client_id);
                try {
                    const diag = {
                        from: client_id,
                        to: to_client_id,
                        encrypted: data?.encrypted === true,
                        textLength: message_text.length || undefined,
                        contentLength: typeof data?.content === 'string' ? data.content.length : undefined,
                        hasSignature: !!data?.signature,
                        isFile: data?.file === true
                    };
                    printDebug('[CMD] send_private payload diag:' + JSON.stringify(diag), DebugLevel.LOG);
                }
                catch(dErr){ printDebug('[CMD] Failed to log send_private diag:' + dErr, DebugLevel.WARN); }

                if (!client) {
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
                    content,
                    data?.encrypted === true,
                    reply_to,
                    reply_to_text,
                    reply_to_user
                );

                const messageData = {
                    event: "private_message_received",
                    from_client: client_id,
                    to_client: to_client_id,
                    text: message_text,
                    timestamp: new Date().toISOString(),
                    verified: true,
                    file: isFile,
                    message_id: message_id,
                    encrypted: data?.encrypted === true,
                    reply_to: reply_to,
                    reply_to_text: reply_to_text,
                    reply_to_user: reply_to_user
                };

                if (isFile) {
                    messageData.filename = filename;
                    messageData.mimetype = mimetype;
                    messageData.content = content;
                }

                if(data?.sk_fingerprint) (messageData as any).sk_fingerprint = data.sk_fingerprint;
                if(data?.sender_ecdh_public) (messageData as any).sender_ecdh_public = data.sender_ecdh_public;

                printDebug(`Broadcasting private message from ${client_id} to ${to_client_id}${isFile ? ' (with file)' : ''}`, DebugLevel.LOG);

                const targetWs = wsClientMap.get(to_client_id);
                    if (targetWs && targetWs.readyState === 1) {
                        targetWs.send(JSON.stringify(messageData));
                    }

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
            case command.startsWith("delete_private_message:"): {
                const messageId = command.split(":", 2)[1];
                if(!messageId || messageId.trim() === ''){
                    response.error = "Command format: delete_private_message:MESSAGE_ID";
                    break;
                }

                const messageIdTrim = messageId.trim();
                try {
                    const deletionResult = await this.dataManager.deletePrivateMessage(messageIdTrim, client_id);

                    if (deletionResult.success) {
                        response = {
                            ...response,
                            message: deletionResult.message || "Message deleted",
                            message_id: messageId.trim()
                        };
                        
                        try {
                            const allMessages = await this.dataManager.getPrivateMessages();
                            const deletedMessage = Object.values(allMessages).find(msg => msg.id === messageId.trim());
                            if (deletedMessage) {
                                const otherClientId = deletedMessage.from_client === client_id ? deletedMessage.to_client : deletedMessage.from_client;
                                const otherWs = wsClientMap.get(otherClientId);
                                if (otherWs && otherWs.readyState === 1) {
                                    otherWs.send(JSON.stringify({
                                        event: "private_message_deleted",
                                        message_id: messageId.trim(),
                                        deleted_by: client_id,
                                        timestamp: getCurrentISOString()
                                    }));
                                }
                            }
                        } catch (notifyError) {
                            printDebug(`[CMD] Failed to notify other client about message deletion: ${notifyError}`, DebugLevel.WARN);
                        }
                        
                        printDebug(`[CMD] Message ${messageId.trim()} deleted by ${client_id}`, DebugLevel.INFO);
                    } else {
                        response.error = deletionResult.message || deletionResult.error || "Impossibile eliminare il messaggio";
                        
                        switch (deletionResult.error){
                            case 'MESSAGE_NOT_FOUND':
                                printDebug(`[CMD] Delete attempt failed - message not found: ${messageId} by ${client_id}`, DebugLevel.WARN);
                                break;
                            case 'UNAUTHORIZED':
                                printDebug(`[CMD] Unauthorized delete attempt: ${messageId} by ${client_id}`, DebugLevel.WARN);
                                break;
                            default:
                                printDebug(`[CMD] Delete failed: ${deletionResult.error} for message ${messageId} by ${client_id}`, DebugLevel.WARN);
                        }
                    }
                } catch(error) {
                    response.error = "Errore interno durante l'eliminazione del messaggio";
                    printDebug(`[CMD] Unexpected error in delete_private_message: ${error}`, DebugLevel.ERROR);
                }
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
            printDebug('[ERROR] Failed to send response:' + error, DebugLevel.ERROR);
        }
    }

    private validateMessage(message: string): boolean {
        return message.length <= 1024 && message.trim().length > 0;
    }

    public addFilterPattern(pattern: RegExp, replacement: string, category: string): void {
        this.messageFilter.addPattern({ pattern, replacement, category });
        printDebug(`[FILTER] Added new filter pattern for category: ${category}`, DebugLevel.INFO);
    }

    public removeFiltersByCategory(category: string): void {
        this.messageFilter.removePatternsByCategory(category);
        printDebug(`[FILTER] Removed all filters for category: ${category}`, DebugLevel.INFO);
    }
}