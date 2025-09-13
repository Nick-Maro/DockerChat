import { useEffect, useRef, useState, useCallback, useMemo } from "preact/hooks";
import { memo } from "preact/compat";
import styles from '../css/chatWindow.module.css';
import { useChat } from '../shared/chatContext';
import { useClient } from '../shared/authContext';
import { Message } from "../types";
import { getMessageType } from '../shared/fileHelpers';
import attachWhite from '../assets/icons/attach-white.svg';
import sendWhite from '../assets/icons/send-white.svg';

export const ChatWindow = memo(() => {
  const { currentRoom, currentClient, messages, privateMessages, sendMessage, sendFile, sendPrivateMessage, sendPrivateFile } = useChat();
  const { username } = useClient();
  
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [showDropdown, setShowDropdown] = useState<string | null>(null);
  const [hoveredMessage, setHoveredMessage] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);
  const longPressTimer = useRef<number | null>(null);

  const isMobile = /Mobi|Android/i.test(navigator.userAgent);

  const activeMessages = useMemo(() => {
    return currentClient ? (privateMessages[currentClient.client_id] || []) : messages;
  }, [currentClient, privateMessages, messages]);

  useEffect(() => {
    const timer = setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    return () => clearTimeout(timer);
  }, [activeMessages.length]);

  const handleLongPressStart = useCallback((msg: Message, e: any) => {
    if (!isMobile) return;
    e.preventDefault();
    longPressTimer.current = window.setTimeout(() => {
      setSelectedMessage(msg);
      if (navigator.vibrate) navigator.vibrate(50);
    }, 500);
  }, [isMobile]);

  const handleLongPressEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const handleReply = useCallback(() => {
    const msg = selectedMessage || activeMessages.find(m => m.id === showDropdown);
    if (!msg || !inputRef.current) return;
    const replyText = `Reply to "${msg.text.substring(0, 30)}...": `;
    inputRef.current.focus();
    inputRef.current.value = replyText;
    setSelectedMessage(null);
    setShowDropdown(null);
  }, [selectedMessage, showDropdown, activeMessages]);

  const stopEvent = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragEnter = useCallback((e: DragEvent) => {
    stopEvent(e);
    const hasFiles = e.dataTransfer?.types?.includes?.("Files");
    if(!hasFiles) return;
    dragCounter.current++;
    setIsDragOver(true);
  }, [stopEvent]);

  const handleDragLeave = useCallback((e: DragEvent) => {
    stopEvent(e);
    dragCounter.current--;
    if(dragCounter.current <= 0){
      dragCounter.current = 0;
      setIsDragOver(false);
    }
  }, [stopEvent]);

  const handleDragOver = useCallback((e: DragEvent) => {
    stopEvent(e);
    e.dataTransfer!.dropEffect = "copy";
  }, [stopEvent]);

  const handleDrop = useCallback((e: DragEvent) => {
    stopEvent(e);
    dragCounter.current = 0;
    setIsDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if(file) handleFileUploadWrapper(file);
  }, [stopEvent]);

  const handleFileUploadWrapper = useCallback(async (file: File) => {
    try{
      setUploadError(null);
      if(file.size > 10 * 1024 * 1024){
        setUploadError("File size must be less than 10MB");
        return;
      }
      if(currentRoom) await sendFile(file);
      else if(currentClient) await sendPrivateFile(file);
      else setUploadError("No chat selected");
    }
    catch(error){
      setUploadError("File upload failed");
    }
  }, [currentRoom, currentClient, sendFile, sendPrivateFile]);

  const handleSendMessage = useCallback(() => {
    const text = inputRef.current?.value?.trim();
    if(!text) return;
    
    if(currentRoom){
      sendMessage(text);
    } else if(currentClient){
      sendPrivateMessage(text);
    }
    
    if(inputRef.current) inputRef.current.value = '';
  }, [currentRoom, currentClient, sendMessage, sendPrivateMessage]);

  const handleKeyPress = useCallback((event: KeyboardEvent) => {
    if(event.key === 'Enter' && !event.shiftKey){
      event.preventDefault();
      handleSendMessage();
    }
  }, [handleSendMessage]);

  const openFileDialog = useCallback(() => fileInputRef.current?.click(), []);
  
  const handleFileChange = useCallback((event: Event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if(file) handleFileUploadWrapper(file);
    (event.target as HTMLInputElement).value = "";
  }, [handleFileUploadWrapper]);

  const renderMessage = useCallback((msg: Message) => {
    const isFile = msg.file || (msg.filename && msg.content);
    
    if (isFile && msg.filename) {
      if (msg.content) {
        const messageType = getMessageType(msg.mimetype);
        return messageType === "image" ? (
          <div className={styles.imageMessage}>
            <a href={msg.content} download={msg.filename} target="_blank" rel="noopener noreferrer">
              <img src={msg.content} alt={msg.filename} />
            </a>
            <span className={styles.fileName}>{msg.filename}</span>
          </div>
        ) : (
          <p className={`${styles.fileMessage} flex`}>
            <span>📎</span>
            <a href={msg.content} download={msg.filename}>
              <p>{msg.filename}</p>
            </a>
          </p>
        );
      } else {
        return (
          <p className={`${styles.fileMessage} flex`}>
            <span>❌</span>
            <span>{msg.filename} (file content missing)</span>
          </p>
        );
      }
    }
    
    return <p className={styles.messageText}>{msg.text}</p>;
  }, []);

  if(!currentRoom && !currentClient){
    return (
      <div className={`${styles.noRoom} noRoom flex column center-flex`}>
        <h3>No Chat Selected</h3>
        <p>Select a room or a user from the sidebar to start chatting.</p>
      </div>
    );
  }

  return (
    <>
      <div className={`${styles.chatWindow} flex column ${isDragOver ? styles.dragOver : ''}`}
        onDragOver={handleDragOver}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => {setSelectedMessage(null); setShowDropdown(null);}}>

        {isDragOver && (
          <div className={`${styles.dragOverlay} center-flex column`}>
            <h3>Drop your file here</h3>
            <p>Supported: images, PDF, documents (max 10MB)</p>
            <p>{currentRoom ? 'Send to room' : `Send to ${currentClient?.client_id}`}</p>
          </div>
        )}

        {activeMessages.length === 0 ? (
          <div className={styles.noMessages}>
            <p>No messages yet.</p>
            <p>You can drag files here to send them</p>
          </div>
        ) : (
          activeMessages.map((msg, index) => (
            <div 
              key={msg.id || `fallback-${index}`} 
              className={`${styles.message} ${msg.from_client === username ? styles.sent : styles.received} ${selectedMessage?.id === msg.id ? styles.selected : ''} flex`}
              onTouchStart={isMobile ? (e) => handleLongPressStart(msg, e) : undefined}
              onTouchEnd={isMobile ? handleLongPressEnd : undefined}
              onMouseEnter={!isMobile ? () => setHoveredMessage(msg.id!) : undefined}
              onMouseLeave={!isMobile ? () => setHoveredMessage(null) : undefined}>
              
              <div className={styles.bubble} style={getMessageType(msg.mimetype) === "image" ? { width: '35%' } : {}}>
                <span className={styles.username}>
                  {msg.from_client === username ? 'You' : msg.from_client}
                </span>
                {renderMessage(msg)}
                <span className={styles.time}>
                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>

              {!isMobile && hoveredMessage === msg.id && (
                <div className={styles.messageMenu}>
                  <button 
                    className={styles.menuButton}
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowDropdown(showDropdown === msg.id ? null : msg.id!);
                    }}>
                    ⋮
                  </button>
                  {showDropdown === msg.id && (
                    <div className={styles.dropdown}>
                      <button onClick={handleReply}>Reply</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
        <div ref={endRef}></div>

        {uploadError && (
          <div className={[styles.errorUpload, 'center-flex'].join(' ')}>
            <strong>❌ {uploadError}</strong>
          </div>
        )}
      </div>

      {isMobile && selectedMessage && (
        <div className={styles.mobileActions}>
          <button onClick={handleReply} className={styles.replyButton}>
            ↩ Reply
          </button>
          <button onClick={() => setSelectedMessage(null)} className={styles.cancelButton}>
            ✕
          </button>
        </div>
      )}

      <div className={`${styles.messageComposer} center-flex`}>
        <div className={[styles.icon, styles.attach, 'center-flex'].join(' ')} onClick={openFileDialog} title="Attach file">
          <img src={attachWhite} alt="attach" />
          <input type="file" hidden ref={fileInputRef} onChange={handleFileChange} accept="image/*,.pdf,.txt,.doc,.docx" />
        </div>

        <input 
          ref={inputRef}
          type="text"
          placeholder={currentRoom ? "Type a message..." : `Message ${currentClient?.client_id}...`}
          onKeyPress={handleKeyPress}
          style={{ fontSize: isMobile ? '16px' : '12px' }}
        />

        <div className={[styles.icon, styles.send, 'center-flex'].join(' ')} onClick={handleSendMessage} title="Send message">
          <img src={sendWhite} alt="send" />
        </div>
      </div>
    </>
  );
});