import { useState, useEffect, useRef } from "preact/hooks";

export function useWebSocket(url: string) {
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<"connecting" | "open" | "closed" | "error">("connecting");
  const [messages, setMessages] = useState<any[]>([]);
  const queue = useRef<any[]>([]);

  useEffect(() => {
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus("open");
      queue.current.forEach(msg => ws.send(JSON.stringify(msg)));
      queue.current = [];
    };
    ws.onclose = () => setStatus("closed");
    ws.onerror = () => setStatus("error");
    ws.onmessage = e => {
      try { setMessages(prev => [...prev, JSON.parse(e.data)]); }
      catch { console.error("JSON parse error"); }
    };

    return () => ws.close();
  }, [url]);

  const sendMessage = (msg: any) => {
    wsRef.current?.readyState === WebSocket.OPEN
      ? wsRef.current.send(JSON.stringify(msg))
      : queue.current.push(msg);
  };

  return { ws: wsRef.current, status, messages, sendMessage };
}