import { createContext, ComponentChildren } from 'preact';
import { useContext, useState, useEffect } from 'preact/hooks';
import { getOrCreatePublicKey, sendAuthenticatedMessage } from './utils';
import { useSocket } from './webSocketContext';
import { ClientContextType } from '../types';
import UsernameModal from '../components/UsernameModal';

const ClientContext = createContext<ClientContextType | null>(null);

const validateUsername = (username: string): boolean => {
  const regex = /^[a-zA-Z0-9_-]{3,16}$/;
  return regex.test(username);
};

export const ClientProvider = ({ children }: { children: ComponentChildren }) => {
  const { status, messages, sendMessage } = useSocket();
  const [username, setUsername] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showUsernameModal, setShowUsernameModal] = useState(false);
  const [usernamePromptReason, setUsernamePromptReason] = useState<string>('');

  // open modal to ask for username
  const promptForUsername = (reason: string = 'Enter a username') => {
    setUsernamePromptReason(reason);
    setShowUsernameModal(true);
  };

  // submit handler for username modal
  const handleUsernameSubmit = async (newUsername: string) => {
    setShowUsernameModal(false);
    localStorage.setItem('username', newUsername);
    const publicKey = await getOrCreatePublicKey();
    sendMessage({ command: "upload_public_key", username: newUsername, public_key: publicKey });
    setUsername(newUsername);
  };


  const handleUsernameCancel = () => {
    setShowUsernameModal(false);
    // If there's no username and the user cancels, stay in loading
    if (!username) {
      setLoading(true);
    }
  };

  useEffect(() => {
    if(status !== "open") return;
    
    (async () => {
      const savedUsername = localStorage.getItem('username');
      const publicKey = await getOrCreatePublicKey();
      
      if(!savedUsername){
        promptForUsername('Enter a username to get started');
        return;
      }
      
      if(!validateUsername(savedUsername)) {
        localStorage.removeItem('username');
        promptForUsername('Saved username is no longer valid. Please enter a new one.');
        return;
      }
      
      setUsername(savedUsername);
      sendAuthenticatedMessage(sendMessage, { command: "heartbeat", client_id: savedUsername });
    })();
  }, [status, sendMessage]);

  useEffect(() => {
    if(!messages.length) return;

    const lastMessage = messages[messages.length - 1];
    
    if(typeof lastMessage.command === 'string' && lastMessage.command === "upload_public_key" && lastMessage.client_id){
      localStorage.setItem('username', lastMessage.client_id);
      setUsername(lastMessage.client_id);
      setLoading(false);
      return;
    }

    if(lastMessage.command === 'heartbeat'){
      if(lastMessage.error && lastMessage.error.includes('not found')){
        localStorage.removeItem('username');
        promptForUsername('Session expired. Please re-enter your username.');
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
    
    const heartbeatInterval = setInterval(async () => {
      try{ 
        await sendAuthenticatedMessage(sendMessage, { 
          command: 'heartbeat', 
          client_id: username 
        }); 
      }
      catch(error){ 
        console.error('Heartbeat failed:', error);
      }
    }, 25000);
    
    return () => clearInterval(heartbeatInterval);
  }, [username, status, sendMessage]);

  return (
    <ClientContext.Provider value={{ username, loading }}>
      {children}
      <UsernameModal
        isOpen={showUsernameModal}
        title={usernamePromptReason}
        onSubmit={handleUsernameSubmit}
        onCancel={handleUsernameCancel}
      />
    </ClientContext.Provider>
  );
};

export const useClient = () => {
  const ctx = useContext(ClientContext);
  if(!ctx) throw new Error("useClient must be used within a ClientProvider");
  return ctx;
};