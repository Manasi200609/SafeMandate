import test from 'node:test';
import assert from 'node:assert/strict';
import app from '../../src/app.js';
import { getHealth } from '../../src/controllers/healthController.js';
import { postValidateMandate } from '../../src/controllers/mandateController.js';
import { postEvaluateProposal } from '../../src/controllers/policyController.js';
import { createCorsMiddleware } from '../../src/middleware/cors.js';
import { errorHandler, notFoundHandler } from '../../src/middleware/errors.js';

function responseRecorder() {
  return {
    code: 200, body: undefined, headers: {}, ended: false,
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
    set(name, value) { this.headers[name.toLowerCase()] = value; return this; },
    end() { this.ended = true; return this; },
  };
}

test('Express app mounts the required API routes and centralized handlers', () => {
  const layers = app.router.stack;
  const mountedApi = layers.find((layer) => layer.name === 'router')?.handle;
  const routes = mountedApi?.stack.map((layer) => `${Object.keys(layer.route.methods)[0].toUpperCase()} /api${layer.route.path}`);
  assert.deepEqual(routes, ['GET /api/health', 'POST /api/mandates/validate', 'POST /api/policy/evaluate']);
  assert.ok(layers.some((layer) => layer.name === 'notFoundHandler'));
  assert.ok(layers.some((layer) => layer.name === 'errorHandler'));
});

test('GET /api/health controller returns successful service JSON', () => {
  const res = responseRecorder();
  getHealth({}, res);
  assert.equal(res.code, 200);
  assert.deepEqual(res.body, { status: 'ok', service: 'safe-mandate-api' });
});

test('development frontend CORS origin is allowed and other origins are rejected', () => {
  const cors = createCorsMiddleware(['http://127.0.0.1:5173']);
  const allowedRes = responseRecorder();
  cors({ get: () => 'http://127.0.0.1:5173', method: 'GET' }, allowedRes, () => {});
  assert.equal(allowedRes.headers['access-control-allow-origin'], 'http://127.0.0.1:5173');
  assert.equal(allowedRes.headers.vary, 'Origin');

  const rejectedRes = responseRecorder();
  cors({ get: () => 'https://example.invalid', method: 'GET' }, rejectedRes, () => assert.fail('unapproved origin passed'));
  assert.equal(rejectedRes.code, 403);
  assert.equal(rejectedRes.body.error.code, 'ORIGIN_NOT_ALLOWED');
});

test('POST /api/mandates/validate controller delegates to the existing validator', () => {
  const res = responseRecorder();
  postValidateMandate({ body: { maxAmountMinor: 100 } }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.valid, false);
  assert.ok(res.body.errors.length > 0);
});

test('POST /api/policy/evaluate delegates to policy and never authorizes an over-budget proposal', () => {
  const mandate = {
    mandateId: 'mandate-http-test', maxAmountMinor: 1_500_000, currency: 'INR', allowedCategories: ['Electronics'],
    meetupRules: { requirePublicPlace: true, daytimeStart: '09:00', daytimeEnd: '18:00', timeZone: 'Asia/Kolkata' },
    expiresAt: '2099-12-31T23:59:59Z', guardianId: 'guardian-http-test', riskThreshold: 60,
  };
  const proposal = {
    proposalId: 'proposal-http-test', itemName: 'Headphones', description: 'Demo headphones', category: 'Electronics',
    amountMinor: 2_200_000, currency: 'INR', sellerName: 'Sample seller', sellerId: 'seller-http-test', meetupLocation: 'Public cafe',
    locationIsPublic: true, proposedLocalMeetupTime: '12:00', timeZone: 'Asia/Kolkata', aiRiskScore: 10,
    riskSignals: [], supportingEvidence: [], createdAt: '2026-11-09T10:00:00+05:30',
  };
  const res = responseRecorder();
  postEvaluateProposal({ body: { mandate, proposal } }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.decision, 'NEEDS_GUARDIAN');
  assert.equal(res.body.paymentEligible, false);
  assert.equal(res.body.evaluationOnly, true);
  assert.equal(res.body.authorizationGranted, false);
  assert.deepEqual(res.body.reasonCodes, ['OVER_BUDGET']);
});

test('404 and error handlers return safe JSON without stack traces', () => {
  const missing = responseRecorder();
  notFoundHandler({ method: 'GET', path: '/unknown' }, missing);
  assert.equal(missing.code, 404);
  assert.equal(missing.body.error.code, 'NOT_FOUND');

  const failed = responseRecorder();
  errorHandler(Object.assign(new Error('private internal details'), { status: 400, stack: 'private stack' }), {}, failed, assert.fail);
  assert.equal(failed.code, 400);
  assert.deepEqual(failed.body, { error: { code: 'INVALID_REQUEST', message: 'The request body is invalid or exceeds the allowed size.' } });
});
