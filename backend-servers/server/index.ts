import { type Server, type ServerWebSocket, type WebSocketHandler } from "bun";
import { storage } from "./storage";
import { DataManager } from "./dataManager";
import { CommandHandler } from "./commandHandler";
import { CONFIG } from "./config";
import { isExpired, generateUUID, printDebug } from "./utils/utils.ts";
import type { ServerStatus , WebSocketData} from './types';

await storage.initialize();
const dataManager = new DataManager();
const serverId = `Bun-${generateUUID()}`;
const wsClientMap: Map<string, ServerWebSocket<WebSocketData>> = new Map();
let commandHandler: CommandHandler;

console.log(`Bun server starting on ${CONFIG.SERVER.HOST}:${CONFIG.SERVER.PORT}...`);

export const websocket: WebSocketHandler<WebSocketData> = {
    open(ws) {
        printDebug(`[WS] Connection opened.`);
        ws.subscribe("global");
    },
    message(ws, message) {
        commandHandler.handle(ws, message, wsClientMap);
    },
    ping(ws, data) {
        ws.pong(data);
        printDebug(`[WS] Responded to ping from client: ${ws.data.clientId}`);
    },
    close(ws, code, reason) {
        printDebug(`[WS] Connection closed: ${code} ${reason}`);
        const clientId = ws.data.clientId;
        if (clientId) wsClientMap.delete(clientId);
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
        idleTimeout: 60,
    },
});

commandHandler = new CommandHandler(dataManager, serverId, server);

console.log(`Server listening on http://${server.hostname}:${server.port}`);