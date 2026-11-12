import { once } from 'node:events';
import { createApp } from '../../src/app.js';

/** Starts the real Express app on an ephemeral loopback port. */
export async function startTestServer(repositories, configOverrides = {}, integrations = {}) {
  const app = createApp({
    repositories,
    config: { frontendOrigins: ['http://127.0.0.1:5173'], sessionTtlMinutes: 480, ...configOverrides },
    ...integrations,
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

export async function request(baseUrl, method, path, { token, body, origin, extraHeaders = {} } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  if (origin) headers.Origin = origin;
  Object.assign(headers, extraHeaders);

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  return { status: response.status, headers: response.headers, body: parsed };
}

export const BUYER = Object.freeze({
  email: 'buyer@example.test',
  password: 'correct-horse-battery',
  role: 'buyer',
  displayName: 'Demo Buyer',
});

export const SELLER = Object.freeze({
  email: 'seller@example.test',
  password: 'correct-horse-battery',
  role: 'seller',
  displayName: 'Demo Seller',
});

export const MANDATE_BODY = Object.freeze({
  maxAmountMinor: 1_500_000,
  currency: 'INR',
  allowedCategories: ['electronics'],
  meetupRules: { requirePublicPlace: true, daytimeStart: '09:00', daytimeEnd: '18:00', timeZone: 'Asia/Kolkata' },
  expiresAt: '2099-12-31T23:59:59Z',
  guardianId: 'guardian-demo-1',
  riskThreshold: 40,
});

export const PROPOSAL_BODY = Object.freeze({
  itemName: 'Used phone',
  description: 'Demo used phone in good condition',
  category: 'electronics',
  amountMinor: 1_000_000,
  currency: 'INR',
  meetupLocation: 'Public cafe',
  locationIsPublic: true,
  proposedLocalMeetupTime: '12:30',
  timeZone: 'Asia/Kolkata',
  aiRiskScore: 10,
  riskSignals: [],
  supportingEvidence: [],
});

export async function registerUser(baseUrl, user) {
  const response = await request(baseUrl, 'POST', '/api/auth/register', { body: user });
  return response;
}

export async function loginUser(baseUrl, email, password) {
  return request(baseUrl, 'POST', '/api/auth/login', { body: { email, password } });
}
