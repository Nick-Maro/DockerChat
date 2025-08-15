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