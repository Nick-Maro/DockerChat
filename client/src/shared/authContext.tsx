import { createContext, ComponentChildren } from 'preact';
import { useContext, useState, useEffect } from 'preact/hooks';
import { getOrCreatePublicKey } from './utils';
import { useSocket } from './webSocketContext';
import { ClientContextType } from '../types';

const ClientContext = createContext<ClientContextType | null>(null);


export const ClientProvider = ({ children }: { children: ComponentChildren }) => {
  const { status, messages, sendMessage } = useSocket();
  const [username, setUsername] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if(status !== "open") return;
    (async () => {
      const savedUsername = localStorage.getItem('username');
      const publicKey = await getOrCreatePublicKey();

      if(!savedUsername){
        const uname = prompt("Inserisci un username (3-16, lettere/numeri/_-):")?.trim();
        if(uname){
          localStorage.setItem('username', uname);
          sendMessage({ command: `upload_public_key:${uname}`, public_key: publicKey });
        }
        return;
      }

      setUsername(savedUsername);
      sendMessage({ command: 'heartbeat', client_id: savedUsername });
    })();
  }, [status, sendMessage]);

  useEffect(() => {
    if(!messages.length) return;

    const lastMessage = messages[messages.length - 1];
    if(typeof lastMessage.command === 'string' && lastMessage.command.startsWith("upload_public_key") && lastMessage.client_id){
      localStorage.setItem('username', lastMessage.client_id);
      setUsername(lastMessage.client_id);
      setLoading(false);
      return;
    }

    if(lastMessage.command === 'heartbeat'){
      if(lastMessage.error === 'Unregistered client'){
        const uname = localStorage.getItem('username') || prompt("Inserisci un username (3-16, lettere/numeri/_-):")?.trim();
        if(uname){
          (async () => {
            const publicKey = await getOrCreatePublicKey();
            sendMessage({ command: `upload_public_key:${uname}`, public_key: publicKey });
          })();
        }
      }
      else{
        const id = localStorage.getItem('username');
        if(id) setUsername(id);
        setLoading(false);
      }
    }
  }, [messages]);

  useEffect(() => {
    if(!username || status !== 'open') return;
    const t = setInterval(() => {
      sendMessage({ command: 'heartbeat', client_id: username });
    }, 30_000);
    return () => clearInterval(t);
  }, [username, status, sendMessage]);

  return (
    <ClientContext.Provider value={{ username, loading }}>
      {children}
    </ClientContext.Provider>
  );
};

export const useClient = () => {
  const ctx = useContext(ClientContext);
  if(!ctx) throw new Error("useClient must be used within a ClientProvider");
  return ctx;
};