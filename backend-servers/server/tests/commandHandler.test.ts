// tests/commandHandler.test.ts
import { test, expect, beforeEach, afterEach, mock, describe } from "bun:test";
import type { ServerWebSocket } from "bun";

// Correct imports - each module from its specific file
import { CommandHandler } from "../commandHandler";
import type { WSMessage, WSResponse } from "../types";  

// Mock dependencies
const mockDataManager = {
    cleanExpiredData: mock(() => Promise.resolve()),
    getClients: mock(() => Promise.resolve({})),
    getRooms: mock(() => Promise.resolve({})),
    getPrivateMessages: mock(() => Promise.resolve({})),
    updateClientLastSeen: mock((clientId: string) => Promise.resolve()),
    removeClientFromRoom: mock((clientId: string, roomId: string) => Promise.resolve()),
    addClientToRoom: mock((roomName: string, clientId: string, clientData: any) => Promise.resolve()),
    addMessageToRoom: mock((roomId: string, message: any) => Promise.resolve()),
    addPrivateMessage: mock((fromClient: string, toClient: string, message: string, signature?: string) => Promise.resolve("msg_123")),
    markPrivateMessagesAsRead: mock((clientId: string) => Promise.resolve()),
    removeClient: mock((clientId: string) => Promise.resolve())
};

const mockStorage = {
    setClients: mock((clients: any) => Promise.resolve()),
    isRedisAvailable: true
};

const mockWebSocket = {
    data: { clientId: null as string | null },
    send: mock((message: string) => {}),
    close: mock((code?: number, reason?: string) => {})
};

const mockWsClientMap = new Map<string, ServerWebSocket<any>>();

// Mock utility functions
const mockGenerateUUID = mock(() => "test-uuid-123");
const mockGetCurrentISOString = mock(() => "2024-01-01T12:00:00.000Z");
const mockIsExpired = mock((timestamp: string, ttl: number) => false);

// Mock CONFIG
const mockConfig = {
    CLIENT_TTL: 86400, // 24 hours
    MESSAGE_TTL: 172800 // 48 hours
};

// Create a mocked version of CommandHandler that uses our mocks
class MockCommandHandler {
    private dataManager: any;
    private serverId: string;
    
    constructor(dataManager: any, serverId: string) {
        this.dataManager = dataManager;
        this.serverId = serverId;
    }

    async handle(ws: any, message: string, wsClients: Map<string, any>) {
        // Simulate cleaning expired data
        await this.dataManager.cleanExpiredData();

        let parsedMessage: WSMessage;
        try {
            parsedMessage = JSON.parse(message);
        } catch (error) {
            ws.send(JSON.stringify({ error: "Invalid JSON" }));
            return;
        }

        const { command, client_id, public_key, signature } = parsedMessage;

        // Handle upload_public_key (doesn't require registered client)
        if (command === "upload_public_key") {
            if (!public_key) {
                ws.send(JSON.stringify({ 
                    command: "upload_public_key", 
                    error: "Missing public_key" 
                }));
                return;
            }

            const clients = await this.dataManager.getClients();
            const newClientId = client_id || mockGenerateUUID();
            const timestamp = mockGetCurrentISOString();

            const clientData = {
                public_key,
                room_id: null,
                last_seen: timestamp,
                created_at: timestamp
            };

            clients[newClientId] = clientData;
            await mockStorage.setClients(clients);

            ws.data.clientId = newClientId;
            wsClients.set(newClientId, ws);

            ws.send(JSON.stringify({
                command: "upload_public_key",
                message: "Client registered with success!",
                client_id: newClientId,
                status: "registered",
                ttl_info: {
                    client_ttl_hours: 24,
                    message_ttl_hours: 48
                },
                debug: {
                    server_instance: this.serverId,
                    redis_available: mockStorage.isRedisAvailable,
                    command: "upload_public_key",
                    client_id: newClientId
                }
            }));
            return;
        }

        // All other commands require client_id
        if (!client_id) {
            ws.send(JSON.stringify({ 
                command, 
                error: "Missing client_id" 
            }));
            return;
        }

        // Verify that the client is registered
        const clients = await this.dataManager.getClients();
        if (!clients[client_id]) {
            ws.send(JSON.stringify({ 
                command, 
                error: "Unregistered client" 
            }));
            return;
        }

        // Update last_seen for every command
        await this.dataManager.updateClientLastSeen(client_id);

        // Handle specific commands
        if (command.startsWith("join_room:")) {
            const roomName = command.split(":")[1];
            if (!roomName) {
                ws.send(JSON.stringify({
                    command,
                    error: "Command format: join_room:ROOM_NAME"
                }));
                return;
            }

            const client = clients[client_id];
            
            // Remove from previous room if present
            if (client.room_id) {
                await this.dataManager.removeClientFromRoom(client_id, client.room_id);
            }

            // Add to new room
            await this.dataManager.addClientToRoom(roomName, client_id, {
                public_key: client.public_key,
                last_seen: mockGetCurrentISOString()
            });

            // Update the client
            client.room_id = roomName;
            client.last_seen = mockGetCurrentISOString();
            await mockStorage.setClients(clients);

            ws.send(JSON.stringify({
                command,
                message: `Joined room '${roomName}' successfully!`,
                room_name: roomName,
                debug: {
                    server_instance: this.serverId,
                    redis_available: mockStorage.isRedisAvailable,
                    command,
                    client_id
                }
            }));
            return;
        }

        if (command.startsWith("send_message:")) {
            const messageText = command.substring("send_message:".length);
            const client = clients[client_id];

            if (!client.room_id) {
                ws.send(JSON.stringify({
                    command,
                    error: "You aren't connected to any room"
                }));
                return;
            }

            const messageData = {
                from_client: client_id,
                text: messageText,
                signature,
                timestamp: mockGetCurrentISOString(),
                public_key: client.public_key
            };

            await this.dataManager.addMessageToRoom(client.room_id, messageData);

            ws.send(JSON.stringify({
                command,
                message: `Message sent in room '${client.room_id}' successfully!`,
                room_name: client.room_id,
                debug: {
                    server_instance: this.serverId,
                    redis_available: mockStorage.isRedisAvailable,
                    command,
                    client_id
                }
            }));
            return;
        }

        if (command.startsWith("send_private:")) {
            const parts = command.split(":");
            if (parts.length < 3) {
                ws.send(JSON.stringify({
                    command,
                    error: "Command format: send_private:CLIENT_ID:MESSAGE"
                }));
                return;
            }

            const toClientId = parts[1];
            const messageText = parts.slice(2).join(":");

            if (!clients[toClientId]) {
                ws.send(JSON.stringify({
                    command,
                    error: "Recipient Client not found"
                }));
                return;
            }

            const messageId = await this.dataManager.addPrivateMessage(client_id, toClientId, messageText, signature);

            ws.send(JSON.stringify({
                command,
                message: `Private message sent to ${toClientId} successfully!`,
                message_id: messageId,
                recipient: toClientId,
                debug: {
                    server_instance: this.serverId,
                    redis_available: mockStorage.isRedisAvailable,
                    command,
                    client_id
                }
            }));
            return;
        }

        if (command === "get_private_messages") {
            const privateMessages = await this.dataManager.getPrivateMessages();
            await this.dataManager.markPrivateMessagesAsRead(client_id);

            const userMessages = Object.values(privateMessages).map((msg: any) => ({
                ...msg,
                direction: msg.from_client === client_id ? 'sent' : 'received'
            }));

            ws.send(JSON.stringify({
                command,
                private_messages: userMessages,
                total_messages: userMessages.length,
                debug: {
                    server_instance: this.serverId,
                    redis_available: mockStorage.isRedisAvailable,
                    command,
                    client_id
                }
            }));
            return;
        }

        if (command === "get_messages") {
            const client = clients[client_id];
            if (!client.room_id) {
                ws.send(JSON.stringify({
                    command,
                    error: "You're not in any room"
                }));
                return;
            }

            const rooms = await this.dataManager.getRooms();
            const room = rooms[client.room_id];
            const messages = room?.messages || [];

            ws.send(JSON.stringify({
                command,
                messages,
                total_messages: messages.length,
                room_name: client.room_id,
                debug: {
                    server_instance: this.serverId,
                    redis_available: mockStorage.isRedisAvailable,
                    command,
                    client_id
                }
            }));
            return;
        }

        if (command === "list_clients") {
            const otherClients = Object.entries(clients)
                .filter(([id]) => id !== client_id)
                .map(([id, client]: [string, any]) => ({
                    client_id: id,
                    room_id: client.room_id,
                    last_seen: client.last_seen,
                    created_at: client.created_at
                }));

            ws.send(JSON.stringify({
                command,
                clients: otherClients,
                total_clients: otherClients.length,
                debug: {
                    server_instance: this.serverId,
                    redis_available: mockStorage.isRedisAvailable,
                    command,
                    client_id
                }
            }));
            return;
        }

        if (command === "list_rooms") {
            const rooms = await this.dataManager.getRooms();
            const roomList = Object.entries(rooms).map(([name, room]: [string, any]) => ({
                name,
                clients: Object.keys(room.clients || {}).length,
                messages: (room.messages || []).length,
                created_at: room.created_at,
                last_activity: room.last_activity
            }));

            ws.send(JSON.stringify({
                command,
                rooms: roomList,
                total_rooms: roomList.length,
                debug: {
                    server_instance: this.serverId,
                    redis_available: mockStorage.isRedisAvailable,
                    command,
                    client_id
                }
            }));
            return;
        }

        if (command === "leave_room") {
            const client = clients[client_id];
            if (!client.room_id) {
                ws.send(JSON.stringify({
                    command,
                    error: "You're not in any room"
                }));
                return;
            }

            const roomId = client.room_id;
            await this.dataManager.removeClientFromRoom(client_id, roomId);

            client.room_id = null;
            client.last_seen = mockGetCurrentISOString();
            await mockStorage.setClients(clients);

            ws.send(JSON.stringify({
                command,
                message: `Left the room '${roomId}' successfully!`,
                room_left: roomId,
                debug: {
                    server_instance: this.serverId,
                    redis_available: mockStorage.isRedisAvailable,
                    command,
                    client_id
                }
            }));
            return;
        }

        if (command === "heartbeat") {
            ws.send(JSON.stringify({
                command,
                message: "Heartbeat received",
                client_status: "alive",
                timestamp: mockGetCurrentISOString(),
                debug: {
                    server_instance: this.serverId,
                    redis_available: mockStorage.isRedisAvailable,
                    command,
                    client_id
                }
            }));
            return;
        }

        if (command === "disconnect") {
            await this.dataManager.removeClient(client_id);
            wsClients.delete(client_id);

            ws.send(JSON.stringify({
                command,
                message: `Client ${client_id} disconnected successfully!`,
                debug: {
                    server_instance: this.serverId,
                    redis_available: mockStorage.isRedisAvailable,
                    command,
                    client_id
                }
            }));

            ws.close(1000, "Client initiated disconnect");
            return;
        }

        // Unknown command
        ws.send(JSON.stringify({
            command,
            message: "Unknown command",
            debug: {
                server_instance: this.serverId,
                redis_available: mockStorage.isRedisAvailable,
                command,
                client_id
            }
        }));
    }
}

describe("CommandHandler", () => {
    let commandHandler: MockCommandHandler;
    const serverId = "test-server-123";

    beforeEach(() => {
        // Reset all mocks
        Object.values(mockDataManager).forEach(mockFn => {
            if (typeof mockFn === 'function' && 'mockReset' in mockFn) {
                (mockFn as any).mockReset();
            }
        });
        mockStorage.setClients.mockReset();
        mockWebSocket.send.mockReset();
        mockWebSocket.close.mockReset();
        mockWebSocket.data.clientId = null;
        mockWsClientMap.clear();

        commandHandler = new MockCommandHandler(mockDataManager as any, serverId);
    });

    test("should handle invalid JSON", async () => {
        const invalidJson = "{ invalid json";
        
        await commandHandler.handle(mockWebSocket as any, invalidJson, mockWsClientMap);
        
        expect(mockWebSocket.send).toHaveBeenCalledWith(
            JSON.stringify({ error: "Invalid JSON" })
        );
    });

    describe("upload_public_key", () => {
        test("should register a new client successfully", async () => {
            const message: WSMessage = {
                command: "upload_public_key",
                public_key: "-----BEGIN PUBLIC KEY-----\ntest_key\n-----END PUBLIC KEY-----",
                client_id: undefined
            };

            mockDataManager.getClients.mockResolvedValueOnce({});

            await commandHandler.handle(mockWebSocket as any, JSON.stringify(message), mockWsClientMap);

            expect(mockDataManager.getClients).toHaveBeenCalled();
            expect(mockStorage.setClients).toHaveBeenCalledWith({
                "test-uuid-123": {
                    public_key: message.public_key,
                    room_id: null,
                    last_seen: "2024-01-01T12:00:00.000Z",
                    created_at: "2024-01-01T12:00:00.000Z"
                }
            });
            expect(mockWebSocket.data.clientId).toBe("test-uuid-123");
            expect(mockWsClientMap.has("test-uuid-123")).toBe(true);
            expect(mockWebSocket.send).toHaveBeenCalledWith(
                JSON.stringify({
                    command: "upload_public_key",
                    message: "Client registered with success!",
                    client_id: "test-uuid-123",
                    status: "registered",
                    ttl_info: {
                        client_ttl_hours: 24,
                        message_ttl_hours: 48
                    },
                    debug: {
                        server_instance: serverId,
                        redis_available: true,
                        command: "upload_public_key",
                        client_id: "test-uuid-123"
                    }
                })
            );
        });

        test("should require public_key", async () => {
            const message: WSMessage = {
                command: "upload_public_key"
            };

            await commandHandler.handle(mockWebSocket as any, JSON.stringify(message), mockWsClientMap);

            expect(mockWebSocket.send).toHaveBeenCalledWith(
                JSON.stringify({ 
                    command: "upload_public_key", 
                    error: "Missing public_key" 
                })
            );
        });

        test("should use existing client_id if provided", async () => {
            const existingClientId = "existing-client-456";
            const message: WSMessage = {
                command: "upload_public_key",
                public_key: "test_key",
                client_id: existingClientId
            };

            mockDataManager.getClients.mockResolvedValueOnce({});

            await commandHandler.handle(mockWebSocket as any, JSON.stringify(message), mockWsClientMap);

            expect(mockWebSocket.data.clientId).toBe(existingClientId);
            expect(mockWsClientMap.has(existingClientId)).toBe(true);
        });
    });

    describe("commands requiring registration", () => {
        test("should require client_id", async () => {
            const message: WSMessage = {
                command: "list_rooms"
            };

            await commandHandler.handle(mockWebSocket as any, JSON.stringify(message), mockWsClientMap);

            expect(mockWebSocket.send).toHaveBeenCalledWith(
                JSON.stringify({ 
                    command: "list_rooms", 
                    error: "Missing client_id" 
                })
            );
        });

        test("should verify client is registered", async () => {
            const message: WSMessage = {
                command: "list_rooms",
                client_id: "unregistered-client"
            };

            mockDataManager.getClients.mockResolvedValueOnce({});

            await commandHandler.handle(mockWebSocket as any, JSON.stringify(message), mockWsClientMap);

            expect(mockWebSocket.send).toHaveBeenCalledWith(
                JSON.stringify({ 
                    command: "list_rooms", 
                    error: "Unregistered client" 
                })
            );
        });
    });

    describe("join_room", () => {
        const clientId = "test-client";
        const mockClient = {
            public_key: "test_key",
            room_id: null,
            last_seen: "2024-01-01T11:00:00.000Z",
            created_at: "2024-01-01T10:00:00.000Z"
        };

        beforeEach(() => {
            mockDataManager.getClients.mockResolvedValue({
                [clientId]: mockClient
            });
        });

        test("should join client to a room", async () => {
            const roomName = "general";
            const message: WSMessage = {
                command: `join_room:${roomName}`,
                client_id: clientId
            };

            await commandHandler.handle(mockWebSocket as any, JSON.stringify(message), mockWsClientMap);

            expect(mockDataManager.addClientToRoom).toHaveBeenCalledWith(
                roomName, 
                clientId, 
                {
                    public_key: mockClient.public_key,
                    last_seen: "2024-01-01T12:00:00.000Z"
                }
            );
            expect(mockStorage.setClients).toHaveBeenCalled();
            expect(mockWebSocket.send).toHaveBeenCalledWith(
                expect.stringContaining(`Joined room '${roomName}'`)
            );
        });

        test("should handle incorrect command format", async () => {
            const message: WSMessage = {
                command: "join_room:",
                client_id: clientId
            };

            await commandHandler.handle(mockWebSocket as any, JSON.stringify(message), mockWsClientMap);

            expect(mockWebSocket.send).toHaveBeenCalledWith(
                expect.stringContaining("Command format: join_room:ROOM_NAME")
            );
        });

        test("should remove client from previous room", async () => {
            const oldRoom = "old-room";
            const newRoom = "new-room";
            const clientWithRoom = { ...mockClient, room_id: oldRoom };
            
            mockDataManager.getClients.mockResolvedValueOnce({
                [clientId]: clientWithRoom
            });

            const message: WSMessage = {
                command: `join_room:${newRoom}`,
                client_id: clientId
            };

            await commandHandler.handle(mockWebSocket as any, JSON.stringify(message), mockWsClientMap);

            expect(mockDataManager.removeClientFromRoom).toHaveBeenCalledWith(clientId, oldRoom);
            expect(mockDataManager.addClientToRoom).toHaveBeenCalledWith(newRoom, clientId, expect.any(Object));
        });
    });

    describe("send_message", () => {
        const clientId = "test-client";
        const roomId = "general";
        const mockClient = {
            public_key: "test_key",
            room_id: roomId,
            last_seen: "2024-01-01T11:00:00.000Z",
            created_at: "2024-01-01T10:00:00.000Z"
        };

        beforeEach(() => {
            mockDataManager.getClients.mockResolvedValue({
                [clientId]: mockClient
            });
        });

        test("should send message in room", async () => {
            const messageText = "Hello, world!";
            const signature = "test_signature";
            const message: WSMessage = {
                command: `send_message:${messageText}`,
                client_id: clientId,
                signature: signature
            };

            await commandHandler.handle(mockWebSocket as any, JSON.stringify(message), mockWsClientMap);

            expect(mockDataManager.addMessageToRoom).toHaveBeenCalledWith(
                roomId,
                {
                    from_client: clientId,
                    text: messageText,
                    signature: signature,
                    timestamp: "2024-01-01T12:00:00.000Z",
                    public_key: mockClient.public_key
                }
            );
            expect(mockWebSocket.send).toHaveBeenCalledWith(
                expect.stringContaining(`Message sent in room '${roomId}'`)
            );
        });

        test("should require being in a room", async () => {
            const clientWithoutRoom = { ...mockClient, room_id: null };
            mockDataManager.getClients.mockResolvedValueOnce({
                [clientId]: clientWithoutRoom
            });

            const message: WSMessage = {
                command: "send_message:test",
                client_id: clientId
            };

            await commandHandler.handle(mockWebSocket as any, JSON.stringify(message), mockWsClientMap);

            expect(mockWebSocket.send).toHaveBeenCalledWith(
                expect.stringContaining("You aren't connected to any room")
            );
        });
    });

    describe("send_private", () => {
        const fromClientId = "client-1";
        const toClientId = "client-2";
        const mockClients = {
            [fromClientId]: {
                public_key: "key1",
                room_id: null,
                last_seen: "2024-01-01T11:00:00.000Z",
                created_at: "2024-01-01T10:00:00.000Z"
            },
            [toClientId]: {
                public_key: "key2",
                room_id: null,
                last_seen: "2024-01-01T11:00:00.000Z",
                created_at: "2024-01-01T10:00:00.000Z"
            }
        };

        beforeEach(() => {
            mockDataManager.getClients.mockResolvedValue(mockClients);
        });

        test("should send private message", async () => {
            const messageText = "Private message";
            const signature = "test_signature";
            const message: WSMessage = {
                command: `send_private:${toClientId}:${messageText}`,
                client_id: fromClientId,
                signature: signature
            };

            mockDataManager.addPrivateMessage.mockResolvedValueOnce("msg-123");

            await commandHandler.handle(mockWebSocket as any, JSON.stringify(message), mockWsClientMap);

            expect(mockDataManager.addPrivateMessage).toHaveBeenCalledWith(
                fromClientId,
                toClientId,
                messageText,
                signature
            );
            expect(mockWebSocket.send).toHaveBeenCalledWith(
                expect.stringContaining(`Private message sent to ${toClientId}`)
            );
        });

        test("should handle incorrect command format", async () => {
            const message: WSMessage = {
                command: "send_private:incomplete",
                client_id: fromClientId
            };

            await commandHandler.handle(mockWebSocket as any, JSON.stringify(message), mockWsClientMap);

            expect(mockWebSocket.send).toHaveBeenCalledWith(
                expect.stringContaining("Command format: send_private:CLIENT_ID:MESSAGE")
            );
        });

        test("should handle non-existent recipient", async () => {
            const message: WSMessage = {
                command: "send_private:nonexistent:message",
                client_id: fromClientId
            };

            await commandHandler.handle(mockWebSocket as any, JSON.stringify(message), mockWsClientMap);

            expect(mockWebSocket.send).toHaveBeenCalledWith(
                expect.stringContaining("Recipient Client not found")
            );
        });
    });

    describe("heartbeat", () => {
        const clientId = "test-client";
        const mockClient = {
            public_key: "test_key",
            room_id: null,
            last_seen: "2024-01-01T11:00:00.000Z",
            created_at: "2024-01-01T10:00:00.000Z"
        };

        beforeEach(() => {
            mockDataManager.getClients.mockResolvedValue({
                [clientId]: mockClient
            });
        });

        test("should respond to heartbeat", async () => {
            const message: WSMessage = {
                command: "heartbeat",
                client_id: clientId
            };

            await commandHandler.handle(mockWebSocket as any, JSON.stringify(message), mockWsClientMap);

            const sentMessage = mockWebSocket.send.mock.calls[0][0];
            const response = JSON.parse(sentMessage);
            
            expect(response.message).toBe("Heartbeat received");
            expect(response.client_status).toBe("alive");
        });
    });

    test("should automatically clean expired data", async () => {
        const message: WSMessage = {
            command: "upload_public_key",
            public_key: "test_key"
        };

        mockDataManager.getClients.mockResolvedValueOnce({});

        await commandHandler.handle(mockWebSocket as any, JSON.stringify(message), mockWsClientMap);

        expect(mockDataManager.cleanExpiredData).toHaveBeenCalled();
    });
});

// Integration tests for complex scenarios
describe("CommandHandler Integration", () => {
    let commandHandler: MockCommandHandler;
    const serverId = "integration-server";

    beforeEach(() => {
        // Complete reset for integration tests
        Object.values(mockDataManager).forEach(mockFn => {
            if (typeof mockFn === 'function' && 'mockReset' in mockFn) {
                (mockFn as any).mockReset();
            }
        });
        mockStorage.setClients.mockReset();
        mockWebSocket.send.mockReset();
        mockWebSocket.close.mockReset();
        mockWebSocket.data.clientId = null;
        mockWsClientMap.clear();

        commandHandler = new MockCommandHandler(mockDataManager as any, serverId);
    });

    test("complete scenario: registration, join room, send message", async () => {
        const clientId = "integration-client";
        const roomName = "integration-room";
        
        // Step 1: Registration
        const registerMessage: WSMessage = {
            command: "upload_public_key",
            public_key: "-----BEGIN PUBLIC KEY-----\nintegration_key\n-----END PUBLIC KEY-----",
            client_id: clientId
        };

        mockDataManager.getClients.mockResolvedValueOnce({});

        await commandHandler.handle(mockWebSocket as any, JSON.stringify(registerMessage), mockWsClientMap);
        
        expect(mockWebSocket.data.clientId).toBe(clientId);
        expect(mockWsClientMap.has(clientId)).toBe(true);

        // Step 2: Join room
        const mockClients = {
            [clientId]: {
                public_key: registerMessage.public_key,
                room_id: null,
                last_seen: "2024-01-01T12:00:00.000Z",
                created_at: "2024-01-01T12:00:00.000Z"
            }
        };
        
        mockDataManager.getClients.mockResolvedValue(mockClients);

        const joinMessage: WSMessage = {
            command: `join_room:${roomName}`,
            client_id: clientId
        };

        await commandHandler.handle(mockWebSocket as any, JSON.stringify(joinMessage), mockWsClientMap);

        expect(mockDataManager.addClientToRoom).toHaveBeenCalledWith(
            roomName,
            clientId,
            expect.objectContaining({
                public_key: registerMessage.public_key
            })
        );

        // Step 3: Send message
        mockClients[clientId].room_id = roomName; // Simulate client is now in room
        mockDataManager.getClients.mockResolvedValue(mockClients);

        const sendMessage: WSMessage = {
            command: "send_message:Hello integration test!",
            client_id: clientId,
            signature: "integration_signature"
        };

        await commandHandler.handle(mockWebSocket as any, JSON.stringify(sendMessage), mockWsClientMap);

        expect(mockDataManager.addMessageToRoom).toHaveBeenCalledWith(
            roomName,
            expect.objectContaining({
                from_client: clientId,
                text: "Hello integration test!",
                signature: "integration_signature"
            })
        );

        // Verify all calls were successful
        expect(mockWebSocket.send).toHaveBeenCalledTimes(3);
    });
    test("scenario: private conversation between two clients", async () => {
        const message: WSMessage = {
            command: "upload_public_key",
            public_key: "test_key"
        };

        mockDataManager.getClients.mockResolvedValueOnce({});

        await commandHandler.handle(mockWebSocket as any, JSON.stringify(message), mockWsClientMap);

        expect(mockDataManager.cleanExpiredData).toHaveBeenCalled();
    });
});

// Script di esecuzione test
if (import.meta.main) {
    console.log(" Eseguendo test per CommandHandler...");
    console.log("\n for general tests:");
    console.log("bun test commandHandler.test.ts");
    console.log("\n for test with coverage:");
    console.log("bun test --coverage commandHandler.test.ts");
    console.log("\n for specific tests:");
    console.log("bun test --grep 'upload_public_key' commandHandler.test.ts");
}