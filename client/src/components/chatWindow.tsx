import { useEffect, useRef, useState } from "preact/hooks";
import styles from '../css/chatWindow.module.css';
import { useChat } from '../shared/chatContext';
import { useClient } from '../shared/authContext';

// icons
import attachWhite from '../assets/icons/attach-white.svg';
import sendWhite from '../assets/icons/send-white.svg';

export function ChatWindow() {
  const { currentRoom, messages, sendMessage } = useChat();
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

    const reader = new FileReader();

    reader.onload = () => {
      const dataUrl = reader.result;


      sendMessage(JSON.stringify({
        type: file.type.startsWith("image/") ? "image" : "file",
        name: file.name,
        data: dataUrl, 
      }));
    };


    reader.readAsDataURL(file);


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

                {(() => {
                  try {
                    const content = JSON.parse(msg.text);
                    return content.type === "image" ? (
                      <div className={styles.imageMessage}>
                        <a href={content.data} download={content.name}>
                          <img src={content.data} alt={content.name} />
                        </a>
                        <span className={styles.fileName}>{content.name}</span>
                      </div>
                    ) : (
                      <p className={styles.messageText}>
                        📎 <a href={content.data} download={content.name}>
                          <strong>{content.name}</strong>
                        </a>
                      </p>
                    );
                  } catch {
                    return <p className={styles.messageText}>{msg.text}</p>;
                  }
                })()}

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
