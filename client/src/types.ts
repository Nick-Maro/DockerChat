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
  username: string | null;
  loading: boolean;
};


/*** Chat ***/
export type ChatContextType = {
  rooms: Room[];
  currentRoom: Room | null;
  messages: Message[];
  clients: Client[];
  joinRoom: (roomName: string) => void;
  leaveRoom: () => void;
  createRoom: (roomName: string) => void;
  sendMessage: (text: string) => void;
};

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
    messages?: Message[];
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

export interface Message {
  from_client: string;
  text: string;
  timestamp: string;
  public_key: string;
  signature?: string;
  verified?: boolean;
  file?: boolean;
  filename?: string;
  mimetype?: string;
  content?: string;
}