import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword } from '../../src/auth/password.js';
import { createMemoryRepositories } from '../../src/persistence/memoryRepositories.js';
import { createAuthService } from '../../src/services/authService.js';

test('registration never accepts a caller-selected account status', async () => {
  const repositories = createMemoryRepositories();
  const auth = createAuthService(repositories);
  await auth.register({
    email: 'status@example.test',
    password: 'correct-horse-battery',
    role: 'buyer',
    accountStatus: 'SUSPENDED',
  });
  assert.equal((await repositories.users.findByEmail('status@example.test')).accountStatus, 'ACTIVE');
});

test('suspended accounts cannot create new sessions', async () => {
  const repositories = createMemoryRepositories();
  await repositories.users.insert({
    userId: 'user-suspended',
    email: 'suspended@example.test',
    displayName: 'Suspended account',
    role: 'buyer',
    accountStatus: 'SUSPENDED',
    passwordHash: await hashPassword('correct-horse-battery'),
  });
  const auth = createAuthService(repositories);
  await assert.rejects(
    auth.login({ email: 'suspended@example.test', password: 'correct-horse-battery' }),
    (error) => error.status === 401 && error.code === 'INVALID_CREDENTIALS',
  );
});
