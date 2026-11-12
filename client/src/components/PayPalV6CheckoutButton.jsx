import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, LoaderCircle } from 'lucide-react';
import { authorizePayPalOrder, createPayPalOrder, getPaymentStatus, getTransaction, reconcilePayPalPayment } from '../services/api.js';
import { canStartPayPalCheckout } from '../services/transactionDraft.js';
import { getPayPalCheckoutState, recoverPayPalSdkError, resumePayPalApproval, verifyPayPalApproval } from '../services/paypalCheckout.js';
import { claimPayPalCheckout, createPayPalAuthorizationSession, findPayPalEligibility, loadPayPalSdkV6, PayPalSdkError, releasePayPalCheckout, requestPayPalSdkOrder, startPayPalPopupSession } from '../services/paypalSdkV6.js';
import { money } from '../services/format.js';
import './PayPalV6CheckoutButton.css';

const messagesByState = {
  'sdk-missing': 'paypalV6.notConfigured',
  'sdk-error': 'paypalV6.unavailable',
  ineligible: 'paypalV6.ineligible',
  'eligibility-warning': 'paypalV6.eligibilityWarning',
  'approval-required': 'paypalV6.approvalRequired',
  starting: 'paypalV6.starting',
  authorizing: 'paypalV6.verifying',
  fallback: 'paypalV6.popupFallback',
  cancelled: 'paypalV6.cancelled',
  authorized: 'paypalV6.authorized',
  unresolved: 'paypalV6.unresolved',
  error: 'paypalV6.error',
};

function checkoutStatus(payment, latestTransaction) {
  return getPayPalCheckoutState(payment, latestTransaction);
}

export default function PayPalV6CheckoutButton({ transaction, token, onRefresh, t }) {
  const buttonRef = useRef(null);
  const createdOrderId = useRef('');
  const locked = useRef(false);
  const approvalInFlight = useRef(null);
  const [session, setSession] = useState(null);
  const [eligible, setEligible] = useState(false);
  const [canCheckout, setCanCheckout] = useState(false);
  const [existingApprovalUrl, setExistingApprovalUrl] = useState('');
  const [state, setState] = useState('loading');
  const [reconciling, setReconciling] = useState(false);

  useEffect(() => {
    let active = true;
    setState('loading'); setEligible(false); setCanCheckout(false); setSession(null); setExistingApprovalUrl(''); createdOrderId.current = '';
    Promise.all([loadPayPalSdkV6(), getPaymentStatus(transaction.transactionId, token), getTransaction(transaction.transactionId, token)])
      .then(async ([sdk, payment, latestTransaction]) => {
        if (!active) return;
        if (latestTransaction?.transactionId !== transaction.transactionId) {
          setState('unresolved');
          return;
        }
        const status = checkoutStatus(payment, latestTransaction);
        if (status === 'authorized') { setState('authorized'); return; }
        if (latestTransaction.state === 'PAYMENT_PENDING'
          && payment?.provider?.orderId
          && payment.provider.orderId === latestTransaction.provider?.orderId) {
          const orderOperation = payment.operations?.find((operation) => operation.kind === 'CREATE_ORDER'
            && operation.status === 'COMPLETED' && operation.providerResourceId === payment.provider.orderId);
          if (orderOperation?.approvalUrl) {
            setExistingApprovalUrl(orderOperation.approvalUrl);
            setState('approval-required');
            return;
          }
        }
        if (status !== 'ready') { setState(status); return; }
        const allowed = await findPayPalEligibility(sdk, latestTransaction);
        if (!active) return;
        const paymentSession = createPayPalAuthorizationSession(sdk, {
          onApprove: (data = {}) => {
            if (approvalInFlight.current) return approvalInFlight.current;
            const approval = (async () => {
              try {
                setState('authorizing'); setCanCheckout(false);
                const { orderId } = data;
                if (!orderId || orderId !== createdOrderId.current) { setState('unresolved'); return; }
                try {
                  const result = await verifyPayPalApproval({
                    orderId,
                    transactionId: transaction.transactionId,
                    token,
                    getPaymentStatus,
                    getTransaction,
                    authorize: authorizePayPalOrder,
                    reconcile: reconcilePayPalPayment,
                  });
                  if (result.kind === 'authorized') setState('authorized');
                  else if (result.kind === 'not-authorizable') setState('error');
                  else setState('unresolved');
                } catch (error) {
                  if (['PAYMENT_OUTCOME_UNKNOWN', 'PAYPAL_STATUS_UNAVAILABLE', 'PAYPAL_RECONCILIATION_FAILED', 'API_UNAVAILABLE'].includes(error?.code)) {
                    setState('unresolved');
                    try {
                      const recovered = await recoverPayPalSdkError({ transactionId: transaction.transactionId, token, getPaymentStatus, getTransaction, reconcile: reconcilePayPalPayment });
                      setState(recovered.kind === 'authorized' ? 'authorized' : 'unresolved');
                    } catch { /* provider state remains unresolved; no new mutation is attempted */ }
                  } else setState('error');
                }
              } finally {
                releasePayPalCheckout(transaction.transactionId);
                await onRefresh().catch(() => {});
              }
            })();
            approvalInFlight.current = approval.finally(() => { approvalInFlight.current = null; });
            return approvalInFlight.current;
          },
          onCancel: async () => {
            setState('cancelled'); setCanCheckout(false);
            try {
              const [paymentStatus, currentTransaction] = await Promise.all([
                getPaymentStatus(transaction.transactionId, token),
                getTransaction(transaction.transactionId, token),
              ]);
              const statusNow = checkoutStatus(paymentStatus, currentTransaction);
              setState(statusNow === 'authorized' ? 'authorized' : statusNow === 'ready' ? 'cancelled' : statusNow);
              setCanCheckout(statusNow === 'ready');
            } catch { setState('unresolved'); }
            finally { releasePayPalCheckout(transaction.transactionId); await onRefresh().catch(() => {}); }
          },
          onError: async (providerError) => {
            if (providerError?.code === 'ERR_DEV_UNABLE_TO_OPEN_POPUP' || providerError?.isRecoverable === true) {
              setState('fallback');
              return;
            }
            setState('error'); setCanCheckout(false);
            try {
              const [paymentStatus, currentTransaction] = await Promise.all([
                getPaymentStatus(transaction.transactionId, token),
                getTransaction(transaction.transactionId, token),
              ]);
              const statusNow = checkoutStatus(paymentStatus, currentTransaction);
              setState(statusNow === 'ready' ? 'error' : statusNow);
              setCanCheckout(statusNow === 'ready');
            } catch { setState('unresolved'); }
            finally { releasePayPalCheckout(transaction.transactionId); await onRefresh().catch(() => {}); }
          },
        });
        setSession(paymentSession);
        setEligible(true);
        setCanCheckout(true);
        // SDK eligibility is advisory. The authenticated backend remains authoritative
        // and validates the persisted transaction before it creates any PayPal order.
        setState(allowed ? 'ready' : 'eligibility-warning');
      }).catch((error) => {
        if (!active) return;
        setEligible(false); setCanCheckout(false);
        setState(error instanceof PayPalSdkError && error.code === 'PAYPAL_SDK_NOT_CONFIGURED' ? 'sdk-missing' : 'sdk-error');
      });
    return () => { active = false; };
  }, [transaction.transactionId, transaction.version, transaction.currency, transaction.amountMinor, token, onRefresh]);

  useEffect(() => {
    const button = buttonRef.current;
    if (!button || !eligible || !canCheckout || !session || !['ready', 'cancelled', 'error', 'eligibility-warning'].includes(state)) return undefined;
    const start = (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (locked.current || !claimPayPalCheckout(transaction.transactionId)) return;
      locked.current = true;
      createdOrderId.current = '';
      setCanCheckout(false);
      setState('starting');
      // Start the PayPal session synchronously in this click task. Do not await order creation first.
      const orderPromise = requestPayPalSdkOrder({
        transactionId: transaction.transactionId,
        token,
        expectedVersion: transaction.version,
        createOrder: createPayPalOrder,
        onUnresolved: () => setState('unresolved'),
      }).then((order) => { createdOrderId.current = order.orderId; return order; });
      startPayPalPopupSession({
        transactionId: transaction.transactionId,
        paymentSession: session,
        orderPromise,
        lockClaimed: true,
        onFallback: () => setState('fallback'),
      }).then(() => {
        setState((current) => current === 'starting' || current === 'fallback' ? 'unresolved' : current);
      }).catch(async (error) => {
        if (error?.code === 'PAYMENT_OUTCOME_UNKNOWN') {
          setState('unresolved');
          try {
            const recovered = await recoverPayPalSdkError({ transactionId: transaction.transactionId, token, getPaymentStatus, getTransaction, reconcile: reconcilePayPalPayment });
            if (recovered.kind === 'authorized') setState('authorized');
          } catch { /* remain blocked until provider state is reconciled */ }
        } else {
          setState('error');
          try {
            const [paymentStatus, currentTransaction] = await Promise.all([
              getPaymentStatus(transaction.transactionId, token),
              getTransaction(transaction.transactionId, token),
            ]);
            const statusNow = checkoutStatus(paymentStatus, currentTransaction);
            setCanCheckout(statusNow === 'ready');
            setState(statusNow === 'ready' ? 'error' : statusNow);
          } catch { setState('unresolved'); }
          await onRefresh().catch(() => {});
        }
      }).finally(() => { locked.current = false; });
    };
    button.addEventListener('click', start);
    return () => button.removeEventListener('click', start);
  }, [eligible, canCheckout, session, state, transaction.transactionId, transaction.version, token, onRefresh]);

  const messageKey = messagesByState[state];
  const busy = ['loading', 'starting', 'authorizing', 'fallback'].includes(state);
  async function reconcileNow() {
    setReconciling(true);
    try {
      const result = await recoverPayPalSdkError({ transactionId: transaction.transactionId, token, getPaymentStatus, getTransaction, reconcile: reconcilePayPalPayment });
      if (result.kind === 'authorized') { setState('authorized'); setCanCheckout(false); }
      else if (result.kind === 'unresolved') { setState('unresolved'); setCanCheckout(false); }
      else {
        const latest = await getTransaction(transaction.transactionId, token);
        const permitted = canStartPayPalCheckout(latest?.state);
        setState(permitted ? 'ready' : 'ineligible');
        setCanCheckout(permitted);
      }
      await onRefresh().catch(() => {});
    } catch { setState('unresolved'); setCanCheckout(false); }
    finally { setReconciling(false); }
  }
  function resumeExistingApproval() {
    try {
      resumePayPalApproval({
        transactionId: transaction.transactionId,
        orderId: transaction.provider?.orderId,
        approvalUrl: existingApprovalUrl,
        token,
      });
    } catch { setState('unresolved'); }
  }
  const showButton = eligible && canCheckout && ['ready', 'cancelled', 'error', 'eligibility-warning'].includes(state);
  return <div className={`paypal-v6-control${busy ? ' is-busy' : ''}`}>
    <div className="paypal-v6-amount">{money(transaction.amountMinor, transaction.currency)}</div>
    {showButton && <paypal-button ref={buttonRef} type="checkout" class="paypal-gold" aria-label={t('paypalV6.buttonLabel')} />}
    {state === 'approval-required' && <button type="button" className="paypal-v6-resume" onClick={resumeExistingApproval}>{t('paypalV6.resumeApproval')}</button>}
    {busy && <span className="paypal-v6-progress" role="status"><LoaderCircle size={12} className="payment-spinner"/>{t(state === 'loading' ? 'paypalV6.loading' : state === 'authorizing' ? 'paypalV6.verifying' : state === 'fallback' ? 'paypalV6.popupFallback' : 'paypalV6.starting')}</span>}
    {state === 'authorized' && <span className="paypal-v6-status success" role="status"><CheckCircle2 size={12}/>{t('paypalV6.authorized')}</span>}
    {messageKey && !busy && state !== 'authorized' && <span className={`paypal-v6-status${state === 'cancelled' ? ' neutral' : ' warning'}`} role={state === 'cancelled' ? 'status' : 'alert'}><AlertTriangle size={12}/>{t(messageKey)}</span>}
    {state === 'unresolved' && <button type="button" className="paypal-v6-reconcile" onClick={reconcileNow} disabled={reconciling}>{reconciling ? <LoaderCircle size={11} className="payment-spinner"/> : null}{t(reconciling ? 'paypalV6.reconciling' : 'paypalV6.reconcile')}</button>}
  </div>;
}
