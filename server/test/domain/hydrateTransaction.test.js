import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTransaction,
  hydrateTransaction,
  serializeTransaction,
  transitionTransaction,
} from '../../src/domain/transactions/transitionTransaction.js';
import { proposalFingerprint } from '../../src/domain/mandate/evaluateProposal.js';

const now = '2026-11-09T10:00:00Z';
const mandate = {
  mandateId: 'mandate-hydrate', maxAmountMinor: 1_500_000, currency: 'INR', allowedCategories: ['electronics'],
  meetupRules: { requirePublicPlace: true, daytimeStart: '09:00', daytimeEnd: '18:00', timeZone: 'Asia/Kolkata' },
  expiresAt: '2099-12-31T23:59:59Z', guardianId: 'guardian-1', riskThreshold: 40,
};
const proposal = {
  proposalId: 'proposal-hydrate', itemName: 'Phone', description: 'Used phone', category: 'electronics',
  amountMinor: 1_000_000, currency: 'INR', sellerName: 'Seller', sellerId: 'seller-1', meetupLocation: 'Cafe',
  locationIsPublic: true, proposedLocalMeetupTime: '12:30', timeZone: 'Asia/Kolkata', aiRiskScore: 10,
  riskSignals: [], supportingEvidence: [], createdAt: now,
};
const agent = { id: 'agent-1', role: 'agent' };
const system = { id: 'system-1', role: 'system' };

function persistedRecord(overrides = {}) {
  return {
    transactionId: 'tx-persisted-1', mandateId: mandate.mandateId, mandate, proposal,
    proposalVersion: 1, proposalFingerprint: proposalFingerprint(proposal),
    buyerId: 'buyer-1', sellerId: 'seller-1', version: 0, state: 'PROPOSED',
    createdAt: now, updatedAt: now, policyEvidence: null, guardianApproval: null,
    handoffConfirmations: { buyerConfirmed: false, sellerConfirmed: false, buyerActorId: null, sellerActorId: null },
    provider: { orderId: null, authorizationId: null, captureId: null, voidId: null },
    auditLog: [], eventDigests: [],
    ...overrides,
  };
}

test('a persisted transaction record hydrates into an immutable, transitionable aggregate', () => {
  const restored = hydrateTransaction(persistedRecord());

  assert.equal(restored.transactionId, 'tx-persisted-1');
  assert.equal(restored.state, 'PROPOSED');
  assert.equal(restored.version, 0);
  assert.equal(Object.isFrozen(restored), true);
  assert.throws(() => { restored.state = 'READY_FOR_PAYMENT'; }, TypeError);

  const evaluated = transitionTransaction(
    restored,
    { eventId: 'evt-hydrate-1', expectedVersion: 0, type: 'POLICY_EVALUATED', actor: agent },
    { now },
  );
  assert.equal(evaluated.state, 'READY_FOR_PAYMENT');
  assert.equal(evaluated.version, 1);
  assert.equal(evaluated.auditLog.length, 1);
});

test('serialize then hydrate returns the same current snapshot and is idempotent per version', () => {
  const created = createTransaction({ transactionId: 'tx-round-trip', mandate, proposal, buyerId: 'buyer-1', createdAt: now });
  const evaluated = transitionTransaction(created, { eventId: 'evt-round-trip', expectedVersion: 0, type: 'POLICY_EVALUATED', actor: agent }, { now });
  const record = serializeTransaction(evaluated);

  const hydrated = hydrateTransaction(JSON.parse(JSON.stringify(record)));
  assert.equal(hydrated, evaluated);
  assert.equal(hydrated.auditLog[0].eventType, 'POLICY_EVALUATED');
  assert.equal(hydrated.state, 'READY_FOR_PAYMENT');
});

test('a stored proposal that no longer matches its fingerprint is rejected', () => {
  const created = createTransaction({ transactionId: 'tx-tampered-proposal', mandate, proposal, buyerId: 'buyer-1', createdAt: now });
  const record = serializeTransaction(created);

  assert.throws(
    () => hydrateTransaction({ ...record, proposal: { ...record.proposal, amountMinor: 1 } }),
    (error) => error.code === 'INVALID_PERSISTED_TRANSACTION',
  );
});

test('a stored audit chain with a gap, wrong reason, or state mismatch is rejected', () => {
  const created = createTransaction({ transactionId: 'tx-tampered-audit', mandate, proposal, buyerId: 'buyer-1', createdAt: now });
  const evaluated = transitionTransaction(created, { eventId: 'evt-audit-1', expectedVersion: 0, type: 'POLICY_EVALUATED', actor: agent }, { now });
  const record = serializeTransaction(evaluated);

  assert.throws(() => hydrateTransaction({ ...record, state: 'PAYMENT_PENDING' }), (error) => error.code === 'INVALID_PERSISTED_TRANSACTION');
  assert.throws(() => hydrateTransaction({ ...record, version: 2 }), (error) => error.code === 'INVALID_PERSISTED_TRANSACTION');
  assert.throws(
    () => hydrateTransaction({ ...record, auditLog: [{ ...record.auditLog[0], previousState: 'AUTHORIZED' }] }),
    (error) => error.code === 'INVALID_PERSISTED_TRANSACTION',
  );
  assert.throws(
    () => hydrateTransaction({ ...record, auditLog: [{ ...record.auditLog[0], reason: '' }] }),
    (error) => error.code === 'INVALID_PERSISTED_TRANSACTION',
  );
  assert.throws(() => hydrateTransaction({ ...record, eventDigests: [] }), (error) => error.code === 'INVALID_PERSISTED_TRANSACTION');
});

test('persisted audit history cannot skip a disallowed state transition', () => {
  const record = persistedRecord();
  const forgedEvent = {
    eventId: 'evt-forged', transactionId: record.transactionId, previousState: 'PROPOSED', newState: 'CAPTURED',
    eventType: 'PAYPAL_CAPTURE_CONFIRMED', actor: system, timestamp: now, reason: 'Forged.', metadata: {},
  };
  assert.throws(
    () => hydrateTransaction({
      ...record,
      version: 1,
      state: 'CAPTURED',
      auditLog: [forgedEvent],
      eventDigests: [{ eventId: 'evt-forged', digest: 'forged-digest' }],
      updatedAt: now,
    }),
    (error) => error.code === 'INVALID_PERSISTED_TRANSACTION',
  );
});
