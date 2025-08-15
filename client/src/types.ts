export interface WSMessage {
    command: string;
    client_id?: string;
    public_key?: string;
    signature?: string;
    [key: string]: any;
}

export interface WSResponse {
    command: string;
    message?: string;
    error?: string;
    client_id?: string;
    room_name?: string;
    rooms?: Room[];
    clients?: Client[];
    private_messages?: PrivateMessage[];
    total_messages?: number;
    debug?: any;
}

export interface Room {
    name: string;
    clients: number;
    messages: number;
    created_at: string;
    last_activity: string;
}

export interface Client {
    client_id: string;
    room_id: string | null;
    last_seen: string;
    online: boolean;
}

export interface PrivateMessage {
    from_client: string;
    to_client: string;
    text: string;
    timestamp: string;
    direction: 'sent' | 'received';
}