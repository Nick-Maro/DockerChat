import { createContext, ComponentChildren } from "preact";
import { useContext, useState, useEffect, useRef, useCallback } from "preact/hooks";
import { useClient } from "./authContext";
import { useSocket } from "./webSocketContext";
import { useUnread } from "./unreadMessagesContext";
import { Room, ChatContextType, Message, Client } from "../types";
import { getOrCreatePublicKey, sendAuthenticatedMessage } from "./utils";
import { generateECDHKeyPair, deriveSharedKey, encryptMessage, decryptMessage, fingerprintKey, getLocalECDHPublic } from "./cryptoHelpers";
import { indexedDBHelper } from "./indexedDBHelper";

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

  const lastMessageIndex = useRef(0);
  const messageQueue = useRef<any[]>([]);
  const wasDisconnected = useRef(false);
  const processedMessageIds = useRef<Set<string>>(new Set());

  const sharedKeys = useRef<Record<string, CryptoKey>>({});
  const pendingEcdh = useRef<Record<string, (k: string | null) => void>>({});

  const queuedSendMessage = useCallback(async (msg: any) => {
    if(status === 'open') {
      try {
        await sendAuthenticatedMessage(sendMessage, msg);
      } catch (e) {
        messageQueue.current.push(msg);
      }
    } else {
      messageQueue.current.push(msg);
    }
  }, [status, sendMessage]);

  const processQueue = useCallback(async () => {
    if(status !== 'open' || !username) return;
    const queue = [...messageQueue.current];
    messageQueue.current = [];
    
    for(const msg of queue) {
      try {
        await sendAuthenticatedMessage(sendMessage, msg);
        await new Promise(resolve => setTimeout(resolve, 50));
      } catch (e) {
        console.error('Failed to send queued message:', e);
        messageQueue.current.push(msg);
      }
    }
  }, [status, username, sendMessage]);

  useEffect(() => {
    if(status === 'closed' || status === 'error') {
      wasDisconnected.current = true;
    } else if(status === 'open' && wasDisconnected.current) {
      wasDisconnected.current = false;
      setTimeout(processQueue, 2000);
    }
  }, [status, processQueue]);

  const requestPeerEcdh = useCallback(async (target: string, timeout = 3500) => {
    if (!username || status !== 'open') return null;
    if (!target) return null;
    if (pendingEcdh.current[target]) return null;
    return await new Promise<string | null>(resolve => {
      pendingEcdh.current[target] = (k: string | null) => { resolve(k); delete pendingEcdh.current[target]; };
      queuedSendMessage({ command: `get_ecdh_key:${target}`, client_id: username }).catch(() => {});
      setTimeout(() => { if (pendingEcdh.current[target]) pendingEcdh.current[target](null); }, timeout);
    });
  }, [username, status, queuedSendMessage]);

  const getOrCreateSharedKey = useCallback(async (peer: string) : Promise<CryptoKey | undefined> => {
    if(!peer || peer === username) return undefined;
    if(sharedKeys.current[peer]) return sharedKeys.current[peer];
    
    try {
      const persisted = await indexedDBHelper.getECDHKey(peer);
      if(persisted){
        try{
          const k = await deriveSharedKey(persisted);
          sharedKeys.current[peer] = k;
          return k;
        }
        catch(e){ console.warn('deriveSharedKey(persisted) failed', e); }
      }
    } catch (e) {
      console.warn('Failed to get ECDH key from IndexedDB', e);
    }
    
    try{
      const remote = await requestPeerEcdh(peer);
      if(remote){
        try{ 
          await indexedDBHelper.setECDHKey(peer, remote);
        } catch (e) {
          console.warn('Failed to store ECDH key in IndexedDB', e);
        }
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
        try{ 
          await indexedDBHelper.setECDHKey(peer, sender_ecdh_public);
        } catch (e) {
          console.warn('Failed to store ECDH key in IndexedDB', e);
        }
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
        console.log(msg)
        try{
          if(msg.command){
            if (msg.command === 'list_rooms') setRooms(msg.rooms || []);
            else if (msg.command === 'list_clients') setClients(msg.clients || []);
            else if (msg.command?.startsWith('create_room:')) {
              if (msg.error) {
                console.error('Error creating room:', msg.error);
              } else if (msg.room_name) {
                const newRoom = {
                  name: msg.room_name,
                  clients: msg.clients_in_room || 1,
                  messages: 0,
                  created_at: new Date().toISOString(),
                  last_activity: new Date().toISOString()
                };
                setRooms(prev => [...prev, newRoom]);
                setCurrentRoom(newRoom);
                setCurrentClient(null);
                setRoomMessages([]);
              }
            }
            else if (msg.command?.startsWith('join_room:')) {
              console.log("JOINO ROOM", msg.room_name);
              if(msg.error) console.error('Error joining room:', msg.error);
              else if(msg.room_name){
                const room = rooms.find(r => r.name === msg.room_name);
                if(room){
                  setCurrentRoom(room);
                  setCurrentClient(null);
                  await queuedSendMessage({ command: 'get_messages', client_id: username });
                }
              }
            }
            else if (msg.command === 'get_messages') {
              const list = msg.messages || [];
              const newMessages = [];
              
              processedMessageIds.current.clear();
              
              for (const m of list) {
                const msgId = m.id || `${m.room || 'unknown'}:${m.timestamp || Date.now()}:${m.from || m.from_client}`;
                if(processedMessageIds.current.has(msgId)) continue;
                processedMessageIds.current.add(msgId);
                
                const isFile = !!m.file || (!!m.filename && !!m.content);
                let text = '';
                let content = m.content || '';
                
                if (isFile) {
                  text = m.filename || m.text || 'File';
                } else {
                  if (m.encrypted) {
                    const decryptResult = await tryDecryptForPeer(m.from || m.from_client, m.content || m.text, m.sk_fingerprint, m.sender_ecdh_public);
                    text = decryptResult.text;
                  } else {
                    text = m.content || m.text || '';
                    if (m.reply_to && m.reply_to_user && m.reply_to_text) {
                      const replyPrefix = `@${m.reply_to_user}: ${m.reply_to_text.substring(0, 50)}${m.reply_to_text.length > 50 ? '...' : ''}\n\n`;
                      text = replyPrefix + text;
                    }
                  }
                }
                
                const roomMsg: Message = {
                  id: msgId,
                  from_client: m.from || m.from_client || '',
                  text,
                  timestamp: m.timestamp || new Date().toISOString(),
                  public_key: '',
                  content,
                  encrypted: !!m.encrypted && !isFile, 
                  file: isFile,
                  filename: m.filename,
                  mimetype: m.mimetype
                };
                newMessages.push(roomMsg);
              }
              setRoomMessages(newMessages);
            } else if (msg.command === 'get_private_messages') {
              const clientId = currentClient?.client_id;
              if(!clientId) return;

              const raw = msg.private_messages || [];
              const relevant = raw.filter((m: any) =>
                (m.from_client === username && m.to_client === clientId) ||
                (m.from_client === clientId && m.to_client === username)
              );

              const processMessages = async () => {
                return Promise.all(relevant.map(async (m: any) => {
                  const isFile = !!m.file;
                  const content = m.content || '';
                  let text = m.text || '';
                  let encrypted = !!m.encrypted;
                  if(encrypted){
                    const peer = m.from_client === username ? m.to_client : m.from_client;
                    const key = await getOrCreateSharedKey(peer);
                    if(key){
                      try { text = await decryptMessage(key, content || text); encrypted = false; }
                      catch { text = '[Messaggio criptato - impossibile decifrare]'; }
                    }
                    else text = '[Messaggio criptato - chiave non disponibile]';
                  }

                  return {
                    id: m.id,
                    from_client: m.from_client,
                    to_client: m.to_client,
                    text,
                    timestamp: m.timestamp || new Date().toISOString(),
                    public_key: m.public_key || '',
                    content,
                    encrypted,
                    file: isFile,
                    filename: m.filename,
                    mimetype: m.mimetype
                  } as Message;
                }));
              };

              const processedMsgs = await processMessages();
              setPrivateMessages(prev => ({ ...prev, [clientId]: processedMsgs }));
            }
          }

          if(msg.event){
            switch(msg.event){
              case 'client_registered':
                setClients(prev => [...prev, { client_id: msg.client_id, room_id: null, last_seen: msg.timestamp, online: true }]);
                break;

              case 'client_online':
                setClients(prev => prev.map(c => c.client_id === msg.client_id ? { ...c, online: true, last_seen: msg.timestamp } : c));
                break;

              case 'client_offline':
                setClients(prev => prev.map(c => c.client_id === msg.client_id ? { ...c, online: false } : c));
                break;

              case 'client_ecdh_updated':
                if(msg.ecdh_key && msg.client_id) {
                  try {
                    await indexedDBHelper.setECDHKey(msg.client_id, msg.ecdh_key);
                    const derived = await deriveSharedKey(msg.ecdh_key);
                    sharedKeys.current[msg.client_id] = derived;
                  } catch(e) {
                    console.warn('Failed to update ECDH key:', e);
                  }
                }
                if(pendingEcdh.current[msg.client_id]) {
                  pendingEcdh.current[msg.client_id](msg.ecdh_key);
                }
                break;

              case 'room_created':
                if(msg.room_name){
                  const newRoom: Room = {
                    name: msg.room_name,
                    clients: msg.clients_in_room || 1,
                    messages: 0,
                    created_at: new Date().toISOString(),
                    last_activity: new Date().toISOString()
                  };
                  setRooms(prev => [...prev, newRoom]);
                }
                break;

              case 'room_message_received': {
                const m = msg as any;
                const msgId = m.message_id || `${m.from_client}:${m.timestamp || Date.now()}`;
                
                if(processedMessageIds.current.has(msgId)) break;
                processedMessageIds.current.add(msgId);
                
                const isFile = !!m.file;
                let text = m.text || '';
                let encrypted = !!m.encrypted;

                if(isFile && m.filename){
                  text = m.filename;
                  encrypted = false;
                }
                else if(encrypted && !isFile){
                  const peer = m.from_client;
                  const res = await tryDecryptForPeer(peer, m.content || m.text, m.sk_fingerprint, m.sender_ecdh_public);
                  text = res.text;
                  encrypted = !res.ok;
                }

                const messageObj: Message = {
                  id: msgId,
                  from_client: m.from_client,
                  to_client: m.to_client,
                  text,
                  timestamp: m.timestamp || new Date().toISOString(),
                  public_key: m.public_key || '',
                  file: isFile,
                  filename: m.filename,
                  mimetype: m.mimetype,
                  content: m.content || '',
                  encrypted
                };

                if(m.from_client !== username && currentRoom?.name !== m.room_name && document.hidden) {
                  incrementUnread(`room_${m.room_name}`);
                }
                setRoomMessages(prev => [...prev, messageObj]);
                break;
              }

              case 'private_message_received': {
                const m = msg as any;
                
                if(!(m.from_client === username || m.to_client === username)) return;
                if(m.from_client === username && m.to_client === username) return;
                
                if(m.from_client !== username){
                  const isCurrentChat = currentClient?.client_id === m.from_client;
                  if(document.hidden || !isCurrentChat) {
                    incrementUnread(`client_${m.from_client}`);
                  }
                }
                
                const isFile = !!m.file && !!m.content;
                let text = m.text || '';
                let encrypted = !!m.encrypted;

                if(isFile){
                  text = m.filename || 'File';
                  encrypted = false;
                }
                else if(encrypted){
                  const peer = m.from_client === username ? m.to_client : m.from_client;
                  const res = await tryDecryptForPeer(peer, m.content || m.text, m.sk_fingerprint, m.sender_ecdh_public);
                  text = res.text;
                  encrypted = !res.ok;
                }

                const pm: Message = {
                  id: m.message_id || `${m.from_client}:${Date.now()}`,
                  from_client: m.from_client,
                  to_client: m.to_client,
                  text,
                  timestamp: m.timestamp || new Date().toISOString(),
                  public_key: '',
                  content: m.content || '',
                  encrypted,
                  file: isFile,
                  filename: m.filename,
                  mimetype: m.mimetype
                };

                const peer = m.from_client === username ? m.to_client : m.from_client;
                if(m.from_client === username){
                  setPrivateMessages(prev => {
                    const list = prev[m.to_client] || [];
                    const filtered = list.filter(msg => !msg.id.startsWith('local-'));
                    return { ...prev, [m.to_client]: list.map(msg => msg.id.startsWith('local-') ? pm : msg) };
                  });
                } else {
                  setPrivateMessages(prev => {
                    const list = prev[peer] || [];
                    return { ...prev, [peer]: [...list, pm] };
                  });
                }
                break;
              }
              case 'private_message_deleted': {
                const { message_id, deleted_by } = msg;
                if(!message_id) break;

                const peer = currentClient?.client_id;
                if(!peer) break;

                setPrivateMessages(prev => {
                  const list = prev[peer] || [];
                  return { ...prev, [peer]: list.map(m => m.id === message_id ? { ...m, text: 'Message deleted', content: '', encrypted: false, file: false } : m) };
                });

                break;
              }
              case 'get_ecdh_key':
                if(msg.ecdh_key && msg.target_user){
                  try{ 
                    await indexedDBHelper.setECDHKey(msg.target_user, msg.ecdh_key);
                  } catch (e) {
                    console.warn('Failed to store ECDH key in IndexedDB', e);
                  }
                  try{ const k = await deriveSharedKey(msg.ecdh_key); sharedKeys.current[msg.target_user] = k; } catch {}
                  if (pendingEcdh.current[msg.target_user]) pendingEcdh.current[msg.target_user](msg.ecdh_key);
                }
                break;
            }
          }
        }
        catch(e){ console.error('Error processing incoming websocket message', e); }
      }
    })();
  }, [messages, currentClient, currentRoom, username, incrementUnread, tryDecryptForPeer, requestPeerEcdh, queuedSendMessage]);

  useEffect(() => {
    if(status === 'open' && username){
      (async () => {
        try {
          await getOrCreatePublicKey();
          const existing = await indexedDBHelper.getItem('ecdh_private');
          if(!existing){
            const pub = await generateECDHKeyPair();
            await queuedSendMessage({ command: 'upload_ecdh_key', username, ecdh_key: pub, client_id: username });
          } else {
            const pub = await getLocalECDHPublic();
            if(pub) {
              await queuedSendMessage({ command: 'upload_ecdh_key', username, ecdh_key: pub, client_id: username });
            }
          }
          await queuedSendMessage({ command: 'list_rooms', client_id: username });
          await queuedSendMessage({ command: 'list_clients', client_id: username });
        } catch (e) { console.error('init error', e); }
      })();
    }
  }, [status, username, queuedSendMessage]);

  const joinRoom = (roomName: string) => {
    if(!username || status !== 'open') return;
    if(currentRoom?.name === roomName) return;
    setCurrentClient(null);
    queuedSendMessage({ command: `join_room:${roomName}`, client_id: username });
  };

  const leaveRoom = () => { if (username && currentRoom) { queuedSendMessage({ command: 'leave_room', client_id: username }); setCurrentRoom(null); setRoomMessages([]); } };

  const sendMessageToRoom = (text: string, replyTo?: Message) => {
    if(!username || !currentRoom || status !== 'open') return;
    const ts = new Date().toISOString();
    const msgId = `local-${Date.now()}`;
    
    let displayText = text;
    if (replyTo) {
      let replyText = replyTo.text;
      const lines = replyText.split('\n');
      if (lines[0].startsWith('@') && lines.length > 2 && lines[1] === '') {
        replyText = lines.slice(2).join('\n');
      }
      const replyPrefix = `@${replyTo.from_client}: ${replyText.substring(0, 50)}${replyText.length > 50 ? '...' : ''}\n\n`;
      displayText = replyPrefix + text;
    }
    
    setRoomMessages(prev => [...prev, { id: msgId, from_client: username, text: displayText, timestamp: ts, public_key: '', content: '', encrypted: false }]);
    
    const messageData: any = { command: `send_message:${text}`, client_id: username };
    if (replyTo) {
      messageData.reply_to = replyTo.id;
      messageData.reply_to_text = replyTo.text.substring(0, 100);
      messageData.reply_to_user = replyTo.from_client;
    }
    
    queuedSendMessage(messageData);
  };

  const sendPrivateMessage = async (text: string) => {
    if(!username || !currentClient) return;
    const peer = currentClient.client_id;
    if(peer === username) return;
    const ts = new Date().toISOString();
    let key = sharedKeys.current[peer];
    if(!key){ try { key = await getOrCreateSharedKey(peer); } catch {} }
    if(!key){
      const msg: Message = { from_client: username, to_client: peer, text: text + ' (non criptato)', timestamp: ts, public_key: '', content: '', encrypted: false };
      setPrivateMessages(prev => ({ ...prev, [peer]: [...(prev[peer]||[]), msg] }));
      await queuedSendMessage({ command: `send_private:${peer}:${text}`, client_id: username });
      return;
    }
    const encrypted = await encryptMessage(key, text);
    let sk_fp = '';
    try{ sk_fp = await fingerprintKey(key); } catch {}
    let sender_pub = null;
    try{ sender_pub = await getLocalECDHPublic(); } catch {}
    let displayed = text;
    try{ const dec = await decryptMessage(key, encrypted); if (dec) displayed = dec; } catch {}
    const localId = crypto.randomUUID();
    const localMsg: Message = {
      id: localId,
      from_client: username,
      to_client: peer,
      text: displayed,
      timestamp: ts,
      public_key: '',
      content: encrypted,
      encrypted: true,
      file: false,
      message_id: localId
    };
    setPrivateMessages(prev => ({ ...prev, [peer]: [...(prev[peer]||[]), localMsg] }));
    await queuedSendMessage({ command: `send_private:${peer}:ENC`, client_id: username, encrypted: true, content: encrypted, sk_fingerprint: sk_fp, sender_ecdh_public: sender_pub, message_id: localId });
  };

  const sendPrivateFile = async (file: File) => {
    if (!username || !currentClient) return;
    const peer = currentClient.client_id;
    const toBase64 = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(f); });
    const content = await toBase64(file);
    const ts = new Date().toISOString();
    const key = await getOrCreateSharedKey(peer).catch(() => undefined);
    if (!key) { const msg: Message = { from_client: username, to_client: peer, text: file.name + ' (non criptato)', timestamp: ts, public_key: '', content, file: true, filename: file.name, mimetype: file.type, encrypted: false }; setPrivateMessages(prev => ({ ...prev, [peer]: [...(prev[peer]||[]), msg] })); await queuedSendMessage({ command: `send_private:${peer}:${file.name}`, client_id: username, file: true, filename: file.name, mimetype: file.type, content }); return; }
    const msg: Message = { from_client: username, to_client: peer, text: file.name, timestamp: ts, public_key: '', content, file: true, filename: file.name, mimetype: file.type, encrypted: true };
    setPrivateMessages(prev => ({ ...prev, [peer]: [...(prev[peer]||[]), msg] }));
    await queuedSendMessage({ command: `send_private:${peer}:${file.name}`, client_id: username, file: true, filename: file.name, mimetype: file.type, content, encrypted: true });
  };

  const sendFile = async (file: File) => {
    if(!currentRoom || !username) return;
    const readerToText = (f: File) => new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result as string);
      r.onerror = rej;
      r.readAsDataURL(f);
    });

    const content = await readerToText(file).catch(() => null);
    const ts = new Date().toISOString();
    const msgId = `local-${Date.now()}`;
    const msg: Message = {
      id: msgId,
      from_client: username,
      text: file.name,
      timestamp: ts,
      file: true,
      filename: file.name,
      mimetype: file.type,
      content: content || '',
      encrypted: false,
      public_key: ''
    };

    setRoomMessages(prev => [...prev, msg]);
    await queuedSendMessage({
      command: `send_message:${file.name}`,
      client_id: username,
      file: true,
      filename: file.name,
      mimetype: file.type,
      content
    });
  };

  const fetchPrivateMessages = async (clientId: string) => {
    setCurrentRoom(null);
    setCurrentClient(clients.find(c => c.client_id === clientId) || null);
    await queuedSendMessage({ command: 'get_private_messages', client_id: username, target_client_id: clientId });
  };

  const createRoom = (name: string) => {
    queuedSendMessage({ command: `create_room:${name}`, client_id: username });
  };
  
  const deletePrivateMessage = async (messageId: string) => {
    if (!username || !currentClient) return;

    let messageToDelete, peerKey;
    for(const p of Object.keys(privateMessages)){
      const msg = privateMessages[p]?.find(m => m.id === messageId);
      if(msg) messageToDelete = msg; peerKey = p; break;
    }
    if(!messageToDelete) return;

    setPrivateMessages(prev => ({
      ...prev,
      [peerKey]: (prev[peerKey] || []).map(m => m.id === messageId ? { ...m, text: "Message deleted", content: null, file: false, encrypted: false } : m)
    }));

    try { await queuedSendMessage({ command: `delete_private_message:${messageId}`, client_id: username }); }
    catch(error){
      console.error('Failed to delete message:', error);
      setPrivateMessages(prev => ({
        ...prev,
        [peerKey]: (prev[peerKey] || []).map(m => m.id === messageId ? messageToDelete : m)
          .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      }));
    }
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
      fetchPrivateMessages,
      sendFile,
      sendPrivateFile,
      deletePrivateMessage
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