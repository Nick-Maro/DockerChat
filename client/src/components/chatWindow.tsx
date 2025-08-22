import { useEffect, useRef, useState } from "preact/hooks";
import styles from '../css/chatWindow.module.css';
import { useChat } from '../shared/chatContext';
import { useClient } from '../shared/authContext';

// icons
import attachWhite from '../assets/icons/attach-white.svg';
import sendWhite from '../assets/icons/send-white.svg';

export function ChatWindow() {
  const { currentRoom, messages, sendMessage, sendFile } = useChat();
  const { username } = useClient();
  const [messageText, setMessageText] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const openFileDialog = () => { 
    fileInputRef.current?.click(); 
  };

  const handleFileChange = (event: Event) => {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file || !currentRoom) return;

    // use the sendFile function from context instead of sendMessage
    sendFile(file);

    // clear the input
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

  const renderMessage = (msg: any) => {
    // Check if this is a file message
    if (msg.file && msg.filename && msg.content) {
      const isImage = msg.mimetype?.startsWith("image/");
      
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

    try {
      const content = JSON.parse(msg.text);
      if (content.type === "image") {
        return (
          <div className={styles.imageMessage}>
            <a href={content.data} download={content.name} target="_blank" rel="noopener noreferrer">
              <img 
                src={content.data} 
                alt={content.name}
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
            <span className={styles.fileName}>{content.name}</span>
          </div>
        );
      } else if (content.type === "file") {
        return (
          <p className={styles.messageText}>
            📎 <a href={content.data} download={content.name}>
              <strong>{content.name}</strong>
            </a>
          </p>
        );
      }
    } catch {

    }

    // Regular text message
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
      <div className={`${styles.chatWindow} flex column`}>
        {messages.length === 0 ? (
          <div className={styles.noMessages}>
            <p>No messages yet.</p>
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