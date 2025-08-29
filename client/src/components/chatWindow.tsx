import { useEffect, useRef, useState } from "preact/hooks";
import styles from '../css/chatWindow.module.css';
import { useChat } from '../shared/chatContext';
import { useClient } from '../shared/authContext';
import { Message } from "../types";
import { getMessageType } from '../shared/fileHelpers';

// icons
import attachWhite from '../assets/icons/attach-white.svg';
import sendWhite from '../assets/icons/send-white.svg';


export function ChatWindow() {
  const { currentRoom, currentClient, messages, privateMessages, sendMessage, sendFile, sendPrivateMessage, sendPrivateFile } = useChat();
  const { username } = useClient();
  const [messageText, setMessageText] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);
  const activeMessages = currentClient ? (privateMessages[currentClient.client_id] || []) : messages;

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [activeMessages]);

  const stopEvent = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragEnter = (e: DragEvent) => {
    stopEvent(e);

    const types = e.dataTransfer?.types;
    const hasFiles = types && (types.includes?.("Files") || Array.from(types).includes("Files"));
    if(!hasFiles) return;

    dragCounter.current++;
    setIsDragOver(true);
  };

  const handleDragLeave = (e: DragEvent) => {
    stopEvent(e);
    dragCounter.current--;
    if(dragCounter.current <= 0){
      dragCounter.current = 0;
      setIsDragOver(false);
    }
  };

  const handleDragOver = (e: DragEvent) => {
    stopEvent(e);
    e.dataTransfer!.dropEffect = "copy";
  };

  const handleDrop = (e: DragEvent) => {
    stopEvent(e);

    dragCounter.current = 0;
    setIsDragOver(false);

    const files = e.dataTransfer?.files;
    if(files && files.length > 0){
      const file = files[0];
      handleFileUploadWrapper(file);
    }
  };

  const handleFileUploadWrapper = async (file: File) => {
    try{
      setUploadError(null);

      if(file.size > 10 * 1024 * 1024){ // File size check (10MB)
        setUploadError("File size must be less than 10MB");
        return;
      }

      if(currentRoom) await sendFile(file);
      else if(currentClient) await sendPrivateFile(file);
      else setUploadError("No chat selected");
    }
    catch(error){
      console.error("File upload failed:", error);
      setUploadError("File upload failed");
    }
  };

  const openFileDialog = () => fileInputRef.current?.click();
  const handleFileChange = (event: Event) => {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    if(file) handleFileUploadWrapper(file);
    target.value = "";
  };

  const handleSendMessage = () => {
    if(messageText.trim() && currentRoom){
      sendMessage(messageText.trim());
      setMessageText('');
    }
    else if(messageText.trim() && currentClient){
      sendPrivateMessage(messageText.trim());
      setMessageText('');
    }
  };

  const handleKeyPress = (event: KeyboardEvent) => {
    if(event.key === 'Enter' && !event.shiftKey){
      event.preventDefault();
      handleSendMessage();
    }
  };

  const renderMessage = (msg: Message) => {
    if(msg.file && msg.filename && msg.content){
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
    } else if(msg.file && msg.filename && !msg.content) {
      console.warn("File message without content:", msg);
      return (
        <p className={`${styles.fileMessage} flex`}>
          <span>❌</span>
          <span>{msg.filename} (file content missing)</span>
        </p>
      );
    }

    return <p className={styles.messageText}>{msg.text}</p>;
  };

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
        onDrop={handleDrop}>

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
            <div key={index} className={`${styles.message} ${msg.from_client === username ? styles.sent : styles.received} flex`}>
              <div className={styles.bubble} style={getMessageType(msg.mimetype) === "image" ? { width: '35%' } : {}}>
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

        {uploadError && (
          <div className={[styles.errorUpload, 'center-flex'].join(' ')}>
            <strong>❌ {uploadError}</strong>
          </div>
        )}
      </div>

      <div className={`${styles.messageComposer} center-flex`}>
        <div className={[styles.icon, styles.attach, 'center-flex'].join(' ')} onClick={openFileDialog} title="Attach file">
          <img src={attachWhite} alt="attach" />
          <input type="file" hidden ref={fileInputRef} onChange={handleFileChange} accept="image/*,.pdf,.txt,.doc,.docx" />
        </div>

        <input type="text"
          placeholder={currentRoom ? "Type a message..." : `Message ${currentClient?.client_id}...`}
          value={messageText} 
          onChange={(e) => setMessageText((e.target as HTMLInputElement).value)} 
          onKeyPress={handleKeyPress} />

        <div className={[styles.icon, styles.send, 'center-flex'].join(' ')} onClick={handleSendMessage} title="Send message">
          <img src={sendWhite} alt="send" />
        </div>
      </div>
    </>
  );
}