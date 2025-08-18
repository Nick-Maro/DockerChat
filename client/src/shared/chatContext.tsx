import { createContext, ComponentChildren } from "preact";
import { useContext, useState, useEffect, useRef } from "preact/hooks";
import { useClient } from "./authContext";
import { useSocket } from "./webSocketContext";
import { Room, ChatContextType, Message, Client } from "../types";

const ChatContext = createContext<ChatContextType | null>(null);


export const ChatProvider = ({ children }: { children: ComponentChildren }) => {
  const { clientId } = useClient();
  const { status, messages, sendMessage } = useSocket();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [currentClient, setCurrentClient] = useState<Client | null>(null);
  const [currentRoom, setCurrentRoom] = useState<Room | null>(null);
  const [roomMessages, setRoomMessages] = useState<Message[]>([]);
  const hasInitialized = useRef(false);
  const processedMessages = useRef(new Set());
  const lastMessageCount = useRef(0);
  const sentMessages = useRef(new Set());

  useEffect(() => {
    if(status === "open" && clientId && !hasInitialized.current) {
      hasInitialized.current = true;
      sendMessage({ command: "list_rooms", client_id: clientId });
      sendMessage({ command: "list_clients", client_id: clientId });
    }
  }, [status, clientId]);

  useEffect(() => {
    if (messages.length <= lastMessageCount.current) return;
    
    const newMessages = messages.slice(lastMessageCount.current);
    lastMessageCount.current = messages.length;
    
    newMessages.forEach(message => {
      const messageId = JSON.stringify(message);
      
      if (processedMessages.current.has(messageId)) return;
      processedMessages.current.add(messageId);
      
      console.log('WebSocket response received:', message);
      
      if(message.command === "list_rooms") setRooms(message.rooms || []);
      else if(message.command === "list_clients") setClients(message.clients || []);
      else if(message.command === "get_messages") setRoomMessages(message.messages || []);
      else if(message.event === "room_message_received") {
        const messageKey = `${message.from}:${message.text}:${message.timestamp}`;
        if(!sentMessages.current.has(messageKey)){
          setRoomMessages(prev => [...prev, {
            from_client: message.from,
            text: message.text,
            timestamp: message.timestamp,
            public_key: ""
          }]);
        }
      }
      else if(message.command && message.command.startsWith("create_room:")){
        if(message.error){
          const roomName = message.command.split(":")[1];
          setRooms(prev => prev.filter(r => r.name !== roomName));
          setCurrentRoom(null);
          console.error("Failed to create room:", message.error);
        }
        else if(message.room_name){
          setRooms(prev => prev.map(r => 
            r.name === message.room_name 
              ? { ...r, clients: message.clients_in_room || 1 }
              : r
          ));
        }
      }
      else if(message.command && message.command.startsWith("join_room:")){
        if(message.error){
          console.error("Failed to join room:", message.error);
          setCurrentRoom(null);
          setRoomMessages([]);
          sentMessages.current.clear();
          processedMessages.current.clear();
        }
        else if(message.room_name){
          if(clientId && status === "open") {
            setRoomMessages([]);
            sentMessages.current.clear();
            processedMessages.current.clear();
            sendMessage({ command: "get_messages", client_id: clientId });
          }
        }
      }
      else if(message.command === "leave_room"){
        if(message.error) console.error("Failed to leave room:", message.error);
      }
    });
  }, [messages, clientId, status]);

  const joinRoom = (roomName: string) => {
    if(clientId && status === "open") {
      if(currentRoom && currentRoom.name !== roomName) {
        sendMessage({ command: "leave_room", client_id: clientId });
        setCurrentRoom(null);
        setRoomMessages([]);
        sentMessages.current.clear();
        processedMessages.current.clear();
      }
      
      sendMessage({ command: `join_room:${roomName}`, client_id: clientId });
      
      const room = rooms.find(r => r.name === roomName);
      if(room) {
        setCurrentRoom(room);
        setRoomMessages([]);
        sentMessages.current.clear();
        processedMessages.current.clear();
      }
    }
  };

  const leaveRoom = () => {
    if(clientId && currentRoom && status === "open") {
      setCurrentRoom(null);
      setRoomMessages([]);
      sentMessages.current.clear();
      processedMessages.current.clear();
      
      sendMessage({ command: "leave_room", client_id: clientId });
    }
  };

  const createRoom = (roomName: string) => {
    if(clientId && status === "open") {
      const newRoom: Room = {
        name: roomName,
        clients: 1,
        messages: 0,
        created_at: new Date().toISOString(),
        last_activity: new Date().toISOString()
      };
      
      setRooms(prev => [...prev, newRoom]);
      sendMessage({ command: `create_room:${roomName}`, client_id: clientId });
      setCurrentRoom(newRoom);
      setRoomMessages([]);
    }
  };

  const sendMessageToRoom = (text: string) => {
    if(clientId && currentRoom && status === "open") {
      const newMessage = {
        from_client: clientId,
        text: text,
        timestamp: new Date().toISOString(),
        public_key: ""
      };
      
      const messageKey = `${clientId}:${text}:${newMessage.timestamp}`;
      sentMessages.current.add(messageKey);
      setRoomMessages(prev => [...prev, newMessage]);
      sendMessage({ command: `send_message:${text}`, client_id: clientId });
    }
  };

  return (
    <ChatContext.Provider value={{ 
      rooms, 
      currentRoom, 
      messages: roomMessages,
      clients,
      joinRoom, 
      leaveRoom, 
      createRoom, 
      sendMessage: sendMessageToRoom 
    }}>
      {children}
    </ChatContext.Provider>
  );
};

export const useChat = () => {
  const ctx = useContext(ChatContext);
  if(!ctx) throw new Error("useChat must be used within a ChatProvider");
  return ctx;
};