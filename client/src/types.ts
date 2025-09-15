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
  privateMessages: Record<string, Message[]>;
  clients: Client[];
  currentClient: Client | null;
  setCurrentClient: (client: Client | null) => void;
  setgCurrentRoom: (room: Room | null) => void;
  joinRoom: (roomName: string) => void;
  leaveRoom: () => void;
  createRoom: (roomName: string) => void;
  sendMessage: (text: string) => void;
  sendPrivateMessage: (text: string) => void;
  fetchPrivateMessages: (clientId: string) => void;
  sendFile: (file: File) => void;
  sendPrivateFile: (file: File) => void;
  deletePrivateMessage: (messageId: string) => Promise<void>;
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
  has_ecdh?: boolean;
  waiting_for_ecdh?: boolean;
  has_shared_key?: boolean;
  ecdh_error?: boolean;
}

export interface PrivateMessage {
  from_client: string;
  to_client: string;
  text: string;
  timestamp: string;
  direction: 'sent' | 'received';
  reply_to?: string; 
  reply_to_text?: string; 
  reply_to_user?: string; 
}

export interface Message {
  id?: string;
  from_client: string;
  to_client?: string;
  text: string;
  timestamp: string;
  public_key: string;
  signature?: string;
  verified?: boolean;
  file?: boolean;
  filename?: string;
  mimetype?: string;
  content?: string;
  encrypted?: boolean;
  error?: string;
  warning?: string;
  status?: "sent" | "pending" | "failed";
  retryCount?: number;
  reply_to?: string; 
  reply_to_text?: string; 
  reply_to_user?: string; 
}