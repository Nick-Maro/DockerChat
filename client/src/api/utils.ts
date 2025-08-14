
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  return Uint8Array.from(atob(base64), c => c.charCodeAt(0)).buffer;
}


/**************************************************/


export async function generateOrLoadKeys(): Promise<{ privateKey: CryptoKey; publicKey: CryptoKey }> {
  const privateKeyB64 = localStorage.getItem("privateKey");
  const publicKeyB64 = localStorage.getItem("publicKey");

  if (privateKeyB64 && publicKeyB64) {
    const privateKey = await crypto.subtle.importKey(
      "pkcs8",
      base64ToArrayBuffer(privateKeyB64),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      true,
      ["sign"]
    );
    const publicKey = await crypto.subtle.importKey(
      "spki",
      base64ToArrayBuffer(publicKeyB64),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      true,
      ["verify"]
    );
    return { privateKey, publicKey };
  }

  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256"
    },
    true,
    ["sign", "verify"]
  );

  const exportedPriv = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
  const exportedPub = await crypto.subtle.exportKey("spki", keyPair.publicKey);

  localStorage.setItem("privateKey", arrayBufferToBase64(exportedPriv));
  localStorage.setItem("publicKey", arrayBufferToBase64(exportedPub));

  return { privateKey: keyPair.privateKey, publicKey: keyPair.publicKey };
}


export async function signMessage(privateKey: CryptoKey, message: string): Promise<string> {
  const encoded = new TextEncoder().encode(message);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, encoded);
  return arrayBufferToBase64(signature);
}


export async function sendCommandHttp(command: string, privateKey: CryptoKey, clientId: string, host: string, port: number, extraData?: Record<string, any>): Promise<any> {
  const bodyData: Record<string, any> = { command, client_id: clientId };

  if(extraData) Object.assign(bodyData, extraData);

  if(command.startsWith("send_message:") || command.startsWith("send_private:")){
    let messageText = "";
    if(command.startsWith("send_message:")) messageText = command.split(":", 2)[1];
    else{
      const parts = command.split(":", 3);
      messageText = parts[2] ?? "";
    }

    if(messageText){
      const signature = await signMessage(privateKey, messageText);
      bodyData.signature = signature;
      bodyData.message = messageText;
    }
  }

  try {
    const url = `http://api.${host}:${port}/command`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Connection: "keep-alive" },
      body: JSON.stringify(bodyData),
    });

    const text = await res.text();
    try{ return JSON.parse(text); }
    catch{ return text; }
  }
  catch(err){
    console.error("Error sending command:", err);
    return null;
  }
}