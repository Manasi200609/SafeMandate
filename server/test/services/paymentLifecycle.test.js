import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryRepositories } from '../../src/persistence/memoryRepositories.js';
import { PayPalApiError } from '../../src/integrations/paypal/paypalTransport.js';
import { PayPalConfigurationError } from '../../src/integrations/paypal/configuredAdapter.js';
import { request, BUYER, SELLER, MANDATE_BODY, PROPOSAL_BODY, registerUser } from '../helpers/httpHarness.js';

const MERCHANT = 'SANDBOXMERCHANT123';

function fakePayPal({ captureTimeout = false, orderMismatch = null } = {}) {
  const calls = { create: 0, authorize: 0, capture: 0, void: 0 };
  let orderStatus = 'CREATED';
  let orderDraft;
  let captureOccurred = false;
  const authorization = {
    id: 'AUTH-123', status: 'CREATED', amount: { currency_code: 'INR', value: '10000.00' },
    create_time: new Date(Date.now() - 1000).toISOString(), expiration_time: '2099-12-31T23:59:59Z',
  };
  const order = () => ({
    id: 'ORDER-123', intent: 'AUTHORIZE', status: orderStatus,
    purchase_units: [{
      reference_id: orderDraft?.purchase_units[0].reference_id,
      payee: { merchant_id: orderMismatch === 'payee' ? 'OTHER' : MERCHANT },
      amount: { currency_code: orderMismatch === 'currency' ? 'USD' : 'INR', value: orderMismatch === 'amount' ? '1.00' : '10000.00' },
      ...(orderStatus === 'COMPLETED' ? { payments: {
        authorizations: [{ ...authorization }],
        ...(captureOccurred ? { captures: [{ id: 'CAPTURE-123', status: 'COMPLETED', amount: { currency_code: 'INR', value: '10000.00' } }] } : {}),
      } } : {}),
    }],
  });
  const adapter = {
    buildOrderDraft: (input) => {
      orderDraft = input;
      return { intent: 'AUTHORIZE', purchase_units: [{ reference_id: input.transaction.transactionId, amount: { currency_code: input.transaction.proposal.currency, value: '10000.00' }, payee: { merchant_id: MERCHANT } }] };
    },
    async createOrder(draft) {
      calls.create += 1;
      orderDraft = draft;
      return { status: 201, data: { id: 'ORDER-123', links: [{ rel: 'approve', href: 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER-123' }] } };
    },
    async getOrder() { return { status: 200, data: order() }; },
    async authorizeOrder() {
      calls.authorize += 1;
      orderStatus = 'COMPLETED';
      return { status: 201, data: order() };
    },
    async getAuthorization() { return { status: 200, data: { ...authorization } }; },
    async captureAuthorization() {
      calls.capture += 1;
      if (captureTimeout) {
        captureOccurred = true;
        throw new PayPalApiError({ issue: 'REQUEST_OUTCOME_UNKNOWN' });
      }
      return { status: 201, data: { id: 'CAPTURE-123', status: 'COMPLETED', amount: { currency_code: 'INR', value: '10000.00' }, create_time: new Date().toISOString() } };
    },
    async getCapture() { return { status: 200, data: { id: 'CAPTURE-123', status: 'COMPLETED', amount: { currency_code: 'INR', value: '10000.00' } } }; },
    async voidAuthorization() { calls.void += 1; return { status: 200, data: { ...authorization, status: 'VOIDED', update_time: new Date().toISOString() } }; },
  };
  return { calls, adapter, setApproved: () => { orderStatus = 'APPROVED'; }, factory: () => ({ adapter, merchantId: MERCHANT, returnUrl: 'http://127.0.0.1:5173/paypal/return', cancelUrl: 'http://127.0.0.1:5173/paypal/cancel' }) };
}

async function fixture(provider = fakePayPal()) {
  const repositories = createMemoryRepositories();
  // Test-only adapter injection; these tests never use the real transport.
  const { createApp } = await import('../../src/app.js');
  const app = createApp({ repositories, config: { frontendOrigins: ['http://127.0.0.1:5173'], sessionTtlMinutes: 480 }, paypalAdapterFactory: provider.factory });
  const httpServer = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => httpServer.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${httpServer.address().port}`;
  const buyer = await registerUser(baseUrl, BUYER);
  const seller = await registerUser(baseUrl, SELLER);
  const buyerToken = buyer.body.token;
  const sellerToken = seller.body.token;
  const saved = await request(baseUrl, 'PUT', '/api/mandates/current', { token: buyerToken, body: { mandate: MANDATE_BODY } });
  assert.equal(saved.status, 200);
  const created = await request(baseUrl, 'POST', '/api/transactions', { token: buyerToken, body: { sellerId: seller.body.user.userId, proposal: PROPOSAL_BODY } });
  assert.equal(created.status, 201);
  const transactionId = created.body.transaction.transactionId;
  const evaluated = await request(baseUrl, 'POST', `/api/transactions/${transactionId}/evaluate`, { token: buyerToken });
  assert.equal(evaluated.status, 200);
  return {
    baseUrl, buyerToken, sellerToken, provider, transactionId,
    close: () => new Promise((resolve) => httpServer.close(resolve)),
  };
}

async function createOrder(f) {
  const current = await request(f.baseUrl, 'GET', `/api/transactions/${f.transactionId}`, { token: f.buyerToken });
  return request(f.baseUrl, 'POST', `/api/transactions/${f.transactionId}/paypal/order`, {
    token: f.buyerToken, body: { expectedVersion: current.body.transaction.version },
  });
}

async function authorize(f) {
  f.provider.setApproved();
  const current = await request(f.baseUrl, 'GET', `/api/transactions/${f.transactionId}`, { token: f.buyerToken });
  return request(f.baseUrl, 'POST', `/api/transactions/${f.transactionId}/paypal/authorize`, {
    token: f.buyerToken, body: { expectedVersion: current.body.transaction.version },
  });
}

test('order and authorization are transaction-bound, use persisted amount, and replay idempotently', async (t) => {
  const f = await fixture();
  t.after(f.close);
  const sellerAttempt = await request(f.baseUrl, 'POST', `/api/transactions/${f.transactionId}/paypal/order`, { token: f.sellerToken, body: { expectedVersion: 1 } });
  assert.equal(sellerAttempt.status, 403);
  assert.equal(f.provider.calls.create, 0);
  const orderResult = await createOrder(f);
  assert.equal(orderResult.status, 201);
  assert.equal(orderResult.body.operation.approvalUrl, 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER-123');
  assert.equal(f.provider.calls.create, 1);
  assert.equal(orderResult.body.operation.amountMinor, PROPOSAL_BODY.amountMinor);
  const replay = await createOrder(f);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal(f.provider.calls.create, 1);
  const buyerReturn = await request(f.baseUrl, 'GET', `/api/transactions/${f.transactionId}/payment-status`, { token: f.buyerToken });
  assert.equal(buyerReturn.status, 200);
  const approved = await authorize(f);
  assert.equal(approved.status, 200);
  assert.equal(approved.body.operation.providerResourceId, 'AUTH-123');
  const authReplay = await authorize(f);
  assert.equal(authReplay.status, 200);
  assert.equal(authReplay.body.replayed, true);
  assert.equal(f.provider.calls.authorize, 1);
});

test('client cannot supply payment amounts or authorize an unapproved/mismatched order', async (t) => {
  const provider = fakePayPal({ orderMismatch: 'amount' });
  const f = await fixture(provider);
  t.after(f.close);
  const current = await request(f.baseUrl, 'GET', `/api/transactions/${f.transactionId}`, { token: f.buyerToken });
  const tampered = await request(f.baseUrl, 'POST', `/api/transactions/${f.transactionId}/paypal/order`, {
    token: f.buyerToken, body: { expectedVersion: current.body.transaction.version, amountMinor: 1, currency: 'USD' },
  });
  assert.equal(tampered.status, 400);
  assert.equal(provider.calls.create, 0);
  const orderResult = await createOrder(f);
  assert.equal(orderResult.status, 202);
  assert.equal(provider.calls.create, 1);
  const auth = await authorize(f);
  assert.equal(auth.status, 409);
  assert.equal(provider.calls.authorize, 0);
});

test('capture requires persisted check-in and both independent handoff confirmations', async (t) => {
  const f = await fixture();
  t.after(f.close);
  assert.equal((await createOrder(f)).status, 201);
  assert.equal((await authorize(f)).status, 200);
  let tx = await request(f.baseUrl, 'GET', `/api/transactions/${f.transactionId}`, { token: f.buyerToken });
  const meetup = await request(f.baseUrl, 'POST', `/api/transactions/${f.transactionId}/meetup/start`, { token: f.buyerToken, body: { expectedVersion: tx.body.transaction.version } });
  assert.equal(meetup.status, 200);
  tx = await request(f.baseUrl, 'GET', `/api/transactions/${f.transactionId}`, { token: f.buyerToken });
  const blocked = await request(f.baseUrl, 'POST', `/api/transactions/${f.transactionId}/paypal/capture`, { token: f.buyerToken, body: { expectedVersion: tx.body.transaction.version } });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error.code, 'BUYER_CHECK_IN_REQUIRED');
  assert.equal(f.provider.calls.capture, 0);
});

test('capture advances only after persisted evidence and provider COMPLETED status', async (t) => {
  const f = await fixture();
  t.after(f.close);
  assert.equal((await createOrder(f)).status, 201);
  assert.equal((await authorize(f)).status, 200);
  let tx = await request(f.baseUrl, 'GET', `/api/transactions/${f.transactionId}`, { token: f.buyerToken });
  assert.equal((await request(f.baseUrl, 'POST', `/api/transactions/${f.transactionId}/meetup/start`, { token: f.buyerToken, body: { expectedVersion: tx.body.transaction.version } })).status, 200);
  assert.equal((await request(f.baseUrl, 'POST', `/api/transactions/${f.transactionId}/check-ins`, { token: f.buyerToken, body: {} })).status, 201);
  assert.equal((await request(f.baseUrl, 'POST', `/api/transactions/${f.transactionId}/handoff-confirmations`, { token: f.buyerToken })).status, 200);
  assert.equal((await request(f.baseUrl, 'POST', `/api/transactions/${f.transactionId}/handoff-confirmations`, { token: f.sellerToken })).status, 200);
  tx = await request(f.baseUrl, 'GET', `/api/transactions/${f.transactionId}`, { token: f.buyerToken });
  const captureBody = { expectedVersion: tx.body.transaction.version };
  const results = await Promise.all([
    request(f.baseUrl, 'POST', `/api/transactions/${f.transactionId}/paypal/capture`, { token: f.buyerToken, body: captureBody }),
    request(f.baseUrl, 'POST', `/api/transactions/${f.transactionId}/paypal/capture`, { token: f.buyerToken, body: captureBody }),
  ]);
  assert.ok(results.every((result) => [200, 202].includes(result.status)));
  assert.ok(results.some((result) => result.body.operation?.providerResourceId === 'CAPTURE-123'));
  assert.equal(f.provider.calls.capture, 1);
  const detail = await request(f.baseUrl, 'GET', `/api/transactions/${f.transactionId}`, { token: f.buyerToken });
  assert.equal(detail.body.transaction.state, 'CAPTURED');
});

test('void verifies the authorization against its order and replays without a second mutation', async (t) => {
  const f = await fixture();
  t.after(f.close);
  assert.equal((await createOrder(f)).status, 201);
  assert.equal((await authorize(f)).status, 200);
  const tx = await request(f.baseUrl, 'GET', `/api/transactions/${f.transactionId}`, { token: f.buyerToken });
  const body = { expectedVersion: tx.body.transaction.version };
  const first = await request(f.baseUrl, 'POST', `/api/transactions/${f.transactionId}/paypal/void`, { token: f.buyerToken, body });
  assert.equal(first.status, 200);
  assert.equal(first.body.operation.providerStatus, 'VOIDED');
  const replay = await request(f.baseUrl, 'POST', `/api/transactions/${f.transactionId}/paypal/void`, { token: f.buyerToken, body });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal(f.provider.calls.void, 1);
  const detail = await request(f.baseUrl, 'GET', `/api/transactions/${f.transactionId}`, { token: f.buyerToken });
  assert.equal(detail.body.transaction.state, 'VOIDED');
});

test('missing PayPal config fails closed at operation time without breaking health', async (t) => {
  const repositories = createMemoryRepositories();
  const { createApp } = await import('../../src/app.js');
  const app = createApp({ repositories, config: { frontendOrigins: ['http://127.0.0.1:5173'], sessionTtlMinutes: 480 }, paypalAdapterFactory: () => { throw new PayPalConfigurationError(); } });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise((resolve) => server.close(resolve)));
  assert.equal((await request(baseUrl, 'GET', '/api/health')).status, 200);
  const buyer = await registerUser(baseUrl, BUYER);
  await request(baseUrl, 'PUT', '/api/mandates/current', { token: buyer.body.token, body: { mandate: MANDATE_BODY } });
  const seller = await registerUser(baseUrl, SELLER);
  const tx = await request(baseUrl, 'POST', '/api/transactions', { token: buyer.body.token, body: { sellerId: seller.body.user.userId, proposal: PROPOSAL_BODY } });
  await request(baseUrl, 'POST', `/api/transactions/${tx.body.transaction.transactionId}/evaluate`, { token: buyer.body.token });
  const result = await createOrder({ baseUrl, buyerToken: buyer.body.token, transactionId: tx.body.transaction.transactionId });
  assert.equal(result.status, 503);
  assert.equal(result.body.error.code, 'PAYPAL_NOT_CONFIGURED');
});

test('ambiguous capture remains unresolved and is never automatically retried', async (t) => {
  const f = await fixture(fakePayPal({ captureTimeout: true }));
  t.after(f.close);
  assert.equal((await createOrder(f)).status, 201);
  assert.equal((await authorize(f)).status, 200);
  let tx = await request(f.baseUrl, 'GET', `/api/transactions/${f.transactionId}`, { token: f.buyerToken });
  await request(f.baseUrl, 'POST', `/api/transactions/${f.transactionId}/meetup/start`, { token: f.buyerToken, body: { expectedVersion: tx.body.transaction.version } });
  await request(f.baseUrl, 'POST', `/api/transactions/${f.transactionId}/check-ins`, { token: f.buyerToken, body: {} });
  await request(f.baseUrl, 'POST', `/api/transactions/${f.transactionId}/handoff-confirmations`, { token: f.buyerToken });
  await request(f.baseUrl, 'POST', `/api/transactions/${f.transactionId}/handoff-confirmations`, { token: f.sellerToken });
  tx = await request(f.baseUrl, 'GET', `/api/transactions/${f.transactionId}`, { token: f.buyerToken });
  const body = { expectedVersion: tx.body.transaction.version };
  const first = await request(f.baseUrl, 'POST', `/api/transactions/${f.transactionId}/paypal/capture`, { token: f.buyerToken, body });
  assert.equal(first.status, 202);
  const replay = await request(f.baseUrl, 'POST', `/api/transactions/${f.transactionId}/paypal/capture`, { token: f.buyerToken, body });
  assert.equal(replay.status, 202);
  assert.equal(f.provider.calls.capture, 1);
  assert.equal(replay.body.operation.status, 'UNKNOWN');
  const reconciled = await request(f.baseUrl, 'POST', `/api/transactions/${f.transactionId}/paypal/reconcile`, { token: f.buyerToken });
  assert.equal(reconciled.status, 200);
  assert.equal(reconciled.body.reconciled, true);
  assert.equal(reconciled.body.state, 'CAPTURED');
  assert.equal(f.provider.calls.capture, 1);
  const audit = await request(f.baseUrl, 'GET', `/api/transactions/${f.transactionId}/audit`, { token: f.buyerToken });
  assert.ok(audit.body.auditLog.some((event) => event.eventType === 'PAYMENT_RECONCILED'));
});
