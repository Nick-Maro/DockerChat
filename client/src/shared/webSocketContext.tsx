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

  const handleMessage = useCallback((event: MessageEvent) => {
    let data;
    try{ data = JSON.parse(event.data); }
    catch{ return; }

    if(data.type === 'pong'){
      console.log('[WS] Received pong from server');
      const latency = Date.now() - data.timestamp;
      console.log(`[WS] Ping latency: ${latency}ms`);
      return;
    }

    setMessages(prev => [...prev, data]);
  }, []);

  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus("open");
      queue.current.forEach(msg => ws.send(JSON.stringify(msg)));
      queue.current = [];

      try{ ws.send(JSON.stringify({ command: 'subscribe', topic: 'global' })); }
      catch(e){ console.error("Failed to subscribe to global topic", e); }
    };

    ws.onclose = () => setStatus("closed");
    ws.onerror = () => setStatus("error");
    ws.onmessage = handleMessage;

    return () => { ws.close(); };
  }, [handleMessage]);

  const sendMessage = useCallback((msg: any) => {
    if(wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify(msg));
    else queue.current.push(msg);
  }, []);

  useEffect(() => {
    if(!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    const pingInterval = setInterval(() => {
      if(wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
      }
    }, 20000);

    return () => clearInterval(pingInterval);
  }, [status]);

  // automatic reconnection
  useEffect(() => {
    if (status === "closed" || status === "error") {
      console.log("[WS] Connection lost, attempting to reconnect in 3 seconds...");
      
      const reconnectTimer = setTimeout(() => {
        console.log("[WS] Attempting to reconnect...");
        setStatus("connecting");
        
        const ws = new WebSocket(WS_URL);
        wsRef.current = ws;

        ws.onopen = () => {
          console.log("[WS] Reconnected successfully!");
          setStatus("open");
          queue.current.forEach(msg => ws.send(JSON.stringify(msg)));
          queue.current = [];
          try{ ws.send(JSON.stringify({ command: 'subscribe', topic: 'global' })); }
          catch(e){ console.error("Failed to subscribe to global topic", e); }
        };

        ws.onclose = () => setStatus("closed");
        ws.onerror = () => setStatus("error");
        ws.onmessage = handleMessage;
      }, 3000);
      
      return () => clearTimeout(reconnectTimer);
    }
  }, [status, handleMessage]);

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