import test from 'node:test';
import assert from 'node:assert/strict';
import { createTransaction, evaluateTransaction, getSellerChoices, getTransactions } from '../src/services/api.js';
import { acquireSubmissionLock, canStartPayPalCheckout, isValidLocalDate, parseMajorAmount } from '../src/services/transactionDraft.js';

test('major currency amounts convert to minor units without floating-point rounding', () => {
  assert.equal(parseMajorAmount('124.50', 'INR'), 12450);
  assert.equal(parseMajorAmount('12.4', 'INR'), 1240);
  assert.equal(parseMajorAmount('12', 'JPY'), 12);
  assert.equal(parseMajorAmount('1.234', 'KWD'), 1234);
  assert.equal(parseMajorAmount('1.234', 'INR'), null);
  assert.equal(parseMajorAmount('0', 'INR'), null);
  assert.equal(parseMajorAmount('90071992547409.92', 'INR'), null);
});

test('local meetup date rejects malformed and impossible dates', () => {
  assert.equal(isValidLocalDate('2026-11-12'), true);
  assert.equal(isValidLocalDate('2026-02-30'), false);
  assert.equal(isValidLocalDate('12-11-2026'), false);
});

test('checkout is available only in backend payment states and remains blocked for guardian review', () => {
  assert.equal(canStartPayPalCheckout('READY_FOR_PAYMENT'), true);
  assert.equal(canStartPayPalCheckout('PAYMENT_PENDING'), true);
  for (const state of ['PROPOSED', 'NEEDS_GUARDIAN', 'GUARDIAN_APPROVED', 'AUTHORIZED', 'BLOCKED']) {
    assert.equal(canStartPayPalCheckout(state), false, `${state} must not start checkout`);
  }
});

test('duplicate submit events cannot acquire the in-flight creation lock', () => {
  const lock = { current: false };
  assert.equal(acquireSubmissionLock(lock), true);
  assert.equal(acquireSubmissionLock(lock), false);
  lock.current = false;
  assert.equal(acquireSubmissionLock(lock), true);
});

test('seller discovery, transaction creation and policy evaluation use the authenticated existing contracts', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    const payload = requests.length === 1 ? { sellers: [{ sellerId: 'seller-1', displayName: 'Seller One' }] }
      : requests.length === 2 ? { transaction: { transactionId: 'tx-1', state: 'PROPOSED' } }
        : requests.length === 3 ? { transaction: { transactionId: 'tx-1', state: 'READY_FOR_PAYMENT', policyEvidence: { decision: 'READY_FOR_PAYMENT' } } }
          : { transactions: [{ transactionId: 'tx-1', state: 'READY_FOR_PAYMENT', itemName: 'Headphones' }] };
    return new Response(JSON.stringify(payload), { status: requests.length === 2 ? 201 : 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    assert.deepEqual(await getSellerChoices('buyer-token'), [{ sellerId: 'seller-1', displayName: 'Seller One' }]);
    const proposal = {
      itemName: 'Headphones', description: 'Listing description', category: 'electronics', amountMinor: 1240000,
      currency: 'INR', meetupLocation: 'Public cafe', locationIsPublic: true,
      proposedMeetupDate: '2026-11-15', proposedLocalMeetupTime: '12:30', timeZone: 'Asia/Kolkata',
    };
    const created = await createTransaction('buyer-token', 'seller-1', proposal);
    assert.equal(created.transaction.state, 'PROPOSED');
    const evaluated = await evaluateTransaction('tx-1', 'buyer-token');
    assert.equal(evaluated.transaction.policyEvidence.decision, 'READY_FOR_PAYMENT');
    const refreshed = await getTransactions('buyer-token');
    assert.equal(refreshed[0].transactionId, 'tx-1');
    assert.equal(refreshed[0].state, 'READY_FOR_PAYMENT');
    assert.equal(requests[0].url, '/api/transactions/sellers');
    assert.equal(requests[1].url, '/api/transactions');
    assert.equal(requests[1].options.method, 'POST');
    assert.equal(requests[1].options.headers.Authorization, 'Bearer buyer-token');
    assert.deepEqual(JSON.parse(requests[1].options.body), { sellerId: 'seller-1', proposal });
    assert.equal(requests[2].url, '/api/transactions/tx-1/evaluate');
    assert.equal(requests[2].options.method, 'POST');
    assert.equal(requests[2].options.headers.Authorization, 'Bearer buyer-token');
    assert.equal(requests[2].options.body, undefined);
    assert.equal(requests[3].url, '/api/transactions');
    assert.equal(requests[3].options.headers.Authorization, 'Bearer buyer-token');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('transaction creation API returns network and backend errors without inventing a result', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('network down'); };
  try {
    await assert.rejects(createTransaction('buyer-token', 'seller-1', {}), { code: 'API_UNAVAILABLE' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
