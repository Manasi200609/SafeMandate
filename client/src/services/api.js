const API_ORIGIN = import.meta.env.VITE_API_ORIGIN || '';

export class ApiRequestError extends Error {
  constructor({ status, code, message }) {
    super(message || 'The Safe Mandate API request failed.');
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code || 'API_REQUEST_FAILED';
  }
}

async function requestJson(path, { method = 'GET', token, body, signal } = {}) {
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
  const response = await fetch(`${API_ORIGIN}/api/health`, { signal, headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('Safe Mandate API health check failed.');
  return response.json();
}
