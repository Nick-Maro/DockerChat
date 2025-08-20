export class SecureSession {
    private static activeSessions = new Map<string, {
        wsId: string;
        clientId: string;
        publicKey: string;
        lastActivity: number;
    }>();

    static bindSession(wsId: string, clientId: string, publicKey: string): void {
        this.activeSessions.set(wsId, { wsId, clientId, publicKey, lastActivity: Date.now() });
    }

    static getSession(wsId: string): { clientId: string; publicKey: string } | null {
        const session = this.activeSessions.get(wsId);
        if (!session) return null;
        session.lastActivity = Date.now();
        return { clientId: session.clientId, publicKey: session.publicKey };
    }

    static removeSession(wsId: string): void {
        this.activeSessions.delete(wsId);
    }

    static validateBinding(wsId: string, expectedClientId: string): boolean {
        const session = this.activeSessions.get(wsId);
        return session?.clientId === expectedClientId;
    }

    static cleanExpiredSessions(ttl: number = 3600000): void {
        const now = Date.now();
        for (const [wsId, session] of this.activeSessions.entries()) {
            if (now - session.lastActivity > ttl) this.activeSessions.delete(wsId);
        }
    }
}
