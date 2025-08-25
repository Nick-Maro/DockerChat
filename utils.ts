// File utils.ts - chiavi unificate per autenticazione e crittografia

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

export async function signMessage(privateKey: CryptoKey, message: string): Promise<string> {
    const encoder = new TextEncoder();
    const dataToSign = encoder.encode(message); // <-- Sign the raw string

    const signature = await crypto.subtle.sign(
        { name: "RSASSA-PKCS1-v1_5" },
        privateKey,
        dataToSign
    );

    return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

export async function getOrCreatePublicKey(): Promise<string> {
    const cachedPublic = localStorage.getItem('public_key');
    if (cachedPublic) return cachedPublic;
    const { publicKeyPem, privateKey } = await generateKeyPair();
    localStorage.setItem('public_key', publicKeyPem);
    return publicKeyPem;
}

export async function sendAuthenticatedMessage(sendMessage: (msg: any) => void, message: any) {
    const privateKey = await getPrivateKey();
    if (!privateKey) {
        console.error("Cannot send authenticated message: Private key is missing.");
        return;
    }
    const { command, client_id, ...extraData } = message;
    const nonce = crypto.randomUUID();
    const timestamp = Date.now();
    const dataToSign = `${command}|${client_id}|${nonce}|${timestamp}`;
    const signature = await signMessage(privateKey, dataToSign);
    const finalMessage = {
        command,
        client_id,
        nonce,
        timestamp,
        signature,
        ...extraData
    };
    sendMessage(finalMessage);
}

export async function getPrivateKey(): Promise<CryptoKey | null> {
    const privBase64 = localStorage.getItem("private_key");
    if (!privBase64) return null;
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

// ========== FUNZIONI AGGIUNTIVE PER CRITTOGRAFIA ==========

// Funzione per verificare la firma digitale
export async function verifySignature(publicKeyPem: string, message: string, signatureBase64: string): Promise<boolean> {
    try {
        const encoder = new TextEncoder();
        const dataToVerify = encoder.encode(message);
        
        // Importa la chiave pubblica per verifica firma
        const publicKeyBuffer = Uint8Array.from(
            atob(publicKeyPem.replace(/-----BEGIN PUBLIC KEY-----|\n|-----END PUBLIC KEY-----/g, "")), 
            c => c.charCodeAt(0)
        );
        const publicKey = await crypto.subtle.importKey(
            "spki",
            publicKeyBuffer,
            { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
            false,
            ["verify"]
        );
        
        // Decodifica la firma
        const signatureBuffer = Uint8Array.from(atob(signatureBase64), c => c.charCodeAt(0));
        
        // Verifica la firma
        return await crypto.subtle.verify(
            { name: "RSASSA-PKCS1-v1_5" },
            publicKey,
            signatureBuffer,
            dataToVerify
        );
    } catch (error) {
        console.error("Signature verification failed:", error);
        return false;
    }
}

// Funzione helper per importare la stessa chiave privata come RSA-OAEP per crittografia
async function getPrivateKeyForEncryption(): Promise<CryptoKey | null> {
    const privBase64 = localStorage.getItem("private_key");
    if (!privBase64) return null;
    
    try {
        const privBuffer = Uint8Array.from(atob(privBase64), c => c.charCodeAt(0));
        return await crypto.subtle.importKey(
            "pkcs8",
            privBuffer,
            { name: "RSA-OAEP", hash: "SHA-256" },
            true,
            ["decrypt"]
        );
    } catch (error) {
        console.error("Failed to import private key for encryption:", error);
        return null;
    }
}

// Cripta un messaggio usando crittografia ibrida (AES + RSA per scambio chiavi)
export async function encryptMessage(message: string, recipientPublicKeyPem: string): Promise<{
    encryptedData: string;
    encryptedKey: string;
    iv: string;
}> {
    console.log("Encrypting message with recipient key");
    
    try {
        // Genera una chiave AES simmetrica per il messaggio
        const aesKey = await crypto.subtle.generateKey(
            { name: "AES-GCM", length: 256 },
            true,
            ["encrypt", "decrypt"]
        );
        
        // Genera IV per AES
        const iv = crypto.getRandomValues(new Uint8Array(12));
        
        // Cripta il messaggio con AES
        const encoder = new TextEncoder();
        const messageBuffer = encoder.encode(message);
        const encryptedMessage = await crypto.subtle.encrypt(
            { name: "AES-GCM", iv },
            aesKey,
            messageBuffer
        );
        
        // Esporta la chiave AES
        const exportedAesKey = await crypto.subtle.exportKey("raw", aesKey);
        
        // Importa la chiave pubblica del destinatario come RSA-OAEP per crittografia
        const publicKeyBuffer = Uint8Array.from(
            atob(recipientPublicKeyPem.replace(/-----BEGIN PUBLIC KEY-----|\n|-----END PUBLIC KEY-----/g, "")), 
            c => c.charCodeAt(0)
        );
        
        const recipientPublicKey = await crypto.subtle.importKey(
            "spki",
            publicKeyBuffer,
            { name: "RSA-OAEP", hash: "SHA-256" },
            false,
            ["encrypt"]
        );
        
        // Cripta la chiave AES con RSA-OAEP
        const encryptedAesKey = await crypto.subtle.encrypt(
            { name: "RSA-OAEP" },
            recipientPublicKey,
            exportedAesKey
        );
        
        return {
            encryptedData: btoa(String.fromCharCode(...new Uint8Array(encryptedMessage))),
            encryptedKey: btoa(String.fromCharCode(...new Uint8Array(encryptedAesKey))),
            iv: btoa(String.fromCharCode(...iv))
        };
    } catch (error) {
        console.error("Encryption failed:", error);
        throw error;
    }
}

// Decripta un messaggio
export async function decryptMessage(encryptedData: string, encryptedKey: string, ivBase64: string): Promise<string> {
    console.log("Attempting to decrypt message");
    
    try {
        // Usa la stessa chiave privata ma importata come RSA-OAEP
        const privateKey = await getPrivateKeyForEncryption();
        if (!privateKey) {
            throw new Error("Private key not found");
        }
        
        // Decodifica i dati
        const encryptedDataBuffer = Uint8Array.from(atob(encryptedData), c => c.charCodeAt(0));
        const encryptedKeyBuffer = Uint8Array.from(atob(encryptedKey), c => c.charCodeAt(0));
        const iv = Uint8Array.from(atob(ivBase64), c => c.charCodeAt(0));
        
        // Decripta la chiave AES con RSA-OAEP
        const decryptedAesKeyBuffer = await crypto.subtle.decrypt(
            { name: "RSA-OAEP" },
            privateKey,
            encryptedKeyBuffer
        );
        
        // Importa la chiave AES
        const aesKey = await crypto.subtle.importKey(
            "raw",
            decryptedAesKeyBuffer,
            { name: "AES-GCM", length: 256 },
            false,
            ["decrypt"]
        );
        
        // Decripta il messaggio
        const decryptedMessage = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv },
            aesKey,
            encryptedDataBuffer
        );
        
        const decoder = new TextDecoder();
        const result = decoder.decode(decryptedMessage);
        console.log("Message decrypted successfully");
        return result;
    } catch (error) {
        console.error("Decryption failed:", error);
        throw error;
    }
}

// Recupera la chiave pubblica di un client
export async function getClientPublicKey(clientId: string): Promise<string | null> {
    const key = localStorage.getItem(`client_public_key_${clientId}`);
    console.log(`Retrieved public key for ${clientId}:`, key ? "EXISTS" : "NOT_FOUND");
    return key;
}

// Salva la chiave pubblica di un client
export async function storeClientPublicKey(clientId: string, publicKeyPem: string): Promise<void> {
    localStorage.setItem(`client_public_key_${clientId}`, publicKeyPem);
    console.log(`Stored public key for ${clientId}`);
}
// Invio messaggio privato con crittografia + firma
export async function sendSecurePrivateMessage(
  sendMessage: (msg: any) => void,
  fromClient: string,
  toClient: string,
  text: string,
  recipientPublicKeyPem: string
) {
  const privateKey = await getPrivateKey();
  if (!privateKey) {
    console.error("Missing private key");
    return;
  }

  // Cifra il messaggio con la chiave pubblica del destinatario
  const encrypted = await encryptMessage(text, recipientPublicKeyPem);

  // Firma il messaggio originale (non cifrato)
  const dataToSign = `${fromClient}|${toClient}|${text}|${encrypted.iv}`;
  const signature = await signMessage(privateKey, dataToSign);

  const finalMessage = {
    command: `send_private:${toClient}`,
    client_id: fromClient,
    encryptedData: encrypted.encryptedData,
    encryptedKey: encrypted.encryptedKey,
    iv: encrypted.iv,
    signature,
    public_key: await getOrCreatePublicKey()
  };

  sendMessage(finalMessage);
}

// Invio file privato (cifrato + firmato)
export async function sendSecurePrivateFile(
  sendMessage: (msg: any) => void,
  fromClient: string,
  toClient: string,
  file: File,
  recipientPublicKeyPem: string
) {
  const privateKey = await getPrivateKey();
  if (!privateKey) {
    console.error("Missing private key");
    return;
  }

  const toBase64 = (f: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(f);
  });

  const base64 = await toBase64(file);

  // Cripta il contenuto del file
  const encrypted = await encryptMessage(base64, recipientPublicKeyPem);
  // Firma metadati + IV
  const dataToSign = `${fromClient}|${toClient}|${file.name}|${encrypted.iv}`;
  const signature = await signMessage(privateKey, dataToSign);

  const finalMessage = {
    command: `send_private:${toClient}:${file.name}`,
    client_id: fromClient,
    file: true,
    filename: file.name,
    mimetype: file.type,
    encryptedData: encrypted.encryptedData,
    encryptedKey: encrypted.encryptedKey,
    iv: encrypted.iv,
    signature,
    public_key: await getOrCreatePublicKey()
  };

  sendMessage(finalMessage);
}