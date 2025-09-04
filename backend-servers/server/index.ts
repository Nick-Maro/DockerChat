import {type Server, type ServerWebSocket, type WebSocketHandler} from "bun";
import {storage} from "./storage";
import {DataManager} from "./dataManager";
import {CommandHandler} from "./commandHandler";
import {CONFIG} from "./config";
import {DebugLevel, generateUUID, isExpired, printDebug} from "./utils/utils.ts";
import type {ServerStatus, WebSocketData} from './types';

await storage.initialize();
const dataManager = new DataManager();
const serverId = `Bun-${generateUUID()}`;
const wsClientMap: Map<string, ServerWebSocket<WebSocketData>> = new Map();
let commandHandler: CommandHandler;

console.log(`Bun server starting on ${CONFIG.SERVER.HOST}:${CONFIG.SERVER.PORT}...`);

export const websocket: WebSocketHandler<WebSocketData> = {
    open(ws) {
        printDebug(`[WS] Connection opened.`, DebugLevel.LOG);
        ws.subscribe("global");

        const pingInterval = setInterval(() => {
            if(ws.readyState === 1) ws.ping();
            else clearInterval(pingInterval);
        }, 30000);
        
        ws.data.pingInterval = pingInterval;
    },
    message(ws, message) {
        let data;
        try { data = JSON.parse(message.toString()); }
        catch {
            commandHandler.handle(ws, message, wsClientMap);
            return;
        }

        if(data.type === 'ping'){
            ws.send(JSON.stringify({
                type: 'pong',
                timestamp: data.timestamp,
                server_time: Date.now()
            }));
            if(data.client_id) {
                ws.data.clientId = data.client_id;
                ws.data.lastPong = Date.now();
                if (!wsClientMap.has(data.client_id) || wsClientMap.get(data.client_id)?.data.wsId !== ws.data.wsId) {
                    dataManager.setClientOnline(data.client_id, true);
                    dataManager.updateClientLastSeen(data.client_id);
                    wsClientMap.set(data.client_id, ws);
                }
            }
            return;
        }

        if (data.client_id) {
            ws.data.clientId = data.client_id;
            const existingSocket = wsClientMap.get(data.client_id);
            if (!existingSocket || existingSocket.data.wsId !== ws.data.wsId) {
                printDebug(`[WS] Re-associating clientId=${data.client_id} with new socket.`, DebugLevel.LOG);
                dataManager.setClientOnline(data.client_id, true);
                dataManager.updateClientLastSeen(data.client_id);
                wsClientMap.set(data.client_id, ws);
            }
        }

        commandHandler.handle(ws, message, wsClientMap);
    },
    ping(ws, data) {
        ws.pong(data);
        printDebug(`[WS] Responded to ping from client: ${ws.data.clientId}`, DebugLevel.LOG);
    },
    pong(ws, data) {
        printDebug(`[WS] Received pong from client: ${ws.data.clientId}`, DebugLevel.LOG);
        if(ws.data.clientId){ ws.data.lastPong = Date.now(); }
    },
    close(ws, code, reason) {
        printDebug(`[WS] Connection closed: code=${code}, reason=${reason}, clientId=${ws.data.clientId}`, DebugLevel.LOG);
        if(ws.data.pingInterval) clearInterval(ws.data.pingInterval);
        const clientId = ws.data.clientId;
        if(clientId) dataManager.setClientOnline(clientId, false);
    },
};

const server: Server = Bun.serve({
    port: CONFIG.SERVER.PORT,
    hostname: CONFIG.SERVER.HOST,
    /*tls: {
        key: Bun.file("./key.pem"),
        cert: Bun.file("./cert.pem"),
    },*/

    async fetch(req, server) {
        const url = new URL(req.url);

        if (req.method === "GET" && url.pathname === "/status") {
            await dataManager.cleanExpiredData();

            const clients = await dataManager.getClients();
            const rooms = await dataManager.getRooms();
            const privateMsgs = await dataManager.getPrivateMessages();

            const onlineClients = Object.values(clients).filter(client => !isExpired(client.last_seen, CONFIG.CLIENT_TTL)).length;

            const status: ServerStatus = {
                server_instance: serverId,
                redis_available: storage.isRedisAvailable,
                total_clients: Object.keys(clients).length,
                online_clients: onlineClients,
                total_rooms: Object.keys(rooms).length,
                total_private_messages: Object.keys(privateMsgs).length,
                ttl_config: {
                    client_ttl_seconds: CONFIG.CLIENT_TTL,
                    room_ttl_seconds: CONFIG.ROOM_TTL,
                    message_ttl_seconds: CONFIG.MESSAGE_TTL
                },
                rooms: Object.fromEntries(
                    Object.entries(rooms).map(([name, data]) => [
                        name,
                        {
                            clients: Object.keys(data.clients || {}).length,
                            messages: (data.messages || []).length,
                            last_activity: data.last_activity
                        }
                    ])
                )
            };
            return new Response(JSON.stringify(status), {
                headers: { "Content-Type": "application/json" },
            });
        }

        const success = server.upgrade(req, {
            data: {
                wsId: generateUUID(),
                clientId: null,
                authenticated: false
            }
        });
        if (success) return;
        return new Response("Not Found", { status: 404 });
    },

    websocket: {
        ...websocket,
        idleTimeout: 120,
        maxBackpressure: 64 * 1024,
        maxCompressedSize: 64 * 1024,
        maxPayloadLength: 16 * 1024 * 1024,
    },
});

commandHandler = new CommandHandler(dataManager, serverId, server);

console.log(`Server listening on http://${server.hostname}:${server.port}`);