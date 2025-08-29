export interface Client {
    id: string,
    public_key: string;
    ecdh_public_key?: string | null;
    room_id: string | null;
    last_seen: string;
    created_at: string;
    online?: boolean;
}

export interface ClientInRoom {
    public_key: string;
    last_seen: string;
}

export interface Message {
  id?: string;
  from_client: string;
  to_client?: string;
  text: string;
  timestamp: string;
  verified?: boolean;
  file?: boolean;
  filename?: string;
  mimetype?: string;
  content?: string;
  public_key: string;
  encrypted?: boolean;
  iv?: string;
  sender_ecdh_key?: string;
  wasEncrypted?: boolean; 
  decryptionFailed?: boolean; 
}

export interface PrivateMessage {
    id: string;
    from_client: string;
    to_client: string;
    text: string;
    signature?: string;
    timestamp: string;
    read: boolean;
    file?: boolean;
    filename?: string;
    mimetype?: string;
    content?: string;
    encrypted?: boolean;
}

export interface Room {
    clients: { [clientId: string]: ClientInRoom };
    messages: Message[];
    created_at: string;
    last_activity: string;
}

export interface WSMessage {
    command: string;
    public_key?: string;
    client_id?: string;
    signature?: string;
    [key: string]: any;
}

export interface WSResponse {
    command: string;
    message: string;
    status?: string;
    error?: string;
    client_id?: string;
    room_name?: string;
    message_text?: string;
    message_id?: string;
    to_client?: string;
    client_status?: string;
    private_messages?: Array<PrivateMessage & { direction: 'sent' | 'received' }>;
    messages?: Message[];
    clients?: Array<{
        client_id: string;
        room_id: string | null;
        last_seen: string;
        online: boolean;
    }>;
    rooms?: Array<{
        name: string;
        clients: number;
        messages: number;
        created_at: string;
        last_activity: string;
    }>;
    total_messages?: number;
    total_clients?: number;
    clients_in_room?: number;
    ttl_info?: {
        client_ttl_hours: number;
        message_ttl_hours: number;
    };
    debug?: {
        server_instance: string;
        redis_available: boolean;
        command: string;
        client_id?: string;
    };
}

export interface ServerStatus {
    server_instance: string;
    redis_available: boolean;
    total_clients: number;
    online_clients: number;
    total_rooms: number;
    total_private_messages: number;
    ttl_config: {
        client_ttl_seconds: number;
        room_ttl_seconds: number;
        message_ttl_seconds: number;
    };
    rooms: {
        [roomName: string]: {
            clients: number;
            messages: number;
            last_activity: string;
        };
    };
}

export interface WebSocketData {
    wsId: string;
    clientId: string | null;
    authenticated: boolean;
}