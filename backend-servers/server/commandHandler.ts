import { type ServerWebSocket } from "bun";
import { DataManager } from "./dataManager";
import { storage } from "./storage";
import { CONFIG } from "./config";
import { isExpired, generateUUID, getCurrentISOString } from "./utils";
import type {Client, Room, WSMessage, WSResponse} from './types';

type WebSocketData = {
    clientId: string | null;
};

export class CommandHandler {
    constructor(private dataManager: DataManager, private serverId: string) {}

    public async handle(ws: ServerWebSocket<WebSocketData>, message: string | Buffer, wsClientMap: Map<string, ServerWebSocket<WebSocketData>>) {
        await this.dataManager.cleanExpiredData();

        let data: WSMessage;
        try {
            data = JSON.parse(message.toString());
        } catch {
            ws.send(JSON.stringify({ error: "Invalid JSON" }));
            return;
        }

        const { command, public_key, signature } = data;
        let { client_id } = data;

        const debug_info = {
            server_instance: this.serverId,
            redis_available: storage.isRedisAvailable,
            command: command || "unknown",
            client_id: client_id
        };

        if (command === "upload_public_key") {
            if (!public_key) {
                ws.send(JSON.stringify({ command, error: "Missing public_key" }));
                return;
            }
            client_id = client_id || generateUUID();
            const clients = await this.dataManager.getClients();
            const now = getCurrentISOString();
            clients[client_id] = {
                public_key: public_key,
                room_id: null,
                last_seen: now,
                created_at: now
            };
            await storage.setClients(clients);

            ws.data.clientId = client_id;
            wsClientMap.set(client_id, ws);

            const response: WSResponse = {
                command: command,
                message: "Client registered with success!",
                client_id: client_id,
                status: "registered",
                ttl_info: {
                    client_ttl_hours: CONFIG.CLIENT_TTL / 3600,
                    message_ttl_hours: CONFIG.MESSAGE_TTL / 3600
                },
                debug: debug_info
            };
            ws.send(JSON.stringify(response));
            return;
        }

        if (!client_id) {
            ws.send(JSON.stringify({ command, error: "Missing client_id" }));
            return;
        }

        const clients = await this.dataManager.getClients();
        const currentClient = clients[client_id];

        if (!currentClient) {
            ws.send(JSON.stringify({ command, error: "Unregistered client" }));
            return;
        }

        await this.dataManager.updateClientLastSeen(client_id);
        debug_info.client_id = client_id;

        let response: WSResponse = { command, message: "Unknown command", debug: debug_info };

        switch (true) {
            case command.startsWith("create_room:"): {
                const room_name = command.split(":", 2)[1];
                if (!room_name) {
                    response.error = "Command format: create_room:ROOM_NAME";
                    break;
                }
                const rooms = await this.dataManager.getRooms();
                if(rooms && rooms[room_name]) {
                    response.error = "Name already taken, please change or join it";
                    break;
                }
                await this.joinRoom(client_id, currentClient, room_name, clients, rooms)
                response = {
                    ...response,
                    message: `Created room '${room_name}'`,
                    room_name: room_name,
                    clients_in_room: Object.keys(rooms[room_name]?.clients || {}).length
                };
                break;
            }
            case command.startsWith("join_room:"): {
                const room_name = command.split(":", 2)[1];
                if (!room_name) {
                    response.error = "Command format: join_room:ROOM_NAME";
                    break;
                }
                const rooms = await this.dataManager.getRooms();
                if(!rooms || !rooms[room_name]) {
                    response.error = "Invalid room name";
                    break;
                }
                await this.joinRoom(client_id, currentClient, room_name, clients, rooms)
                for (const [otherClientId, otherWs] of wsClientMap) {
                    if (otherClientId !== client_id && clients[otherClientId]?.room_id === room_name) {
                        otherWs.send(JSON.stringify({
                            event: 'user_joined',
                            room_name: room_name,
                            client_id: client_id,
                            clients_in_room: Object.keys(rooms[room_name].clients).length
                        }));
                    }
                }
                response = {
                    ...response,
                    message: `Joined room '${room_name}'`,
                    room_name: room_name,
                    clients_in_room: Object.keys(rooms[room_name]?.clients || {}).length
                };
                break;
            }
            case command.startsWith("send_message:"): {
                const message_text = command.split(":", 2)[1];

                const room_id = currentClient.room_id;
                if (room_id) {
                    await this.dataManager.addMessageToRoom(room_id, {
                        from_client: client_id,
                        text: message_text!,
                        signature,
                        timestamp: getCurrentISOString(),
                        public_key: currentClient.public_key
                    });
                    for (const [otherClientId, otherWs] of wsClientMap) {
                        if (otherClientId !== client_id && clients[otherClientId]?.room_id === currentClient.room_id) {
                            otherWs.send(JSON.stringify({
                                event: 'room_message_received',
                                from: client_id,
                                text: message_text,
                                timestamp: getCurrentISOString()
                            }));
                        }
                    }
                    response = {
                        ...response,
                        message: `Message sent in room '${room_id}'`,
                        room_name: room_id,
                        message_text: message_text
                    };
                } else response.error = "You aren't connected to any room";
                break;
            }
            case command.startsWith("send_private:"): {
                const parts = command.split(":", 3);
                if (parts.length < 3 || !parts[1] || !parts[2]) {
                    response.error = "Command format: send_private:CLIENT_ID:MESSAGE";
                    break;
                }

                const to_client_id = parts[1];
                const message_text = parts[2];
                const to_client_ws = wsClientMap.get(to_client_id);

                if (clients[to_client_id] && to_client_ws) {
                    const message_id = await this.dataManager.addPrivateMessage(client_id, to_client_id, message_text, signature);
                    to_client_ws.send(JSON.stringify({
                        event: 'private_message_received',
                        from: client_id,
                        text: message_text,
                        timestamp: getCurrentISOString()
                    }));
                    response = {
                        ...response,
                        message: `Private message sent to ${to_client_id}`,
                        message_id,
                        to_client: to_client_id
                    };
                } else response.error = "Recipient Client not found";
                break;
            }
            case command === "get_private_messages": {
                const all_messages = Object.values(await this.dataManager.getPrivateMessages());
                const my_messages = all_messages
                    .filter(msg => msg.to_client === client_id || msg.from_client === client_id)
                    .map(msg => ({
                        ...msg,
                        direction: msg.to_client === client_id ? 'received' : 'sent' as 'sent' | 'received'
                    }))
                    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

                await this.dataManager.markPrivateMessagesAsRead(client_id);

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
                    const rooms = await this.dataManager.getRooms();
                    const messages = rooms[room_id]?.messages || [];
                    response = {
                        ...response,
                        message: `Messages for room '${room_id}'`,
                        room_name: room_id,
                        messages: messages,
                        total_messages: messages.length
                    };
                } else response.error = "You're not in any room";
                break;
            }
            case command === "list_clients": {
                const client_list = Object.entries(clients)
                    .filter(([cid, _]) => cid !== client_id)
                    .map(([cid, c_data]) => ({
                        client_id: cid,
                        room_id: c_data.room_id,
                        last_seen: c_data.last_seen,
                        online: !isExpired(c_data.last_seen, CONFIG.CLIENT_TTL)
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
                const rooms = await this.dataManager.getRooms();
                if (room_id) {
                    await this.dataManager.removeClientFromRoom(client_id, room_id);
                    currentClient.room_id = null;
                    await storage.setClients(clients);
                    this.leaveBroadcast(currentClient, client_id, clients, room_id, rooms, wsClientMap, "user_left")
                    response.message = `Left the room '${room_id}'`;
                } else response.error = "You're not in any room";
                break;
            }
            case command === "heartbeat": {
                response = {
                    ...response,
                    message: "Heartbeat received",
                    client_status: "alive"
                };
                break;
            }
            case command === "disconnect": {
                const rooms = await this.dataManager.getRooms();
                const room_id = currentClient.room_id || "";
                await this.dataManager.removeClient(client_id);
                wsClientMap.delete(client_id);
                this.leaveBroadcast(currentClient, client_id, clients, room_id, rooms, wsClientMap, "user_disconnect")
                response = {
                    ...response,
                    message: `Client ${client_id} disconnected and removed`,
                    status: 'disconnected'
                };
                ws.send(JSON.stringify(response));
                ws.close(1000, "Client initiated disconnect");
                return;
            }
        }

        ws.send(JSON.stringify(response));
    }

    private async joinRoom(client_id: string, currentClient: Client, room_name: string, clients: {[p: string]: Client}, rooms: {[p: string]: Room}) {
        if (currentClient.room_id) await this.dataManager.removeClientFromRoom(client_id, currentClient.room_id);
        currentClient.room_id = room_name;
        await storage.setClients(clients);
        await this.dataManager.addClientToRoom(room_name, client_id, {
            public_key: currentClient.public_key,
            last_seen: getCurrentISOString()
        });
        
        // room name check
        if(!rooms[room_name]){
            rooms[room_name] = {
                clients: {},
                messages: [],
                created_at: getCurrentISOString(),
                last_activity: getCurrentISOString()
            };
        }
        
        rooms[room_name].clients[client_id] = {
            public_key: currentClient.public_key,
            last_seen: getCurrentISOString()
        };
    }

    private leaveBroadcast(currentClient : Client, client_id: string, clients: { [p: string]: Client },
                           room_id: string, rooms: { [ r: string]: Room },
                           wsClientMap: Map<string, ServerWebSocket<WebSocketData>>,
                           event_name: string) {
        for (const [otherClientId, otherWs] of wsClientMap) {
            if (otherClientId !== client_id && clients[otherClientId]?.room_id === currentClient.room_id) {
                otherWs.send(JSON.stringify({
                    event: event_name,
                    room_name: room_id,
                    client_id: client_id,
                    clients_in_room: Object.keys(rooms[room_id]?.clients || {}).length
                }));
            }
        }
    }
}