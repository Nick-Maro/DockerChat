
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

export async function signMessage(privateKey: CryptoKey, message: string): Promise<string> {
  const encoded = new TextEncoder().encode(message);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, encoded);
  return arrayBufferToBase64(signature);
}