import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearPayPalHandoff,
  isPayPalApprovalUrl,
  PAYPAL_HANDOFF_KEY,
  reconcilePayPalReturn,
  resumePayPalApproval,
  startPayPalCheckout,
  verifyPayPalReturn,
} from '../src/services/paypalCheckout.js';

function storageStub() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

test('resuming a persisted PayPal order stores a short-lived handoff and redirects without creating an order', () => {
  const storage = storageStub();
  let destination;
  const result = resumePayPalApproval({
    transactionId: 'tx_existing', orderId: 'ORDER-EXISTING',
    approvalUrl: 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER-EXISTING',
    token: 'buyer-token', storage, navigate: (url) => { destination = url; }, now: 123,
  });
  assert.deepEqual(result, { kind: 'redirected', orderId: 'ORDER-EXISTING' });
  assert.equal(destination, 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER-EXISTING');
  assert.deepEqual(JSON.parse(storage.getItem(PAYPAL_HANDOFF_KEY)), {
    transactionId: 'tx_existing', orderId: 'ORDER-EXISTING', token: 'buyer-token', startedAt: 123,
  });
});

function orderResponse(overrides = {}) {
  return { operation: {
    kind: 'CREATE_ORDER', status: 'COMPLETED', providerResourceId: 'ORDER-123',
    providerStatus: 'CREATED', approvalUrl: 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER-123',
    ...overrides,
  } };
}

const transaction = { transactionId: 'tx_123', version: 4, state: 'READY_FOR_PAYMENT' };

test('checkout uses only transaction reference and expected version, stores tab handoff, then redirects', async () => {
  const storage = storageStub();
  const calls = [];
  const redirects = [];
  const result = await startPayPalCheckout({
    transaction, token: 'buyer-session-token', storage, now: 100,
    createOrder: async (...args) => { calls.push(args); return orderResponse(); },
    navigate: (url) => redirects.push(url),
  });

  assert.deepEqual(calls, [['tx_123', 'buyer-session-token', 4]]);
  assert.deepEqual(redirects, ['https://www.sandbox.paypal.com/checkoutnow?token=ORDER-123']);
  assert.deepEqual(JSON.parse(storage.getItem(PAYPAL_HANDOFF_KEY)), {
    transactionId: 'tx_123', orderId: 'ORDER-123', token: 'buyer-session-token', startedAt: 100,
  });
  assert.equal(result.kind, 'redirected');
});

test('duplicate checkout clicks are single-flight per transaction', async () => {
  const storage = storageStub();
  let release;
  let calls = 0;
  const first = startPayPalCheckout({
    transaction, token: 'token', storage,
    createOrder: () => { calls += 1; return new Promise((resolve) => { release = resolve; }); },
    navigate: () => {},
  });
  const duplicate = await startPayPalCheckout({ transaction, token: 'token', storage, createOrder: async () => { calls += 1; return orderResponse(); }, navigate: () => {} });
  assert.equal(duplicate.kind, 'in-progress');
  assert.equal(calls, 1);
  release(orderResponse());
  assert.equal((await first).kind, 'redirected');
});

test('unresolved or untrusted approval responses never redirect', async () => {
  const storage = storageStub();
  let redirects = 0;
  const pending = await startPayPalCheckout({ transaction, token: 'token', storage, createOrder: async () => orderResponse({ status: 'UNKNOWN', approvalUrl: 'https://www.sandbox.paypal.com/checkout' }), navigate: () => { redirects += 1; } });
  const hostile = await startPayPalCheckout({ transaction: { ...transaction, transactionId: 'tx_456' }, token: 'token', storage, createOrder: async () => orderResponse({ approvalUrl: 'https://paypal.com.attacker.example/checkout' }), navigate: () => { redirects += 1; } });
  assert.equal(pending.kind, 'unresolved');
  assert.equal(hostile.kind, 'unresolved');
  assert.equal(redirects, 0);
  assert.equal(isPayPalApprovalUrl('http://paypal.com/checkout'), false);
  assert.equal(isPayPalApprovalUrl('https://paypal.com.attacker.example/checkout'), false);
});

test('PayPal return matches the provider order, then reports success only after backend authorization confirmation', async () => {
  const storage = storageStub();
  await startPayPalCheckout({ transaction, token: 'buyer-token', storage, now: 500, createOrder: async () => orderResponse(), navigate: () => {} });
  let statusCalls = 0;
  let transactionCalls = 0;
  const getPaymentStatus = async () => {
    statusCalls += 1;
    return statusCalls === 1
      ? { state: 'PAYMENT_PENDING', provider: { orderId: 'ORDER-123' }, operations: [] }
      : { state: 'AUTHORIZED', provider: { orderId: 'ORDER-123', authorizationId: 'AUTH-456' }, operations: [{ kind: 'AUTHORIZE', status: 'COMPLETED', providerStatus: 'CREATED', providerResourceId: 'AUTH-456' }] };
  };
  const getTransaction = async () => {
    transactionCalls += 1;
    return transactionCalls === 1
      ? { ...transaction, state: 'PAYMENT_PENDING', provider: { orderId: 'ORDER-123' } }
      : { ...transaction, state: 'AUTHORIZED', provider: { orderId: 'ORDER-123', authorizationId: 'AUTH-456' } };
  };
  let authorizeCalls = 0;
  const result = await verifyPayPalReturn({
    search: '?token=ORDER-123&PayerID=UNTRUSTED-AND-UNUSED', storage, now: 600,
    getPaymentStatus, getTransaction,
    authorize: async (...args) => { authorizeCalls += 1; assert.deepEqual(args, ['tx_123', 'buyer-token', 4]); return { operation: { kind: 'AUTHORIZE', status: 'COMPLETED', providerStatus: 'CREATED', providerResourceId: 'AUTH-456' } }; },
  });
  assert.equal(result.kind, 'authorized');
  assert.equal(authorizeCalls, 1);
});

test('mismatched, missing, canceled, and provider-error returns never authorize', async () => {
  const storage = storageStub();
  await startPayPalCheckout({ transaction, token: 'token', storage, now: 10, createOrder: async () => orderResponse(), navigate: () => {} });
  let authorizeCalls = 0;
  const deps = { storage, now: 11, getPaymentStatus: async () => ({ state: 'PAYMENT_PENDING', provider: { orderId: 'ORDER-123' } }), getTransaction: async () => transaction, authorize: async () => { authorizeCalls += 1; } };
  assert.equal((await verifyPayPalReturn({ ...deps, search: '' })).kind, 'missing-order');
  assert.equal((await verifyPayPalReturn({ ...deps, search: '?token=OTHER' })).kind, 'order-mismatch');
  assert.equal((await verifyPayPalReturn({ ...deps, search: '?error=access_denied&token=ORDER-123' })).kind, 'provider-error');
  clearPayPalHandoff(storage);
  assert.equal((await verifyPayPalReturn({ ...deps, search: '?token=ORDER-123' })).kind, 'missing-session');
  assert.equal(authorizeCalls, 0);
});

test('an ambiguous authorization remains unresolved until explicit read-only reconciliation confirms it', async () => {
  const storage = storageStub();
  await startPayPalCheckout({ transaction, token: 'token', storage, createOrder: async () => orderResponse(), navigate: () => {} });
  let reconcileCalls = 0;
  const payment = { state: 'AUTHORIZED', provider: { orderId: 'ORDER-123', authorizationId: 'AUTH-456' }, operations: [{ kind: 'AUTHORIZE', status: 'COMPLETED', providerStatus: 'CREATED', providerResourceId: 'AUTH-456' }] };
  const tx = { ...transaction, state: 'AUTHORIZED', provider: { orderId: 'ORDER-123', authorizationId: 'AUTH-456' } };
  const result = await reconcilePayPalReturn({ storage, reconcile: async () => { reconcileCalls += 1; return { reconciled: true, providerStatus: 'COMPLETED' }; }, getPaymentStatus: async () => payment, getTransaction: async () => tx });
  assert.equal(reconcileCalls, 1);
  assert.equal(result.kind, 'authorized');
});

test('cancel cleanup removes the short-lived checkout credentials from this tab', async () => {
  const storage = storageStub();
  storage.setItem(PAYPAL_HANDOFF_KEY, JSON.stringify({ transactionId: 'tx_123', orderId: 'ORDER-123', token: 'token', startedAt: Date.now() }));
  clearPayPalHandoff(storage);
  assert.equal(storage.getItem(PAYPAL_HANDOFF_KEY), null);
});

test('checkout API failures are propagated without opening a redirect', async () => {
  const storage = storageStub();
  let redirected = false;
  await assert.rejects(startPayPalCheckout({ transaction, token: 'token', storage, createOrder: async () => { throw new Error('backend unavailable'); }, navigate: () => { redirected = true; } }), /backend unavailable/);
  assert.equal(redirected, false);
});
