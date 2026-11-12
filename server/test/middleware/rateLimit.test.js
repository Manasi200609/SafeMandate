import test from 'node:test';
import assert from 'node:assert/strict';
import { createRateLimitMiddleware } from '../../src/middleware/rateLimit.js';

function response() {
  return {
    headers: {},
    set(name, value) { this.headers[name.toLowerCase()] = value; return this; },
  };
}

test('authentication rate limit blocks excess attempts and resets its window', () => {
  let timestamp = 1_000;
  const limit = createRateLimitMiddleware({ maxRequests: 2, windowMs: 5_000, now: () => timestamp });
  let passed = 0;
  const req = { ip: '127.0.0.1' };
  const firstResponse = response();
  limit(req, firstResponse, () => { passed += 1; });
  limit(req, response(), () => { passed += 1; });
  assert.throws(() => limit(req, response(), () => { passed += 1; }), (error) => error.status === 429 && error.code === 'AUTH_RATE_LIMITED');
  assert.equal(passed, 2);
  timestamp = 6_001;
  limit(req, response(), () => { passed += 1; });
  assert.equal(passed, 3);
  assert.equal(firstResponse.headers['ratelimit-limit'], '2');
});

test('authentication rate limiter keeps client buckets bounded', () => {
  const limit = createRateLimitMiddleware({ maxRequests: 3, windowMs: 10_000, maxClients: 2, now: () => 1000 });
  for (const ip of ['10.0.0.1', '10.0.0.2', '10.0.0.3']) limit({ ip }, response(), () => {});
  assert.equal(limit.clientCount, 2);
});
