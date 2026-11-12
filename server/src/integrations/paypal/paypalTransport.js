const SANDBOX_BASE_URL = 'https://api-m.sandbox.paypal.com';

export class PayPalApiError extends Error {
  constructor({ status, issue = 'PROVIDER_ERROR', debugId = null } = {}) {
    super(`PayPal Sandbox request failed (${status ?? 'network'}).`);
    this.name = 'PayPalApiError';
    this.code = 'PAYPAL_PROVIDER_ERROR';
    this.status = Number.isInteger(status) ? status : null;
    this.issue = /^[A-Z0-9_]{1,64}$/.test(issue) ? issue : 'PROVIDER_ERROR';
    this.debugId = typeof debugId === 'string' && /^[A-Za-z0-9-]{1,80}$/.test(debugId) ? debugId : null;
  }
}

/** OAuth and REST transport for PayPal Sandbox. Mutations are never retried here. */
export function createPayPalTransport({ clientId, clientSecret, baseUrl = SANDBOX_BASE_URL, fetchImpl = fetch, now = Date.now, timeoutMs = 12_000 } = {}) {
  if (typeof clientId !== 'string' || !clientId || typeof clientSecret !== 'string' || !clientSecret) {
    throw new TypeError('PayPal Sandbox credentials are required.');
  }
  let parsedBase;
  try { parsedBase = new URL(baseUrl); } catch { throw new TypeError('PayPal base URL is invalid.'); }
  if (parsedBase.origin !== SANDBOX_BASE_URL || parsedBase.pathname !== '/' || parsedBase.search || parsedBase.hash) {
    throw new TypeError('PayPal transport is restricted to the Sandbox API host.');
  }

  let cachedToken = null;
  let tokenPromise = null;

  async function acquireToken() {
    if (cachedToken && cachedToken.expiresAt - now() > 30_000) return cachedToken.value;
    if (tokenPromise) return tokenPromise;
    tokenPromise = (async () => {
      let response;
      try {
        response = await fetchImpl(`${SANDBOX_BASE_URL}/v1/oauth2/token`, {
          method: 'POST',
          headers: {
            Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
          },
          body: 'grant_type=client_credentials',
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        throw new PayPalApiError({ issue: 'OAUTH_NETWORK_ERROR' });
      }
      let data;
      try { data = await response.json(); } catch { data = null; }
      if (!response.ok || typeof data?.access_token !== 'string' || !Number.isFinite(data?.expires_in) || data.expires_in <= 0) {
        // PayPal's top-level name is often just INVALID_REQUEST; details[].issue
        // contains the actionable schema/business validation code.
        const providerIssue = data?.details?.find((detail) => typeof detail?.issue === 'string')?.issue ?? data?.error ?? data?.name;
        const rawIssue = typeof providerIssue === 'string' ? providerIssue.toUpperCase().replaceAll('-', '_') : '';
        const issue = /^[A-Z0-9_]{1,64}$/.test(rawIssue) ? rawIssue : 'OAUTH_FAILED';
        throw new PayPalApiError({ status: response.status, issue });
      }
      cachedToken = { value: data.access_token, expiresAt: now() + data.expires_in * 1000 };
      return cachedToken.value;
    })().finally(() => { tokenPromise = null; });
    return tokenPromise;
  }

  async function request(method, path, body, { requestId } = {}) {
    if (!['GET', 'POST'].includes(method) || typeof path !== 'string' || !/^\/[A-Za-z0-9_/?=-]+$/.test(path)) {
      throw new TypeError('PayPal request method or path is invalid.');
    }
    const token = await acquireToken();
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (requestId !== undefined) {
      if (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{1,108}$/.test(requestId)) throw new TypeError('PayPal request id is invalid.');
      headers['PayPal-Request-Id'] = requestId;
    }
    let response;
    try {
      response = await fetchImpl(`${SANDBOX_BASE_URL}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      // A mutation timeout is ambiguous; callers must reconcile before retrying.
      cachedToken = null;
      throw new PayPalApiError({ issue: 'REQUEST_OUTCOME_UNKNOWN' });
    }
    let data = null;
    try { if (response.status !== 204) data = await response.json(); } catch { data = null; }
    if (!response.ok) {
      if (response.status === 401) cachedToken = null;
      throw new PayPalApiError({
        status: response.status,
        // PayPal's top-level name is often just INVALID_REQUEST; details[].issue
        // contains the actionable schema/business validation code.
        issue: String(data?.details?.find((detail) => typeof detail?.issue === 'string')?.issue ?? data?.error ?? data?.name ?? 'PROVIDER_ERROR').toUpperCase().replaceAll('-', '_'),
        debugId: response.headers.get('paypal-debug-id'),
      });
    }
    return { status: response.status, data };
  }

  return Object.freeze({ environment: 'sandbox', request, acquireToken });
}

export { SANDBOX_BASE_URL };
