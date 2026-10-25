import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPrivateKey, webcrypto } from 'node:crypto';
import { CryptoAuth, signedPayload } from '../backend-servers/server/utils/cryptography/auth.ts';
import { AuthenticationMiddleware } from '../backend-servers/server/utils/cryptography/auth-middleware.ts';
import { signedPayload as browserPayload, sendAuthenticatedMessage } from '../client/src/shared/utils.ts';

const keys = CryptoAuth.generateKeyPair();
const signed = (extra = {}) => JSON.parse(CryptoAuth.createSignedMessage('send_private', 'alice', keys.privateKey, {
  to_client: 'bob', content: 'ciphertext', encrypted: true, ...extra,
}));

test('a complete signed message verifies once, then rejects replay', () => {
  const message = signed();
  assert.equal(CryptoAuth.verifyMessage(message, 'alice', keys.publicKey).valid, true);
  assert.equal(CryptoAuth.verifyMessage(message, 'alice', keys.publicKey).error, 'Nonce already used (replay attack)');
});

for (const [field, value] of Object.entries({ to_client: 'mallory', content: 'modified', encrypted: false })) {
  test(`tampering with ${field} invalidates the signature without consuming its nonce`, () => {
    const message = signed();
    assert.equal(CryptoAuth.verifyMessage({ ...message, [field]: value }, 'alice', keys.publicKey).valid, false);
    assert.equal(CryptoAuth.verifyMessage(message, 'alice', keys.publicKey).valid, true);
  });
}

test('object property order is irrelevant but nested fields and array order are signed', () => {
  const message = signed({ nested: { z: 1, a: [{ second: 2, first: 1 }, 3] } });
  const reordered = { ...message, nested: { a: [{ first: 1, second: 2 }, 3], z: 1 } };
  assert.equal(browserPayload(reordered), signedPayload(message));
  assert.equal(CryptoAuth.verifyMessage(reordered, 'alice', keys.publicKey).valid, true);
  const altered = signed({ nested: { values: [1, 2] } });
  altered.nested.values.reverse();
  assert.equal(CryptoAuth.verifyMessage(altered, 'alice', keys.publicKey).valid, false);
});

test('reserved authentication fields cannot be overridden by extra data', () => {
  const message = signed({ command: 'delete', client_id: 'mallory', nonce: 'spoofed', timestamp: 0, signature: 'spoofed' });
  assert.equal(message.command, 'send_private');
  assert.equal(message.client_id, 'alice');
  assert.equal(CryptoAuth.verifyMessage(message, 'alice', keys.publicKey).valid, true);
});

test('invalid input, malformed keys, invalid timestamps and expired requests fail closed', () => {
  for (const message of [null, [], {}, signed()]) {
    assert.equal(CryptoAuth.verifyMessage(message, 'alice', 'not-a-public-key').valid, false);
  }
  for (const timestamp of [NaN, Infinity, '123', Date.now() - 60000]) {
    assert.equal(CryptoAuth.validateNonce(CryptoAuth.generateNonce(), timestamp).valid, false);
  }
  assert.equal(CryptoAuth.validateNonce('short', Date.now()).valid, false);
  assert.equal(CryptoAuth.verifyMessage(signed(), 'mallory', keys.publicKey).valid, false);
});

test('middleware binds the authenticated identity to the WebSocket session', async () => {
  const result = await AuthenticationMiddleware.authenticate(signed(), 'mallory', async () => keys.publicKey);
  assert.equal(result.success, false);
});

test('browser signing is compatible with the backend canonical format', async () => {
  const previousStorage = globalThis.localStorage;
  const pkcs8 = createPrivateKey(keys.privateKey).export({ format: 'der', type: 'pkcs8' }).toString('base64');
  globalThis.localStorage = { getItem: name => name === 'private_key' ? pkcs8 : null };
  try {
    let message;
    await sendAuthenticatedMessage(value => { message = value; }, {
      command: 'send_private', client_id: 'alice', to_client: 'bob', content: 'encrypted',
      metadata: { filename: 'hello.txt', flags: ['one', 'two'] },
      nonce: 'injected', timestamp: 0, signature: 'injected',
    });
    assert.equal(CryptoAuth.verifyMessage(message, 'alice', keys.publicKey).valid, true);
  } finally {
    globalThis.localStorage = previousStorage;
  }
});
