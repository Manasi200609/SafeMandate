import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ArrowRight, CheckCircle2, LoaderCircle, Plus, ShieldCheck } from 'lucide-react';
import StatusBadge from './StatusBadge.jsx';
import { ApiRequestError, createTransaction, evaluateTransaction, getTransaction } from '../services/api.js';
import { CURRENCY_MINOR_UNITS } from '../data/currencyMeta.js';
import { acquireSubmissionLock, parseMajorAmount, isValidLocalDate } from '../services/transactionDraft.js';

function todayLocal() {
  const date = new Date();
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

export default function TransactionCreateForm({ token, mandate, sellers, onCreated }) {
  const { t } = useTranslation();
  const [sellerId, setSellerId] = useState('');
  const [itemName, setItemName] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState(mandate?.allowedCategories?.[0] ?? '');
  const [meetupLocation, setMeetupLocation] = useState('');
  const [locationIsPublic, setLocationIsPublic] = useState(false);
  const [meetupDate, setMeetupDate] = useState(todayLocal);
  const [meetupTime, setMeetupTime] = useState(mandate?.meetupRules?.daytimeStart ?? '12:00');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(null);
  const busyRef = useRef(false);
  const minorUnits = CURRENCY_MINOR_UNITS[mandate?.currency];
  const step = minorUnits === 0 ? '1' : minorUnits === 3 ? '0.001' : '0.01';
  const canCreate = Boolean(mandate && sellers.length && category && !busy);
  const hasSeller = useMemo(() => sellers.some((seller) => seller.sellerId === sellerId), [sellers, sellerId]);

  async function evaluateSaved(transactionId) {
    try {
      const response = await evaluateTransaction(transactionId, token);
      setNotice({ transaction: response.transaction, justCreated: true });
      await onCreated();
    } catch (evaluationError) {
      let current = null;
      try { current = await getTransaction(transactionId, token); } catch { /* Keep the creation reference and report evaluation as unconfirmed. */ }
      setNotice({ transaction: current, transactionId, justCreated: true, evaluationPending: current?.state === 'PROPOSED' || !current });
      await onCreated().catch(() => {});
      setError(evaluationError instanceof ApiRequestError ? evaluationError.message : t('transactionCreate.evaluationError'));
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (busyRef.current) return;
    setError('');
    setNotice(null);
    if (!hasSeller) return setError(t('transactionCreate.selectSellerError'));
    const amountMinor = parseMajorAmount(amount, mandate.currency);
    if (!amountMinor) return setError(t('transactionCreate.amountError'));
    if (!isValidLocalDate(meetupDate) || meetupDate < todayLocal()) return setError(t('transactionCreate.dateError'));
    if (!acquireSubmissionLock(busyRef)) return;
    setBusy(true);
    try {
      const response = await createTransaction(token, sellerId, {
        itemName: itemName.trim(),
        description: description.trim(),
        category,
        amountMinor,
        currency: mandate.currency,
        meetupLocation: meetupLocation.trim(),
        locationIsPublic,
        proposedMeetupDate: meetupDate,
        proposedLocalMeetupTime: meetupTime,
        timeZone: mandate.meetupRules.timeZone,
      });
      const transactionId = response?.transaction?.transactionId;
      if (typeof transactionId !== 'string' || !transactionId) throw new Error(t('transactionCreate.createError'));
      setNotice({ transaction: response.transaction, transactionId, justCreated: true, evaluating: true });
      await evaluateSaved(transactionId);
      setItemName('');
      setDescription('');
      setAmount('');
      setMeetupLocation('');
      setLocationIsPublic(false);
      setMeetupDate(todayLocal());
    } catch (requestError) {
      setError(requestError instanceof ApiRequestError ? requestError.message : requestError.message || t('transactionCreate.createError'));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function retryEvaluation() {
    if (!notice?.transactionId || !acquireSubmissionLock(busyRef)) return;
    setBusy(true);
    setError('');
    await evaluateSaved(notice.transactionId);
    busyRef.current = false;
    setBusy(false);
  }

  const resultState = notice?.transaction?.state;
  return <section className="panel transaction-create-panel">
    <div className="transaction-create-heading"><div className="copilot-auth-icon"><Plus size={18}/></div><div><span className="eyebrow">{t('transactionCreate.eyebrow')}</span><h2>{t('transactionCreate.title')}</h2><p>{t('transactionCreate.description')}</p></div></div>
    {!mandate ? <div className="transaction-create-prerequisite" role="status"><ShieldCheck size={17}/><span>{t('transactionCreate.mandateRequired')}</span></div> : <>
      <div className="transaction-create-mandate"><ShieldCheck size={15}/><span>{t('transactionCreate.mandateLabel')}</span><b>{mandate.currency} · {t('transactionCreate.limit', { amount: (mandate.maxAmountMinor / (10 ** minorUnits)).toLocaleString(undefined, { minimumFractionDigits: minorUnits, maximumFractionDigits: minorUnits }) })}</b><small>{t('transactionCreate.timezone', { timezone: mandate.meetupRules.timeZone })}</small></div>
      {!sellers.length && <p className="transaction-create-prerequisite" role="status">{t('transactionCreate.noSellers')}</p>}
      <form className="transaction-create-form" onSubmit={handleSubmit}>
        <label>{t('transactionCreate.seller')}<select value={sellerId} onChange={(event) => setSellerId(event.target.value)} required disabled={!canCreate}><option value="">{t('transactionCreate.chooseSeller')}</option>{sellers.map((seller) => <option value={seller.sellerId} key={seller.sellerId}>{seller.displayName}</option>)}</select></label>
        <label>{t('ai.itemName')}<input value={itemName} onChange={(event) => setItemName(event.target.value)} maxLength={180} required disabled={!canCreate}/></label>
        <label>{t('transactionCreate.descriptionLabel')}<textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} rows={3} required disabled={!canCreate}/></label>
        <div className="transaction-create-fields">
          <label>{t('ai.askingPrice')} · {mandate.currency}<input type="number" inputMode="decimal" min="0" step={step} value={amount} onChange={(event) => setAmount(event.target.value)} required disabled={!canCreate}/></label>
          <label>{t('ai.category')}<select value={category} onChange={(event) => setCategory(event.target.value)} required disabled={!canCreate}>{mandate.allowedCategories.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        </div>
        <label>{t('ai.handoffLocation')}<input value={meetupLocation} onChange={(event) => setMeetupLocation(event.target.value)} maxLength={180} required disabled={!canCreate}/></label>
        <label className="transaction-create-public"><input type="checkbox" checked={locationIsPublic} onChange={(event) => setLocationIsPublic(event.target.checked)} disabled={!canCreate}/><span>{t('ai.publicPlace')}</span></label>
        <div className="transaction-create-fields">
          <label>{t('transactionCreate.meetupDate')}<input type="date" value={meetupDate} min={todayLocal()} onChange={(event) => setMeetupDate(event.target.value)} required disabled={!canCreate}/></label>
          <label>{t('ai.handoffTime')}<input type="time" value={meetupTime} onChange={(event) => setMeetupTime(event.target.value)} required disabled={!canCreate}/></label>
        </div>
        {error && <p className="payment-flow-error" role="alert"><AlertTriangle size={15}/>{error}</p>}
        <p className="transaction-create-disclosure">{t('transactionCreate.reviewDisclosure')}</p>
        <button className="button button-lime" type="submit" disabled={!canCreate || !sellerId || !itemName.trim() || !description.trim() || !amount || !meetupLocation.trim()}>{busy ? <LoaderCircle size={15} className="payment-spinner"/> : <Plus size={15}/>} {busy ? t('transactionCreate.submitting') : t('transactionCreate.submit')}<ArrowRight size={14}/></button>
      </form>
      {notice && <div className="transaction-create-result" role="status" aria-live="polite">
        {notice.evaluating ? <LoaderCircle size={17} className="payment-spinner"/> : notice.justCreated ? <CheckCircle2 size={17}/> : null}
        <div><b>{notice.evaluationPending ? t('transactionCreate.pendingTitle') : t('transactionCreate.resultTitle')}</b>
          <p>{notice.evaluationPending ? t('transactionCreate.pendingBody', { id: notice.transactionId }) : notice.transaction ? t(`transactionCreate.state.${resultState}`, { defaultValue: t('transactionCreate.stateOther', { state: resultState }) }) : t('transactionCreate.pendingBody', { id: notice.transactionId })}</p>
          {notice.transaction && <StatusBadge status={resultState} small/>}
          {notice.transaction?.state === 'NEEDS_GUARDIAN' && <small>{t('transactionCreate.guardianRequired')}</small>}
          {notice.transaction?.state === 'READY_FOR_PAYMENT' && <small>{t('transactionCreate.checkoutNext')}</small>}
        </div>
        {notice.evaluationPending && <button className="button button-outline button-small" type="button" disabled={busy} onClick={retryEvaluation}>{t('transactionCreate.retryEvaluation')}</button>}
      </div>}
    </>}
  </section>;
}
