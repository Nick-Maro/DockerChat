import { createContext, ComponentChildren } from 'preact';
import { useContext, useState, useEffect } from 'preact/hooks';
import { getOrCreatePublicKey, sendAuthenticatedMessage } from './utils';
import { useSocket } from './webSocketContext';
import { ClientContextType } from '../types';

const ClientContext = createContext<ClientContextType | null>(null);

// check if the username is valid (letters, numbers, _ and - , 3-16 chars)
const validateUsername = (username: string): boolean => {
  const regex = /^[a-zA-Z0-9_-]{3,16}$/;
  return regex.test(username);
};

// ask the user for a username until it's valid
const promptForValidUsername = (): string | null => {
  let username = null;
  
  while (!username) {
    const input = prompt("Enter a username (3-16 characters, letters/numbers/_-):")?.trim();
    
    if (input === null) {
      return null; // user canceled
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
    if(status !== "open") return; // wait until socket is open
    (async () => {
      const savedUsername = localStorage.getItem('username');
      const publicKey = await getOrCreatePublicKey();
      
      if(!savedUsername){
        // if no username saved, ask the user
        const uname = promptForValidUsername();
        if(uname){
          localStorage.setItem('username', uname);
          sendMessage({ command: "upload_public_key", username: uname, public_key: publicKey });
          setUsername(uname);
        }
        return;
      }
      
      if(!validateUsername(savedUsername)) {
        // if saved username is invalid, reset it
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
      
      // username is good -> set it and send heartbeat
      setUsername(savedUsername);
      sendAuthenticatedMessage(sendMessage, { command: "heartbeat", client_id: savedUsername });
    })();
  }, [status, sendMessage]);

  useEffect(() => {
    if(!messages.length) return;

    const lastMessage = messages[messages.length - 1];
    if(typeof lastMessage.command === 'string' && lastMessage.command.startsWith("upload_public_key") && lastMessage.client_id){
      // server accepted public key -> save username
      localStorage.setItem('username', lastMessage.client_id);
      setUsername(lastMessage.client_id);
      setLoading(false);
      return;
    }

    if(lastMessage.command === 'heartbeat'){
      if(lastMessage.error === 'Unregistered client'){
        // if server says "unknown user", reset username
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
        // heartbeat ok -> keep username
        const id = localStorage.getItem('username');
        if(id) setUsername(id);
        setLoading(false);
      }
    }
  }, [messages]);

  useEffect(() => {
    if(!username || status !== 'open') return;
    // send heartbeat every 30 seconds
    const t = setInterval(() => {
      (async() => {
        await sendAuthenticatedMessage(sendMessage, {command: 'heartbeat', client_id: username});
      })();
    }, 30_000);
    return () => clearInterval(t);
  }, [username, status, sendMessage]);

  return (
    // provide username + loading state to the app
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
