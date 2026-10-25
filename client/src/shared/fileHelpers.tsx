export const getMessageType = (mimetype?: string): "image" | "file" | "message" => {
  if(mimetype?.startsWith("image/")) return "image";
  if(mimetype) return "file";
  return "message";
};

// A decrypted attachment is still untrusted input. Never turn peer-supplied
// javascript:, HTML, SVG, or arbitrary URLs into links in the app's origin.
export function safeAttachmentUrls(content: string): { download: string; preview?: string } | null {
  const match = /^data:([a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+)?;base64,([A-Za-z0-9+/]*={0,2})$/.exec(content);
  if (!match) return null;
  const mime = (match[1] || '').toLowerCase();
  const data = match[2];
  if (data.length % 4 !== 0) return null;
  const preview = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mime)
    ? `data:${mime};base64,${data}` : undefined;
  return { download: `data:application/octet-stream;base64,${data}`, preview };
}

export const validateFile = (file: File): { valid: boolean; error?: string } => {
  const acceptedTypes = [
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'application/pdf', 'text/plain', 
    'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ];
  
  const maxSize = 10 * 1024 * 1024; // 10MB
  if(file.size > maxSize) return { valid: false, error: 'File is too large (maximum 10MB)' };
  if(!acceptedTypes.includes(file.type)) return { valid: false, error: 'Unsupported file type' };
  
  return { valid: true };
};
