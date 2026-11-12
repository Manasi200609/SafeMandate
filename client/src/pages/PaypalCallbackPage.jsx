import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ArrowLeft, CheckCircle2, CircleSlash, Clock3, LoaderCircle, RefreshCw } from 'lucide-react';
import PageFrame from '../components/PageFrame.jsx';
import { ApiRequestError, authorizePayPalOrder, getPaymentStatus, getTransaction, reconcilePayPalPayment } from '../services/api.js';
import { clearPayPalHandoff, reconcilePayPalReturn, verifyPayPalReturn } from '../services/paypalCheckout.js';

const COPY_BY_RESULT = {
  authorized: ['successTitle', 'successBody'],
  unresolved: ['unresolvedTitle', 'unresolvedBody'],
  'provider-error': ['failedTitle', 'failedBody'],
  'missing-order': ['missingTitle', 'missingBody'],
  'missing-session': ['sessionTitle', 'sessionBody'],
  'order-mismatch': ['mismatchTitle', 'mismatchBody'],
  'not-authorizable': ['failedTitle', 'failedBody'],
  failed: ['failedTitle', 'failedBody'],
};

export default function PaypalCallbackPage({ outcome = 'return' }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const canceled = outcome === 'cancel';
  const [result, setResult] = useState(canceled ? 'canceled' : 'checking');
  const [requestError, setRequestError] = useState('');
  const [reconciling, setReconciling] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (canceled) {
      clearPayPalHandoff();
      return;
    }
    verifyPayPalReturn({
      search: window.location.search,
      getPaymentStatus,
      getTransaction,
      authorize: authorizePayPalOrder,
    }).then((verification) => setResult(verification.kind))
      .catch((error) => {
        setRequestError(error instanceof ApiRequestError ? error.message : 'Safe Mandate could not verify this PayPal checkout.');
        setResult(error instanceof ApiRequestError && ['PAYMENT_OUTCOME_UNKNOWN', 'PAYPAL_STATUS_UNAVAILABLE', 'PAYPAL_RECONCILIATION_FAILED', 'API_UNAVAILABLE'].includes(error.code) ? 'unresolved' : 'failed');
      });
  }, [canceled]);

  async function handleReconcile() {
    setReconciling(true);
    setRequestError('');
    try {
      const verification = await reconcilePayPalReturn({ reconcile: reconcilePayPalPayment, getPaymentStatus, getTransaction });
      setResult(verification.kind);
    } catch (error) {
      setRequestError(error instanceof ApiRequestError ? error.message : t('paypalCallback.unresolvedBody'));
      setResult('unresolved');
    } finally {
      setReconciling(false);
    }
  }

  function backToTransactions() {
    clearPayPalHandoff();
    navigate('/app/transactions');
  }

  const resultCopy = COPY_BY_RESULT[result];
  const Icon = result === 'authorized' ? CheckCircle2 : canceled ? CircleSlash : result === 'checking' ? Clock3 : AlertTriangle;
  const title = result === 'canceled' ? t('paypalCallback.cancelTitle')
    : result === 'checking' ? t('paypalCallback.checkingTitle')
      : t(`paypalCallback.${resultCopy?.[0] ?? 'failedTitle'}`);
  const body = result === 'canceled' ? t('paypalCallback.cancelBody')
    : result === 'checking' ? t('paypalCallback.checkingBody')
      : t(`paypalCallback.${resultCopy?.[1] ?? 'failedBody'}`);
  const showReconcile = !canceled && result === 'unresolved';

  return <PageFrame className="app-page"><div className="page-shell subpage-shell">
    <div className="demo-ribbon" role="status"><span className="demo-pulse"/>{t(result === 'authorized' ? 'paypalCallback.verified' : 'paypalCallback.unverified')}<span className="ribbon-right">{t('paypalCallback.noCapture')}</span></div>
    <section className={`empty-screen paypal-callback paypal-callback-${result}`} aria-labelledby="paypal-callback-title" aria-live="polite">
      {result === 'checking' ? <LoaderCircle size={28} className="payment-spinner" aria-hidden="true"/> : <Icon size={28} aria-hidden="true"/>}
      <span className="eyebrow">{t(canceled ? 'paypalCallback.cancelEyebrow' : result === 'authorized' ? 'paypalCallback.verifiedEyebrow' : 'paypalCallback.returnEyebrow')}</span>
      <h1 id="paypal-callback-title">{title}</h1>
      <p>{body}</p>
      {requestError && <p className="payment-flow-error" role="alert"><AlertTriangle size={15}/>{requestError}</p>}
      <div className="paypal-callback-actions">
        {showReconcile && <button className="button button-lime" type="button" onClick={handleReconcile} disabled={reconciling}>{reconciling ? <LoaderCircle size={15} className="payment-spinner"/> : <RefreshCw size={15}/>}{reconciling ? t('paypalCallback.reconciling') : t('paypalCallback.reconcile')}</button>}
        <button className="button button-outline" type="button" onClick={backToTransactions}><ArrowLeft size={14} aria-hidden="true"/>{t('paypalCallback.backToTransactions')}</button>
      </div>
    </section>
  </div></PageFrame>;
}
