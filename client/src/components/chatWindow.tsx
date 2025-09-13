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
  // Add removeLocalMessage to the destructured imports
  const { currentRoom, currentClient, messages, privateMessages, sendMessage, sendFile, sendPrivateMessage, sendPrivateFile, deleteMessage, removeLocalMessage, setReply, cancelReply, replyingTo } = useChat();
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
  
  const chatWindowRef = useRef<HTMLDivElement>(null);
  const [isUserScrolling, setIsUserScrolling] = useState(false);
  const scrollTimeoutRef = useRef<number | null>(null);

  const isMobile = /Mobi|Android/i.test(navigator.userAgent);

  const activeMessages = useMemo(() => {
    return currentClient ? (privateMessages[currentClient.client_id] || []) : messages;
  }, [currentClient, privateMessages, messages]);

  useEffect(() => {
    if (!isUserScrolling) {
      const timer = setTimeout(() => {
        endRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [activeMessages.length, isUserScrolling]);

  const handleScroll = useCallback(() => {
    setIsUserScrolling(true);
    
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }
    
    scrollTimeoutRef.current = window.setTimeout(() => {
      setIsUserScrolling(false);
    }, 2000);
    
    const chatWindow = chatWindowRef.current;
    if (chatWindow) {
      const { scrollTop, scrollHeight, clientHeight } = chatWindow;
      const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;
      if (isNearBottom) {
        setIsUserScrolling(false);
      }
    }
  }, []);

  const handleLongPressStart = useCallback((msg: Message, e: any) => {
    if (!isMobile) return;
    
    longPressTimer.current = window.setTimeout(() => {
      e.preventDefault();
      setSelectedMessage(msg);
      if (navigator.vibrate) navigator.vibrate(50);
    }, 600);
  }, [isMobile]);

  const handleTouchMove = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const handleLongPressEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const handleReply = useCallback(() => {
    const msg = selectedMessage || activeMessages.find(m => m.id === showDropdown);
    if (!msg) return;
    setReply(msg);
    setSelectedMessage(null);
    setShowDropdown(null);
    inputRef.current?.focus();
  }, [selectedMessage, showDropdown, activeMessages, setReply]);

  const handleDelete = useCallback(() => {
    const msg = selectedMessage || activeMessages.find(m => m.id === showDropdown);
    if (!msg || msg.from_client !== username || !msg.id) return;
    
    if (msg.id.startsWith('local-')) {
      // Check if removeLocalMessage exists before calling it
      if (removeLocalMessage) {
        removeLocalMessage(msg.id);
      } else {
        console.warn('removeLocalMessage function not available');
      }
    } else {
      deleteMessage(msg.id);
    }
    
    setSelectedMessage(null);
    setShowDropdown(null);
  }, [selectedMessage, showDropdown, activeMessages, username, deleteMessage, removeLocalMessage]);

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
    } else if(event.key === 'Escape' && replyingTo){
      cancelReply();
    }
  }, [handleSendMessage, replyingTo, cancelReply]);

  const openFileDialog = useCallback(() => fileInputRef.current?.click(), []);
  
  const handleFileChange = useCallback((event: Event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if(file) handleFileUploadWrapper(file);
    (event.target as HTMLInputElement).value = "";
  }, [handleFileUploadWrapper]);

  const renderMessage = useCallback((msg: Message) => {
    if (msg.deleted) {
      return <p className={styles.deletedMessage}>This message was deleted</p>;
    }
    
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
      <div 
        ref={chatWindowRef}
        className={`${styles.chatWindow} flex column ${isDragOver ? styles.dragOver : ''}`}
        onScroll={handleScroll}
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
              className={`${styles.message} ${msg.from_client === username ? styles.sent : styles.received} ${selectedMessage?.id === msg.id ? styles.selected : ''} ${msg.deleted ? styles.deleted : ''} flex`}
              onTouchStart={isMobile ? (e) => handleLongPressStart(msg, e) : undefined}
              onTouchMove={isMobile ? handleTouchMove : undefined}
              onTouchEnd={isMobile ? handleLongPressEnd : undefined}
              onMouseEnter={!isMobile ? () => setHoveredMessage(msg.id!) : undefined}
              onMouseLeave={!isMobile ? () => setHoveredMessage(null) : undefined}>
              
              <div className={styles.bubble} style={getMessageType(msg.mimetype) === "image" ? { width: '35%' } : {}}>
                <span className={styles.username}>
                  {msg.from_client === username ? 'You' : msg.from_client}
                </span>
                
                {msg.replyTo && (
                  <div className={styles.replyTo}>
                    <div className={styles.replyContent}>
                      <span className={styles.replyUser}>{msg.replyTo.from_client}</span>
                      <span className={styles.replyText}>{msg.replyTo.text}</span>
                    </div>
                  </div>
                )}
                
                {renderMessage(msg)}
                <span className={styles.time}>
                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>

              {!isMobile && hoveredMessage === msg.id && !msg.deleted && (
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
                      {msg.from_client === username && (
                        <button onClick={handleDelete} className={styles.deleteButton}>Delete</button>
                      )}
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

      {isMobile && selectedMessage && !selectedMessage.deleted && (
        <div className={styles.mobileActions}>
          <button onClick={handleReply} className={styles.replyButton}>
            Reply
          </button>
          {selectedMessage.from_client === username && (
            <button onClick={handleDelete} className={styles.deleteButton}>
              Delete
            </button>
          )}
          <button onClick={() => setSelectedMessage(null)} className={styles.cancelButton}>
            Cancel
          </button>
        </div>
      )}

      {replyingTo && (
        <div className={styles.replyPreview}>
          <div className={styles.replyPreviewContent}>
            <span className={styles.replyingToText}>Replying to {replyingTo.from_client}</span>
            <span className={styles.replyingToMessage}>{replyingTo.text.substring(0, 60)}...</span>
          </div>
          <button onClick={cancelReply} className={styles.cancelReplyButton}>✕</button>
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
          placeholder={replyingTo ? `Reply to ${replyingTo.from_client}...` : (currentRoom ? "Type a message..." : `Message ${currentClient?.client_id}...`)}
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