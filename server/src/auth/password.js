import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
const PREFIX = 'scrypt';
const PARAMS = Object.freeze({ N: 16384, r: 8, p: 1 });
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const MAXMEM = 64 * 1024 * 1024;
const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 200;

/** Hashes a password with scrypt and a per-user random salt. The result is self-describing. */
export async function hashPassword(password) {
  if (typeof password !== 'string') throw new TypeError('Password must be a string.');
  const salt = randomBytes(SALT_LENGTH);
  const key = await derive(password, salt, KEY_LENGTH, { ...PARAMS, maxmem: MAXMEM });
  return [PREFIX, PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), key.toString('base64')].join('$');
}

/** Constant-time password verification; malformed stored hashes fail closed. */
export async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== PREFIX) return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (![N, r, p].every((value) => Number.isInteger(value) && value > 0)) return false;
  const salt = Buffer.from(parts[4], 'base64');
  const expected = Buffer.from(parts[5], 'base64');
  if (salt.length !== SALT_LENGTH || expected.length !== KEY_LENGTH) return false;
  let derived;
  try {
    derived = await derive(password, salt, expected.length, { N, r, p, maxmem: MAXMEM });
  } catch {
    return false;
  }
  return timingSafeEqual(derived, expected);
}

export function validatePassword(password) {
  const errors = [];
  if (typeof password !== 'string') errors.push('password must be a string.');
  else {
    if (password.length < MIN_PASSWORD_LENGTH) errors.push(`password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    if (password.length > MAX_PASSWORD_LENGTH) errors.push(`password must be at most ${MAX_PASSWORD_LENGTH} characters.`);
    if (!/\S/.test(password)) errors.push('password must contain a non-whitespace character.');
  }
  return { valid: errors.length === 0, errors };
}
