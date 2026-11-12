import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryRepositories } from '../../src/persistence/memoryRepositories.js';
import { createAuthService } from '../../src/services/authService.js';
import { createGuardianService } from '../../src/services/guardianService.js';
import { createMandateService } from '../../src/services/mandateService.js';
import { createTransactionService } from '../../src/services/transactionService.js';
import { MANDATE_BODY, PROPOSAL_BODY } from '../helpers/httpHarness.js';
import { startTestServer, request } from '../helpers/httpHarness.js';

const PASSWORD = 'correct-horse-battery';

test('guardian role cannot be self-selected; relationship requires invited account acceptance', async () => {
  const repositories = createMemoryRepositories();
  const auth = createAuthService(repositories);
  await assert.rejects(auth.register({ email: 'self@guardian.test', password: PASSWORD, role: 'guardian' }), (error) => error.code === 'INVALID_ROLE');
  const buyerResult = await auth.register({ email: 'buyer@guardian.test', password: PASSWORD, role: 'buyer' });
  const invitee = await auth.register({ email: 'invitee@guardian.test', password: PASSWORD, role: 'seller' });
  const guardians = createGuardianService(repositories);
  const invitation = await guardians.invite({ principal: buyerResult.user, body: { guardianEmail: invitee.user.email } });

  await assert.rejects(guardians.accept({ principal: buyerResult.user, relationshipId: invitation.relationshipId }), (error) => error.status === 404);
  const accepted = await guardians.accept({ principal: invitee.user, relationshipId: invitation.relationshipId });
  assert.equal(accepted.status, 'ACCEPTED');
  assert.equal((await repositories.users.findByUserId(invitee.user.userId)).role, 'guardian');
  assert.equal(await repositories.guardianRelationships.findAccepted(buyerResult.user.userId, invitee.user.userId) !== null, true);
  const repeatAcceptance = await guardians.accept({ principal: invitee.user, relationshipId: invitation.relationshipId });
  assert.equal(repeatAcceptance.status, 'ACCEPTED');
});

test('only accepted designated guardian may approve the current eligible transaction version', async () => {
  const repositories = createMemoryRepositories();
  const auth = createAuthService(repositories);
  const buyer = (await auth.register({ email: 'buyer@decision.test', password: PASSWORD, role: 'buyer' })).user;
  const seller = (await auth.register({ email: 'seller@decision.test', password: PASSWORD, role: 'seller' })).user;
  const designated = (await auth.register({ email: 'guardian@decision.test', password: PASSWORD, role: 'seller' })).user;
  const intruder = (await auth.register({ email: 'intruder@decision.test', password: PASSWORD, role: 'seller' })).user;
  const guardianService = createGuardianService(repositories);
  const invitation = await guardianService.invite({ principal: buyer, body: { guardianEmail: designated.email } });
  await guardianService.accept({ principal: designated, relationshipId: invitation.relationshipId });
  const guardian = { ...designated, role: 'guardian' };

  const mandateService = createMandateService(repositories);
  await mandateService.saveMandate({ principal: buyer, body: { ...MANDATE_BODY, guardianId: guardian.userId } });
  const transactionService = createTransactionService(repositories, { assertGuardianAccepted: guardianService.assertAccepted });
  const transaction = await transactionService.createTransaction({
    principal: buyer,
    body: { sellerId: seller.userId, proposal: { ...PROPOSAL_BODY, amountMinor: 2_200_000 } },
  });
  const needsApproval = await transactionService.evaluateTransaction({ principal: buyer, transactionId: transaction.transactionId });
  assert.equal(needsApproval.state, 'NEEDS_GUARDIAN');

  await assert.rejects(transactionService.guardianDecision({ principal: { ...intruder, role: 'guardian' }, transactionId: transaction.transactionId, body: { expectedVersion: 1, decision: 'approve', reason: 'Approve.' } }), (error) => error.code === 'GUARDIAN_NOT_ACCEPTED');
  await assert.rejects(transactionService.guardianDecision({ principal: guardian, transactionId: transaction.transactionId, body: { expectedVersion: 0, decision: 'approve', reason: 'Approve.' } }), (error) => error.code === 'STALE_TRANSACTION');

  const approved = await transactionService.guardianDecision({
    principal: guardian,
    transactionId: transaction.transactionId,
    body: { expectedVersion: 1, decision: 'approve', reason: 'Reviewed exception.' },
  });
  assert.equal(approved.state, 'GUARDIAN_APPROVED');
  assert.equal(approved.guardianApproval.guardianId, guardian.userId);
  assert.equal(approved.version, 2);
  assert.equal(approved.auditLog.at(-1).eventType, 'GUARDIAN_DECISION');
  assert.equal((await repositories.auditEvents.listByTransaction(transaction.transactionId)).length, 2);
  await assert.rejects(transactionService.guardianDecision({ principal: guardian, transactionId: transaction.transactionId, body: { expectedVersion: 2, decision: 'approve', reason: 'Again.' } }));
});

test('HTTP guardian invitation acceptance and approval use authenticated bearer identity', async () => {
  const repositories = createMemoryRepositories();
  const server = await startTestServer(repositories);
  try {
    const buyer = await authRegister(server.baseUrl, 'buyer@http-guardian.test', 'buyer');
    const seller = await authRegister(server.baseUrl, 'seller@http-guardian.test', 'seller');
    const guardianAccount = await authRegister(server.baseUrl, 'guardian@http-guardian.test', 'seller');
    const invited = await request(server.baseUrl, 'POST', '/api/guardian-relationships', {
      token: buyer.token, body: { guardianEmail: guardianAccount.user.email },
    });
    assert.equal(invited.status, 201);
    const relationshipId = invited.body.relationship.relationshipId;
    const accepted = await request(server.baseUrl, 'POST', `/api/guardian-relationships/${relationshipId}/accept`, { token: guardianAccount.token });
    assert.equal(accepted.status, 200);
    const mandate = await request(server.baseUrl, 'PUT', '/api/mandates/current', {
      token: buyer.token, body: { ...MANDATE_BODY, guardianId: guardianAccount.user.userId },
    });
    assert.equal(mandate.status, 200);
    const created = await request(server.baseUrl, 'POST', '/api/transactions', {
      token: buyer.token,
      body: { sellerId: seller.user.userId, proposal: { ...PROPOSAL_BODY, amountMinor: 2_200_000 } },
    });
    assert.equal(created.status, 201);
    const evaluated = await request(server.baseUrl, 'POST', `/api/transactions/${created.body.transaction.transactionId}/evaluate`, { token: buyer.token });
    assert.equal(evaluated.body.transaction.state, 'NEEDS_GUARDIAN');
    const approval = await request(server.baseUrl, 'POST', `/api/transactions/${created.body.transaction.transactionId}/guardian-approval`, {
      token: guardianAccount.token,
      body: { expectedVersion: evaluated.body.transaction.version, decision: 'approve', reason: 'Reviewed the exception.' },
    });
    assert.equal(approval.status, 200);
    assert.equal(approval.body.transaction.state, 'GUARDIAN_APPROVED');
    const buyerCannotApprove = await request(server.baseUrl, 'POST', `/api/transactions/${created.body.transaction.transactionId}/guardian-approval`, {
      token: buyer.token,
      body: { expectedVersion: 2, decision: 'approve', reason: 'Attempt.' },
    });
    assert.equal(buyerCannotApprove.status, 403);
  } finally {
    await server.close();
  }
});

async function authRegister(serverUrl, email, role) {
  const response = await request(serverUrl, 'POST', '/api/auth/register', {
    body: { email, password: PASSWORD, role },
  });
  assert.equal(response.status, 201);
  return response.body;
}
