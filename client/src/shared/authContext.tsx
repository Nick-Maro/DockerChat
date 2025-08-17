import { createContext, ComponentChildren } from 'preact';
import { useContext, useState, useEffect } from 'preact/hooks';
import { generatePublicKey } from './utils';
import { useSocket } from './webSocketContext';
import { ClientContextType } from '../types';

const ClientContext = createContext<ClientContextType | null>(null);


export const ClientProvider = ({ children }: { children: ComponentChildren }) => {
  const { status, messages, sendMessage } = useSocket();
  const [clientId, setClientId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if(status === "open" && !clientId){
      (async () => {
        const publicKey = await generatePublicKey();
        sendMessage({ command: "upload_public_key", public_key: publicKey });
      })();
    }
  }, [status, clientId, sendMessage]);

  useEffect(() => {
    if(!messages.length) return;

    const lastMessage = messages[messages.length - 1];
    if(lastMessage.command === "upload_public_key" && lastMessage.client_id){
      setClientId(lastMessage.client_id);
      setLoading(false);
    }
  }, [messages]);

  return (
    <ClientContext.Provider value={{ clientId, loading }}>
      {children}
    </ClientContext.Provider>
  );
};

export const useClient = () => {
  const ctx = useContext(ClientContext);
  if(!ctx) throw new Error("useClient must be used within a ClientProvider");
  return ctx;
};