import test from 'node:test';
import assert from 'node:assert/strict';
import { hashSessionToken } from '../../src/auth/sessionToken.js';
import { createMemoryRepositories } from '../../src/persistence/memoryRepositories.js';
import {
  BUYER,
  MANDATE_BODY,
  PROPOSAL_BODY,
  SELLER,
  request,
  startTestServer,
  createAcceptedGuardian,
} from '../helpers/httpHarness.js';

const PASSWORD = BUYER.password;

async function context() {
  const repositories = createMemoryRepositories();
  const running = await startTestServer(repositories);
  return { repositories, ...running };
}

test('registration requires an allowlisted role and never returns a password hash', async () => {
  const { baseUrl, close } = await context();
  try {
    const invalidRole = await request(baseUrl, 'POST', '/api/auth/register', {
      body: { email: 'guardian@example.test', password: PASSWORD, role: 'guardian' },
    });
    assert.equal(invalidRole.status, 400);
    assert.equal(invalidRole.body.error.code, 'INVALID_ROLE');

    const weak = await request(baseUrl, 'POST', '/api/auth/register', {
      body: { email: 'weak@example.test', password: 'short', role: 'buyer' },
    });
    assert.equal(weak.status, 400);
    assert.equal(weak.body.error.code, 'INVALID_PASSWORD');

    const registered = await request(baseUrl, 'POST', '/api/auth/register', { body: BUYER });
    assert.equal(registered.status, 201);
    assert.equal(registered.body.user.role, 'buyer');
    assert.equal(registered.body.user.email, BUYER.email);
    assert.equal(registered.body.user.passwordHash, undefined);
    assert.equal(registered.headers.get('cache-control'), 'no-store');
    assert.ok(registered.body.token.length >= 40);

    const duplicate = await request(baseUrl, 'POST', '/api/auth/register', {
      body: { ...BUYER, email: BUYER.email.toUpperCase() },
    });
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.error.code, 'EMAIL_IN_USE');
  } finally {
    await close();
  }
});

test('login, session lookup, logout, and bad credentials behave safely', async () => {
  const { baseUrl, close } = await context();
  try {
    await request(baseUrl, 'POST', '/api/auth/register', { body: BUYER });

    const wrong = await request(baseUrl, 'POST', '/api/auth/login', {
      body: { email: BUYER.email, password: 'not-the-right-password' },
    });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.body.error.code, 'INVALID_CREDENTIALS');

    const unknown = await request(baseUrl, 'POST', '/api/auth/login', {
      body: { email: 'nobody@example.test', password: PASSWORD },
    });
    assert.equal(unknown.status, 401);
    assert.equal(unknown.body.error.code, 'INVALID_CREDENTIALS');

    const login = await request(baseUrl, 'POST', '/api/auth/login', {
      body: { email: BUYER.email, password: PASSWORD },
    });
    assert.equal(login.status, 200);
    assert.ok(login.body.token);

    const session = await request(baseUrl, 'GET', '/api/auth/session', { token: login.body.token });
    assert.equal(session.status, 200);
    assert.equal(session.body.user.userId, login.body.user.userId);
    assert.equal(session.body.user.role, 'buyer');

    assert.equal((await request(baseUrl, 'GET', '/api/auth/session')).status, 401);
    assert.equal((await request(baseUrl, 'GET', '/api/auth/session', { token: 'x'.repeat(43) })).status, 401);

    const logout = await request(baseUrl, 'POST', '/api/auth/logout', { token: login.body.token });
    assert.equal(logout.status, 204);

    const afterLogout = await request(baseUrl, 'GET', '/api/auth/session', { token: login.body.token });
    assert.equal(afterLogout.status, 401);
    assert.equal(afterLogout.body.error.code, 'SESSION_INVALID');
  } finally {
    await close();
  }
});

test('seller choices are buyer-only and expose only active other sellers public fields', async () => {
  const { repositories, baseUrl, close } = await context();
  try {
    const buyer = await request(baseUrl, 'POST', '/api/auth/register', { body: BUYER });
    const seller = await request(baseUrl, 'POST', '/api/auth/register', { body: SELLER });
    await repositories.users.insert({
      userId: 'user_suspended_seller', email: 'suspended@example.test', displayName: 'Suspended seller',
      role: 'seller', accountStatus: 'SUSPENDED', passwordHash: 'private-hash',
    });
    const choices = await request(baseUrl, 'GET', '/api/transactions/sellers', { token: buyer.body.token });
    assert.equal(choices.status, 200);
    assert.deepEqual(choices.body.sellers, [{ sellerId: seller.body.user.userId, displayName: seller.body.user.displayName }]);
    assert.equal(JSON.stringify(choices.body).includes('email'), false);
    assert.equal(JSON.stringify(choices.body).includes('passwordHash'), false);
    assert.equal(choices.headers.get('cache-control'), 'no-store');
    assert.equal((await request(baseUrl, 'GET', '/api/transactions/sellers')).status, 401);
    assert.equal((await request(baseUrl, 'GET', '/api/transactions/sellers', { token: seller.body.token })).status, 403);
  } finally {
    await close();
  }
});

test('middleware rejects expired sessions before MongoDB TTL cleanup occurs', async () => {
  const token = 'a'.repeat(43);
  const tokenHash = hashSessionToken(token);
  const base = createMemoryRepositories();
  const repositories = {
    ...base,
    sessions: {
      ...base.sessions,
      async findByTokenHash(candidate) {
        return candidate === tokenHash
          ? { tokenHash, userId: 'user-expired-session', role: 'buyer', expiresAt: '2000-01-01T00:00:00.000Z', revokedAt: null }
          : null;
      },
    },
    users: {
      ...base.users,
      async findByUserId(userId) {
        return { userId, email: 'expired@example.test', role: 'buyer', accountStatus: 'ACTIVE' };
      },
    },
  };
  const server = await startTestServer(repositories);
  try {
    const response = await request(server.baseUrl, 'GET', '/api/auth/session', { token });
    assert.equal(response.status, 401);
    assert.equal(response.body.error.code, 'SESSION_INVALID');
  } finally {
    await server.close();
  }
});

test('buyer and seller identities, roles, and transaction ownership are enforced by the server', async () => {
  const { baseUrl, close } = await context();
  try {
    const buyer = (await request(baseUrl, 'POST', '/api/auth/register', { body: BUYER })).body;
    const seller = (await request(baseUrl, 'POST', '/api/auth/register', { body: SELLER })).body;
    const otherBuyer = (
      await request(baseUrl, 'POST', '/api/auth/register', {
        body: { email: 'other-buyer@example.test', password: PASSWORD, role: 'buyer' },
      })
    ).body;
    const guardian = (await request(baseUrl, 'POST', '/api/auth/register', { body: { email: 'guardian@example.test', password: PASSWORD, role: 'seller' } })).body;
    const invitation = await request(baseUrl, 'POST', '/api/guardian-relationships', { token: buyer.token, body: { guardianEmail: guardian.user.email } });
    assert.equal(invitation.status, 201);
    const pendingMandate = await request(baseUrl, 'PUT', '/api/mandates/current', { token: buyer.token, body: { mandate: { ...MANDATE_BODY, guardianId: guardian.user.userId } } });
    assert.equal(pendingMandate.status, 409);
    assert.equal(pendingMandate.body.error.code, 'GUARDIAN_NOT_ELIGIBLE');
    await request(baseUrl, 'POST', `/api/guardian-relationships/${invitation.body.relationship.relationshipId}/accept`, { token: guardian.token });

    assert.equal((await request(baseUrl, 'POST', '/api/transactions', { body: { sellerId: seller.user.userId, proposal: PROPOSAL_BODY } })).status, 401);
    assert.equal((await request(baseUrl, 'PUT', '/api/mandates/current', { token: seller.token, body: { mandate: MANDATE_BODY } })).status, 403);
    assert.equal((await request(baseUrl, 'PUT', '/api/mandates/current', { token: buyer.token, body: { mandate: { ...MANDATE_BODY, maxAmountMinor: 0 } } })).status, 400);

    const saved = await request(baseUrl, 'PUT', '/api/mandates/current', { token: buyer.token, body: { mandate: { ...MANDATE_BODY, guardianId: guardian.user.userId } } });
    assert.equal(saved.status, 200);
    assert.match(saved.body.mandate.mandateId, /^mandate_/);
    assert.notEqual(saved.body.mandate.mandateId, MANDATE_BODY.mandateId);

    const current = await request(baseUrl, 'GET', '/api/mandates/current', { token: buyer.token });
    assert.equal(current.status, 200);
    assert.equal(current.body.mandate.maxAmountMinor, MANDATE_BODY.maxAmountMinor);
    assert.equal((await request(baseUrl, 'GET', '/api/mandates/current', { token: otherBuyer.token })).body.error.code, 'MANDATE_NOT_FOUND');
    const reusedGuardian = await request(baseUrl, 'PUT', '/api/mandates/current', { token: otherBuyer.token, body: { mandate: { ...MANDATE_BODY, guardianId: guardian.user.userId } } });
    assert.equal(reusedGuardian.status, 409);
    const update = await request(baseUrl, 'PUT', '/api/mandates/current', { token: buyer.token, body: { mandate: { ...MANDATE_BODY, guardianId: guardian.user.userId, maxAmountMinor: 1_600_000 } } });
    assert.equal(update.status, 200);
    assert.notEqual(update.body.mandate.mandateId, saved.body.mandate.mandateId);
    assert.equal((await request(baseUrl, 'GET', '/api/mandates/current', { token: buyer.token })).body.mandate.maxAmountMinor, 1_600_000);

    const sellerCannotCreate = await request(baseUrl, 'POST', '/api/transactions', {
      token: seller.token,
      body: { sellerId: seller.user.userId, proposal: PROPOSAL_BODY },
    });
    assert.equal(sellerCannotCreate.status, 403);

    const noMandate = await request(baseUrl, 'POST', '/api/transactions', {
      token: otherBuyer.token,
      body: { sellerId: seller.user.userId, proposal: PROPOSAL_BODY },
    });
    assert.equal(noMandate.status, 409);
    assert.equal(noMandate.body.error.code, 'MANDATE_REQUIRED');

    const unknownSeller = await request(baseUrl, 'POST', '/api/transactions', {
      token: buyer.token,
      body: { sellerId: 'user_does_not_exist', proposal: PROPOSAL_BODY },
    });
    assert.equal(unknownSeller.status, 400);
    assert.equal(unknownSeller.body.error.code, 'SELLER_NOT_FOUND');

    const created = await request(baseUrl, 'POST', '/api/transactions', {
      token: buyer.token,
      body: {
        buyerId: otherBuyer.user.userId,
        state: 'CAPTURED',
        provider: { orderId: 'forged-order', authorizationId: 'forged-auth', captureId: 'forged-capture' },
        sellerId: seller.user.userId,
        proposal: { ...PROPOSAL_BODY, proposalId: 'client-chosen', sellerName: 'Forged name' },
      },
    });
    assert.equal(created.status, 201);
    const transaction = created.body.transaction;
    assert.equal(transaction.state, 'PROPOSED');
    assert.equal(transaction.version, 0);
    assert.equal(transaction.buyerId, buyer.user.userId);
    assert.equal(transaction.state, 'PROPOSED');
    assert.deepEqual(transaction.provider, { orderId: null, authorizationId: null, captureId: null, voidId: null });
    assert.equal(transaction.sellerId, seller.user.userId);
    assert.equal(transaction.proposal.sellerId, seller.user.userId);
    assert.notEqual(transaction.proposal.proposalId, 'client-chosen');
    assert.equal(transaction.proposal.sellerName, SELLER.displayName);

    const sellerRead = await request(baseUrl, 'GET', `/api/transactions/${transaction.transactionId}`, { token: seller.token });
    assert.equal(sellerRead.status, 200);
    assert.equal(sellerRead.headers.get('cache-control'), 'no-store');

    const strangerRead = await request(baseUrl, 'GET', `/api/transactions/${transaction.transactionId}`, { token: otherBuyer.token });
    assert.equal(strangerRead.status, 404);
    assert.equal(strangerRead.body.error.code, 'TRANSACTION_NOT_FOUND');

    const sellerEvaluate = await request(baseUrl, 'POST', `/api/transactions/${transaction.transactionId}/evaluate`, { token: seller.token });
    assert.equal(sellerEvaluate.status, 403);

    const evaluated = await request(baseUrl, 'POST', `/api/transactions/${transaction.transactionId}/evaluate`, { token: buyer.token });
    assert.equal(evaluated.status, 200);
    assert.equal(evaluated.body.transaction.state, 'READY_FOR_PAYMENT');
    assert.equal(evaluated.body.transaction.version, 1);
    assert.deepEqual(evaluated.body.transaction.policyEvidence.reasonCodes, []);

    const repeat = await request(baseUrl, 'POST', `/api/transactions/${transaction.transactionId}/evaluate`, { token: buyer.token });
    assert.equal(repeat.status, 422);
    assert.equal(repeat.body.error.code, 'INVALID_TRANSITION');

    const audit = await request(baseUrl, 'GET', `/api/transactions/${transaction.transactionId}/audit`, { token: buyer.token });
    assert.equal(audit.status, 200);
    assert.equal(audit.body.auditLog.length, 1);
    assert.equal(audit.body.auditLog[0].eventType, 'POLICY_EVALUATED');
    assert.equal(audit.body.auditLog[0].actor.role, 'system');
    assert.equal(audit.body.projectedEventCount, 1);

    const handoffTooEarly = await request(baseUrl, 'POST', `/api/transactions/${transaction.transactionId}/handoff-confirmations`, { token: seller.token });
    assert.equal(handoffTooEarly.status, 422);

    const checkInTooEarly = await request(baseUrl, 'POST', `/api/transactions/${transaction.transactionId}/check-ins`, { token: buyer.token, body: {} });
    assert.equal(checkInTooEarly.status, 409);
    assert.equal(checkInTooEarly.body.error.code, 'CHECK_IN_NOT_APPLICABLE');

    const reference = await request(baseUrl, 'GET', `/api/transactions/${transaction.transactionId}/payment-reference`, { token: buyer.token });
    assert.equal(reference.status, 200);
    assert.equal(reference.body.reference.orderId, null);
    assert.equal(reference.body.reference.environment, 'sandbox');

    const list = await request(baseUrl, 'GET', '/api/transactions', { token: seller.token });
    assert.equal(list.status, 200);
    assert.equal(list.body.transactions.length, 1);
    assert.equal(list.body.transactions[0].transactionId, transaction.transactionId);
  } finally {
    await close();
  }
});

test('transactions survive an app restart against the same persistent store', async () => {
  const repositories = createMemoryRepositories();
  const first = await startTestServer(repositories);
  let transactionId;
  let buyerToken;
  try {
    const buyer = (await request(first.baseUrl, 'POST', '/api/auth/register', { body: BUYER })).body;
    const seller = (await request(first.baseUrl, 'POST', '/api/auth/register', { body: SELLER })).body;
    buyerToken = buyer.token;
    const guardian = await createAcceptedGuardian(first.baseUrl, buyer.token, 'guardian@restart.test');
    await request(first.baseUrl, 'PUT', '/api/mandates/current', { token: buyer.token, body: { mandate: { ...MANDATE_BODY, guardianId: guardian.user.userId } } });
    const created = await request(first.baseUrl, 'POST', '/api/transactions', {
      token: buyer.token,
      body: { sellerId: seller.user.userId, proposal: PROPOSAL_BODY },
    });
    transactionId = created.body.transaction.transactionId;
    await request(first.baseUrl, 'POST', `/api/transactions/${transactionId}/evaluate`, { token: buyer.token });
  } finally {
    await first.close();
  }

  const second = await startTestServer(repositories);
  try {
    const reloaded = await request(second.baseUrl, 'GET', `/api/transactions/${transactionId}`, { token: buyerToken });
    assert.equal(reloaded.status, 200);
    assert.equal(reloaded.body.transaction.state, 'READY_FOR_PAYMENT');
    assert.equal(reloaded.body.transaction.version, 1);
    assert.equal(reloaded.body.transaction.auditLog.length, 1);
  } finally {
    await second.close();
  }
});

test('registration and login enforce configured per-client limits below and above the threshold', async () => {
  const server = await startTestServer(createMemoryRepositories(), {
    authRegisterLimit: 2,
    authLoginLimit: 2,
    authRateWindowMs: 60_000,
  });
  try {
    const first = await request(server.baseUrl, 'POST', '/api/auth/register', { body: BUYER });
    assert.equal(first.status, 201);
    const second = await request(server.baseUrl, 'POST', '/api/auth/register', {
      body: { ...BUYER, email: 'another@example.test' },
    });
    assert.equal(second.status, 201);
    assert.equal(second.headers.get('ratelimit-limit'), '2');
    const overLimitRegister = await request(server.baseUrl, 'POST', '/api/auth/register', {
      body: { ...BUYER, email: 'third@example.test' },
      extraHeaders: { 'X-Forwarded-For': '198.51.100.88' },
    });
    assert.equal(overLimitRegister.status, 429);
    assert.equal(overLimitRegister.body.error.code, 'AUTH_RATE_LIMITED');
    assert.equal(overLimitRegister.headers.get('retry-after') !== null, true);

    const firstLogin = await request(server.baseUrl, 'POST', '/api/auth/login', {
      body: { email: BUYER.email, password: PASSWORD },
    });
    const secondLogin = await request(server.baseUrl, 'POST', '/api/auth/login', {
      body: { email: BUYER.email, password: PASSWORD },
    });
    assert.equal(firstLogin.status, 200);
    assert.equal(secondLogin.status, 200);
    assert.equal(secondLogin.headers.get('ratelimit-remaining'), '0');
    const overLimitLogin = await request(server.baseUrl, 'POST', '/api/auth/login', {
      body: { email: 'different@example.test', password: 'not-a-password' },
      extraHeaders: { 'X-Forwarded-For': '203.0.113.27' },
    });
    assert.equal(overLimitLogin.status, 429);
    assert.equal(overLimitLogin.body.error.code, 'AUTH_RATE_LIMITED');
    assert.equal(overLimitLogin.headers.get('retry-after') !== null, true);
  } finally {
    await server.close();
  }
});

test('database failures return a generic response without exposing internal details', async () => {
  const repositories = createMemoryRepositories();
  repositories.mandates.findCurrentForBuyer = async () => { throw new Error('private database connection details'); };
  const server = await startTestServer(repositories);
  try {
    const buyer = await request(server.baseUrl, 'POST', '/api/auth/register', { body: BUYER });
    const response = await request(server.baseUrl, 'POST', '/api/transactions', {
      token: buyer.body.token,
      body: { sellerId: 'not-loaded', proposal: PROPOSAL_BODY },
    });
    assert.equal(response.status, 500);
    assert.equal(response.body.error.code, 'INTERNAL_ERROR');
    assert.equal(JSON.stringify(response.body).includes('private database connection details'), false);
  } finally {
    await server.close();
  }
});
