import { createContext, ComponentChildren } from "preact";
import { useContext, useState, useEffect, useRef } from "preact/hooks";
import { useClient } from "./authContext";
import { useSocket } from "./webSocketContext";
import { Room, ChatContextType, Message, Client } from "../types";
import { 
  getOrCreatePublicKey, 
  sendAuthenticatedMessage, 
  signMessage,
  getOrCreateEncryptionKeys,
  encryptMessage,
  decryptMessage,
  getClientEncryptionPublicKey,
  storeClientEncryptionPublicKey
} from "./utils";

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

  // Initialize encryption keys when user connects
  useEffect(() => {
    if (status === "open" && username && !hasInitialized.current) {
      hasInitialized.current = true;
      const init = async () => {
        console.log("Initializing chat context for user:", username);
        
        // Initialize encryption keys
        await getOrCreateEncryptionKeys();
        
        // Subscribe to global channel for encrypted messages
        sendMessage({ command: "subscribe_global", client_id: username });
        
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

      // Check processed messages with better deduplication
      if (processedMessages.current.has(serialized)) return;
      if (processedMessages.current.size >= 1000) {
        const oldest = processedMessages.current.values().next().value;
        processedMessages.current.delete(oldest);
      }
      processedMessages.current.add(serialized);

      console.log('WebSocket response received:', message);

      if (message.command === "list_rooms") setRooms(message.rooms || []);
      else if (message.command === "list_clients") {
        // Store encryption keys when we receive client list
        if (message.clients) {
          message.clients.forEach(async (client: any) => {
            if (client.encryption_public_key && client.client_id !== username) {
              console.log(`Storing encryption key for ${client.client_id}`);
              await storeClientEncryptionPublicKey(client.client_id, client.encryption_public_key);
            }
          });
        }
        setClients(message.clients || []);
      }
      else if (message.command === "get_messages") setRoomMessages(message.messages || []);

      // Handle encryption key exchange
      else if (message.event === "encryption_key_received") {
        if (message.from_client !== username && message.to_client === username) {
          console.log(`Received encryption key from ${message.from_client}`);
          const handleKeyExchange = async () => {
            await storeClientEncryptionPublicKey(message.from_client, message.encryption_public_key);
            
            // Only send our key back if we don't already have their key stored
            const existingKey = await getClientEncryptionPublicKey(message.from_client);
            if (!existingKey || existingKey !== message.encryption_public_key) {
              const { publicKeyPem } = await getOrCreateEncryptionKeys();
              await sendAuthenticatedMessage(sendMessage, {
                command: `exchange_encryption_key:${message.from_client}`,
                client_id: username,
                encryption_public_key: publicKeyPem
              });
              console.log(`Sent encryption key back to ${message.from_client}`);
            } else {
              console.log(`Key exchange already completed with ${message.from_client}`);
            }
          };
          handleKeyExchange();
        }
      }

      // FIXED: Handle encrypted private messages with better logging
      else if (message.event === "encrypted_private_message_received") {
        console.log('DEBUG: Processing encrypted private message:', {
          event: message.event,
          from: message.from_client,
          to: message.to_client,
          currentUser: username,
          hasEncryptedData: !!message.encrypted_message
        });

        // Skip if message is not for current user
        if (message.from_client !== username && message.to_client !== username) {
          console.log('DEBUG: Message not for current user, skipping');
          return;
        }

        // Only process messages sent TO us (we don't need to decrypt our own sent messages)
        if (message.to_client === username) {
          console.log('DEBUG: Processing encrypted message sent to us from:', message.from_client);
          
          const handleEncryptedMessage = async () => {
            try {
              const { encryptedData, encryptedKey, iv } = message.encrypted_message;
              console.log('DEBUG: Attempting to decrypt message');
              
              const decryptedText = await decryptMessage(encryptedData, encryptedKey, iv);
              console.log('DEBUG: Message decrypted successfully');
              
              const privateMessage: Message = {
                id: message.message_id,
                from_client: message.from_client,
                to_client: message.to_client,
                text: decryptedText,
                timestamp: message.timestamp,
                verified: true, // Encrypted messages are considered verified
                file: false,
                filename: "",
                mimetype: "",
                content: "",
                public_key: "",
                encrypted: true
              };

              const conversationKey = message.from_client;
              console.log(`DEBUG: Adding decrypted message to conversation with ${conversationKey}`);
              
              setPrivateMessages(prev => {
                const currentMessages = prev[conversationKey] || [];
                const newMessages = [...currentMessages, privateMessage];
                console.log(`DEBUG: Updated private messages for ${conversationKey}:`, newMessages.length, 'total messages');
                return { ...prev, [conversationKey]: newMessages };
              });
            } catch (error) {
              console.error('Failed to decrypt message:', error);
              // Show encrypted message with error indicator
              const privateMessage: Message = {
                id: message.message_id,
                from_client: message.from_client,
                to_client: message.to_client,
                text: "[Encrypted message - decryption failed]",
                timestamp: message.timestamp,
                verified: false,
                file: false,
                filename: "",
                mimetype: "",
                content: "",
                public_key: "",
                encrypted: true,
                decryptionError: true
              };

              const conversationKey = message.from_client;
              setPrivateMessages(prev => {
                const currentMessages = prev[conversationKey] || [];
                const newMessages = [...currentMessages, privateMessage];
                return { ...prev, [conversationKey]: newMessages };
              });
            }
          };

          handleEncryptedMessage();
        } else {
          console.log('DEBUG: Encrypted message from us, skipping processing');
        }
      }
      // Handle regular private messages (for files and fallback)
      else if (message.event === "private_message_received") {
        if (message.from_client !== username && message.to_client !== username) return;

        // Skip our own sent messages to avoid duplicates
        if (message.from_client === username) {
          console.log('DEBUG: Skipping our own private message to avoid duplicates');
          return;
        }

        console.log('DEBUG: Processing regular private message from:', message.from_client);

        let conversationKey = message.from_client;

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
          encrypted: false
        };

        setPrivateMessages(prev => {
          const currentMessages = prev[conversationKey] || [];
          const newMessages = [...currentMessages, privateMessage];
          return { ...prev, [conversationKey]: newMessages };
        });
      }
      else if (message.event === "room_message_received") {
        const messageKey = message.file 
          ? `${message.from}:${message.filename}:${message.timestamp}:file`
          : `${message.from}:${message.text}:${message.timestamp}`;
        
        if (!sentMessages.current.has(messageKey)) {
          const newMessage = {
            from_client: message.from,
            text: message.text || (message.file ? message.filename : ''),
            timestamp: message.timestamp,
            public_key: "",
            file: message.file || false,
            filename: message.filename,
            mimetype: message.mimetype,
            content: message.content
          };
          
          setRoomMessages(prev => [...prev, newMessage]);
        }
      }
      // ... rest of existing message handling code stays the same ...
      else if (message.command && message.command.startsWith("create_room:")) {
        if (message.error) {
          const roomName = message.command.split(":")[1];
          setRooms(prev => prev.filter(r => r.name !== roomName));
          setCurrentRoom(null);
          console.error("Failed to create room:", message.error);
        }
        else if (message.room_name) {
          setRooms(prev => prev.map(r => 
            r.name === message.room_name ? { ...r, clients: message.clients_in_room || 1 } : r
          ));
        }
      }
      // ... continue with all other existing message handling ...
    });
  }, [messages, username, status]);

  // FIXED: Enhanced encrypted private message sending with better error handling
  const sendPrivateMessage = async (text: string) => {
    if (username && currentClient && status === "open") {
      const clientId = currentClient.client_id;
      const timestamp = new Date().toISOString();
      
      console.log(`Attempting to send encrypted message to ${clientId}`);
      
      try {
        // Get recipient's encryption public key
        let recipientPublicKey = await getClientEncryptionPublicKey(clientId);
        console.log(`Recipient key found:`, recipientPublicKey ? "YES" : "NO");
        
        // If we don't have their key, initiate key exchange and wait
        if (!recipientPublicKey) {
          console.log(`Initiating key exchange with ${clientId}...`);
          await exchangeEncryptionKey(clientId);
          
          // Wait for key exchange to complete
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          // Try again to get the key
          recipientPublicKey = await getClientEncryptionPublicKey(clientId);
          console.log(`Key after exchange:`, recipientPublicKey ? "YES" : "NO");
        }
        
        if (!recipientPublicKey) {
          console.warn(`Still no encryption key for ${clientId}, sending unencrypted message`);
          
          const newMessage: Message = {
            from_client: username,
            to_client: clientId,
            text,
            timestamp,
            public_key: "",
            verified: false,
            file: false,
            encrypted: false
          };

          // Use unique message key for unencrypted messages
          const messageKey = `${username}:${clientId}:unencrypted:${text}:${timestamp}`;
          sentMessages.current.add(messageKey);

          setPrivateMessages(prev => {
            const currentMessages = prev[clientId] || [];
            return { ...prev, [clientId]: [...currentMessages, newMessage] };
          });

          await sendAuthenticatedMessage(sendMessage, { 
            command: `send_private:${clientId}:${text}`, 
            client_id: username 
          });
          return;
        }

        console.log(`Encrypting message for ${clientId}...`);
        
        // Encrypt the message
        const encryptedMessage = await encryptMessage(text, recipientPublicKey);
        
        console.log(`Message encrypted successfully, sending to ${clientId}`);
        
        // Create encrypted message for our local display
        const newMessage: Message = {
          from_client: username,
          to_client: clientId,
          text,
          timestamp,
          public_key: "",
          verified: true,
          file: false,
          encrypted: true
        };

        // Use unique message key for encrypted messages
        const messageKey = `${username}:${clientId}:encrypted:${timestamp}`;
        sentMessages.current.add(messageKey);

        setPrivateMessages(prev => {
          const currentMessages = prev[clientId] || [];
          console.log(`Adding encrypted message to conversation with ${clientId}`);
          return { ...prev, [clientId]: [...currentMessages, newMessage] };
        });

        // Send encrypted message to backend
        await sendAuthenticatedMessage(sendMessage, { 
          command: `send_encrypted_private:${clientId}`, 
          client_id: username,
          encrypted_message: encryptedMessage
        });
        
        console.log(`Encrypted message sent successfully to ${clientId}`);
        
      } catch (error) {
        console.error('Failed to send private message:', error);
        
        // Fallback to unencrypted message on error
        const newMessage: Message = {
          from_client: username,
          to_client: clientId,
          text,
          timestamp,
          public_key: "",
          verified: false,
          file: false,
          encrypted: false
        };

        const messageKey = `${username}:${clientId}:fallback:${text}:${timestamp}`;
        sentMessages.current.add(messageKey);

        setPrivateMessages(prev => {
          const currentMessages = prev[clientId] || [];
          return { ...prev, [clientId]: [...currentMessages, newMessage] };
        });

        await sendAuthenticatedMessage(sendMessage, { 
          command: `send_private:${clientId}:${text}`, 
          client_id: username 
        });
      }
    }
  };

  // ... rest of your existing methods stay the same ...
  
  const joinRoom = (roomName: string) => {
    if (username && status === "open") {
      if (currentRoom && currentRoom.name !== roomName) {
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
      if (room) {
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
    if (username && currentRoom && status === "open") {
      setCurrentRoom(null);
      setRoomMessages([]);
      sentMessages.current.clear();
      processedMessages.current.clear();
      
      (async () => { await sendAuthenticatedMessage(sendMessage, { command: `leave_room`, client_id: username }); })();
    }
  };

  const createRoom = (roomName: string) => {
    if (username && status === "open") {
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
    if (username && currentRoom && status === "open") {
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
    if (username && currentRoom && status === "open") {
      
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
    if (username && status === "open") {
      console.log(`Fetching private messages for ${clientId}`);
      
      // Check if we have encryption key for this client
      const hasKey = await getClientEncryptionPublicKey(clientId);
      console.log(`Encryption key for ${clientId}:`, hasKey ? "EXISTS" : "MISSING");
      
      // If no key, initiate key exchange
      if (!hasKey) {
        console.log(`Initiating key exchange with ${clientId}`);
        await exchangeEncryptionKey(clientId);
        
        // Wait a moment for the key exchange to complete
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      await sendAuthenticatedMessage(sendMessage, { 
        command: "get_private_messages", 
        client_id: username, 
        target_client_id: clientId 
      });
      setCurrentClient(clients.find(c => c.client_id === clientId) || null);
    }
  };

  const sendPrivateFile = async (file: File) => {
    if (username && currentClient && status === "open") {
      const clientId = currentClient.client_id;
      
      const toBase64 = (f: File) => new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(f); 
      });

      const base64 = await toBase64(file);
      const timestamp = new Date().toISOString();

      // Files are sent unencrypted for now (due to size limitations)
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
        verified: false,
        encrypted: false
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

  // Function to exchange encryption keys with another client
  const exchangeEncryptionKey = async (clientId: string) => {
    if (username && status === "open") {
      try {
        const { publicKeyPem } = await getOrCreateEncryptionKeys();
        
        console.log(`Sending encryption key to ${clientId}`);
        
        // Send our encryption public key to the other client
        await sendAuthenticatedMessage(sendMessage, {
          command: `exchange_encryption_key:${clientId}`,
          client_id: username,
          encryption_public_key: publicKeyPem
        });
        
        console.log(`Encryption key sent to ${clientId}`);
      } catch (error) {
        console.error('Failed to exchange encryption key:', error);
      }
    }
  };

  // Function to manually set a client's encryption key (for testing or manual key exchange)
  const setClientEncryptionKey = async (clientId: string, publicKeyPem: string) => {
    await storeClientEncryptionPublicKey(clientId, publicKeyPem);
    console.log(`Stored encryption key for ${clientId}`);
  };

  return (
    <ChatContext.Provider value={{ 
      rooms, 
      currentRoom, 
      messages: roomMessages,
      clients,
      currentClient,
      setCurrentClient,
      privateMessages,
      joinRoom, 
      leaveRoom, 
      createRoom, 
      sendMessage: sendMessageToRoom,
      sendPrivateMessage,
      sendPrivateFile,
      fetchPrivateMessages,
      sendFile: sendFileToRoom,
      exchangeEncryptionKey,
      setClientEncryptionKey
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