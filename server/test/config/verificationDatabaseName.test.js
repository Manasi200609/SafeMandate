import test from 'node:test';
import assert from 'node:assert/strict';
import { createVerificationDatabaseName, isValidVerificationDatabaseName } from '../../src/config/verificationDatabaseName.js';

test('Atlas verification database name is a 36-byte smv_ name with 128 random bits', () => {
  const name = createVerificationDatabaseName();
  assert.match(name, /^smv_[a-f0-9]{32}$/);
  assert.equal(Buffer.byteLength(name, 'utf8'), 36);
  assert.ok(Buffer.byteLength(name, 'utf8') <= 38);
  assert.equal(isValidVerificationDatabaseName(name), true);
  assert.equal(isValidVerificationDatabaseName(`smv_${'g'.repeat(32)}`), false);
  assert.equal(isValidVerificationDatabaseName(`smv_${'a'.repeat(34)}`), false);
});
