import crypto from 'crypto';

export class CryptoAuth {
    private static usedNonces = new Map<string, number>();
    private static readonly NONCE_TTL = 300000; // 5 minutes
    private static readonly MAX_TIME_SKEW = 30000; // 30 seconds

    static generateNonce(): string {
        return crypto.randomBytes(16).toString('hex');
    }

    static signData(data: string, privateKeyPem: string): string {
        const sign = crypto.createSign('SHA256');
        sign.update(data, 'utf8');
        sign.end();
        return sign.sign(privateKeyPem, 'base64');
    }

    static verifySignature(data: string, signature: string, publicKeyPem: string): boolean {
        const verify = crypto.createVerify('SHA256');
        verify.update(data, 'utf8');
        verify.end();
        return verify.verify(publicKeyPem, signature, 'base64');
    }

    static validateNonce(nonce: string, timestamp: number): { valid: boolean; error?: string } {
        const now = Date.now();
        this.cleanOldNonces();
        if (Math.abs(now - timestamp) > this.MAX_TIME_SKEW) return { valid: false, error: 'Request timestamp outside acceptable window' };
        if (this.usedNonces.has(nonce)) return { valid: false, error: 'Nonce already used (replay attack)' };
        this.usedNonces.set(nonce, now + this.NONCE_TTL);
        return { valid: true };
    }

    private static cleanOldNonces(): void {
        const now = Date.now();
        for (const [nonce, expiry] of this.usedNonces.entries()) {
            if (now > expiry) this.usedNonces.delete(nonce);
        }
    }

    static createSignedMessage(command: string, clientId: string, privateKey: string, extraData: Record<string, any> = {}): string {
        const nonce = this.generateNonce();
        const timestamp = Date.now();
        const dataToSign = `${command}|${clientId}|${nonce}|${timestamp}`;
        const signature = this.signData(dataToSign, privateKey);

        return JSON.stringify({
            command,
            client_id: clientId,
            nonce,
            timestamp,
            signature,
            ...extraData
        });
    }

    static verifyMessage(message: any, expectedClientId: string, publicKey: string): { valid: boolean; error?: string } {
        const { command, client_id, nonce, timestamp, signature } = message;

        if (!command || !client_id || !nonce || !timestamp || !signature) return { valid: false, error: 'Missing required authentication fields' };
        if (client_id !== expectedClientId) return { valid: false, error: 'Client ID mismatch with WebSocket session' };

        const nonceResult = this.validateNonce(nonce, timestamp);
        if (!nonceResult.valid) return nonceResult;

        const dataToVerify = `${command}|${client_id}|${nonce}|${timestamp}`;
        if (!this.verifySignature(dataToVerify, signature, publicKey)) return { valid: false, error: 'Invalid signature' };
        return { valid: true };
    }

    static generateKeyPair(): { publicKey: string; privateKey: string } {
        return crypto.generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { type: 'spki', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
        });
    }

    static validatePublicKey(publicKeyPem: string): boolean {
        try {
            crypto.createPublicKey(publicKeyPem);
            return true;
        } catch {
            return false;
        }
    }

    static validateECDHKey(ecdhKeyPem: string): boolean {
        try {
            const keyObject = crypto.createPublicKey(ecdhKeyPem);
            return keyObject.asymmetricKeyType === 'ec';
        } catch {
            return false;
        }
    }
}
