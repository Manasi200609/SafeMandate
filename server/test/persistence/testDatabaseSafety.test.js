import test from 'node:test';
import assert from 'node:assert/strict';
import { isSafeLocalTestDatabaseUri } from '../helpers/testDatabaseSafety.js';

const runId = '0123456789abcdef0123456789abcdef';
const isolatedLocal = `mongodb://127.0.0.1:27017/safe_mandate_phase1_test_${runId}`;

test('isolated local test database URI is accepted only for the dedicated test name', () => {
  assert.equal(isSafeLocalTestDatabaseUri(isolatedLocal, 'mongodb://127.0.0.1:27017/safe_mandate'), true);
});

test('database safety guard rejects Atlas, remote hosts, application DB, and non-unique names', () => {
  assert.equal(isSafeLocalTestDatabaseUri(`mongodb+srv://cluster.example.mongodb.net/safe_mandate_phase1_test_${runId}`), false);
  assert.equal(isSafeLocalTestDatabaseUri(`mongodb://10.0.0.5:27017/safe_mandate_phase1_test_${runId}`), false);
  assert.equal(isSafeLocalTestDatabaseUri(isolatedLocal, `mongodb://127.0.0.1:27017/safe_mandate_phase1_test_${runId}`), false);
  assert.equal(isSafeLocalTestDatabaseUri('mongodb://127.0.0.1:27017/safe_mandate_phase1_test'), false);
  assert.equal(isSafeLocalTestDatabaseUri(''), false);
});
