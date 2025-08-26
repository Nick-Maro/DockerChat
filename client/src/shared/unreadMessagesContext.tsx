
import { createContext, ComponentChildren } from "preact";
import { useContext, useState, useEffect } from "preact/hooks";
import { useClient } from "./authContext";

interface UnreadCount {
  [key: string]: number; // roomName/clientId -> count
}

interface UnreadContextType {
  unreadCounts: UnreadCount;
  incrementUnread: (chatId: string) => void;
  clearUnread: (chatId: string) => void;
  getTotalUnread: () => number;
  getUnreadCount: (chatId: string) => number;
}

const UnreadContext = createContext<UnreadContextType | null>(null);

export const UnreadProvider = ({ children }: { children: ComponentChildren }) => {
  const { username } = useClient();
  const [unreadCounts, setUnreadCounts] = useState<UnreadCount>({});
  const [currentChat, setCurrentChat] = useState<string | null>(null);


  useEffect(() => {
    if (username) {
      const saved = localStorage.getItem(`unread_${username}`);
      if (saved) {
        try {
          setUnreadCounts(JSON.parse(saved));
        } catch (e) {
          console.error('Errore nel caricamento unread counts:', e);
        }
      }
    }
  }, [username]);


  useEffect(() => {
    if (username) {
      localStorage.setItem(`unread_${username}`, JSON.stringify(unreadCounts));
    }
  }, [unreadCounts, username]);


  useEffect(() => {
    window.setCurrentChat = setCurrentChat;
    return () => {
      delete window.setCurrentChat;
    };
  }, []);

  const incrementUnread = (chatId: string) => {

    if (chatId === currentChat && !document.hidden) return;

    setUnreadCounts(prev => ({
      ...prev,
      [chatId]: (prev[chatId] || 0) + 1
    }));


    updatePageTitle();
  };

  const clearUnread = (chatId: string) => {
    setUnreadCounts(prev => {
      const newCounts = { ...prev };
      delete newCounts[chatId];
      return newCounts;
    });
    updatePageTitle();
  };

  const getTotalUnread = (): number => {
    return Object.values(unreadCounts).reduce((sum, count) => sum + count, 0);
  };

  const getUnreadCount = (chatId: string): number => {
    return unreadCounts[chatId] || 0;
  };

  const updatePageTitle = () => {
   // TODO: TO IMPLEMENT
   // const total = getTotalUnread();
   // const baseTitle = "SecureChat";
   // document.title = total > 0 ? `(${total}) ${baseTitle}` : baseTitle;
  };


  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden && currentChat) {

        clearUnread(currentChat);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [currentChat]);

  return (
    <UnreadContext.Provider value={{
      unreadCounts,
      incrementUnread,
      clearUnread,
      getTotalUnread,
      getUnreadCount
    }}>
      {children}
    </UnreadContext.Provider>
  );
};

export const useUnread = () => {
  const ctx = useContext(UnreadContext);
  if (!ctx) throw new Error("useUnread must be used within UnreadProvider");
  return ctx;
};


declare global {
  interface Window {
    setCurrentChat: (chatId: string | null) => void;
  }
}

export const useUnreadIntegration = () => {
  const { incrementUnread } = useUnread();
  const { username } = useClient();

  const handleNewMessage = (message: any, currentRoomId: string | null, currentClientId: string | null) => {

    if (message.from_client === username) return;

    let chatId: string;

    if (message.event === 'room_message_received') {
      chatId = `room_${currentRoomId}`;

      if (currentRoomId !== message.room_name) {
        incrementUnread(chatId);
      }
    } else if (message.event === 'private_message_received') {
      chatId = `client_${message.from_client}`;

      if (currentClientId !== message.from_client) {
        incrementUnread(chatId);
      }
    }
  };

  return { handleNewMessage };
};