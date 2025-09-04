export async function generateKeyPair(): Promise<{ publicKeyPem: string, privateKey: CryptoKey }> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"]
  );

  const exported = await crypto.subtle.exportKey("spki", keyPair.publicKey);
  const exportedAsBase64 = btoa(String.fromCharCode(...new Uint8Array(exported)));
  const pem = `-----BEGIN PUBLIC KEY-----\n${exportedAsBase64.match(/.{1,64}/g)?.join("\n")}\n-----END PUBLIC KEY-----`;

  const exportedPriv = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
  const privBase64 = btoa(String.fromCharCode(...new Uint8Array(exportedPriv)));
  localStorage.setItem("private_key", privBase64);
  return { publicKeyPem: pem, privateKey: keyPair.privateKey };
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
export async function signMessage(privateKey: CryptoKey, message: string): Promise<string> {
  const encoded = new TextEncoder().encode(message);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, encoded);
  return arrayBufferToBase64(signature);
}

export async function getOrCreatePublicKey(): Promise<string> {
  const cachedPublic = localStorage.getItem('public_key');
  if(cachedPublic) return cachedPublic;
  const { publicKeyPem } = await generateKeyPair();
  localStorage.setItem('public_key', publicKeyPem);
  return publicKeyPem;
}

export async function sendAuthenticatedMessage(sendMessage: (msg: any) => void, message: any) {
  const privateKey = await getPrivateKey();
  if(!privateKey){
    console.error("Cannot send authenticated message: Private key is missing.");
    throw new Error("Private key missing");
  }
  const { command, client_id, ...extraData } = message;
  const nonce = crypto.randomUUID();
  const timestamp = Date.now();
  const dataToSign = `${command}|${client_id}|${nonce}|${timestamp}`;
  const signature = await signMessage(privateKey, dataToSign);
  const finalMessage = { command, client_id, nonce, timestamp, signature, ...extraData };
  
  sendMessage(finalMessage);
}

export async function getPrivateKey(): Promise<CryptoKey | null> {
  const privBase64 = localStorage.getItem("private_key");
  if(!privBase64) return null;
  const privBuffer = Uint8Array.from(atob(privBase64), c => c.charCodeAt(0));

  return await crypto.subtle.importKey(
    "pkcs8",
    privBuffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    true,
    ["sign"]
  );
}

export function formatDateTime(dateStr: string): string {
  const dt = new Date(dateStr);
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  const sameDay = dt.toDateString() === now.toDateString();
  const time = [dt.getHours(), dt.getMinutes()].map(pad).join(":");

  if(sameDay) return time;

  const date = [pad(dt.getDate()), pad(dt.getMonth() + 1), dt.getFullYear().toString().slice(-2)].join("/");
  return `${date} ${time}`;
}
//
// ---------- ECDH (Key Exchange) ----------
//

/**
 * Generate an ECDH key pair (P-256).
 * - Stores the private key in localStorage.
 * - Returns the public key (Base64 encoded).
 */
export async function generateECDHKeyPair(): Promise<string> {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveKey", "deriveBits"]
  );

  // Export & save private key
  const priv = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
  localStorage.setItem("ecdh_private", JSON.stringify(priv));

  // Export public key to send to the server/other users
  const pub = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  return arrayBufferToBase64(pub);
}

/**
 * Import your ECDH private key from localStorage.
 */
async function getECDHPrivateKey(): Promise<CryptoKey | null> {
  const stored = localStorage.getItem("ecdh_private");
  if (!stored) return null;

  const jwk = JSON.parse(stored);
  return await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveKey", "deriveBits"]
  );
}

/**
 * Import someone else's ECDH public key (Base64) to use for key agreement.
 */
async function importECDHPublicKey(pubBase64: string): Promise<CryptoKey> {
  const raw = base64ToArrayBuffer(pubBase64);
  return await crypto.subtle.importKey(
    "raw",
    raw,
    { name: "ECDH", namedCurve: "P-256" },
    true,
    []
  );
}

/**
 * Derive a shared AES-GCM key from your private key and the other user's public key.
 */
export async function deriveSharedKey(peerPublicBase64: string): Promise<CryptoKey> {
  const privateKey = await getECDHPrivateKey();
  if (!privateKey) throw new Error("ECDH private key missing.");

  const peerPublicKey = await importECDHPublicKey(peerPublicBase64);

  return await crypto.subtle.deriveKey(
    { name: "ECDH", public: peerPublicKey },
    privateKey,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
}

//
// ---------- AES-GCM Encryption ----------
//

/**
 * Encrypt a message using a shared AES-GCM key.
 * Returns Base64 encoded { iv, ciphertext }.
 */
export async function encryptMessage(sharedKey: CryptoKey, message: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(message);

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    sharedKey,
    encoded
  );

  // Combine IV + ciphertext for transmission
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);

  return arrayBufferToBase64(combined.buffer);
}

/**
 * Decrypt a Base64 encoded message (IV + ciphertext).
 */
export async function decryptMessage(sharedKey: CryptoKey, encryptedBase64: string): Promise<string> {
  const combined = new Uint8Array(base64ToArrayBuffer(encryptedBase64));
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    sharedKey,
    ciphertext
  );

  return new TextDecoder().decode(decrypted);
}