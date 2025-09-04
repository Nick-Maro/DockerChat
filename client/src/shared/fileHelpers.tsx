export const getMessageType = (mimetype?: string): "image" | "file" | "message" => {
  if(mimetype?.startsWith("image/")) return "image";
  if(mimetype) return "file";
  return "message";
};

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