import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { CURRENCY_MINOR_UNITS } from '../src/domain/mandate/currencies.js';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = resolve(SCRIPT_DIR, '..');
const SANDBOX_API = 'https://api-m.sandbox.paypal.com';
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

function parseAmountMinor(currency) {
  const configured = process.env.PAYPAL_SMOKE_AMOUNT_MINOR ?? '100';
  if (!/^\d+$/.test(configured)) throw new Error('PAYPAL_SMOKE_AMOUNT_MINOR must be a positive integer.');
  const amountMinor = Number(configured);
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    throw new Error('PAYPAL_SMOKE_AMOUNT_MINOR must be a positive safe integer.');
  }
  return amountMinor;
}

function formatMinorUnits(amountMinor, currency) {
  const exponent = CURRENCY_MINOR_UNITS[currency];
  if (!Number.isInteger(exponent)) throw new Error(`Currency ${currency} has no configured minor-unit exponent.`);
  if (exponent === 0) return String(amountMinor);
  const divisor = 10 ** exponent;
  const whole = Math.floor(amountMinor / divisor);
  const fraction = String(amountMinor % divisor).padStart(exponent, '0');
  return `${whole}.${fraction}`;
}

function createTokenProvider({ clientId, clientSecret, fetchImpl = fetch, now = Date.now }) {
  let cachedToken;
  return async function getAccessToken() {
    if (cachedToken && now() < cachedToken.usableUntil) return cachedToken.value;

    const credentials = Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64');
    let response;
    try {
      response = await fetchImpl(`${SANDBOX_API}/v1/oauth2/token`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: 'grant_type=client_credentials',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      const networkCode = error?.cause?.code || error?.cause?.name || error?.name || 'UNKNOWN_NETWORK_ERROR';
      throw new Error(`PayPal OAuth request failed before a response was received (${networkCode}); check connectivity. No access token was received.`);
    }

    const body = await response.json().catch(() => ({}));
    console.log(`OAuth HTTP status: ${response.status}`);
    if (!response.ok) {
      const message = body.error_description || body.message || body.error || 'PayPal rejected the OAuth request.';
      throw new Error(`PayPal OAuth failed: ${redact(message, [clientId, clientSecret, body.access_token])}`);
    }

    if (typeof body.access_token !== 'string' || !body.access_token || !Number.isSafeInteger(body.expires_in) || body.expires_in * 1000 <= TOKEN_SAFETY_MARGIN_MS) {
      throw new Error('PayPal OAuth response was incomplete or had an unsafe token lifetime.');
    }
    const expiresAt = now() + body.expires_in * 1000;
    cachedToken = { value: body.access_token, expiresAt, usableUntil: expiresAt - TOKEN_SAFETY_MARGIN_MS };
    console.log('OAuth authentication succeeded; access token is held in memory and was not printed.');
    return cachedToken.value;
  };
}

async function createSandboxOrder({ accessToken, currency, value, returnUrl, cancelUrl, fetchImpl = fetch, clientId, clientSecret }) {
  let response;
  try {
    response = await fetchImpl(`${SANDBOX_API}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'PayPal-Request-Id': randomUUID(),
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        intent: 'AUTHORIZE',
        purchase_units: [{
          reference_id: 'SAFE-MANDATE-STAGE-0',
          description: 'Safe Mandate Sandbox connectivity verification',
          amount: { currency_code: currency, value },
        }],
        payment_source: {
          paypal: {
            experience_context: {
              brand_name: 'Safe Mandate',
              user_action: 'PAY_NOW',
              shipping_preference: 'NO_SHIPPING',
              return_url: returnUrl,
              cancel_url: cancelUrl,
            },
          },
        },
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const networkCode = error?.cause?.code || error?.cause?.name || error?.name || 'UNKNOWN_NETWORK_ERROR';
    throw new Error(`PayPal order request failed before a response was received (${networkCode}). Its outcome is unknown; do not rerun immediately because PayPal may have created the order.`);
  }

  const body = await response.json().catch(() => ({}));
  console.log(`Order creation HTTP status: ${response.status}`);
  if (!response.ok) {
    const issue = body.details?.[0]?.issue || body.name || 'UNKNOWN_ERROR';
    const description = body.details?.[0]?.description || body.message || body.message_to_payer || 'PayPal rejected the order request.';
    throw new Error(`PayPal order creation failed (${redact(issue, [clientId, clientSecret, accessToken])}): ${redact(description, [clientId, clientSecret, accessToken])}`);
  }

  const approval = body.links?.find((link) => ['approve', 'payer-action'].includes(link.rel));
  if (typeof body.id !== 'string' || !approval?.href) {
    throw new Error('PayPal returned a successful response without an order ID or buyer approval link. No further payment operation was attempted.');
  }
  const approvalUrl = new URL(approval.href);
  if (approvalUrl.protocol !== 'https:' || !(approvalUrl.hostname === 'paypal.com' || approvalUrl.hostname.endsWith('.paypal.com'))) {
    throw new Error('PayPal returned an approval link outside the verified HTTPS PayPal domain; refusing to display it.');
  }

  return { id: body.id, status: body.status ?? 'not provided', approvalUrl: approvalUrl.href, httpStatus: response.status };
}

async function main() {
  loadLocalEnvironment();
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in server/.env.');

  const configuredBase = process.env.PAYPAL_BASE_URL;
  if (configuredBase !== SANDBOX_API) throw new Error('PAYPAL_BASE_URL must exactly match the PayPal Sandbox API host. No request was sent.');

  const currency = (process.env.PAYPAL_SMOKE_CURRENCY || 'USD').toUpperCase();
  if (!Object.hasOwn(CURRENCY_MINOR_UNITS, currency)) {
    throw new Error(`Currency ${currency} is not in Safe Mandate's supported currency list. Set PAYPAL_SMOKE_CURRENCY to a supported Sandbox currency.`);
  }
  const amountMinor = parseAmountMinor(currency);
  const value = formatMinorUnits(amountMinor, currency);
  const returnUrl = process.env.PAYPAL_RETURN_URL || 'http://127.0.0.1:5173/paypal/return';
  const cancelUrl = process.env.PAYPAL_CANCEL_URL || 'http://127.0.0.1:5173/paypal/cancel';
  for (const [name, value] of [['PAYPAL_RETURN_URL', returnUrl], ['PAYPAL_CANCEL_URL', cancelUrl]]) {
    let url;
    try { url = new URL(value); } catch { throw new Error(`${name} must be a valid URL.`); }
    const isLocalHttp = url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname);
    if (url.protocol !== 'https:' && !isLocalHttp) throw new Error(`${name} must use HTTPS, except for localhost development URLs.`);
  }
  console.log(`Sandbox currency selected: ${currency}; amount: ${value}. PayPal order acceptance will confirm whether this merchant accepts it.`);

  const getAccessToken = createTokenProvider({ clientId, clientSecret });
  const accessToken = await getAccessToken();
  const order = await createSandboxOrder({ accessToken, currency, value, returnUrl, cancelUrl, clientId, clientSecret });
  console.log(`Provider order status: ${order.status}`);
  console.log(`PayPal order ID: ${order.id}`);
  console.log(`Buyer approval URL: ${order.approvalUrl}`);
  console.log('Stopped after order creation. No authorization, capture, or void was requested.');
}

main().catch((error) => {
  console.error(`PayPal Sandbox smoke test stopped: ${error.message}`);
  process.exitCode = 1;
});
