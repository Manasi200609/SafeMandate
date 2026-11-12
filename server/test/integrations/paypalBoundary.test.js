import test from 'node:test';
import assert from 'node:assert/strict';
import { createPayPalAdapter, PayPalMutationDisabledError } from '../../src/integrations/paypal/providerBoundary.js';

test('PayPal adapter mutations remain disabled by default and make no provider calls', async () => {
  let calls = 0;
  const adapter = createPayPalAdapter({
    transport: { async request() { calls += 1; return { status: 'COMPLETED' }; } },
  });
  assert.equal(adapter.environment, 'sandbox');
  assert.equal(adapter.mutationsEnabled, false);
  for (const operation of [
    () => adapter.createOrder({}),
    () => adapter.authorizeOrder('order-id'),
    () => adapter.captureAuthorization('authorization-id'),
    () => adapter.voidAuthorization('authorization-id'),
  ]) {
    await assert.rejects(operation, (error) => error instanceof PayPalMutationDisabledError && error.code === 'PAYPAL_MUTATIONS_DISABLED');
  }
  assert.equal(calls, 0);
});

test('PayPal reads also remain inert until a transport is supplied', async () => {
  const adapter = createPayPalAdapter();
  await assert.rejects(() => adapter.getOrder('order-id'), (error) => error.code === 'PAYPAL_MUTATIONS_DISABLED');
});
