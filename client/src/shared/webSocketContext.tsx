import { createContext } from "preact";
import { useContext, useState, useEffect, useRef, useCallback } from "preact/hooks";
import { SocketMessage, SocketContextType, SocketProviderProps } from '../types';

const SocketContext = createContext<SocketContextType | null>(null);
const WS_URL = `ws://${import.meta.env.VITE_API_HOST}:${import.meta.env.VITE_API_PORT}`;
const WSS_URL = `wss://${import.meta.env.VITE_API_HOST}`;
const WS_FINAL_URL = import.meta.env.VITE_PRODUCTION === "TRUE" ? WSS_URL : WS_URL;

export const SocketProvider = ({ children }: SocketProviderProps) => {
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<"connecting" | "open" | "closed" | "error">("connecting");
  const [messages, setMessages] = useState<SocketMessage[]>([]);
  const queue = useRef<any[]>([]);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const clientIdRef = useRef<string | null>(null);

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

    if(data.client_id && !clientIdRef.current){
      clientIdRef.current = data.client_id;
    }

    setMessages(prev => [...prev, data]);
  }, []);

  const cleanup = useCallback(() => {
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  const createConnection = useCallback(() => {
    cleanup();
        
    const ws = new WebSocket(WS_FINAL_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus("open");
      queue.current.forEach(msg => {
        try {
          ws.send(JSON.stringify(msg));
        } catch (e) {
          console.error("Failed to send queued message:", e);
        }
      });
      queue.current = [];
    };

    ws.onclose = () => setStatus("closed");
    ws.onerror = () => setStatus("error");
    ws.onmessage = handleMessage;
  }, [handleMessage, cleanup]);

  useEffect(() => {
    createConnection();
    return cleanup;
  }, [createConnection, cleanup]);

  const sendMessage = useCallback((msg: any) => {
    if(clientIdRef.current && !msg.client_id){
      msg.client_id = clientIdRef.current;
    }
    
    if(wsRef.current?.readyState === WebSocket.OPEN && status === "open") {
      try {
        wsRef.current.send(JSON.stringify(msg));
      } catch (e) {
        queue.current.push(msg);
      }
    } else {
      queue.current.push(msg);
    }
  }, [status]);

  useEffect(() => {
    if(!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    pingIntervalRef.current = setInterval(() => {
      if(wsRef.current?.readyState === WebSocket.OPEN) {
        const pingMsg = clientIdRef.current 
          ? { type: 'ping', timestamp: Date.now(), client_id: clientIdRef.current }
          : { type: 'ping', timestamp: Date.now() };
        wsRef.current.send(JSON.stringify(pingMsg));
      }
    }, 20000);

    return () => {
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }
    };
  }, [status]);

  useEffect(() => {
    if (status === "closed" || status === "error") {
      console.log("[WS] Connection lost, attempting to reconnect in 3 seconds...");
                
      reconnectTimerRef.current = setTimeout(() => {
        console.log("[WS] Attempting to reconnect...");
        setStatus("connecting");
        createConnection();
      }, 3000);

      return () => {
        if (reconnectTimerRef.current) {
          clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = null;
        }
      };
    }
  }, [status, createConnection]);

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