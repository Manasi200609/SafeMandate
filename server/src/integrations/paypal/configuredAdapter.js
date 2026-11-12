import { createPayPalAdapter } from './providerBoundary.js';
import { createPayPalTransport, SANDBOX_BASE_URL } from './paypalTransport.js';

export class PayPalConfigurationError extends Error {
  constructor() {
    super('PayPal Sandbox payment configuration is incomplete or invalid.');
    this.name = 'PayPalConfigurationError';
    this.code = 'PAYPAL_NOT_CONFIGURED';
  }
}

/** Lazily configures a Sandbox adapter so missing credentials never block API startup. */
export function createConfiguredPayPalAdapterFactory({ env = () => process.env, fetchImpl } = {}) {
  let configured = null;
  return function getConfiguredPayPal() {
    if (configured) return configured;
    const values = env();
    const clientId = values.PAYPAL_CLIENT_ID;
    const clientSecret = values.PAYPAL_CLIENT_SECRET;
    const baseUrl = values.PAYPAL_BASE_URL || SANDBOX_BASE_URL;
    const merchantId = values.PAYPAL_MERCHANT_ID;
    const returnUrl = values.PAYPAL_RETURN_URL;
    const cancelUrl = values.PAYPAL_CANCEL_URL;
    if (!clientId || !clientSecret || !/^[A-Za-z0-9_-]{1,128}$/.test(merchantId ?? '')
      || !validCallbackUrl(returnUrl) || !validCallbackUrl(cancelUrl)) throw new PayPalConfigurationError();
    try {
      const transport = createPayPalTransport({ clientId, clientSecret, baseUrl, ...(fetchImpl ? { fetchImpl } : {}) });
      configured = Object.freeze({
        adapter: createPayPalAdapter({ transport, mutationsEnabled: true }),
        merchantId,
        returnUrl,
        cancelUrl,
      });
      return configured;
    } catch {
      throw new PayPalConfigurationError();
    }
  };
}

function validCallbackUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname));
  } catch {
    return false;
  }
}
