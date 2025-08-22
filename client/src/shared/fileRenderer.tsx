import { h } from "preact";
import styles from '../css/chatWindow.module.css';

interface FileMessage {
  filename?: string;
  content?: string;
  mimetype?: string;
  type?: "image" | "file";
  name?: string;
  data?: string;
}

export function renderFileMessage(msg: FileMessage) {
  const isImage = msg.mimetype?.startsWith("image/") || msg.type === "image";
  const filename = msg.filename || msg.name || "file";
  const content = msg.content || msg.data || "#";

  if (isImage) {
    return (
      <div className={styles.imageMessage}>
        <a href={content} download={filename} target="_blank" rel="noopener noreferrer">
          <img 
            src={content} 
            alt={filename}
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
        <span className={styles.fileName}>{filename}</span>
      </div>
    );
  }

  return (
    <p className={styles.messageText}>
      📎 <a href={content} download={filename}>
        <strong>{filename}</strong>
      </a>
    </p>
  );
}
