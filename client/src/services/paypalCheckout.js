import { canStartPayPalCheckout } from './transactionDraft.js';

export const PAYPAL_HANDOFF_KEY = 'safe-mandate-paypal-handoff';
const MAX_HANDOFF_AGE_MS = 8 * 60 * 60 * 1000;
const checkoutsInFlight = new Set();

export function isPayPalApprovalUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'paypal.com' || url.hostname.endsWith('.paypal.com'));
  } catch {
    return false;
  }
}

export function clearPayPalHandoff(storage = globalThis.sessionStorage) {
  try { storage?.removeItem(PAYPAL_HANDOFF_KEY); } catch { /* Storage can be unavailable in restricted browsing modes. */ }
}

function readPayPalHandoff(storage, now) {
  let raw;
  try { raw = storage?.getItem(PAYPAL_HANDOFF_KEY); } catch { return null; }
  if (!raw) return null;
  try {
    const handoff = JSON.parse(raw);
    if (typeof handoff?.transactionId !== 'string' || typeof handoff?.orderId !== 'string'
      || typeof handoff?.token !== 'string' || !Number.isFinite(handoff?.startedAt)
      || now - handoff.startedAt < 0 || now - handoff.startedAt > MAX_HANDOFF_AGE_MS) {
      clearPayPalHandoff(storage);
      return null;
    }
    return handoff;
  } catch {
    clearPayPalHandoff(storage);
    return null;
  }
}

export async function startPayPalCheckout({ transaction, token, createOrder, storage = globalThis.sessionStorage, navigate = (url) => window.location.assign(url), now = Date.now() }) {
  if (!transaction?.transactionId || !Number.isInteger(transaction.version) || !token) {
    throw new TypeError('A signed-in buyer and a persisted transaction version are required.');
  }
  const transactionId = transaction.transactionId;
  if (checkoutsInFlight.has(transactionId)) return { kind: 'in-progress' };
  checkoutsInFlight.add(transactionId);
  try {
    const result = await createOrder(transactionId, token, transaction.version);
    const operation = result?.operation;
    if (operation?.kind !== 'CREATE_ORDER' || operation.status !== 'COMPLETED'
      || typeof operation.providerResourceId !== 'string' || !isPayPalApprovalUrl(operation.approvalUrl)) {
      return { kind: 'unresolved', operation: operation ?? null };
    }

    const handoff = { transactionId, orderId: operation.providerResourceId, token, startedAt: now };
    try {
      storage?.setItem(PAYPAL_HANDOFF_KEY, JSON.stringify(handoff));
    } catch {
      throw new Error('This browser could not safely preserve the short-lived checkout session. No PayPal redirect was opened.');
    }
    navigate(operation.approvalUrl);
    return { kind: 'redirected', orderId: handoff.orderId };
  } finally {
    checkoutsInFlight.delete(transactionId);
  }
}

/** Resume a provider order already persisted by Safe Mandate; never creates another order. */
export function resumePayPalApproval({ transactionId, orderId, approvalUrl, token, storage = globalThis.sessionStorage, navigate = (url) => window.location.assign(url), now = Date.now() }) {
  if (typeof transactionId !== 'string' || !transactionId || typeof orderId !== 'string' || !orderId || !token || !isPayPalApprovalUrl(approvalUrl)) {
    throw new TypeError('A verified pending PayPal order and buyer session are required.');
  }
  try {
    storage?.setItem(PAYPAL_HANDOFF_KEY, JSON.stringify({ transactionId, orderId, token, startedAt: now }));
  } catch {
    throw new Error('This browser could not safely preserve the short-lived checkout session. PayPal was not opened.');
  }
  navigate(approvalUrl);
  return { kind: 'redirected', orderId };
}

export function isConfirmedAuthorization(payment, transaction) {
  const authorization = payment?.operations?.find((operation) => operation.kind === 'AUTHORIZE');
  return payment?.state === 'AUTHORIZED' && transaction?.state === 'AUTHORIZED'
    && typeof transaction?.provider?.authorizationId === 'string'
    && authorization?.status === 'COMPLETED'
    && authorization.providerStatus === 'CREATED'
    && authorization.providerResourceId === transaction.provider.authorizationId;
}

export function hasUnresolvedCheckoutOperation(payment) {
  return payment?.operations?.some((operation) => ['PENDING', 'UNKNOWN'].includes(operation.status)
    || (operation.kind === 'AUTHORIZE' && operation.status === 'COMPLETED')) === true;
}

export function hasFailedCheckoutOperation(payment) {
  return payment?.operations?.some((operation) => ['CREATE_ORDER', 'AUTHORIZE'].includes(operation.kind)
    && operation.status === 'FAILED') === true;
}

export function getPayPalCheckoutState(payment, transaction) {
  if (payment?.provider?.orderId !== transaction?.provider?.orderId) return 'unresolved';
  if (isConfirmedAuthorization(payment, transaction)) return 'authorized';
  if (hasUnresolvedCheckoutOperation(payment) || hasFailedCheckoutOperation(payment)) return 'unresolved';
  return canStartPayPalCheckout(transaction?.state) ? 'ready' : 'ineligible';
}

export async function verifyPayPalApproval({ orderId, transactionId, token, getPaymentStatus, getTransaction, authorize, reconcile }) {
  if (typeof orderId !== 'string' || !orderId || !transactionId || !token) return { kind: 'missing-order' };
  const [payment, transaction] = await Promise.all([
    getPaymentStatus(transactionId, token),
    getTransaction(transactionId, token),
  ]);
  if (payment?.provider?.orderId !== orderId || transaction?.provider?.orderId !== orderId) return { kind: 'order-mismatch' };
  if (isConfirmedAuthorization(payment, transaction)) return { kind: 'authorized', transactionId };
  if (payment.state !== 'PAYMENT_PENDING' || transaction.state !== 'PAYMENT_PENDING') return { kind: 'not-authorizable', state: transaction.state };

  try {
    const result = await authorize(transactionId, token, transaction.version);
    if (result?.operation?.kind === 'AUTHORIZE' && result.operation.status === 'COMPLETED'
      && result.operation.providerStatus === 'CREATED' && typeof result.operation.providerResourceId === 'string') {
      const confirmed = await fetchAuthorizationState({ transactionId, token, orderId, getPaymentStatus, getTransaction });
      if (confirmed) return { kind: 'authorized', transactionId };
    }
    if (!['PENDING', 'UNKNOWN'].includes(result?.operation?.status)) return { kind: 'unresolved', transactionId };
  } catch (error) {
    if (!['PAYMENT_OUTCOME_UNKNOWN', 'PAYPAL_STATUS_UNAVAILABLE', 'PAYPAL_RECONCILIATION_FAILED', 'API_UNAVAILABLE'].includes(error?.code)) throw error;
  }
  if (typeof reconcile === 'function') {
    await reconcile(transactionId, token);
    if (await fetchAuthorizationState({ transactionId, token, orderId, getPaymentStatus, getTransaction })) return { kind: 'authorized', transactionId };
  }
  return { kind: 'unresolved', transactionId };
}

async function fetchAuthorizationState({ transactionId, token, orderId, getPaymentStatus, getTransaction }) {
  const [payment, transaction] = await Promise.all([
    getPaymentStatus(transactionId, token),
    getTransaction(transactionId, token),
  ]);
  return payment?.provider?.orderId === orderId && transaction?.provider?.orderId === orderId
    && isConfirmedAuthorization(payment, transaction);
}

/** Read persisted provider state and reconcile only operations already marked pending or unknown. */
export async function recoverPayPalSdkError({ transactionId, token, getPaymentStatus, getTransaction, reconcile }) {
  const payment = await getPaymentStatus(transactionId, token);
  const hasAmbiguousOperation = payment?.operations?.some((operation) => ['PENDING', 'UNKNOWN'].includes(operation.status));
  if (hasAmbiguousOperation) await reconcile(transactionId, token);
  const [freshPayment, transaction] = await Promise.all([
    getPaymentStatus(transactionId, token),
    getTransaction(transactionId, token),
  ]);
  if (freshPayment?.provider?.orderId !== transaction?.provider?.orderId) return { kind: 'order-mismatch' };
  const checkoutState = getPayPalCheckoutState(freshPayment, transaction);
  return checkoutState === 'authorized'
    ? { kind: 'authorized', transactionId }
    : checkoutState === 'unresolved' ? { kind: 'unresolved', transactionId }
      : { kind: 'not-authorized', state: transaction?.state };
}

export async function verifyPayPalReturn({ search, storage = globalThis.sessionStorage, getPaymentStatus, getTransaction, authorize, now = Date.now() }) {
  const params = new URLSearchParams(search);
  if (params.has('error')) return { kind: 'provider-error' };
  const returnedOrderId = params.get('token');
  if (!returnedOrderId) return { kind: 'missing-order' };
  const handoff = readPayPalHandoff(storage, now);
  if (!handoff) return { kind: 'missing-session' };
  if (returnedOrderId !== handoff.orderId) return { kind: 'order-mismatch' };

  const payment = await getPaymentStatus(handoff.transactionId, handoff.token);
  if (payment?.provider?.orderId !== returnedOrderId) return { kind: 'order-mismatch' };
  const transaction = await getTransaction(handoff.transactionId, handoff.token);
  if (transaction?.provider?.orderId !== returnedOrderId) return { kind: 'order-mismatch' };
  if (isConfirmedAuthorization(payment, transaction)) return { kind: 'authorized', transactionId: handoff.transactionId };
  if (payment.state !== 'PAYMENT_PENDING' || transaction.state !== 'PAYMENT_PENDING') {
    return { kind: 'not-authorizable', state: payment.state };
  }

  const result = await authorize(handoff.transactionId, handoff.token, transaction.version);
  if (result?.operation?.kind !== 'AUTHORIZE' || result.operation.status !== 'COMPLETED'
    || result.operation.providerStatus !== 'CREATED' || typeof result.operation.providerResourceId !== 'string') {
    return { kind: 'unresolved', transactionId: handoff.transactionId };
  }

  const [freshPayment, freshTransaction] = await Promise.all([
    getPaymentStatus(handoff.transactionId, handoff.token),
    getTransaction(handoff.transactionId, handoff.token),
  ]);
  if (!isConfirmedAuthorization(freshPayment, freshTransaction)) return { kind: 'unresolved', transactionId: handoff.transactionId };
  return { kind: 'authorized', transactionId: handoff.transactionId };
}

export async function reconcilePayPalReturn({ storage = globalThis.sessionStorage, reconcile, getPaymentStatus, getTransaction }) {
  const handoff = readPayPalHandoff(storage, Date.now());
  if (!handoff) return { kind: 'missing-session' };
  await reconcile(handoff.transactionId, handoff.token);
  const [payment, transaction] = await Promise.all([
    getPaymentStatus(handoff.transactionId, handoff.token),
    getTransaction(handoff.transactionId, handoff.token),
  ]);
  if (payment?.provider?.orderId !== handoff.orderId || transaction?.provider?.orderId !== handoff.orderId) return { kind: 'order-mismatch' };
  return isConfirmedAuthorization(payment, transaction)
    ? { kind: 'authorized', transactionId: handoff.transactionId }
    : { kind: 'unresolved', transactionId: handoff.transactionId };
}
