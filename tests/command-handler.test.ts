import { expect, test } from 'bun:test';
import crypto from 'node:crypto';
import { CommandHandler } from '../backend-servers/server/commandHandler.ts';
import { CryptoAuth } from '../backend-servers/server/utils/cryptography/auth.ts';
import { storage } from '../backend-servers/server/storage.ts';
import { DataManager } from '../backend-servers/server/dataManager.ts';
import { SecureSession } from '../backend-servers/server/utils/cryptography/session.ts';
import { arrayBufferToBase64, base64ToArrayBuffer } from '../client/src/shared/utils.ts';
import { encryptMessage, decryptMessage, fingerprintKey } from '../client/src/shared/cryptoHelpers.ts';
import { safeAttachmentUrls } from '../client/src/shared/fileHelpers.tsx';
import { CONFIG } from '../backend-servers/server/config.ts';

const rsa = CryptoAuth.generateKeyPair();
const ecdh = crypto.generateKeyPairSync('ec', {
  namedCurve: 'prime256v1', publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

function fixture() {
  const sent: any[] = [];
  const delivered: any[] = [];
  let storedMessages = 0;
  let updatedMessages = 0;
  const ws = { data: { wsId: crypto.randomUUID(), clientId: 'alice' }, readyState: 1, send: (data: string) => sent.push(JSON.parse(data)) };
  const target = { data: { wsId: crypto.randomUUID(), clientId: 'bob' }, readyState: 1, send: (data: string) => delivered.push(JSON.parse(data)) };
  const manager = {
    cleanExpiredData: async () => {},
    getClient: async (id: string) => ({ id, public_key: rsa.publicKey, room_id: null }),
    setClientOnline: async () => {},
    updateClientLastSeen: async () => {},
    addPrivateMessage: async () => { storedMessages++; return 'message-test-id'; },
    getPrivateMessages: async () => ({ other: { id: 'other', from_client: 'bob', to_client: 'carol', text: 'private' } }),
    updatePrivateMessage: async () => { updatedMessages++; return true; },
  };
  const handler = new CommandHandler(manager as any, 'test-server', { publish: () => {} } as any);
  const sockets = new Map([['bob', target]]);
  return { sent, delivered, ws, handler, sockets, storedMessages: () => storedMessages, updatedMessages: () => updatedMessages };
}

test('an unsigned ECDH update cannot replace a registered public key', async () => {
  const f = fixture();
  await f.handler.handle(f.ws as any, JSON.stringify({ command: 'upload_ecdh_key', username: 'alice', client_id: 'alice', ecdh_key: ecdh.publicKey }), f.sockets as any);
  expect(f.sent.at(-1).error).toContain('Authentication failed');
  expect(SecureSession.getSession(f.ws.data.wsId)).toBeNull();
});

test('a signed ECDH update cannot target a different identity', async () => {
  const f = fixture();
  const message = CryptoAuth.createSignedMessage('upload_ecdh_key', 'alice', rsa.privateKey, { username: 'bob', ecdh_key: ecdh.publicKey });
  await f.handler.handle(f.ws as any, message, f.sockets as any);
  expect(f.sent.at(-1).error).toContain("another client's");
});

test('an owner can authenticate and update their own ECDH key', async () => {
  const f = fixture();
  const message = CryptoAuth.createSignedMessage('upload_ecdh_key', 'alice', rsa.privateKey, { username: 'alice', ecdh_key: ecdh.publicKey });
  await f.handler.handle(f.ws as any, message, f.sockets as any);
  expect(f.sent.at(-1).status).toBe('ecdh_updated');
  expect(SecureSession.getECDHKey(f.ws.data.wsId)).toBe(ecdh.publicKey);
});

test('a modified private-message recipient is rejected before storage or delivery', async () => {
  const f = fixture();
  const message = JSON.parse(CryptoAuth.createSignedMessage('send_private:bob:ENC', 'alice', rsa.privateKey, { encrypted: true, content: 'ciphertext' }));
  message.command = 'send_private:mallory:ENC';
  await f.handler.handle(f.ws as any, JSON.stringify(message), f.sockets as any);
  expect(f.sent.at(-1).error).toContain('Authentication failed');
  expect(f.storedMessages()).toBe(0);
  expect(f.delivered).toHaveLength(0);
});

test('encrypted private payload reaches the intended socket without plaintext', async () => {
  const f = fixture();
  const message = CryptoAuth.createSignedMessage('send_private:bob:ENC', 'alice', rsa.privateKey, { encrypted: true, content: 'ciphertext' });
  await f.handler.handle(f.ws as any, message, f.sockets as any);
  expect(f.storedMessages()).toBe(1);
  expect(f.delivered).toHaveLength(1);
  expect(f.delivered[0].content).toBe('ciphertext');
  expect(f.delivered[0].encrypted).toBe(true);
});

test('invalid JSON shapes produce an error instead of throwing', async () => {
  for (const value of [null, [], { command: 123 }]) {
    const f = fixture();
    await f.handler.handle(f.ws as any, JSON.stringify(value), f.sockets as any);
    expect(f.sent.at(-1).error).toBe('Invalid command message');
  }
});

test('an authenticated client cannot delete someone else\'s private message', async () => {
  const f = fixture();
  const message = CryptoAuth.createSignedMessage('delete_private_message:other', 'alice', rsa.privateKey);
  await f.handler.handle(f.ws as any, message, f.sockets as any);
  expect(f.sent.at(-1).error).toContain('only delete your own');
  expect(f.updatedMessages()).toBe(0);
});

test('private-message reply metadata survives persistence', async () => {
  const manager = new DataManager();
  const id = crypto.randomUUID();
  await manager.addPrivateMessage('alice', 'bob', 'reply', id, undefined, false, undefined, undefined, undefined, false, 'original-id', 'original text', 'bob');
  const messages = await storage.getPrivateMessages();
  expect(messages[id]?.reply_to).toBe('original-id');
  expect(messages[id]?.reply_to_text).toBe('original text');
  expect(messages[id]?.reply_to_user).toBe('bob');
});

test('large attachment buffers encode without exceeding the JS argument limit', () => {
  const bytes = new Uint8Array(512 * 1024).fill(137);
  expect(new Uint8Array(base64ToArrayBuffer(arrayBufferToBase64(bytes.buffer)))).toEqual(bytes);
});

test('encrypted attachment data roundtrips and a missing key fails closed', async () => {
  const key = await crypto.webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const data = 'data:text/plain;base64,aGVsbG8=';
  const ciphertext = await encryptMessage(key, data);
  expect(ciphertext).not.toContain(data);
  expect(await decryptMessage(key, ciphertext)).toBe(data);
  await expect(encryptMessage(undefined as any, data)).rejects.toThrow('Invalid shared key');
});

test('key fingerprints disclose a digest, never a prefix of the raw AES key', async () => {
  const raw = new Uint8Array(32).fill(42);
  const key = await crypto.webcrypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
  const expected = crypto.createHash('sha256').update(raw).digest('base64').slice(0, 24);
  const fingerprint = await fingerprintKey(key);
  expect(fingerprint).toBe(expected);
  expect(fingerprint).not.toBe(Buffer.from(raw).toString('base64').slice(0, 24));
});

test('attachment links reject active URL schemes and use safe download MIME types', () => {
  for (const value of ['javascript:alert(1)', 'https://example.invalid/file', 'data:text/html,<script>alert(1)</script>', 'data:text/plain;base64,???']) {
    expect(safeAttachmentUrls(value)).toBeNull();
  }
  expect(safeAttachmentUrls('data:text/html;base64,PHNjcmlwdD4=')?.download).toStartWith('data:application/octet-stream;');
  expect(safeAttachmentUrls('data:image/svg+xml;base64,PHN2Zz4=')?.preview).toBeUndefined();
  expect(safeAttachmentUrls('data:image/png;base64,aGVsbG8=')?.preview).toStartWith('data:image/png;');
});

test('a maximum-size encrypted attachment fits the configured WebSocket wire limit', async () => {
  const key = await crypto.webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const dataUrl = `data:application/octet-stream;base64,${Buffer.alloc(10 * 1024 * 1024).toString('base64')}`;
  const ciphertext = await encryptMessage(key, dataUrl);
  const wire = CryptoAuth.createSignedMessage('send_private:bob:ENC', 'alice', rsa.privateKey, {
    encrypted: true, file: true, content: ciphertext, filename: 'maximum-size.bin', mimetype: 'application/octet-stream', sender_ecdh_public: ecdh.publicKey,
  });
  expect(Buffer.byteLength(wire)).toBeLessThan(CONFIG.SERVER.MAX_PAYLOAD_LENGTH);
});
