import test from 'node:test';
import assert from 'node:assert/strict';
import { claimPayPalCheckout, createPayPalAuthorizationSession, findPayPalEligibility, formatPayPalEligibilityAmount, loadPayPalSdkV6, releasePayPalCheckout, requestPayPalSdkOrder, startPayPalPopupSession } from '../src/services/paypalSdkV6.js';
import { getPayPalCheckoutState, verifyPayPalApproval } from '../src/services/paypalCheckout.js';

test('SDK v6 initializes the Sandbox web SDK with the public client ID and PayPal payment component', async () => {
  const calls = [];
  const windowObject = { paypal: { async createInstance(options) { calls.push(options); return { ready: true }; } } };
  const documentObject = { createElement() {} };
  const sdk = await loadPayPalSdkV6({ clientId: 'public-sandbox-client-id', windowObject, documentObject });
  assert.deepEqual(sdk, { ready: true });
  assert.deepEqual(calls, [{ clientId: 'public-sandbox-client-id', components: ['paypal-payments'], pageType: 'checkout' }]);
  assert.equal(await loadPayPalSdkV6({ clientId: 'public-sandbox-client-id', windowObject, documentObject }), sdk);
  await assert.rejects(loadPayPalSdkV6({ clientId: '', windowObject, documentObject }), (error) => error.code === 'PAYPAL_SDK_NOT_CONFIGURED');
});

test('SDK script loader uses the Sandbox v6 core endpoint', async () => {
  const listeners = {};
  const appended = [];
  const windowObject = {};
  const script = { dataset: {}, addEventListener: (name, callback) => { listeners[name] = callback; } };
  const documentObject = { createElement: () => script, head: { appendChild: (element) => {
    appended.push(element);
    windowObject.paypal = { async createInstance() { return { initialized: true }; } };
    listeners.load();
  } }, querySelector: () => null };
  const sdk = await loadPayPalSdkV6({ clientId: 'public-client-id', windowObject, documentObject });
  assert.equal(script.src, 'https://www.sandbox.paypal.com/web-sdk/v6/core');
  assert.equal(script.async, true);
  assert.equal(appended.length, 1);
  assert.deepEqual(sdk, { initialized: true });
});

test('a failed SDK script is removed and a later load attempt creates a fresh script', async () => {
  const windowObject = {};
  const scripts = [];
  const documentObject = {
    createElement() {
      const listeners = {};
      const script = {
        dataset: {},
        addEventListener: (name, callback) => { listeners[name] = callback; },
        removeEventListener: (name) => { delete listeners[name]; },
        remove() { script.removed = true; },
        fail() { listeners.error?.(); },
        load() { listeners.load?.(); },
      };
      scripts.push(script);
      return script;
    },
    querySelector: () => scripts.find((script) => !script.removed) ?? null,
    head: { appendChild(script) { if (scripts.length === 1) script.fail(); else { windowObject.paypal = { createInstance: async () => ({ retry: true }) }; script.load(); } } },
  };
  await assert.rejects(loadPayPalSdkV6({ clientId: 'retry-client', windowObject, documentObject }), (error) => error.code === 'PAYPAL_SDK_UNAVAILABLE');
  assert.equal(scripts[0].removed, true);
  assert.deepEqual(await loadPayPalSdkV6({ clientId: 'retry-client', windowObject, documentObject }), { retry: true });
  assert.equal(scripts.length, 2);
});

test('an SDK script that never loads times out and removes the stuck element', async () => {
  const scripts = [];
  const documentObject = {
    createElement() {
      const script = { dataset: {}, addEventListener() {}, removeEventListener() {}, remove() { script.removed = true; } };
      scripts.push(script);
      return script;
    },
    querySelector: () => scripts.find((script) => !script.removed) ?? null,
    head: { appendChild() {} },
  };
  await assert.rejects(loadPayPalSdkV6({ clientId: 'timeout-client', windowObject: {}, documentObject, scriptLoadTimeoutMs: 1 }), /timed out/);
  assert.equal(scripts[0].removed, true);
});

test('PayPal eligibility uses exact persisted currency and amount values and caches duplicate checks', async () => {
  assert.equal(formatPayPalEligibilityAmount(124050, 'INR'), '1240.50');
  assert.equal(formatPayPalEligibilityAmount(1250, 'KWD'), '1.250');
  assert.equal(formatPayPalEligibilityAmount(120, 'JPY'), '120');
  assert.equal(formatPayPalEligibilityAmount(0, 'INR'), null);
  const calls = [];
  const sdk = { async findEligibleMethods(input) { calls.push(input); return { isEligible: (method) => method === 'paypal' }; } };
  const transaction = { amountMinor: 124050, currency: 'INR' };
  assert.equal(await findPayPalEligibility(sdk, transaction), true);
  assert.equal(await findPayPalEligibility(sdk, transaction), true);
  assert.deepEqual(calls, [{ currencyCode: 'INR', amount: '1240.50' }]);
});

test('PayPal eligibility passes the configured Sandbox buyer country and isolates its cache', async () => {
  const calls = [];
  const sdk = { async findEligibleMethods(input) { calls.push(input); return { isEligible: () => true }; } };
  const transaction = { amountMinor: 55000, currency: 'USD' };
  assert.equal(await findPayPalEligibility(sdk, transaction, 'us'), true);
  assert.equal(await findPayPalEligibility(sdk, transaction, 'US'), true);
  assert.equal(await findPayPalEligibility(sdk, transaction), true);
  assert.deepEqual(calls, [
    { currencyCode: 'USD', amount: '550.00', countryCode: 'US' },
    { currencyCode: 'USD', amount: '550.00' },
  ]);
});

test('rejected eligibility checks are evicted so a later attempt can retry', async () => {
  let calls = 0;
  const sdk = { async findEligibleMethods() {
    calls += 1;
    if (calls === 1) throw new Error('temporary eligibility failure');
    return { isEligible: (method) => method === 'paypal' };
  } };
  const transaction = { amountMinor: 5000, currency: 'USD' };
  await assert.rejects(findPayPalEligibility(sdk, transaction), /temporary eligibility failure/);
  assert.equal(await findPayPalEligibility(sdk, transaction), true);
  assert.equal(calls, 2);
});

test('SDK order creation returns only the persisted server order ID contract', async () => {
  const calls = [];
  const createOrder = async (...args) => {
    calls.push(args);
    return { operation: { kind: 'CREATE_ORDER', status: 'COMPLETED', providerStatus: 'CREATED', providerResourceId: 'ORDER-SANDBOX-1', approvalUrl: 'https://www.sandbox.paypal.com/not-used' } };
  };
  const result = await requestPayPalSdkOrder({ transactionId: 'tx_1', token: 'buyer-token', expectedVersion: 7, createOrder });
  assert.deepEqual(result, { orderId: 'ORDER-SANDBOX-1' });
  assert.deepEqual(calls, [['tx_1', 'buyer-token', 7]]);
  await assert.rejects(requestPayPalSdkOrder({ transactionId: 'tx_1', token: 'buyer-token', expectedVersion: 7, createOrder: async () => ({ operation: { kind: 'CREATE_ORDER', status: 'UNKNOWN' } }) }), (error) => error.code === 'PAYMENT_OUTCOME_UNKNOWN');
});

test('popup mode falls back only for SDK recoverable popup failures and reuses the same order promise', async () => {
  const modes = [];
  let promiseUsed;
  const orderPromise = Promise.resolve({ orderId: 'ORDER-1' });
  const session = { async start(options, order) {
    modes.push(options.presentationMode); promiseUsed ??= order; assert.equal(order, promiseUsed);
    if (options.presentationMode === 'popup') throw Object.assign(new Error('blocked'), { code: 'ERR_DEV_UNABLE_TO_OPEN_POPUP' });
  } };
  let fallbackCalls = 0;
  const result = await startPayPalPopupSession({ transactionId: 'tx-1', paymentSession: session, orderPromise, onFallback: () => { fallbackCalls += 1; } });
  assert.deepEqual(modes, ['popup', 'modal']);
  assert.equal(promiseUsed, orderPromise);
  assert.equal(fallbackCalls, 1);
  assert.deepEqual(result, { kind: 'completed', presentation: 'modal-fallback' });
  await assert.rejects(startPayPalPopupSession({ transactionId: 'tx-2', paymentSession: { async start() { throw new Error('provider failure'); } }, orderPromise }), /provider failure/);
});

test('checkout start is single-flight for a transaction', async () => {
  let releasePopup;
  let starts = 0;
  const paymentSession = { start: () => { starts += 1; return new Promise((resolve) => { releasePopup = resolve; }); } };
  const first = startPayPalPopupSession({ transactionId: 'tx-single-flight', paymentSession, orderPromise: Promise.resolve({ orderId: 'ORDER-1' }) });
  await Promise.resolve();
  const second = await startPayPalPopupSession({ transactionId: 'tx-single-flight', paymentSession, orderPromise: Promise.resolve({ orderId: 'ORDER-1' }) });
  assert.deepEqual(second, { kind: 'in-progress' });
  assert.equal(starts, 1);
  releasePopup();
  assert.deepEqual(await first, { kind: 'completed', presentation: 'popup' });
  releasePayPalCheckout('tx-single-flight');
});

test('transaction lock is acquired synchronously before checkout order creation', () => {
  assert.equal(claimPayPalCheckout('tx-reserved'), true);
  assert.equal(claimPayPalCheckout('tx-reserved'), false);
  releasePayPalCheckout('tx-reserved');
  assert.equal(claimPayPalCheckout('tx-reserved'), true);
  releasePayPalCheckout('tx-reserved');
});

test('transaction checkout state blocks confirmed authorization and unresolved or failed operations', () => {
  const tx = { transactionId: 'tx-1', state: 'PAYMENT_PENDING', provider: { orderId: 'ORDER-1', authorizationId: 'AUTH-1' } };
  const authorizedPayment = { state: 'AUTHORIZED', provider: { orderId: 'ORDER-1' }, operations: [{ kind: 'AUTHORIZE', status: 'COMPLETED', providerStatus: 'CREATED', providerResourceId: 'AUTH-1' }] };
  assert.equal(getPayPalCheckoutState(authorizedPayment, { ...tx, state: 'AUTHORIZED' }), 'authorized');
  assert.equal(getPayPalCheckoutState({ operations: [{ kind: 'CREATE_ORDER', status: 'UNKNOWN' }] }, { ...tx, provider: { orderId: 'ORDER-1' } }), 'unresolved');
  assert.equal(getPayPalCheckoutState({ operations: [{ kind: 'AUTHORIZE', status: 'FAILED' }] }, { ...tx, provider: { orderId: 'ORDER-1' } }), 'unresolved');
  assert.equal(getPayPalCheckoutState({ operations: [] }, { ...tx, state: 'READY_FOR_PAYMENT', provider: {} }), 'ready');
});

test('SDK authorization callback only reports success after backend authorization is persisted', async () => {
  const orderId = 'ORDER-1';
  const transactionId = 'tx-1';
  let authorized = false;
  let authorizeCalls = 0;
  let reconcileCalls = 0;
  const getPaymentStatus = async () => authorized
    ? { state: 'AUTHORIZED', provider: { orderId, authorizationId: 'AUTH-1' }, operations: [{ kind: 'AUTHORIZE', status: 'COMPLETED', providerStatus: 'CREATED', providerResourceId: 'AUTH-1' }] }
    : { state: 'PAYMENT_PENDING', provider: { orderId }, operations: [] };
  const getTransaction = async () => authorized
    ? { transactionId, version: 9, state: 'AUTHORIZED', provider: { orderId, authorizationId: 'AUTH-1' } }
    : { transactionId, version: 8, state: 'PAYMENT_PENDING', provider: { orderId } };
  const result = await verifyPayPalApproval({
    orderId, transactionId, token: 'buyer-token', getPaymentStatus, getTransaction,
    authorize: async (...args) => { authorizeCalls += 1; assert.deepEqual(args, [transactionId, 'buyer-token', 8]); authorized = true; return { operation: { kind: 'AUTHORIZE', status: 'COMPLETED', providerStatus: 'CREATED', providerResourceId: 'AUTH-1' } }; },
    reconcile: async () => { reconcileCalls += 1; },
  });
  assert.deepEqual(result, { kind: 'authorized', transactionId });
  assert.equal(authorizeCalls, 1);
  assert.equal(reconcileCalls, 0);
});

test('callback order mismatch never calls authorization', async () => {
  let authorizeCalls = 0;
  const result = await verifyPayPalApproval({
    orderId: 'ORDER-WRONG', transactionId: 'tx-1', token: 'token',
    getPaymentStatus: async () => ({ state: 'PAYMENT_PENDING', provider: { orderId: 'ORDER-1' } }),
    getTransaction: async () => ({ state: 'PAYMENT_PENDING', provider: { orderId: 'ORDER-1' } }),
    authorize: async () => { authorizeCalls += 1; },
  });
  assert.equal(result.kind, 'order-mismatch');
  assert.equal(authorizeCalls, 0);
});

test('missing callback order ID never authorizes and authorization rejection is not treated as success', async () => {
  let authorizeCalls = 0;
  const noOrder = await verifyPayPalApproval({
    orderId: '', transactionId: 'tx-1', token: 'buyer-token',
    getPaymentStatus: async () => ({}), getTransaction: async () => ({}),
    authorize: async () => { authorizeCalls += 1; },
  });
  assert.equal(noOrder.kind, 'missing-order');
  await assert.rejects(verifyPayPalApproval({
    orderId: 'ORDER-1', transactionId: 'tx-1', token: 'buyer-token',
    getPaymentStatus: async () => ({ state: 'PAYMENT_PENDING', provider: { orderId: 'ORDER-1' }, operations: [] }),
    getTransaction: async () => ({ transactionId: 'tx-1', version: 3, state: 'PAYMENT_PENDING', provider: { orderId: 'ORDER-1' } }),
    authorize: async () => { authorizeCalls += 1; throw Object.assign(new Error('rejected'), { code: 'PAYPAL_OPERATION_FAILED' }); },
    reconcile: async () => { throw new Error('a definitive rejection must not reconcile as success'); },
  }), /rejected/);
  assert.equal(authorizeCalls, 1);
});

test('ambiguous authorization is reconciled before the UI can regard it as confirmed', async () => {
  let reconciled = false;
  const getPaymentStatus = async () => reconciled
    ? { state: 'AUTHORIZED', provider: { orderId: 'ORDER-1' }, operations: [{ kind: 'AUTHORIZE', status: 'COMPLETED', providerStatus: 'CREATED', providerResourceId: 'AUTH-1' }] }
    : { state: 'PAYMENT_PENDING', provider: { orderId: 'ORDER-1' }, operations: [{ kind: 'AUTHORIZE', status: 'UNKNOWN' }] };
  const getTransaction = async () => reconciled
    ? { transactionId: 'tx-1', state: 'AUTHORIZED', provider: { orderId: 'ORDER-1', authorizationId: 'AUTH-1' } }
    : { transactionId: 'tx-1', state: 'PAYMENT_PENDING', provider: { orderId: 'ORDER-1' } };
  let authorizeCalls = 0;
  let reconcileCalls = 0;
  const result = await verifyPayPalApproval({
    orderId: 'ORDER-1', transactionId: 'tx-1', token: 'buyer-token', getPaymentStatus, getTransaction,
    authorize: async () => { authorizeCalls += 1; throw Object.assign(new Error('uncertain'), { code: 'PAYMENT_OUTCOME_UNKNOWN' }); },
    reconcile: async () => { reconcileCalls += 1; reconciled = true; },
  });
  assert.deepEqual(result, { kind: 'authorized', transactionId: 'tx-1' });
  assert.equal(authorizeCalls, 1);
  assert.equal(reconcileCalls, 1);
});

test('v6 session receives approval, cancellation, and error handlers without any capture handler', () => {
  let options;
  const sdk = { createPayPalOneTimePaymentSession(input) { options = input; return { start() {} }; } };
  const callbacks = { onApprove: async () => {}, onCancel: async () => {}, onError: async () => {} };
  createPayPalAuthorizationSession(sdk, callbacks);
  assert.deepEqual(Object.keys(options).sort(), ['onApprove', 'onCancel', 'onError']);
  for (const key of Object.keys(callbacks)) assert.equal(options[key], callbacks[key]);
  assert.equal('onCapture' in options, false);
});
