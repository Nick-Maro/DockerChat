// cryptoHelpers.ts (aggiornato per IndexedDB)
import { indexedDBHelper } from './indexedDBHelper';
import { arrayBufferToBase64, base64ToArrayBuffer } from "./utils";

export async function generateECDHKeyPair(): Promise<string> {
  try {
    const stored = await indexedDBHelper.getItem("ecdh_private");
    if(stored){
      try{
        const jwk = JSON.parse(stored);
        if (jwk.x && jwk.y) {
          const pubKey = await crypto.subtle.importKey(
            "jwk",
            { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, ext: true },
            { name: "ECDH", namedCurve: "P-256" },
            true,
            []
          );
          const spki = await crypto.subtle.exportKey("spki", pubKey);
          return `-----BEGIN PUBLIC KEY-----\n${arrayBufferToBase64(spki).match(/.{1,64}/g)?.join("\n")}\n-----END PUBLIC KEY-----`;
        }
      }
      catch{ }
    }
  } catch (e) {
    console.warn('Failed to get existing ECDH key from IndexedDB:', e);
  }

  const keyPair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey", "deriveBits"]);
  
  try {
    await indexedDBHelper.setItem("ecdh_private", JSON.stringify(await crypto.subtle.exportKey("jwk", keyPair.privateKey)));
  } catch (e) {
    console.warn('Failed to store ECDH private key in IndexedDB:', e);
  }
  
  const spki = await crypto.subtle.exportKey("spki", keyPair.publicKey);
  return `-----BEGIN PUBLIC KEY-----\n${arrayBufferToBase64(spki).match(/.{1,64}/g)?.join("\n")}\n-----END PUBLIC KEY-----`;
}

export function cleanBase64Input(input: string): string {
  if (!input || typeof input !== 'string') return input;
  let s = input.trim().replace(/\s+/g, '');
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4;
  if (pad === 2) s += '==';
  else if (pad === 3) s += '=';
  return s;
}

export async function getLocalECDHPublic(): Promise<string | null> {
  try {
    const stored = await indexedDBHelper.getItem('ecdh_private');
    if(!stored) return null;
    const jwk = JSON.parse(stored);
    if(!jwk.x || !jwk.y) return null;
    const publicJwk: any = { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, ext: true };
    const pubKey = await crypto.subtle.importKey('jwk', publicJwk, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
    const spki = await crypto.subtle.exportKey('spki', pubKey);
    const spkiBase64 = arrayBufferToBase64(spki);
    const pem = `-----BEGIN PUBLIC KEY-----\n${spkiBase64.match(/.{1,64}/g)?.join('\n')}\n-----END PUBLIC KEY-----`;
    return pem;
  }
  catch(e){
    console.warn('getLocalECDHPublic failed:', e);
    return null;
  }
}

export async function getECDHPrivateKey(): Promise<CryptoKey | null> {
  try {
    const stored = await indexedDBHelper.getItem("ecdh_private");
    if (!stored) return null;
    const jwk = JSON.parse(stored);
    return await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveKey", "deriveBits"]
    );
  } catch (e) {
    console.warn('Failed to get ECDH private key from IndexedDB:', e);
    return null;
  }
}

export async function importECDHPublicKey(pemKey: string): Promise<CryptoKey> {
  if(!pemKey) throw new Error("Empty or null key provided");
  const keyStr = pemKey.trim();
  const attempts: any[] = [];

  const tryImport = async (method: string, fn: () => Promise<CryptoKey>) => {
    try{ return await fn(); } 
    catch(e){ attempts.push({ method, error: e?.message || String(e) }); }
  };

  const importSpki = (binary: ArrayBuffer) => crypto.subtle.importKey("spki", binary, { name: "ECDH", namedCurve: "P-256" }, true, []);
  const importJwk = (jwk: JsonWebKey) => crypto.subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, true, []);
  const importRaw = (raw: ArrayBuffer) => crypto.subtle.importKey("raw", raw, { name: "ECDH", namedCurve: "P-256" }, true, []);

  if(keyStr.includes("-----BEGIN PUBLIC KEY-----")){
    const pemContents = keyStr.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s+/g, "");
    const key = await tryImport("PEM/SPKI", () => importSpki(base64ToArrayBuffer(pemContents)));
    if (key) return key;
  }

  const key = await tryImport("Direct Base64 SPKI", () => importSpki(base64ToArrayBuffer(keyStr)));
  if(key) return key;

  try {
    const jwk = JSON.parse(atob(keyStr));
    const keyJwk = await tryImport("JWK import", () => importJwk(jwk));
    if(keyJwk) return keyJwk;
  }
  catch(e){ attempts.push({ method: "JWK parse", error: e?.message || String(e) }); }

  const keyRaw = await tryImport("Raw import", () => importRaw(base64ToArrayBuffer(keyStr)));
  if(keyRaw) return keyRaw;

  throw new Error(`Failed to import key. Attempts: ${attempts.map(a => a.method).join(', ')}`);
}

export async function deriveSharedKey(peerPublicBase64: string): Promise<CryptoKey> {
  if(!peerPublicBase64) throw new Error("Empty or null peer public key provided");
  let privateKey: CryptoKey | null = null;
  try{
    privateKey = await getECDHPrivateKey();
    if(!privateKey) throw new Error("ECDH private key missing");
  }
  catch(privateKeyError){
    throw new Error(`Failed to retrieve ECDH private key: ${privateKeyError instanceof Error ? privateKeyError.message : String(privateKeyError)}`);
  }
  let peerPublicKey: CryptoKey | null = null;
  try{ peerPublicKey = await importECDHPublicKey(peerPublicBase64); }
  catch(importError){
    throw new Error(`Failed to import peer public key: ${importError instanceof Error ? importError.message : String(importError)}`);
  }
  try{
    const sharedKey = await crypto.subtle.deriveKey(
      { name: "ECDH", public: peerPublicKey as CryptoKey },
      privateKey as CryptoKey,
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"]
    );
    return sharedKey;
  }
  catch(deriveError){
    throw new Error(`Failed to derive shared key: ${deriveError instanceof Error ? deriveError.message : String(deriveError)}`);
  }
}

export async function encryptMessage(sharedKey: CryptoKey, message: string): Promise<string> {
  if (!sharedKey) throw new Error("Invalid shared key provided for encryption");
  if (message === undefined || message === null) throw new Error("Invalid message provided for encryption");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(message);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, sharedKey, encoded);
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return arrayBufferToBase64(combined.buffer);
}

export async function decryptMessage(sharedKey: CryptoKey, encryptedBase64: string): Promise<string> {
  if (!sharedKey) throw new Error("Invalid shared key provided for decryption");
  if (!encryptedBase64 || typeof encryptedBase64 !== 'string') throw new Error("Invalid encrypted message provided for decryption");
  const cleaned = cleanBase64Input(encryptedBase64);
  const arrayBuffer = base64ToArrayBuffer(cleaned);
  if (!arrayBuffer || arrayBuffer.byteLength < 13) throw new Error("Encrypted message is too short or malformed");
  const combined = new Uint8Array(arrayBuffer);
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const cipherBuffer = ciphertext.buffer.slice(ciphertext.byteOffset, ciphertext.byteOffset + ciphertext.byteLength);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, sharedKey, cipherBuffer);
  return new TextDecoder().decode(decrypted);
}

export async function fingerprintKey(sharedKey: CryptoKey): Promise<string> {
  try{
    const raw = await crypto.subtle.exportKey('raw', sharedKey);
    const b64 = btoa(String.fromCharCode(...new Uint8Array(raw)));
    return b64.substring(0, 24);
  }
  catch(e){
    console.warn('fingerprintKey failed:', e);
    return '';
  }
}