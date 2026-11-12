const API_ORIGIN = (import.meta.env?.VITE_API_ORIGIN || '').replace(/\/+$/, '');
const IS_PRODUCTION = Boolean(import.meta.env?.PROD);

export class ApiRequestError extends Error {
  constructor({ status, code, message }) {
    super(message || 'The Safe Mandate API request failed.');
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code || 'API_REQUEST_FAILED';
  }
}

async function requestJson(path, { method = 'GET', token, body, signal } = {}) {
  if (IS_PRODUCTION && !API_ORIGIN) {
    throw new ApiRequestError({ status: 0, code: 'API_BASE_URL_NOT_CONFIGURED', message: 'The deployed API base URL is not configured. Set VITE_API_ORIGIN to the Safe Mandate Render service URL in the frontend deployment settings.' });
  }
  let response;
  try {
    response = await fetch(`${API_ORIGIN}${path}`, {
      method,
      signal,
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiRequestError({ status: 0, code: 'API_UNAVAILABLE', message: 'The Safe Mandate backend could not be reached.' });
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiRequestError({
      status: response.status,
      code: payload?.error?.code,
      message: payload?.error?.message,
    });
  }
  return payload;
}

export async function signInBuyer(email, password) {
  const result = await requestJson('/api/auth/login', { method: 'POST', body: { email, password } });
  if (result?.user?.role !== 'buyer' || typeof result?.token !== 'string') {
    if (typeof result?.token === 'string') await requestJson('/api/auth/logout', { method: 'POST', token: result.token }).catch(() => {});
    throw new ApiRequestError({ status: 403, code: 'BUYER_ACCOUNT_REQUIRED', message: 'Sign in with a buyer account to use the purchase copilot.' });
  }
  return result;
}

export async function signOut(token) {
  if (token) await requestJson('/api/auth/logout', { method: 'POST', token });
}

export async function getCurrentMandate(token) {
  const result = await requestJson('/api/mandates/current', { token });
  return result.mandate;
}

export async function postAiAssessment(token, body, { signal } = {}) {
  return requestJson('/api/ai/assessments', { method: 'POST', token, body, signal });
}

export async function getApiHealth({ signal } = {}) {
  return requestJson('/api/health', { signal });
}

export async function getTransactions(token, { signal } = {}) {
  const result = await requestJson('/api/transactions', { token, signal });
  return result.transactions;
}

export async function getTransaction(transactionId, token, { signal } = {}) {
  const result = await requestJson(`/api/transactions/${encodeURIComponent(transactionId)}`, { token, signal });
  return result.transaction;
}

export async function getPaymentStatus(transactionId, token, { signal } = {}) {
  return requestJson(`/api/transactions/${encodeURIComponent(transactionId)}/payment-status`, { token, signal });
}

export async function createPayPalOrder(transactionId, token, expectedVersion) {
  return requestJson(`/api/transactions/${encodeURIComponent(transactionId)}/paypal/order`, {
    method: 'POST', token, body: { expectedVersion },
  });
}

export async function authorizePayPalOrder(transactionId, token, expectedVersion) {
  return requestJson(`/api/transactions/${encodeURIComponent(transactionId)}/paypal/authorize`, {
    method: 'POST', token, body: { expectedVersion },
  });
}

export async function reconcilePayPalPayment(transactionId, token) {
  return requestJson(`/api/transactions/${encodeURIComponent(transactionId)}/paypal/reconcile`, {
    method: 'POST', token,
  });
}
