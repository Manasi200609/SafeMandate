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

function isConfirmedAuthorization(payment, transaction) {
  const authorization = payment?.operations?.find((operation) => operation.kind === 'AUTHORIZE');
  return payment?.state === 'AUTHORIZED' && transaction?.state === 'AUTHORIZED'
    && typeof transaction?.provider?.authorizationId === 'string'
    && authorization?.status === 'COMPLETED'
    && authorization.providerStatus === 'CREATED'
    && authorization.providerResourceId === transaction.provider.authorizationId;
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
