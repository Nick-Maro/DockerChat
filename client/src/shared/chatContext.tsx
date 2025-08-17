import { createContext, ComponentChildren } from "preact";
import { useContext, useState, useEffect } from "preact/hooks";
import { useClient } from "./authContext";
import { useSocket } from "./webSocketContext";
import { Room, ChatContextType } from "../types";

const ChatContext = createContext<ChatContextType | null>(null);

export const ChatProvider = ({ children }: { children: ComponentChildren }) => {
  const { clientId } = useClient();
  const { status, messages, sendMessage } = useSocket();
  const [rooms, setRooms] = useState<Room[]>([]);

  useEffect(() => {
    if(status === "open" && clientId) sendMessage({ command: "list_rooms", client_id: clientId });
  }, [status, clientId]);

  useEffect(() => {
    messages.forEach(msg => {
      if(msg.command === "list_rooms") setRooms(msg.rooms || []);
    });
  }, [messages]);

  return (
    <ChatContext.Provider value={{ rooms }}>
      {children}
    </ChatContext.Provider>
  );
};

export const useChat = () => {
  const ctx = useContext(ChatContext);
  if(!ctx) throw new Error("useChat must be used within a ChatProvider");
  return ctx;
};