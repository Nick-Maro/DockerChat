import { createContext, ComponentChildren } from "preact";
import { useContext, useState, useEffect, useRef } from "preact/hooks";
import { useClient } from "./authContext";
import { useSocket } from "./webSocketContext";
import { Room, ChatContextType, Message, Client } from "../types";
import { getOrCreatePublicKey, sendAuthenticatedMessage, signMessage } from "./utils";

const ChatContext = createContext<ChatContextType | null>(null);


export const ChatProvider = ({ children }: { children: ComponentChildren }) => {
  const { username } = useClient();
  const { status, messages, sendMessage } = useSocket();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [currentClient, setCurrentClient] = useState<Client | null>(null);
  const [privateMessages, setPrivateMessages] = useState<Record<string, Message[]>>({});
  const [currentRoom, setCurrentRoom] = useState<Room | null>(null);
  const [roomMessages, setRoomMessages] = useState<Message[]>([]);
  const hasInitialized = useRef(false);
  const processedMessages = useRef(new Set());
  const lastMessageCount = useRef(0);
  const sentMessages = useRef(new Set());

  useEffect(() => {
    if(status === "open" && username && !hasInitialized.current) {
      hasInitialized.current = true;
      const init = async () => {
        await sendAuthenticatedMessage(sendMessage, { command: "list_rooms", client_id: username });
        await sendAuthenticatedMessage(sendMessage, { command: "list_clients", client_id: username });
      };
      init();
    }
  }, [status, username]);

useEffect(() => {
  if (messages.length <= lastMessageCount.current) return;

  const newMessages = messages.slice(lastMessageCount.current);
  lastMessageCount.current = messages.length;

  newMessages.forEach(message => {
    const serialized = JSON.stringify(message);

    // check processed messages
    if (processedMessages.current.has(serialized)) return;
    if (processedMessages.current.size >= 1000) {
      const oldest = processedMessages.current.values().next().value;
      processedMessages.current.delete(oldest);
    }
    processedMessages.current.add(serialized);

    // handle message.command
    if (message.command) {
      switch (true) {
        case message.command === "list_rooms":
          setRooms(message.rooms || []);
          return;

        case message.command === "list_clients":
          setClients(message.clients || []);
          return;

        case message.command === "get_messages":
          setRoomMessages(message.messages || []);
          return;

        case message.command.startsWith("create_room:"):
          if (message.error) {
            const roomName = message.command.split(":")[1];
            setRooms(prev => prev.filter(r => r.name !== roomName));
            setCurrentRoom(null);
            console.error("Failed to create room:", message.error);
          } else if (message.room_name) {
            setRooms(prev =>
              prev.map(r =>
                r.name === message.room_name
                  ? { ...r, clients: message.clients_in_room || 1 }
                  : r
              )
            );
          }
          return;

        case message.command.startsWith("join_room:"):
          if (message.error) {
            console.error("Failed to join room:", message.error);
            setCurrentRoom(null);
            setRoomMessages([]);
            sentMessages.current.clear();
            processedMessages.current.clear();
          } else if (message.room_name) {
            if (username && status === "open") {
              setRoomMessages([]);
              sentMessages.current.clear();
              processedMessages.current.clear();
              (async () => {
                await sendAuthenticatedMessage(sendMessage, {
                  command: `get_messages`,
                  client_id: username,
                });
              })();
            }
          }
          return;

        case message.command === "leave_room":
          if (message.error)
            console.error("Failed to leave room:", message.error);
          return;

        case message.command === "get_private_messages": {
          const normalized = (message.private_messages || []).map((m: any) => ({
            id: m.id,
            from_client: m.from_client,
            to_client: m.to_client,
            text: m.text,
            timestamp: m.timestamp,
            verified: m.verified,
            file: m.file,
            filename: m.filename || "",
            mimetype: m.mimetype || "",
            content: m.content || "",
            public_key: m.public_key || "",
          }));

          const clientId = currentClient?.client_id;
          if (clientId) {
            const filtered = normalized.filter(
              m =>
                (m.from_client === username && m.to_client === clientId) ||
                (m.from_client === clientId && m.to_client === username)
            );


            const filesWithoutContent = filtered.filter(
              m => m.file && !m.content
            );
            if (filesWithoutContent.length > 0) {
              console.warn("Files missing content:", filesWithoutContent);
            }

            setPrivateMessages(prev => ({ ...prev, [clientId]: filtered }));
          }
          return;
        }
      }
    }

    // handle message.event
    if (message.event) {
      switch (message.event) {
        case "client_registered":
          if (username && status === "open") {
            (async () => {
              await sendAuthenticatedMessage(sendMessage, {
                command: "list_clients",
                client_id: username,
              });
            })();
          }
          return;

        case "client_online":
          setClients(prev =>
            prev.map(client =>
              client.client_id === message.client_id
                ? { ...client, online: true, last_seen: message.timestamp }
                : client
            )
          );
          return;

        case "client_offline":
          setClients(prev =>
            prev.map(client =>
              client.client_id === message.client_id
                ? { ...client, online: false, last_seen: message.timestamp }
                : client
            )
          );
          return;

        case "private_message_received":
          if (
            message.from_client !== username &&
            message.to_client !== username
          )
            return;


          if (message.from_client === username) return;

          const conversationKey = message.from_client;
          const privateMessage: Message = {
            id: message.message_id,
            from_client: message.from_client,
            to_client: message.to_client,
            text: message.text,
            timestamp: message.timestamp,
            verified: message.verified,
            file: message.file || false,
            filename: message.filename || "",
            mimetype: message.mimetype || "",
            content: message.content || "",
            public_key: message.public_key || "",
          };

          setPrivateMessages(prev => {
            const currentMessages = prev[conversationKey] || [];
            return {
              ...prev,
              [conversationKey]: [...currentMessages, privateMessage],
            };
          });
          return;

        case "room_message_received": {
          const messageKey = message.file
            ? `${message.from}:${message.filename}:${message.timestamp}:file`
            : `${message.from}:${message.text}:${message.timestamp}`;

          if (!sentMessages.current.has(messageKey)) {
            const newMessage = {
              from_client: message.from,
              text: message.text || (message.file ? message.filename : ""),
              timestamp: message.timestamp,
              public_key: "",
              file: message.file || false,
              filename: message.filename,
              mimetype: message.mimetype,
              content: message.content,
            };

            setRoomMessages(prev => [...prev, newMessage]);
          }
          return;
        }
      }
    }
  });
}, [messages, username, status]);


  const joinRoom = (roomName: string) => {
    if(username && status === "open") {
      if(currentRoom && currentRoom.name !== roomName) {
        (async () => { await sendAuthenticatedMessage(sendMessage, { command: `leave_room`, client_id: username }); })();
        setCurrentRoom(null);
        setRoomMessages([]);
        setCurrentClient(null);
        setPrivateMessages({});
        sentMessages.current.clear();
        processedMessages.current.clear();
      }
      
      (async () => { await sendAuthenticatedMessage(sendMessage, { command: `join_room:${roomName}`, client_id: username }); })();
      
      const room = rooms.find(r => r.name === roomName);
      if(room){
        setCurrentRoom(room);
        setRoomMessages([]);
        setCurrentClient(null);
        setPrivateMessages({});
        sentMessages.current.clear();
        processedMessages.current.clear();
      }
    }
  };

  const leaveRoom = () => {
    if(username && currentRoom && status === "open") {
      setCurrentRoom(null);
      setRoomMessages([]);
      sentMessages.current.clear();
      processedMessages.current.clear();
      
      (async () => { await sendAuthenticatedMessage(sendMessage, { command: `leave_room`, client_id: username }); })();
    }
  };

  const createRoom = (roomName: string) => {
    if(username && status === "open") {
      const newRoom: Room = {
        name: roomName,
        clients: 1,
        messages: 0,
        created_at: new Date().toISOString(),
        last_activity: new Date().toISOString()
      };
      
      setRooms(prev => [...prev, newRoom]);
      (async () => { await sendAuthenticatedMessage(sendMessage, { command: `create_room:${roomName}`, client_id: username }); })();
      setCurrentRoom(newRoom);
      setRoomMessages([]);
      setCurrentClient(null);
      setPrivateMessages({});
    }
  };

  const sendMessageToRoom = (text: string) => {
    if(username && currentRoom && status === "open") {
      const newMessage = {
        from_client: username,
        text: text,
        timestamp: new Date().toISOString(),
        public_key: ""
      };
      
      const messageKey = `${username}:${text}:${newMessage.timestamp}`;
      sentMessages.current.add(messageKey);
      setRoomMessages(prev => [...prev, newMessage]);
      (async() => {
        await sendAuthenticatedMessage(sendMessage, { command: `send_message:${text}`, client_id: username });
      })();
    }
  };

  const sendFileToRoom = async (file: File) => {
    if(username && currentRoom && status === "open"){
      
      const toBase64 = (f: File) => new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(f); 
      });

      const base64 = await toBase64(file);

      const newMessage: Message = {
        from_client: username,
        timestamp: new Date().toISOString(),
        public_key: "",
        text: file.name,
        file: true,
        filename: file.name,
        mimetype: file.type,
        content: base64
      };

      const messageKey = `${username}:${file.name}:${newMessage.timestamp}`;
      sentMessages.current.add(messageKey);
      setRoomMessages(prev => [...prev, newMessage]);

      await sendAuthenticatedMessage(sendMessage, { 
        command: `send_message:${file.name}`, 
        client_id: username,
        file: true,
        filename: file.name,
        mimetype: file.type,
        content: base64
      });
    }
  };

  const fetchPrivateMessages = async (clientId: string) => {
    if(username && status === "open"){
      await sendAuthenticatedMessage(sendMessage, { command: "get_private_messages", client_id: username, target_client_id: clientId });
      setCurrentClient(clients.find(c => c.client_id === clientId) || null);
    }
  };
  
  const sendPrivateMessage = (text: string) => {
    if(username && currentClient && status === "open"){
      const clientId = currentClient.client_id;
      const timestamp = new Date().toISOString();
      const newMessage: Message = {
        from_client: username,
        to_client: clientId,
        text,
        timestamp,
        public_key: "",
        verified: false,
        file: false
      };

      const messageKey = `${username}:${clientId}:${text}:${timestamp}`;
      sentMessages.current.add(messageKey);

      setPrivateMessages(prev => {
        const currentMessages = prev[clientId] || [];
        return { ...prev, [clientId]: [...currentMessages, newMessage] };
      });

      (async () => {
        await sendAuthenticatedMessage(sendMessage, { command: `send_private:${clientId}:${text}`, client_id: username });
      })();
    }
  };

  const sendPrivateFile = async (file: File) => {
    if(username && currentClient && status === "open"){
      const clientId = currentClient.client_id;
      
      const toBase64 = (f: File) => new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(f); 
      });

      const base64 = await toBase64(file);
      const timestamp = new Date().toISOString();

      const newMessage: Message = {
        from_client: username,
        to_client: clientId,
        timestamp,
        public_key: "",
        text: file.name,
        file: true,
        filename: file.name,
        mimetype: file.type,
        content: base64,
        verified: false
      };

      const messageKey = `${username}:${clientId}:${file.name}:${timestamp}:file`;
      sentMessages.current.add(messageKey);

      setPrivateMessages(prev => {
        const currentMessages = prev[clientId] || [];
        return { ...prev, [clientId]: [...currentMessages, newMessage] };
      });

      await sendAuthenticatedMessage(sendMessage, { 
        command: `send_private:${clientId}:${file.name}`, 
        client_id: username,
        file: true,
        filename: file.name,
        mimetype: file.type,
        content: base64
      });
    }
  };

  return (
    <ChatContext.Provider value={{ 
      rooms, 
      currentRoom, 
      messages: roomMessages,
      clients,
      currentClient,
      setCurrentClient,
      setCurrentRoom,
      privateMessages,
      joinRoom, 
      leaveRoom, 
      createRoom, 
      sendMessage: sendMessageToRoom,
      sendPrivateMessage,
      sendPrivateFile,
      fetchPrivateMessages,
      sendFile: sendFileToRoom
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