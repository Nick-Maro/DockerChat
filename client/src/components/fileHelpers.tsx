// fileHelpers.ts
export interface FileMessage {
  file?: boolean;
  filename?: string;
  content?: string;
  mimetype?: string;
  text?: string;
}

export interface ParsedFileContent {
  type: "image" | "file";
  data: string;
  name: string;
}


export const isImageFile = (mimetype?: string): boolean => {
  return mimetype?.startsWith("image/") ?? false;
};


export const parseMessageContent = (msg: FileMessage): ParsedFileContent | null => {
  if (!msg.text) return null;
  
  try {
    const content = JSON.parse(msg.text);
    if (content.type === "image" || content.type === "file") {
      return content as ParsedFileContent;
    }
  } catch {
    // Ignore parsing errors
  }
  
  return null;
};


export const isFileMessage = (msg: FileMessage): boolean => {
  return !!(msg.file && msg.filename && msg.content) || !!parseMessageContent(msg);
};


export const validateFile = (file: File): { valid: boolean; error?: string } => {
  const acceptedTypes = [
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'application/pdf', 'text/plain', 
    'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ];
  
  const maxSize = 10 * 1024 * 1024; // 10MB
  
  if (file.size > maxSize) {
    return { valid: false, error: 'File is too large (maximum 10MB)' };
  }
  
  if (!acceptedTypes.includes(file.type)) {
    return { valid: false, error: 'Unsupported file type' };
  }
  
  return { valid: true };
};


export const handleFileUpload = (
  file: File, 
  sendFile: (file: File) => void, 
  currentRoom: string | null
): boolean => {
  if (!file || !currentRoom) return false;
  
  sendFile(file);
  return true;
};
