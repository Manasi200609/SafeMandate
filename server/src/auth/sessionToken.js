import { createHash, randomBytes } from 'node:crypto';

const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Issues an opaque random 256-bit token. Only its SHA-256 digest is persisted. */
export function issueSessionToken() {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  return { token, tokenHash: hashSessionToken(token) };
}

export function hashSessionToken(token) {
  return createHash('sha256').update(String(token), 'utf8').digest('hex');
}

export function looksLikeSessionToken(token) {
  return typeof token === 'string' && TOKEN_PATTERN.test(token);
}
