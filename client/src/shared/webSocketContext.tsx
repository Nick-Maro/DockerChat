import { createContext } from "preact";
import { useContext, useState, useEffect, useRef, useCallback } from "preact/hooks";
import { WS_CONFIG } from "../config";
import { SocketMessage, SocketContextType, SocketProviderProps } from '../types';

const SocketContext = createContext<SocketContextType | null>(null);
const WS_URL = `ws://${WS_CONFIG.HOST}:${WS_CONFIG.PORT}`;


export const SocketProvider = ({ children }: SocketProviderProps) => {
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<"connecting" | "open" | "closed" | "error">("connecting");
  const [messages, setMessages] = useState<SocketMessage[]>([]);
  const queue = useRef<any[]>([]);

  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus("open");
      queue.current.forEach(msg => ws.send(JSON.stringify(msg)));
      queue.current = [];
    };

    ws.onclose = () => setStatus("closed");
    ws.onerror = () => setStatus("error");

    ws.onmessage = (e) => {
      try{ setMessages(prev => [...prev, JSON.parse(e.data)]); }
      catch(err){ console.error("WebSocket JSON parse error:", e.data, err); }
    };

    return () => { ws.close(); };
  }, []);

  const sendMessage = useCallback((msg: any) => {
    if(wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify(msg));
    else queue.current.push(msg);
  }, []);

  return (
    <SocketContext.Provider value={{ status, messages, sendMessage }}>
      {children}
    </SocketContext.Provider>
  );
};

export const useSocket = () => {
  const ctx = useContext(SocketContext);
  if(!ctx) throw new Error("useSocket must be used within a SocketProvider");
  return ctx;
};