import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ArrowRight, LoaderCircle, LockKeyhole, LogIn, LogOut, RefreshCw, Search, ShoppingBag } from 'lucide-react';
import PageFrame from '../components/PageFrame.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { ApiRequestError, createPayPalOrder, getTransactions, signInBuyer, signOut } from '../services/api.js';
import { money, dateLabel, numberLabel } from '../services/format.js';
import { startPayPalCheckout } from '../services/paypalCheckout.js';

const PAYMENT_ACTION_STATES = new Set(['READY_FOR_PAYMENT', 'PAYMENT_PENDING']);

export default function TransactionsPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [buyer, setBuyer] = useState(null);
  const [token, setToken] = useState('');
  const [transactions, setTransactions] = useState([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('ALL');
  const [sort, setSort] = useState('newest');
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');

  const loadTransactions = useCallback(async (sessionToken) => {
    setTransactions(await getTransactions(sessionToken));
  }, []);

  async function handleSignIn(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const session = await signInBuyer(email.trim(), password);
      setToken(session.token);
      setBuyer(session.user);
      setPassword('');
      await loadTransactions(session.token);
    } catch (requestError) {
      setError(requestError instanceof ApiRequestError ? requestError.message : t('paypalCheckout.loadError'));
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut() {
    try { await signOut(token); } catch { /* Discard the in-memory token even if revocation cannot be reached. */ }
    setBuyer(null);
    setToken('');
    setTransactions([]);
    setError('');
  }

  async function handleCheckout(transaction) {
    if (busyId || !token || !PAYMENT_ACTION_STATES.has(transaction.state)) return;
    setBusyId(transaction.transactionId);
    setError('');
    try {
      const result = await startPayPalCheckout({
        transaction,
        token,
        createOrder: (transactionId, buyerToken, expectedVersion) => createPayPalOrder(transactionId, buyerToken, expectedVersion),
      });
      if (result.kind === 'unresolved') {
        setError(t('paypalCheckout.unresolved'));
        await loadTransactions(token).catch(() => {});
      }
    } catch (requestError) {
      setError(requestError instanceof ApiRequestError ? requestError.message : requestError.message || t('paypalCheckout.checkoutError'));
    } finally {
      setBusyId('');
    }
  }

  const filtered = useMemo(() => transactions
    .filter((transaction) => (status === 'ALL' || transaction.state === status)
      && `${transaction.transactionId} ${transaction.itemName ?? ''}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => sort === 'oldest' ? a.createdAt.localeCompare(b.createdAt)
      : sort === 'amount-high' ? b.amountMinor - a.amountMinor
        : sort === 'amount-low' ? a.amountMinor - b.amountMinor
          : b.createdAt.localeCompare(a.createdAt)), [transactions, status, search, sort]);

  return <PageFrame className="app-page"><div className="page-shell subpage-shell">
    <div className="demo-ribbon"><span className="demo-pulse"/>{t('paypalCheckout.liveLabel')}<span className="ribbon-right">{t('paypalCheckout.backendSource')}</span></div>
    <div className="subpage-heading"><div><span className="eyebrow"><ShoppingBag size={13}/>{t('paypalCheckout.eyebrow')}</span><h1>{t('paypalCheckout.heading')}<em>{t('paypalCheckout.headingAccent')}</em></h1><p>{t('paypalCheckout.description')}</p></div>{buyer && <div className="workspace-chip">{buyer.displayName || buyer.email}<button type="button" className="text-action" onClick={handleSignOut}><LogOut size={13}/>{t('ai.signOut')}</button></div>}</div>

    {!token ? <section className="panel copilot-auth-card payment-auth-card">
      <div className="copilot-auth-icon"><LockKeyhole size={18}/></div>
      <div><span className="eyebrow">{t('paypalCheckout.buyerSession')}</span><h2>{t('ai.signInTitle')}</h2><p>{t('paypalCheckout.signInDescription')}</p></div>
      <form className="copilot-auth-form" onSubmit={handleSignIn}>
        <label>{t('ai.email')}<input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={254}/></label>
        <label>{t('ai.password')}<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required maxLength={256}/></label>
        <button type="submit" className="button button-lime" disabled={busy}>{busy ? <LoaderCircle size={15} className="payment-spinner"/> : <LogIn size={15}/>}{busy ? t('paypalCheckout.signingIn') : t('ai.signIn')}</button>
      </form>
      {error && <p className="copilot-error" role="alert"><AlertTriangle size={15}/>{error}</p>}
    </section> : <>
      <section className="panel transaction-panel payment-transactions-panel">
        <div className="transaction-toolbar"><label className="search-field"><Search size={16}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('paypalCheckout.searchPlaceholder')} aria-label={t('paypalCheckout.searchLabel')}/></label><label className="filter-select"><select value={status} onChange={(event) => setStatus(event.target.value)} aria-label={t('copy.filter_by_status_f43653d')}><option value="ALL">{t('copy.all_statuses_6405179')}</option>{['NEEDS_GUARDIAN','GUARDIAN_APPROVED','READY_FOR_PAYMENT','PAYMENT_PENDING','AUTHORIZED','MEETUP_ACTIVE','CAPTURE_PENDING','CAPTURED','VOID_PENDING','VOIDED','BLOCKED','EXPIRED'].map((value) => <option key={value} value={value}>{t(`status.${value}`)}</option>)}</select></label><label className="filter-select"><select value={sort} onChange={(event) => setSort(event.target.value)} aria-label={t('copy.sort_transactions_7ac7759')}><option value="newest">{t('copy.newest_first_f5ec777')}</option><option value="oldest">{t('copy.oldest_first_6a99c65')}</option><option value="amount-high">{t('copy.amount_high_9681387')}</option><option value="amount-low">{t('copy.amount_low_1242d98')}</option></select></label><button className="icon-button" type="button" onClick={() => loadTransactions(token).catch((loadError) => setError(loadError.message))} aria-label={t('paypalCheckout.refresh')}><RefreshCw size={15}/></button></div>
        {busy ? <div className="table-empty payment-empty" role="status"><LoaderCircle size={20} className="payment-spinner"/><p>{t('paypalCheckout.loading')}</p></div> : filtered.length ? <div className="transaction-table-wrap"><table className="transaction-table"><thead><tr><th>{t('copy.purchase_160f06d')}</th><th>{t('copy.amount_43dc853')}</th><th>{t('copy.date_eb9a4bc')}</th><th>{t('copy.policy_status_6a1d9dd')}</th><th>{t('paypalCheckout.action')}</th></tr></thead><tbody>{filtered.map((transaction) => {
          const canCheckout = PAYMENT_ACTION_STATES.has(transaction.state);
          const isBusy = busyId === transaction.transactionId;
          return <tr key={transaction.transactionId}><td><div className="table-item"><span className="table-item-icon icon-blue"><ShoppingBag size={14}/></span><span><b>{transaction.itemName || t('paypalCheckout.purchase')}</b><small>{transaction.transactionId}</small></span></div></td><td className="table-amount">{money(transaction.amountMinor, transaction.currency)}</td><td className="date-cell">{dateLabel(transaction.createdAt)}</td><td><StatusBadge status={transaction.state} small/></td><td>{canCheckout ? <button type="button" className="button button-lime button-small payment-start-button" onClick={() => handleCheckout(transaction)} disabled={Boolean(busyId)}>{isBusy ? <LoaderCircle size={13} className="payment-spinner"/> : null}{isBusy ? t('paypalCheckout.starting') : transaction.state === 'PAYMENT_PENDING' ? t('paypalCheckout.continueCheckout') : t('paypalCheckout.startCheckout')}<ArrowRight size={13}/></button> : <span className="payment-unavailable">{t('paypalCheckout.notEligible')}</span>}</td></tr>;
        })}</tbody></table></div> : <div className="table-empty payment-empty"><span><ShoppingBag size={20}/></span><b>{transactions.length ? t('paypalCheckout.noMatch') : t('paypalCheckout.noTransactions')}</b><p>{transactions.length ? t('paypalCheckout.changeSearch') : t('paypalCheckout.noTransactionsHelp')}</p></div>}
        <div className="table-foot"><span>{t('paypalCheckout.realRecords', { count: numberLabel(filtered.length) })}</span><span>{t('paypalCheckout.noCaptureHere')}</span></div>
      </section>
      {error && <p className="payment-flow-error" role="alert"><AlertTriangle size={15}/>{error}</p>}
    </>}
    <div className="payment-distinction"><span className="distinction-icon"><LockKeyhole size={16}/></span><div><b>{t('paypalCheckout.controlTitle')}</b><p>{t('paypalCheckout.controlBody')}</p></div></div>
  </div></PageFrame>;
}
