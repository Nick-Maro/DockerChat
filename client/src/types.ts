/*** WebSocket ***/
import { ComponentChildren } from "preact";

export type SocketMessage = any;
export type SocketContextType = {
  status: "connecting" | "open" | "closed" | "error";
  messages: SocketMessage[];
  sendMessage: (msg: any) => void;
};

export interface SocketProviderProps {
  children: ComponentChildren;
}

/*** Auth ***/

export type ClientContextType = {
  clientId: string | null;
  loading: boolean;
};


/*** Chat ***/

export type ChatContextType = {
  rooms: Room[];
};

export type WSMessage =
  | { type: "message"; roomId: string; message: { text: string; user: string } }
  | { type: "join"; roomId: string; user: string }
  | { type: "leave"; roomId: string; user: string }
  | { type: "roomListUpdate"; rooms: string[] };

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

export type Room = {
  name: string;
  clients: number;
  messages: number;
  created_at: string;
  last_activity: string;
};

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