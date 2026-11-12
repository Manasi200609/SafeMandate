import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizePayPalOrder, createPayPalOrder, getPaymentStatus } from '../src/services/api.js';

test('payment API sends only expectedVersion and bearer identity to the existing order route', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    return new Response(JSON.stringify({ operation: { kind: 'CREATE_ORDER', status: 'COMPLETED', approvalUrl: 'https://www.sandbox.paypal.com/checkout' } }), { status: 201, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const result = await createPayPalOrder('tx/id', 'buyer-token', 7);
    assert.equal(result.operation.kind, 'CREATE_ORDER');
    assert.equal(requests[0].url, '/api/transactions/tx%2Fid/paypal/order');
    assert.equal(requests[0].options.method, 'POST');
    assert.equal(requests[0].options.headers.Authorization, 'Bearer buyer-token');
    assert.deepEqual(JSON.parse(requests[0].options.body), { expectedVersion: 7 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('return flow uses payment status and authorize routes without sending provider IDs or amount', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    return new Response(JSON.stringify({ operation: { kind: 'AUTHORIZE', status: 'COMPLETED', providerStatus: 'CREATED' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    await getPaymentStatus('tx_1', 'buyer-token');
    await authorizePayPalOrder('tx_1', 'buyer-token', 8);
    assert.equal(requests[0].url, '/api/transactions/tx_1/payment-status');
    assert.equal(requests[1].url, '/api/transactions/tx_1/paypal/authorize');
    assert.deepEqual(JSON.parse(requests[1].options.body), { expectedVersion: 8 });
    assert.equal(requests[1].options.headers.Authorization, 'Bearer buyer-token');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
