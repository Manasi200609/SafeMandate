import test from 'node:test';
import assert from 'node:assert/strict';
import { createPayPalTransport, PayPalApiError, SANDBOX_BASE_URL } from '../../src/integrations/paypal/paypalTransport.js';

function response(status, data, headers = {}) {
  return { status, ok: status >= 200 && status < 300, headers: new Headers(headers), async json() { return data; } };
}

test('PayPal OAuth is cached and request IDs are sent without exposing token values', async () => {
  let calls = 0;
  let clock = 10_000;
  const observed = [];
  const transport = createPayPalTransport({
    clientId: 'private-client-id', clientSecret: 'private-client-secret', now: () => clock,
    fetchImpl: async (url, init) => {
      calls += 1; observed.push({ url, init });
      return calls === 1 || calls === 3
        ? response(200, { access_token: 'never-log-this-token', expires_in: 3600 })
        : response(201, { id: 'ORDER-1' });
    },
  });
  const result = await transport.request('POST', '/v2/checkout/orders', { intent: 'AUTHORIZE' }, { requestId: 'safe-tx-order-v1' });
  assert.equal(result.status, 201);
  assert.equal(result.data.id, 'ORDER-1');
  assert.equal(calls, 2);
  assert.equal(observed[0].url, `${SANDBOX_BASE_URL}/v1/oauth2/token`);
  assert.equal(observed[1].init.headers['PayPal-Request-Id'], 'safe-tx-order-v1');
  assert.match(observed[1].init.headers.Authorization, /^Bearer /);
  assert.equal(await transport.acquireToken(), 'never-log-this-token');
  assert.equal(calls, 2);
  clock += 3_580_001;
  await transport.acquireToken();
  assert.equal(calls, 3);
});

test('PayPal OAuth failures are sanitized and live hosts are rejected', async () => {
  const transport = createPayPalTransport({
    clientId: 'secret-id', clientSecret: 'secret-value',
    fetchImpl: async () => response(401, { error: 'invalid_client', error_description: 'private detail' }),
  });
  await assert.rejects(transport.acquireToken(), (error) => {
    assert.ok(error instanceof PayPalApiError);
    assert.equal(error.status, 401);
    assert.equal(error.issue, 'INVALID_CLIENT');
    assert.equal(error.message.includes('secret'), false);
    assert.equal(error.message.includes('private detail'), false);
    return true;
  });
  assert.throws(() => createPayPalTransport({ clientId: 'id', clientSecret: 'secret', baseUrl: 'https://api-m.paypal.com' }), /Sandbox/);
});

test('PayPal HTTP errors prefer the specific sanitized details issue over the generic response name', async () => {
  let calls = 0;
  const transport = createPayPalTransport({ clientId: 'id', clientSecret: 'secret', fetchImpl: async () => {
    calls += 1;
    return calls === 1
      ? response(200, { access_token: 'token', expires_in: 3600 })
      : response(400, { name: 'INVALID_REQUEST', message: 'Sensitive provider text', details: [{ field: '/purchase_units/0/payee/merchant_id', value: 'must-not-be-returned', issue: 'INVALID_PARAMETER_SYNTAX', description: 'Sensitive detail' }] });
  } });
  await assert.rejects(transport.request('POST', '/v2/checkout/orders', {}, { requestId: 'order-v1' }), (error) => {
    assert.equal(error.status, 400);
    assert.equal(error.issue, 'INVALID_PARAMETER_SYNTAX');
    assert.equal(error.field, '/purchase_units/0/payee/merchant_id');
    assert.equal(error.message.includes('Sensitive'), false);
    return true;
  });
});

test('ambiguous provider transport failures are surfaced without automatic mutation retry', async () => {
  let calls = 0;
  const transport = createPayPalTransport({ clientId: 'id', clientSecret: 'secret', fetchImpl: async () => {
    calls += 1;
    if (calls === 1) return response(200, { access_token: 'token', expires_in: 3600 });
    throw new Error('timeout');
  } });
  await assert.rejects(transport.request('POST', '/v2/payments/authorizations/AUTH-1/capture', {}, { requestId: 'capture-v1' }), (error) => error.issue === 'REQUEST_OUTCOME_UNKNOWN');
  assert.equal(calls, 2);
});
