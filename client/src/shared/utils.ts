export async function generatePublicKey(): Promise<string> {
    const keyPair = await crypto.subtle.generateKey(
        {
            name: "RSA-OAEP",
            modulusLength: 2048,
            publicExponent: new Uint8Array([1, 0, 1]),
            hash: "SHA-256",
        },
        true,
        ["encrypt", "decrypt"]
    );

    const exported = await crypto.subtle.exportKey("spki", keyPair.publicKey);
    return btoa(String.fromCharCode(...new Uint8Array(exported)));
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