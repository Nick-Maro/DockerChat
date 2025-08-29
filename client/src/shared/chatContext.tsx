import { createContext, ComponentChildren } from "preact";
import { useContext, useState, useEffect, useRef, useCallback } from "preact/hooks";
import { useClient } from "./authContext";
import { useSocket } from "./webSocketContext";
import { useUnread } from "./unreadMessagesContext";
import { Room, ChatContextType, Message, Client } from "../types";
import { getOrCreatePublicKey, sendAuthenticatedMessage } from "./utils";
import { generateECDHKeyPair, deriveSharedKey, encryptMessage, decryptMessage, fingerprintKey, getLocalECDHPublic } from "./cryptoHelpers";

const ChatContext = createContext<ChatContextType | null>(null);

export const ChatProvider = ({ children }: { children: ComponentChildren }) => {
  const { username } = useClient();
  const { status, messages, sendMessage } = useSocket();
  const { incrementUnread } = useUnread();

  const [rooms, setRooms] = useState<Room[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [currentRoom, setCurrentRoom] = useState<Room | null>(null);
  const [currentClient, setCurrentClient] = useState<Client | null>(null);
  const [roomMessages, setRoomMessages] = useState<Message[]>([]);
  const [privateMessages, setPrivateMessages] = useState<Record<string, Message[]>>({});

  // caches & helpers
  const processed = useRef(new Set<string>());
  const lastMessageIndex = useRef(0);

  // in-memory shared key cache and pending ecdh resolvers
  const sharedKeys = useRef<Record<string, CryptoKey>>({});
  const pendingEcdh = useRef<Record<string, (k: string | null) => void>>({});

  const requestPeerEcdh = useCallback(async (target: string, timeout = 3500) => {
    if (!username || status !== 'open') return null;
    if (!target) return null;
    return await new Promise<string | null>(resolve => {
      pendingEcdh.current[target] = (k: string | null) => { resolve(k); delete pendingEcdh.current[target]; };
      sendAuthenticatedMessage(sendMessage, { command: `get_ecdh_key:${target}`, client_id: username }).catch(() => {});
      setTimeout(() => { if (pendingEcdh.current[target]) pendingEcdh.current[target](null); }, timeout);
    });
  }, [username, status, sendMessage]);

  const getOrCreateSharedKey = useCallback(async (peer: string) : Promise<CryptoKey | undefined> => {
    if(!peer || peer === username) return undefined;
    if(sharedKeys.current[peer]) return sharedKeys.current[peer];
    const persisted = localStorage.getItem(`ecdh_peer:${peer}`);
    if(persisted){
      try{
        const k = await deriveSharedKey(persisted);
        sharedKeys.current[peer] = k;
        return k;
      }
      catch(e){ console.warn('deriveSharedKey(persisted) failed', e); }
    }
    try{
      const remote = await requestPeerEcdh(peer);
      if(remote){
        try{ localStorage.setItem(`ecdh_peer:${peer}`, remote); } catch { }
        const k = await deriveSharedKey(remote);
        sharedKeys.current[peer] = k;
        return k;
      }
    } catch(e){ console.warn('getOrCreateSharedKey failed', e); }
    return undefined;
  }, [username, requestPeerEcdh]);

  const tryDecryptForPeer = useCallback(async (peer: string, payload: string | undefined, sk_fingerprint?: string, sender_ecdh_public?: string) => {
    if(!payload) return { text: '', ok: false };
    if(sender_ecdh_public){
      try{
        try{ localStorage.setItem(`ecdh_peer:${peer}`, sender_ecdh_public); } catch {}
        const derived = await deriveSharedKey(sender_ecdh_public);
        sharedKeys.current[peer] = derived;
      } catch { }
    }
    let key = sharedKeys.current[peer];
    if(!key) key = await getOrCreateSharedKey(peer);
    if(!key) return { text: '[Messaggio criptato - chiave non disponibile]', ok: false };
    try{ const plain = await decryptMessage(key, payload); return { text: plain, ok: true }; }
    catch(e){
      if(sk_fingerprint){
        try{
          const localFp = await fingerprintKey(key);
          if (localFp !== sk_fingerprint){
            delete sharedKeys.current[peer];
            key = await getOrCreateSharedKey(peer);
            if(key){
              try{ const p = await decryptMessage(key, payload); return { text: p, ok: true }; }
              catch {}
            }
          }
        }
        catch {}
      }
      return { text: '[Messaggio criptato - impossibile decifrare]', ok: false };
    }
  }, [getOrCreateSharedKey]);

  useEffect(() => {
    if(!messages || messages.length <= lastMessageIndex.current) return;
    const slice = messages.slice(lastMessageIndex.current);
    lastMessageIndex.current = messages.length;
    (async () => {
      for(const msg of slice){
        try{
          const serialized = JSON.stringify(msg);
          if(processed.current.has(serialized)) continue;
          processed.current.add(serialized);

          if (msg.command) {
            if (msg.command === 'list_rooms') setRooms(msg.rooms || []);
            else if (msg.command === 'list_clients') setClients(msg.clients || []);
            else if (msg.command === 'get_messages') {
              const list = msg.messages || [];
              for (const m of list) {
                const roomMsg: Message = {
                  id: m.id || `${m.room}:${Date.now()}`,
                  from_client: m.from || m.from_client || '',
                  text: m.encrypted ? (await tryDecryptForPeer(m.from || m.from_client, m.content || m.text, m.sk_fingerprint, m.sender_ecdh_public)).text : (m.content || m.text || ''),
                  timestamp: m.timestamp || new Date().toISOString(),
                  public_key: '',
                  content: m.content || m.text || '',
                  encrypted: !!m.encrypted
                };
                setRoomMessages(prev => [...prev, roomMsg]);
              }
            } else if (msg.command === 'get_private_messages') {
              const raw = msg.private_messages || [];
              const clientId = currentClient?.client_id;
              if (clientId) {
                const relevant = raw.filter((m: any) => (m.from_client === username && m.to_client === clientId) || (m.from_client === clientId && m.to_client === username));
                const processedMsgs: Message[] = [];
                for (const m of relevant) {
                  let text = m.text || '';
                  let encrypted = !!m.encrypted;
                  if (encrypted && m.from_client !== username) {
                    const res = await tryDecryptForPeer(m.from_client, m.content || m.text, m.sk_fingerprint, m.sender_ecdh_public);
                    text = res.text; encrypted = !res.ok;
                  }
                  processedMsgs.push({ id: m.id, from_client: m.from_client, to_client: m.to_client, text, timestamp: m.timestamp, public_key: m.public_key || '', content: m.content || m.text || '', encrypted });
                }
                setPrivateMessages(prev => ({ ...prev, [clientId]: processedMsgs }));
              }
            }
          }

          if (msg.event) {
            if (msg.event === 'get_ecdh_key') {
              if (msg.ecdh_key && msg.target_user) {
                try { localStorage.setItem(`ecdh_peer:${msg.target_user}`, msg.ecdh_key); } catch {}
                try { const k = await deriveSharedKey(msg.ecdh_key); sharedKeys.current[msg.target_user] = k; } catch {}
                if (pendingEcdh.current[msg.target_user]) pendingEcdh.current[msg.target_user](msg.ecdh_key);
              }
            }

            if (msg.event === 'private_message_received') {
              const m = msg as any;
              if(!(m.from_client === username || m.to_client === username)) continue;
              if(m.from_client === username && m.to_client !== username) continue;
              if(m.from_client === username && m.to_client === username) continue;
              if(m.from_client !== username && currentClient?.client_id === m.from_client){
                if (document.hidden) incrementUnread(`client_${m.from_client}`);
              }
              let text = m.text || '';
              let encrypted = !!m.encrypted;
              if(encrypted) { const r = await tryDecryptForPeer(m.from_client, m.content || m.text, m.sk_fingerprint, m.sender_ecdh_public); text = r.text; encrypted = !r.ok; }
              const pm: Message = { id: m.message_id || `${m.from_client}:${Date.now()}`, from_client: m.from_client, to_client: m.to_client, text, timestamp: m.timestamp || new Date().toISOString(), public_key: '', content: m.content || '', encrypted };
              setPrivateMessages(prev => { const list = prev[m.from_client] || []; return { ...prev, [m.from_client]: [...list, pm] }; });
            }

            if(msg.event === 'room_message_received'){
              const m = msg as any;
              if(m.from !== username){
                if(! (currentRoom?.name === m.room_name) || document.hidden) incrementUnread(`room_${m.room_name}`);
              }
              const roomMsg: Message = {
                from_client: m.from,
                text: m.encrypted
                  ? (await tryDecryptForPeer(
                      m.from,
                      m.content || m.text,
                      (m as any).sk_fingerprint,
                      (m as any).sender_ecdh_public
                    )).text
                  : (m.content || m.text || ''),
                timestamp: m.timestamp || new Date().toISOString(),
                public_key: '',
                content: m.content || m.text || '',
                encrypted: !!m.encrypted
              };
              setRoomMessages(prev => [...prev, roomMsg]);
            }

            if(msg.event === 'client_ecdh_updated'){
              if(msg.client_id) { try { await requestPeerEcdh(msg.client_id); } catch {} }
            }
          }
        }
        catch(e){ console.error('Error processing incoming websocket message', e); }
      }
    })();
  }, [messages, currentClient, currentRoom, username, incrementUnread, tryDecryptForPeer, requestPeerEcdh]);

  useEffect(() => {
    if (status === 'open' && username) {
      (async () => {
        try {
          await getOrCreatePublicKey();
          const existing = localStorage.getItem('ecdh_private');
          if (!existing) {
            const pub = await generateECDHKeyPair();
            await sendAuthenticatedMessage(sendMessage, { command: 'upload_ecdh_key', username, ecdh_key: pub, client_id: username });
          }
          await sendAuthenticatedMessage(sendMessage, { command: 'list_rooms', client_id: username });
          await sendAuthenticatedMessage(sendMessage, { command: 'list_clients', client_id: username });
        } catch (e) { console.error('init error', e); }
      })();
    }
  }, [status, username]);

  const joinRoom = (roomName: string) => { if (!username || status !== 'open') return; if (currentRoom?.name === roomName) return; sendAuthenticatedMessage(sendMessage, { command: `join_room:${roomName}`, client_id: username }); const r = rooms.find(r => r.name === roomName); if (r) { setCurrentRoom(r); setRoomMessages([]); } };
  const leaveRoom = () => { if (username && currentRoom) { sendAuthenticatedMessage(sendMessage, { command: 'leave_room', client_id: username }); setCurrentRoom(null); setRoomMessages([]); } };

  const sendMessageToRoom = (text: string) => {
    if (!username || !currentRoom || status !== 'open') return;
    const ts = new Date().toISOString();
    setRoomMessages(prev => [...prev, { from_client: username, text, timestamp: ts, public_key: '', content: '', encrypted: false }]);
    sendAuthenticatedMessage(sendMessage, { command: `send_message:${text}`, client_id: username });
  };

  const sendPrivateMessage = async (text: string) => {
    if(!username || !currentClient || status !== 'open') return;
    const peer = currentClient.client_id;
    if(peer === username) return;
    const ts = new Date().toISOString();
    let key = sharedKeys.current[peer];
    if(!key){ try { key = await getOrCreateSharedKey(peer); } catch {} }
    if(!key){
      const msg: Message = { from_client: username, to_client: peer, text: text + ' (non criptato)', timestamp: ts, public_key: '', content: '', encrypted: false };
      setPrivateMessages(prev => ({ ...prev, [peer]: [...(prev[peer]||[]), msg] }));
      await sendAuthenticatedMessage(sendMessage, { command: `send_private:${peer}:${text}`, client_id: username });
      return;
    }
    const encrypted = await encryptMessage(key, text);
    let sk_fp = '';
    try{ sk_fp = await fingerprintKey(key); } catch {}
    let sender_pub = null;
    try{ sender_pub = await getLocalECDHPublic(); } catch {}
    let displayed = text;
    try{ const dec = await decryptMessage(key, encrypted); if (dec) displayed = dec; } catch {}
    const localMsg: Message = { from_client: username, to_client: peer, text: displayed, timestamp: ts, public_key: '', content: encrypted, encrypted: true, status: 'sent' };
    setPrivateMessages(prev => ({ ...prev, [peer]: [...(prev[peer]||[]), localMsg] }));
    await sendAuthenticatedMessage(sendMessage, { command: `send_private:${peer}:ENC`, client_id: username, encrypted: true, content: encrypted, sk_fingerprint: sk_fp, sender_ecdh_public: sender_pub });
  };

  const sendPrivateFile = async (file: File) => {
    if (!username || !currentClient || status !== 'open') return;
    const peer = currentClient.client_id;
    const toBase64 = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(f); });
    const content = await toBase64(file);
    const ts = new Date().toISOString();
    const key = await getOrCreateSharedKey(peer).catch(() => undefined);
    if (!key) { const msg: Message = { from_client: username, to_client: peer, text: file.name + ' (non criptato)', timestamp: ts, public_key: '', content, file: true, filename: file.name, mimetype: file.type, encrypted: false }; setPrivateMessages(prev => ({ ...prev, [peer]: [...(prev[peer]||[]), msg] })); await sendAuthenticatedMessage(sendMessage, { command: `send_private:${peer}:${file.name}`, client_id: username, file: true, filename: file.name, mimetype: file.type, content }); return; }
    const msg: Message = { from_client: username, to_client: peer, text: file.name, timestamp: ts, public_key: '', content, file: true, filename: file.name, mimetype: file.type, encrypted: true };
    setPrivateMessages(prev => ({ ...prev, [peer]: [...(prev[peer]||[]), msg] }));
    await sendAuthenticatedMessage(sendMessage, { command: `send_private:${peer}:${file.name}`, client_id: username, file: true, filename: file.name, mimetype: file.type, content, encrypted: true });
  };

  const sendFile = async (file: File) => {
    const readerToText = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(f); });
    const content = await readerToText(file).catch(() => null);
    sendMessageToRoom(file.name + (content ? ' (file attached)' : ''));
  };

  const createRoom = (name: string) => {
    sendAuthenticatedMessage(sendMessage, { command: `create_room:${name}`, client_id: username });
    setRooms(prev => [...prev, { name, clients: 1, messages: 0, created_at: new Date().toISOString(), last_activity: new Date().toISOString() }]);
  };

  return (
    <ChatContext.Provider value={{
      rooms,
      currentRoom,
      messages: roomMessages,
      privateMessages,
      clients,
      currentClient,
      setCurrentClient,
      setCurrentRoom,
      joinRoom,
      leaveRoom,
      createRoom,
      sendMessage: sendMessageToRoom,
      sendPrivateMessage,
      fetchPrivateMessages: async (clientId: string) => { setCurrentClient(clients.find(c => c.client_id === clientId) || null); await sendAuthenticatedMessage(sendMessage, { command: 'get_private_messages', client_id: username, target_client_id: clientId }); },
      sendFile,
      sendPrivateFile
    }}>
      {children}
    </ChatContext.Provider>
  );
};

export const useChat = () => {
  const ctx = useContext(ChatContext);
  if(!ctx) throw new Error('useChat must be used within a ChatProvider');
  return ctx;
};