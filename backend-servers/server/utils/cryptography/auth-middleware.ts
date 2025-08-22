import { CryptoAuth } from './auth.ts';

export class AuthenticationMiddleware {
    static async authenticate(message: any, wsClientId: string, getClientPublicKey: (clientId: string) => Promise<string | null>): Promise<{ success: boolean; error?: string; clientId?: string }> {
        if (message.command === 'upload_public_key') {
            const username = message.username;
            if (!username || !/^[a-zA-Z0-9_-]{3,16}$/.test(username)) return { success: false, error: 'Invalid username format' };
            if (!message.public_key || !CryptoAuth.validatePublicKey(message.public_key)) return { success: false, error: 'Invalid public key format' };
            return { success: true, clientId: username };
        }

        if (!message.client_id) return { success: false, error: 'Missing client_id' };

        const publicKey = await getClientPublicKey(message.client_id);
        if (!publicKey) return { success: false, error: 'Client not registered or public key not found' };

        const expectedClientId = wsClientId || message.client_id;
        const authResult = CryptoAuth.verifyMessage(message, expectedClientId, publicKey);
        if (!authResult.valid) return { success: false, error: authResult.error };

        return { success: true, clientId: message.client_id };
    }
}