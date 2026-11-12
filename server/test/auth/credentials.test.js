import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { hashPassword, validatePassword, verifyPassword } from '../../src/auth/password.js';
import { hashSessionToken, issueSessionToken, looksLikeSessionToken } from '../../src/auth/sessionToken.js';

test('passwords are hashed with scrypt and a unique salt and never stored in plaintext', async () => {
  const password = 'correct-horse-battery';
  const first = await hashPassword(password);
  const second = await hashPassword(password);

  assert.match(first, /^scrypt\$16384\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  assert.notEqual(first, second);
  assert.equal(first.includes(password), false);
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword(password, second), true);
});

test('password verification fails closed for wrong passwords and malformed hashes', async () => {
  const stored = await hashPassword('correct-horse-battery');
  assert.equal(await verifyPassword('correct-horse-batterY', stored), false);
  assert.equal(await verifyPassword('', stored), false);
  assert.equal(await verifyPassword('correct-horse-battery', 'plaintext'), false);
  assert.equal(await verifyPassword('correct-horse-battery', 'scrypt$x$8$1$AAAA$BBBB'), false);
  assert.equal(await verifyPassword('correct-horse-battery', null), false);
});

test('password policy requires a minimum length', () => {
  assert.equal(validatePassword('short').valid, false);
  assert.equal(validatePassword('        ').valid, false);
  assert.equal(validatePassword('correct-horse-battery').valid, true);
  assert.equal(validatePassword(undefined).valid, false);
});

test('session tokens are opaque and stored only as SHA-256 digests', () => {
  const first = issueSessionToken();
  const second = issueSessionToken();

  assert.notEqual(first.token, second.token);
  assert.equal(looksLikeSessionToken(first.token), true);
  assert.equal(looksLikeSessionToken('short'), false);
  assert.equal(first.tokenHash, hashSessionToken(first.token));
  assert.equal(first.tokenHash, createHash('sha256').update(first.token).digest('hex'));
  const legacyHmac = createHmac('sha256', 'legacy-session-key').update(first.token).digest('hex');
  assert.notEqual(first.tokenHash, legacyHmac);
  assert.match(first.tokenHash, /^[a-f0-9]{64}$/);
  assert.notEqual(first.tokenHash, first.token);
});
