import { CURRENCY_MINOR_UNITS } from '../data/currencyMeta.js';

export const PAYPAL_V6_SANDBOX_SCRIPT = 'https://www.sandbox.paypal.com/web-sdk/v6/core';
const scriptLoads = new WeakMap();
const sdkInstances = new WeakMap();
const eligibilityCache = new WeakMap();
const sdkCheckoutsInFlight = new Set();
const SCRIPT_LOAD_TIMEOUT_MS = 20_000;

export class PayPalSdkError extends Error {
  constructor(code, message) { super(message); this.name = 'PayPalSdkError'; this.code = code; }
}

export function formatPayPalEligibilityAmount(amountMinor, currency) {
  const places = CURRENCY_MINOR_UNITS[currency];
  if (!Number.isInteger(places) || !Number.isSafeInteger(amountMinor) || amountMinor <= 0) return null;
  if (!places) return String(amountMinor);
  const scale = 10 ** places;
  return `${Math.floor(amountMinor / scale)}.${String(amountMinor % scale).padStart(places, '0')}`;
}

function loadScript(windowObject, documentObject, timeoutMs) {
  if (windowObject.paypal?.createInstance) return Promise.resolve();
  if (scriptLoads.has(windowObject)) return scriptLoads.get(windowObject);
  const scriptPromise = new Promise((resolve, reject) => {
    const existing = documentObject.querySelector?.('script[data-safe-mandate-paypal-v6="true"]');
    const script = existing ?? documentObject.createElement('script');
    let timeout;
    const cleanup = () => {
      clearTimeout(timeout);
      script.removeEventListener?.('load', loaded);
      script.removeEventListener?.('error', failed);
    };
    const fail = (message) => {
      cleanup();
      script.remove?.();
      reject(new PayPalSdkError('PAYPAL_SDK_UNAVAILABLE', message));
    };
    const loaded = () => {
      if (windowObject.paypal?.createInstance) {
        cleanup();
        resolve();
      } else fail('PayPal checkout could not be initialized.');
    };
    const failed = () => fail('PayPal checkout could not be loaded.');
    script.addEventListener('load', loaded, { once: true });
    script.addEventListener('error', failed, { once: true });
    timeout = setTimeout(() => fail('PayPal checkout loading timed out. Refresh the page and try again.'), timeoutMs);
    if (!existing) {
      script.src = PAYPAL_V6_SANDBOX_SCRIPT;
      script.async = true;
      script.dataset.safeMandatePaypalV6 = 'true';
      const parent = documentObject.head ?? documentObject.body;
      if (!parent) { fail('PayPal checkout could not be loaded.'); return; }
      parent.appendChild(script);
    }
  }).catch((error) => {
    scriptLoads.delete(windowObject);
    throw error;
  });
  scriptLoads.set(windowObject, scriptPromise);
  return scriptPromise;
}

export async function loadPayPalSdkV6({ clientId = import.meta.env?.VITE_PAYPAL_CLIENT_ID, windowObject = globalThis.window, documentObject = globalThis.document, scriptLoadTimeoutMs = SCRIPT_LOAD_TIMEOUT_MS } = {}) {
  if (typeof clientId !== 'string' || !clientId.trim()) throw new PayPalSdkError('PAYPAL_SDK_NOT_CONFIGURED', 'PayPal Sandbox checkout is not configured for this frontend.');
  if (!windowObject || !documentObject) throw new PayPalSdkError('PAYPAL_SDK_UNAVAILABLE', 'PayPal checkout is unavailable in this browser.');
  if (typeof documentObject.createElement !== 'function' || typeof Promise !== 'function') {
    throw new PayPalSdkError('PAYPAL_BROWSER_UNSUPPORTED', 'This browser is not supported for PayPal checkout.');
  }
  const cached = sdkInstances.get(windowObject);
  if (cached?.clientId === clientId) return cached.promise;
  const entry = { clientId, promise: null };
  entry.promise = loadScript(windowObject, documentObject, scriptLoadTimeoutMs).then(() => windowObject.paypal.createInstance({
    clientId,
    components: ['paypal-payments'],
    pageType: 'checkout',
  })).catch((error) => {
    if (sdkInstances.get(windowObject) === entry) sdkInstances.delete(windowObject);
    throw error instanceof PayPalSdkError ? error : new PayPalSdkError('PAYPAL_SDK_UNAVAILABLE', 'PayPal checkout could not be initialized.');
  });
  sdkInstances.set(windowObject, entry);
  return entry.promise;
}

export async function findPayPalEligibility(sdkInstance, transaction, countryCode = import.meta.env?.VITE_PAYPAL_COUNTRY_CODE) {
  const amount = formatPayPalEligibilityAmount(transaction?.amountMinor, transaction?.currency);
  if (!amount || typeof transaction?.currency !== 'string') return false;
  const normalizedCountry = typeof countryCode === 'string' && /^[A-Za-z]{2}$/.test(countryCode.trim())
    ? countryCode.trim().toUpperCase()
    : undefined;
  let cache = eligibilityCache.get(sdkInstance);
  if (!cache) { cache = new Map(); eligibilityCache.set(sdkInstance, cache); }
  const key = `${normalizedCountry ?? 'auto'}:${transaction.currency}:${amount}`;
  if (!cache.has(key)) {
    const input = { currencyCode: transaction.currency, amount };
    if (normalizedCountry) input.countryCode = normalizedCountry;
    const request = Promise.resolve().then(() => sdkInstance.findEligibleMethods(input));
    cache.set(key, request);
    request.catch(() => { if (cache.get(key) === request) cache.delete(key); });
  }
  const methods = await cache.get(key);
  return methods.isEligible('paypal') === true;
}

export function createPayPalAuthorizationSession(sdkInstance, callbacks) {
  return sdkInstance.createPayPalOneTimePaymentSession({
    onApprove: callbacks.onApprove,
    onCancel: callbacks.onCancel,
    onError: callbacks.onError,
  });
}

export async function requestPayPalSdkOrder({ transactionId, token, expectedVersion, createOrder, onUnresolved = () => {} }) {
  const response = await createOrder(transactionId, token, expectedVersion);
  const operation = response?.operation;
  if (operation?.kind !== 'CREATE_ORDER' || operation.status !== 'COMPLETED'
    || !['CREATED', 'PAYER_ACTION_REQUIRED'].includes(operation.providerStatus)
    || typeof operation.providerResourceId !== 'string' || !operation.providerResourceId) {
    onUnresolved(operation ?? null);
    throw new PayPalSdkError('PAYMENT_OUTCOME_UNKNOWN', 'PayPal order result is unresolved. Reconcile before retrying.');
  }
  return { orderId: operation.providerResourceId };
}

export function claimPayPalCheckout(transactionId) {
  if (typeof transactionId !== 'string' || !transactionId || sdkCheckoutsInFlight.has(transactionId)) return false;
  sdkCheckoutsInFlight.add(transactionId);
  return true;
}

export function releasePayPalCheckout(transactionId) {
  if (typeof transactionId === 'string') sdkCheckoutsInFlight.delete(transactionId);
}

export async function startPayPalPopupSession({ transactionId, paymentSession, orderPromise, onFallback = () => {}, lockClaimed = false }) {
  if (!transactionId || !paymentSession || typeof paymentSession.start !== 'function' || !orderPromise) throw new TypeError('A transaction, PayPal payment session, and server order promise are required.');
  if (lockClaimed ? !sdkCheckoutsInFlight.has(transactionId) : !claimPayPalCheckout(transactionId)) return { kind: 'in-progress' };
  let started = false;
  try {
    await paymentSession.start({ presentationMode: 'popup' }, orderPromise);
    started = true;
    return { kind: 'completed', presentation: 'popup' };
  } catch (error) {
    if (error?.code !== 'ERR_DEV_UNABLE_TO_OPEN_POPUP' && error?.isRecoverable !== true) throw error;
    onFallback();
    await paymentSession.start({ presentationMode: 'modal' }, orderPromise);
    started = true;
    return { kind: 'completed', presentation: 'modal-fallback' };
  } finally {
    // A mounted checkout keeps its lock until an SDK lifecycle callback finishes;
    // start() may resolve as soon as a popup has opened in some browsers.
    if (!lockClaimed || !started) releasePayPalCheckout(transactionId);
  }
}
