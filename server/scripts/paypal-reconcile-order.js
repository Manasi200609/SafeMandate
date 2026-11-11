import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const SERVER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SANDBOX_API = 'https://api-m.sandbox.paypal.com';
const ORDER_ID = '0WL94673UD5470001';
const TOKEN_SAFETY_MARGIN_MS = 60_000;
const REQUEST_TIMEOUT_MS = 30_000;

function loadLocalEnvironment() {
  try {
    process.loadEnvFile(resolve(SERVER_DIR, '.env'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('Could not load server/.env securely.');
  }
}

function redact(value, secrets) {
  let safe = String(value ?? '');
  for (const secret of secrets) {
    if (secret) safe = safe.split(secret).join('[redacted]');
  }
  return safe
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/Basic\s+\S+/gi, 'Basic [redacted]')
    .replace(/(client_secret|access_token|refresh_token|authorization)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]');
}

async function getAccessToken({ clientId, clientSecret }) {
  let response;
  try {
    response = await fetch(`${SANDBOX_API}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const code = error?.cause?.code || error?.cause?.name || error?.name || 'UNKNOWN_NETWORK_ERROR';
    throw new Error(`PayPal Sandbox OAuth failed before an HTTP response (${code}).`);
  }

  console.log(`OAuth HTTP status: ${response.status}`);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const providerMessage = body.error_description || body.message || body.error || 'PayPal rejected OAuth.';
    throw new Error(`PayPal Sandbox OAuth failed: ${redact(providerMessage, [clientId, clientSecret, body.access_token])}`);
  }
  if (typeof body.access_token !== 'string' || !body.access_token || !Number.isSafeInteger(body.expires_in) || body.expires_in * 1000 <= TOKEN_SAFETY_MARGIN_MS) {
    throw new Error('PayPal OAuth response had no usable token or an unsafe token lifetime.');
  }
  const usableUntil = Date.now() + body.expires_in * 1000 - TOKEN_SAFETY_MARGIN_MS;
  if (Date.now() >= usableUntil) throw new Error('PayPal OAuth token is too close to expiry for a safe request.');
  console.log('OAuth succeeded; access token remains in memory and was not printed.');
  return body.access_token;
}

function summarizeOrder(order) {
  return {
    id: order.id,
    status: order.status,
    intent: order.intent,
    create_time: order.create_time,
    update_time: order.update_time,
    purchase_units: (order.purchase_units || []).map((unit) => ({
      reference_id: unit.reference_id,
      description: unit.description,
      amount: unit.amount,
      payee_merchant_id: unit.payee?.merchant_id,
      items: (unit.items || []).map((item) => ({
        name: item.name,
        quantity: item.quantity,
        unit_amount: item.unit_amount,
        tax: item.tax,
      })),
      authorizations: (unit.payments?.authorizations || []).map((payment) => ({
        id: payment.id,
        status: payment.status,
        amount: payment.amount,
        expiration_time: payment.expiration_time,
      })),
      captures: (unit.payments?.captures || []).map((payment) => ({
        id: payment.id,
        status: payment.status,
        amount: payment.amount,
      })),
    })),
  };
}

async function main() {
  loadLocalEnvironment();
  const clientId = process.env.PAYPAL_ORIGINAL_CLIENT_ID || process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_ORIGINAL_CLIENT_SECRET || process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('Configure the confirmed original app credentials in server/.env.');
  if (process.env.PAYPAL_BASE_URL !== SANDBOX_API) throw new Error('PAYPAL_BASE_URL must exactly match the Sandbox API host. No request was sent.');

  const accessToken = await getAccessToken({ clientId, clientSecret });
  let response;
  try {
    response = await fetch(`${SANDBOX_API}/v2/checkout/orders/${encodeURIComponent(ORDER_ID)}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const code = error?.cause?.code || error?.cause?.name || error?.name || 'UNKNOWN_NETWORK_ERROR';
    throw new Error(`PayPal order lookup failed before an HTTP response (${code}). No payment mutation was sent.`);
  }

  console.log(`Order lookup HTTP status: ${response.status}`);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.log(JSON.stringify({
      provider_error: body.name,
      message: redact(body.message, [clientId, clientSecret, accessToken]),
      debug_id: body.debug_id,
      details: (body.details || []).map((detail) => ({ issue: detail.issue, description: redact(detail.description, [clientId, clientSecret, accessToken]) })),
    }));
    return;
  }

  console.log(`PayPal order response: ${JSON.stringify(summarizeOrder(body))}`);
}

main().catch((error) => {
  console.error(`Read-only PayPal reconciliation stopped: ${error.message}`);
  process.exitCode = 1;
});
