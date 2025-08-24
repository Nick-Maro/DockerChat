import { createContext, ComponentChildren } from 'preact';
import { useContext, useState, useEffect } from 'preact/hooks';
import { getOrCreatePublicKey, sendAuthenticatedMessage } from './utils';
import { useSocket } from './webSocketContext';
import { ClientContextType } from '../types';

const ClientContext = createContext<ClientContextType | null>(null);

const validateUsername = (username: string): boolean => {
  const regex = /^[a-zA-Z0-9_-]{3,16}$/;
  return regex.test(username);
};

const promptForValidUsername = (): string | null => {
  let username = null;
  
  while (!username) {
    const input = prompt("Enter a username (3-16 characters, letters/numbers/_-):")?.trim();
    
    if (input === null) {
      return null;
    }
    
    if (!input) {
      alert("Username cannot be empty!");
      continue;
    }
    
    if (!validateUsername(input)) {
      alert("Invalid username! It must be 3-16 characters long and contain only letters, numbers, underscores, and hyphens.");
      continue;
    }
    
    username = input;
  }
  
  return username;
};

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
        const uname = promptForValidUsername();
        if(uname){
          localStorage.setItem('username', uname);
          sendMessage({ command: "upload_public_key", username: uname, public_key: publicKey });
          setUsername(uname);
        }
        return;
      }
      
      if(!validateUsername(savedUsername)) {
        localStorage.removeItem('username');
        alert("Saved username is no longer valid. Please enter a new one.");
        const uname = promptForValidUsername();
        if(uname){
          localStorage.setItem('username', uname);
          sendMessage({ command: "upload_public_key", username: uname, public_key: publicKey });
          setUsername(uname);
        }
        return;
      }
      
      setUsername(savedUsername);
      sendAuthenticatedMessage(sendMessage, { command: "heartbeat", client_id: savedUsername });
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
        localStorage.removeItem('username');
        
        const uname = promptForValidUsername();
        if(uname){
          localStorage.setItem('username', uname);
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
      (async() => {
        await sendAuthenticatedMessage(sendMessage, {command: 'heartbeat', client_id: username});
      })();
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