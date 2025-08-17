import { useEffect, useRef } from "preact/hooks";
import styles from '../css/chatWindow.module.css';

// icons
import attachWhite from '../assets/icons/attach-white.svg';
import sendWhite from '../assets/icons/send-white.svg';


export function ChatWindow(){
  const messages = [];
  const endRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const openFileDialog = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (event) => {
    const file = event.target.files[0];
    if (file) {
      console.log("File selected:", file);
      // conan implement the file upload logic
    }
  };


  return (
    <>
      <div className={`${styles.chatWindow} flex column`}>
        {messages.map((msg) => (
          <div key={msg.id} class={`${styles.message} ${msg.isMe ? styles.sent : styles.received} flex`}>
            <div className={styles.bubble}>
              <p>{msg.text}</p>
              <span className={styles.time}>{msg.time}</span>
            </div>
          </div>
        ))}
        <div ref={endRef}></div>
      </div>

      <div className={`${styles.messageComposer} center-flex`}>
        <div className={[styles.icon, styles.attach, 'center-flex'].join(' ')} onClick={openFileDialog}>
          <img src={attachWhite} alt="attach" />
        </div>

        <input type="text" placeholder="Type a message..." />
        <div className={[styles.icon, styles.send, 'center-flex'].join(' ')}>
          <img src={sendWhite} alt="send" />
        </div>

        <input 
          type="file" 
          ref={fileInputRef} 
          style={{ display: "none" }} 
          onChange={handleFileChange} 
        />
      </div>
    </>
  );
}