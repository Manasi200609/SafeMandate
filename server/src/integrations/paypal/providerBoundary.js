import { CURRENCY_MINOR_UNITS } from '../../domain/mandate/currencies.js';

export const PAYPAL_ENVIRONMENT = 'sandbox';

export class PayPalMutationDisabledError extends Error {
  constructor(operation) {
    super(`PayPal ${operation} is disabled until the controlled integration phase authorizes payment mutations.`);
    this.name = 'PayPalMutationDisabledError';
    this.code = 'PAYPAL_MUTATIONS_DISABLED';
    this.operation = operation;
  }
}

/** Converts integer minor units to the decimal string PayPal expects. */
export function formatMinorUnitsAsDecimal(amountMinor, currency) {
  const exponent = CURRENCY_MINOR_UNITS[currency];
  if (!Number.isInteger(exponent)) throw new TypeError(`Currency ${currency} has no supported minor-unit exponent.`);
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    throw new TypeError('amountMinor must be a positive safe integer.');
  }
  if (exponent === 0) return String(amountMinor);
  const divisor = 10 ** exponent;
  return `${Math.floor(amountMinor / divisor)}.${String(amountMinor % divisor).padStart(exponent, '0')}`;
}

/**
 * Pure mapping from an authoritative transaction aggregate to a PayPal
 * AUTHORIZE order draft. This performs no network request and no payment
 * mutation; it exists so the phase-2 adapter has one reviewed mapping.
 */
export function buildOrderDraft({ transaction, returnUrl, cancelUrl, merchantId } = {}) {
  if (!transaction || typeof transaction !== 'object') throw new TypeError('A transaction aggregate is required.');
  const { proposal, transactionId } = transaction;
  if (!proposal || typeof proposal !== 'object') throw new TypeError('A transaction proposal is required.');
  if (typeof transactionId !== 'string' || !transactionId.trim()) throw new TypeError('A transactionId is required.');
  if (typeof merchantId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(merchantId)) {
    throw new TypeError('A configured PayPal Sandbox merchant ID is required.');
  }
  for (const [name, value] of [['returnUrl', returnUrl], ['cancelUrl', cancelUrl]]) {
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      throw new TypeError(`${name} must be a valid URL.`);
    }
    const isLocalHttp = parsed.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(parsed.hostname);
    if (parsed.protocol !== 'https:' && !isLocalHttp) throw new TypeError(`${name} must use HTTPS.`);
  }

  return Object.freeze({
    intent: 'AUTHORIZE',
    purchase_units: [
      {
        reference_id: transactionId,
        payee: { merchant_id: merchantId },
        description: String(proposal.itemName ?? 'Safe Mandate purchase').slice(0, 127),
        amount: {
          currency_code: proposal.currency,
          value: formatMinorUnitsAsDecimal(proposal.amountMinor, proposal.currency),
        },
      },
    ],
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
  });
}

/**
 * Phase-1 boundary for PayPal. Mutations and reads remain inert until a
 * reviewed transport and explicit integration-owner authorization exist.
 */
export function createPayPalAdapter({ transport = null, mutationsEnabled = false } = {}) {
  function requireTransport(operation) {
    if (!transport || typeof transport.request !== 'function') throw new PayPalMutationDisabledError(operation);
  }

  function requireMutations(operation) {
    if (!mutationsEnabled) throw new PayPalMutationDisabledError(operation);
    requireTransport(operation);
  }

  return Object.freeze({
    environment: PAYPAL_ENVIRONMENT,
    mutationsEnabled: Boolean(mutationsEnabled && transport),
    buildOrderDraft,
    async createOrder(draft, { requestId } = {}) {
      requireMutations('order creation');
      return transport.request('POST', '/v2/checkout/orders', draft, { requestId });
    },
    async getOrder(orderId) {
      requireTransport('order lookup');
      return transport.request('GET', `/v2/checkout/orders/${encodeURIComponent(orderId)}`);
    },
    async authorizeOrder(orderId, { requestId } = {}) {
      requireMutations('authorization');
      return transport.request('POST', `/v2/checkout/orders/${encodeURIComponent(orderId)}/authorize`, {}, { requestId });
    },
    async getAuthorization(authorizationId) {
      requireTransport('authorization lookup');
      return transport.request('GET', `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}`);
    },
    async getCapture(captureId) {
      requireTransport('capture lookup');
      return transport.request('GET', `/v2/payments/captures/${encodeURIComponent(captureId)}`);
    },
    async captureAuthorization(authorizationId, { requestId } = {}) {
      requireMutations('capture');
      return transport.request('POST', `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/capture`, {}, { requestId });
    },
    async voidAuthorization(authorizationId, { requestId } = {}) {
      requireMutations('void');
      return transport.request('POST', `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/void`, {}, { requestId });
    },
  });
}

/** Builds the persisted provider-reference projection for a transaction. */
export function buildProviderReference({ transactionId, provider, state, lastEventType, updatedAt }) {
  return Object.freeze({
    transactionId,
    environment: PAYPAL_ENVIRONMENT,
    orderId: provider?.orderId ?? null,
    authorizationId: provider?.authorizationId ?? null,
    captureId: provider?.captureId ?? null,
    voidId: provider?.voidId ?? null,
    lastEventType: lastEventType ?? null,
    transactionState: state ?? null,
    updatedAt,
  });
}
