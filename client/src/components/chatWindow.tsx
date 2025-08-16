import { useEffect, useRef } from "preact/hooks";
import styles from '../css/chatWindow.module.css';

// icons
import attachWhite from '../assets/icons/attach-white.svg';
import sendWhite from '../assets/icons/send-white.svg';

const messages = [
  {
    id: 1,
    sender: "Addisyn Lawson",
    text: "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
    time: "09:12 AM",
    isMe: false,
  },
  {
    id: 2,
    sender: "Jolene Shaw",
    text: "Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
    time: "09:13 AM",
    isMe: true,
  },
  {
    id: 3,
    sender: "Addisyn Lawson",
    text: "Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.",
    time: "09:14 AM",
    isMe: false,
  },
  {
    id: 4,
    sender: "Jolene Shaw",
    text: "Nisi ut aliquip ex ea commodo consequat.",
    time: "09:15 AM",
    isMe: true,
  },
  {
    id: 5,
    sender: "Addisyn Lawson",
    text: "Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore.",
    time: "09:16 AM",
    isMe: false,
  },
  {
    id: 6,
    sender: "Jolene Shaw",
    text: "Eu fugiat nulla pariatur.",
    time: "09:17 AM",
    isMe: true,
  },
  {
    id: 7,
    sender: "Addisyn Lawson",
    text: "Excepteur sint occaecat cupidatat non proident.",
    time: "09:18 AM",
    isMe: false,
  },
  {
    id: 8,
    sender: "Jolene Shaw",
    text: "Sunt in culpa qui officia deserunt mollit anim id est laborum.",
    time: "09:19 AM",
    isMe: true,
  },
];

export function ChatWindow() {
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
