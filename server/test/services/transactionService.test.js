import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createMemoryRepositories } from '../../src/persistence/memoryRepositories.js';
import { createAuthService } from '../../src/services/authService.js';
import { createMandateService } from '../../src/services/mandateService.js';
import { createTransactionService } from '../../src/services/transactionService.js';
import { hydrateTransaction, serializeTransaction, transitionTransaction } from '../../src/domain/transactions/transitionTransaction.js';
import { MANDATE_BODY, PROPOSAL_BODY } from '../helpers/httpHarness.js';

const now = () => new Date().toISOString();

async function seed() {
  const repositories = createMemoryRepositories();
  const authService = createAuthService(repositories);
  const mandateService = createMandateService(repositories);
  const transactionService = createTransactionService(repositories);

  const buyer = (await authService.register({ email: 'buyer@service.test', password: 'correct-horse-battery', role: 'buyer' })).user;
  const seller = (await authService.register({ email: 'seller@service.test', password: 'correct-horse-battery', role: 'seller' })).user;
  const stranger = (await authService.register({ email: 'stranger@service.test', password: 'correct-horse-battery', role: 'buyer' })).user;

  await mandateService.saveMandate({ principal: buyer, body: MANDATE_BODY });
  const transaction = await transactionService.createTransaction({
    principal: buyer,
    body: { sellerId: seller.userId, proposal: PROPOSAL_BODY },
  });

  return { repositories, transactionService, buyer, seller, stranger, transaction };
}

async function driveDomain(repositories, transactionId, steps) {
  let record = await repositories.transactions.findById(transactionId);
  let aggregate = hydrateTransaction(record);
  for (const step of steps) {
    const next = transitionTransaction(
      aggregate,
      { eventId: `evt_${randomUUID()}`, expectedVersion: record.version, type: step.type, actor: step.actor, ...(step.extra ?? {}) },
      { now: now() },
    );
    const serialized = serializeTransaction(next);
    const updated = await repositories.transactions.updateWithVersion({
      transactionId,
      expectedVersion: record.version,
      record: serialized,
    });
    assert.equal(updated, true);
    record = serialized;
    aggregate = next;
  }
  return record;
}

async function toActiveMeetup({ repositories, transaction }) {
  return driveDomain(repositories, transaction.transactionId, [
    { type: 'POLICY_EVALUATED', actor: { id: 'system-policy', role: 'system' } },
    { type: 'PAYMENT_ORDER_CREATED', actor: { id: 'system-payment', role: 'system' }, extra: { orderId: 'order-test-1' } },
    { type: 'PAYMENT_AUTHORIZED', actor: { id: 'paypal-adapter', role: 'paypal' }, extra: { orderId: 'order-test-1', authorizationId: 'auth-test-1' } },
    { type: 'MEETUP_STARTED', actor: { id: 'system-meetup', role: 'system' }, extra: { reason: 'Meetup started.' } },
  ]);
}

test('handoff confirmations use the authenticated identity and ignore client-chosen parties', async () => {
  const { repositories, transactionService, buyer, seller, transaction } = await seed();
  await toActiveMeetup({ repositories, transaction, seller });

  const sellerConfirmed = await transactionService.confirmHandoff({
    principal: seller,
    transactionId: transaction.transactionId,
    body: { party: 'buyer', confirmationId: 'client-supplied' },
  });
  assert.equal(sellerConfirmed.handoffConfirmations.sellerConfirmed, true);
  assert.equal(sellerConfirmed.handoffConfirmations.sellerActorId, seller.userId);
  assert.equal(sellerConfirmed.handoffConfirmations.buyerConfirmed, false);

  const buyerConfirmed = await transactionService.confirmHandoff({
    principal: buyer,
    transactionId: transaction.transactionId,
    body: { party: 'seller' },
  });
  assert.equal(buyerConfirmed.handoffConfirmations.buyerConfirmed, true);
  assert.equal(buyerConfirmed.handoffConfirmations.buyerActorId, buyer.userId);
  assert.notEqual(buyerConfirmed.handoffConfirmations.buyerActorId, buyerConfirmed.handoffConfirmations.sellerActorId);

  assert.equal(buyerConfirmed.version, 6);
  assert.equal(buyerConfirmed.auditLog.at(-1).eventType, 'HANDOFF_CONFIRMED');

  await assert.rejects(
    transactionService.confirmHandoff({ principal: buyer, transactionId: transaction.transactionId }),
    (error) => error.status === 409 && error.code === 'DUPLICATE_HANDOFF',
  );
});

test('a non-participant cannot read or confirm another participant transaction', async () => {
  const { repositories, transactionService, buyer, stranger, transaction } = await seed();
  await toActiveMeetup({ repositories, transaction });

  await assert.rejects(
    transactionService.getTransaction({ principal: stranger, transactionId: transaction.transactionId }),
    (error) => error.status === 404 && error.code === 'TRANSACTION_NOT_FOUND',
  );
  await assert.rejects(
    transactionService.confirmHandoff({ principal: stranger, transactionId: transaction.transactionId }),
    (error) => error.status === 404 && error.code === 'TRANSACTION_NOT_FOUND',
  );
  await assert.rejects(
    transactionService.recordCheckIn({ principal: stranger, transactionId: transaction.transactionId }),
    (error) => error.status === 403 && error.code === 'ROLE_NOT_PERMITTED',
  );
  await assert.rejects(
    transactionService.evaluateTransaction({ principal: buyer, transactionId: transaction.transactionId }),
    (error) => error.status === 422,
  );
});

test('buyer check-ins are persisted only for the buyer during an authorized meetup', async () => {
  const { repositories, transactionService, buyer, seller, transaction } = await seed();

  await assert.rejects(
    transactionService.recordCheckIn({ principal: buyer, transactionId: transaction.transactionId }),
    (error) => error.status === 409 && error.code === 'CHECK_IN_NOT_APPLICABLE',
  );

  await toActiveMeetup({ repositories, transaction });
  const checkIn = await transactionService.recordCheckIn({
    principal: buyer,
    transactionId: transaction.transactionId,
    body: { note: 'Arrived at the cafe.' },
  });
  assert.equal(checkIn.transactionId, transaction.transactionId);
  assert.equal(checkIn.buyerId, buyer.userId);
  assert.equal(checkIn.stateAtCheckIn, 'MEETUP_ACTIVE');

  const stored = await repositories.checkIns.listByTransaction(transaction.transactionId);
  assert.equal(stored.length, 1);

  await assert.rejects(
    transactionService.recordCheckIn({ principal: seller, transactionId: transaction.transactionId }),
    (error) => error.status === 403,
  );
});

test('evaluation is buyer-only, deterministic, and recorded once', async () => {
  const { repositories, transactionService, buyer, seller, transaction } = await seed();

  await assert.rejects(
    transactionService.evaluateTransaction({ principal: seller, transactionId: transaction.transactionId }),
    (error) => error.status === 403,
  );

  const evaluated = await transactionService.evaluateTransaction({ principal: buyer, transactionId: transaction.transactionId });
  assert.equal(evaluated.state, 'READY_FOR_PAYMENT');
  assert.equal(Object.hasOwn(evaluated.proposal, 'aiRiskScore'), false);
  assert.equal(Object.hasOwn(evaluated.proposal, 'riskSignals'), false);
  assert.equal(Object.hasOwn(evaluated.proposal, 'supportingEvidence'), false);
  assert.equal(evaluated.policyEvidence.decision, 'READY_FOR_PAYMENT');
  assert.equal(evaluated.version, 1);

  const audit = await repositories.auditEvents.listByTransaction(transaction.transactionId);
  assert.equal(audit.length, 1);
  assert.equal(audit[0].eventType, 'POLICY_EVALUATED');

  await assert.rejects(
    transactionService.evaluateTransaction({ principal: buyer, transactionId: transaction.transactionId }),
    (error) => error.status === 422,
  );

  const stored = await repositories.transactions.findById(transaction.transactionId);
  assert.equal(stored.version, 1);
  assert.equal(stored.auditLog.length, 1);
});
