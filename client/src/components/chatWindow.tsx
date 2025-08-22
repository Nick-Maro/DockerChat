import { useEffect, useRef, useState } from "preact/hooks";
import styles from '../css/chatWindow.module.css';
import { useChat } from '../shared/chatContext';
import { useClient } from '../shared/authContext';
import { 
  FileMessage, 
  isImageFile, 
  parseMessageContent, 
  validateFile, 
  handleFileUpload 
} from './fileHelpers';

// icons
import attachWhite from '../assets/icons/attach-white.svg';
import sendWhite from '../assets/icons/send-white.svg';

export function ChatWindow() {
  const { currentRoom, messages, sendMessage, sendFile } = useChat();
  const { username } = useClient();
  const [messageText, setMessageText] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Handle file upload
  const onFileUpload = (file: File) => {
    const validation = validateFile(file);
    if (!validation.valid) {
      setUploadError(validation.error || 'File upload error');
      setTimeout(() => setUploadError(null), 3000);
      return;
    }

    const success = handleFileUpload(file, sendFile, currentRoom);
    if (success) {
      setUploadError(null);
    }
  };

  
  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragEnter = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      setIsDragOver(false);
    }
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      const file = files[0];
      onFileUpload(file);
    }
  };

  const openFileDialog = () => { 
    fileInputRef.current?.click(); 
  };

  const handleFileChange = (event: Event) => {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    if (file) {
      onFileUpload(file);
    }
    target.value = "";
  };

  const handleSendMessage = () => {
    if (messageText.trim() && currentRoom) {
      sendMessage(messageText.trim());
      setMessageText('');
    }
  };

  const handleKeyPress = (event: KeyboardEvent) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSendMessage();
    }
  };

  const renderMessage = (msg: FileMessage) => {
    if (msg.file && msg.filename && msg.content) {
      const isImage = isImageFile(msg.mimetype);
      
      return isImage ? (
        <div className={styles.imageMessage}>
          <a href={msg.content} download={msg.filename} target="_blank" rel="noopener noreferrer">
            <img 
              src={msg.content} 
              alt={msg.filename}
              style={{
                maxWidth: '300px',
                maxHeight: '300px',
                width: 'auto',
                height: 'auto',
                borderRadius: '8px',
                cursor: 'pointer',
                objectFit: 'cover'
              }}
            />
          </a>
          <span className={styles.fileName}>{msg.filename}</span>
        </div>
      ) : (
        <p className={styles.messageText}>
          📎 <a href={msg.content} download={msg.filename}>
            <strong>{msg.filename}</strong>
          </a>
        </p>
      );
    }

    const parsedContent = parseMessageContent(msg);
    if (parsedContent) {
      return parsedContent.type === "image" ? (
        <div className={styles.imageMessage}>
          <a href={parsedContent.data} download={parsedContent.name} target="_blank" rel="noopener noreferrer">
            <img 
              src={parsedContent.data} 
              alt={parsedContent.name}
              style={{
                maxWidth: '300px',
                maxHeight: '300px',
                width: 'auto',
                height: 'auto',
                borderRadius: '8px',
                cursor: 'pointer',
                objectFit: 'cover'
              }}
            />
          </a>
          <span className={styles.fileName}>{parsedContent.name}</span>
        </div>
      ) : (
        <p className={styles.messageText}>
          📎 <a href={parsedContent.data} download={parsedContent.name}>
            <strong>{parsedContent.name}</strong>
          </a>
        </p>
      );
    }

    return <p className={styles.messageText}>{msg.text}</p>;
  };

  if (!currentRoom) {
    return (
      <div className={`${styles.noRoom} flex column center-flex`}>
        <h3>No Room Selected</h3>
        <p>Join a room from the sidebar to start chatting</p>
      </div>
    );
  }

  return (
    <>
      <div 
        className={`${styles.chatWindow} flex column ${isDragOver ? styles.dragOver : ''}`}
        onDragOver={handleDragOver}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isDragOver && (
          <div className={styles.dragOverlay}>
            <div className={styles.dragMessage}>
              <h3>Drop your file here</h3>
              <p>Supported: images, PDF, documents (max 10MB)</p>
            </div>
          </div>
        )}

        {uploadError && (
          <div className={styles.errorMessage}>
            <span>❌ {uploadError}</span>
          </div>
        )}

        {messages.length === 0 ? (
          <div className={styles.noMessages}>
            <p>No messages yet.</p>
            <p className={styles.dragHint}>
              You can drag files here to send them
            </p>
          </div>
        ) : (
          messages.map((msg, index) => (
            <div 
              key={index} 
              className={`${styles.message} ${msg.from_client === username ? styles.sent : styles.received} flex`}
            >
              <div className={styles.bubble}>
                <span className={styles.username}>
                  {msg.from_client === username ? 'You' : msg.from_client}
                </span>

                {renderMessage(msg)}

                <span className={styles.time}>
                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            </div>
          ))
        )}
        <div ref={endRef}></div>
      </div>

      <div className={`${styles.messageComposer} center-flex`}>
        <div 
          className={[styles.icon, styles.attach, 'center-flex'].join(' ')} 
          onClick={openFileDialog}
          title="Attach file"
        >
          <img src={attachWhite} alt="attach" />
        </div>

        <input 
          type="text" 
          placeholder="Type a message..." 
          value={messageText}
          onChange={(e) => setMessageText((e.target as HTMLInputElement).value)}
          onKeyPress={handleKeyPress}
        />

        <div 
          className={[styles.icon, styles.send, 'center-flex'].join(' ')} 
          onClick={handleSendMessage}
          title="Send message"
        >
          <img src={sendWhite} alt="send" />
        </div>

        <input 
          type="file" 
          ref={fileInputRef} 
          style={{ display: "none" }} 
          onChange={handleFileChange} 
          accept="image/*,.pdf,.txt,.doc,.docx" 
        />
      </div>
    </>
  );
}