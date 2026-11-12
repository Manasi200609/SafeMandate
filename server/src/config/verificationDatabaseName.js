import { randomBytes } from 'node:crypto';

export function createVerificationDatabaseName() {
  return `smv_${randomBytes(16).toString('hex')}`;
}

export function isValidVerificationDatabaseName(name) {
  return typeof name === 'string'
    && /^smv_[a-f0-9]{32}$/.test(name)
    && Buffer.byteLength(name, 'utf8') <= 38;
}
