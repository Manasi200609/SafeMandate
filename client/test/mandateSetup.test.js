import test from 'node:test';
import assert from 'node:assert/strict';
import { getCurrentMandate, getGuardianRelationships, inviteGuardian, saveCurrentMandate, acceptGuardianInvitation } from '../src/services/api.js';
import { parseMandateMajorAmount } from '../src/services/mandateDraft.js';
import { classifyPersistedMandate } from '../src/services/mandateStatus.js';

const mandate = {
  maxAmountMinor: 124050,
  currency: 'INR',
  allowedCategories: ['electronics', 'books'],
  meetupRules: { requirePublicPlace: true, daytimeStart: '09:00', daytimeEnd: '18:00', timeZone: 'Asia/Kolkata' },
  expiresAt: '2099-12-31T23:59:59Z',
  guardianId: 'guardian-real-id',
  riskThreshold: 40,
};

test('mandate amount conversion preserves minor units without floating point rounding', () => {
  assert.equal(parseMandateMajorAmount('1240.50', 'INR'), 124050);
  assert.equal(parseMandateMajorAmount('1.234', 'KWD'), 1234);
  assert.equal(parseMandateMajorAmount('120', 'JPY'), 120);
  assert.equal(parseMandateMajorAmount('1.001', 'INR'), null);
  assert.equal(parseMandateMajorAmount('0', 'INR'), null);
  assert.equal(parseMandateMajorAmount('90071992547409.92', 'INR'), null);
});

test('Agent mandate classification distinguishes persisted, expired, and malformed records', () => {
  assert.equal(classifyPersistedMandate(mandate, Date.parse('2026-01-01T00:00:00Z')), 'ready');
  assert.equal(classifyPersistedMandate({ ...mandate, expiresAt: '2020-01-01T00:00:00Z' }, Date.parse('2026-01-01T00:00:00Z')), 'expired');
  assert.equal(classifyPersistedMandate({ ...mandate, maxAmountMinor: 0 }, Date.parse('2026-01-01T00:00:00Z')), 'invalid');
  assert.equal(classifyPersistedMandate(null), 'invalid');
});

test('mandate and guardian API calls use authenticated persisted endpoints and exact contracts', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    const body = calls.length === 1 ? { mandate } : calls.length === 2 ? { mandate } : calls.length === 3 ? { relationships: [{ relationshipId: 'rel-1', guardianId: 'guardian-real-id', status: 'ACCEPTED', eligible: true }] } : calls.length === 4 ? { relationship: { relationshipId: 'rel-2', status: 'PENDING' } } : { relationship: { relationshipId: 'rel-1', status: 'ACCEPTED' } };
    return new Response(JSON.stringify(body), { status: calls.length === 4 ? 201 : 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    assert.deepEqual(await getCurrentMandate('buyer-session'), mandate);
    assert.deepEqual(await saveCurrentMandate('buyer-session', mandate), mandate);
    assert.deepEqual(await getGuardianRelationships('buyer-session'), [{ relationshipId: 'rel-1', guardianId: 'guardian-real-id', status: 'ACCEPTED', eligible: true }]);
    assert.equal((await inviteGuardian('buyer-session', 'guardian@example.test')).status, 'PENDING');
    assert.equal((await acceptGuardianInvitation('guardian-session', 'rel/id')).status, 'ACCEPTED');
    assert.equal(calls[0].url, '/api/mandates/current');
    assert.equal(calls[0].options.method, 'GET');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer buyer-session');
    assert.equal(calls[1].options.method, 'PUT');
    assert.deepEqual(JSON.parse(calls[1].options.body), { mandate });
    assert.equal(calls[2].url, '/api/guardian-relationships');
    assert.equal(calls[3].options.method, 'POST');
    assert.deepEqual(JSON.parse(calls[3].options.body), { guardianEmail: 'guardian@example.test' });
    assert.equal(calls[4].url, '/api/guardian-relationships/rel%2Fid/accept');
    assert.equal(calls[4].options.headers.Authorization, 'Bearer guardian-session');
  } finally { globalThis.fetch = originalFetch; }
});

test('API failures remain errors and never create client-side persistence success', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: 'GUARDIAN_NOT_ELIGIBLE', message: 'Select an eligible guardian.' } }), { status: 409 });
  try {
    await assert.rejects(saveCurrentMandate('buyer-session', mandate), (error) => error.status === 409 && error.code === 'GUARDIAN_NOT_ELIGIBLE');
  } finally { globalThis.fetch = originalFetch; }
});
