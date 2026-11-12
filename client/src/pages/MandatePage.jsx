import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ArrowRight, Check, KeyRound, LoaderCircle, LogOut, RefreshCw, ShieldCheck, UserPlus } from 'lucide-react';
import PageFrame from '../components/PageFrame.jsx';
import { ApiRequestError, acceptGuardianInvitation, getCurrentMandate, getGuardianRelationships, inviteGuardian, saveCurrentMandate, signInAccount, signInBuyer, signOut } from '../services/api.js';
import { CURRENCY_MINOR_UNITS } from '../data/currencyMeta.js';
import { parseMandateMajorAmount } from '../services/mandateDraft.js';
import { money } from '../services/format.js';
import './MandatePage.css';

const CATEGORIES = ['electronics', 'home', 'outdoors', 'books', 'fashion', 'other'];
const ZONES = ['Asia/Kolkata', 'Asia/Dubai', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'UTC'];
const EMPTY = Object.freeze({ maxAmountMinor: null, currency: '', allowedCategories: [], meetupRules: { requirePublicPlace: null, daytimeStart: '', daytimeEnd: '', timeZone: '' }, expiresAt: '', guardianId: '', riskThreshold: '' });

function toForm(mandate) {
  if (!mandate) return { ...EMPTY, meetupRules: { ...EMPTY.meetupRules } };
  const places = CURRENCY_MINOR_UNITS[mandate.currency] ?? 2;
  const scale = 10 ** places;
  const amount = places ? `${Math.floor(mandate.maxAmountMinor / scale)}.${String(mandate.maxAmountMinor % scale).padStart(places, '0')}` : String(mandate.maxAmountMinor);
  return { ...mandate, amountText: amount, expiry: mandate.expiresAt.slice(0, 10), meetupRules: { ...mandate.meetupRules } };
}

function errorMessage(error, t) {
  if (error instanceof ApiRequestError && error.code === 'MANDATE_NOT_FOUND') return '';
  return error instanceof ApiRequestError ? error.message : t('mandateSetup.requestFailed');
}

export default function MandatePage() {
  const { t } = useTranslation();
  const [token, setToken] = useState('');
  const [buyerEmail, setBuyerEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mandate, setMandate] = useState(null);
  const [relationships, setRelationships] = useState([]);
  const [form, setForm] = useState(() => toForm(null));
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [success, setSuccess] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [invitation, setInvitation] = useState(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [acceptEmail, setAcceptEmail] = useState('');
  const [acceptPassword, setAcceptPassword] = useState('');
  const [relationshipId, setRelationshipId] = useState('');
  const [acceptBusy, setAcceptBusy] = useState(false);
  const [guardianMessage, setGuardianMessage] = useState('');

  const eligibleGuardians = useMemo(() => relationships.filter((item) => item.status === 'ACCEPTED' && item.eligible === true), [relationships]);

  async function refresh(tokenValue, { throwOnError = false } = {}) {
    setLoading(true);
    setError('');
    try {
      const [links, stored] = await Promise.all([
        getGuardianRelationships(tokenValue),
        getCurrentMandate(tokenValue).catch((failure) => {
          if (failure instanceof ApiRequestError && failure.code === 'MANDATE_NOT_FOUND') return null;
          throw failure;
        }),
      ]);
      setRelationships(links);
      setMandate(stored);
      setForm((current) => toForm(stored ?? (current.mandateId ? current : null)));
      if (!stored) setForm((current) => ({ ...toForm(null), guardianId: current.guardianId }));
      return stored;
    } catch (failure) {
      setError(errorMessage(failure, t));
      if (throwOnError) throw failure;
    } finally {
      setLoading(false);
    }
  }

  async function handleBuyerSignIn(event) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const session = await signInBuyer(buyerEmail.trim(), password);
      setToken(session.token);
      setBuyerEmail(session.user.email);
      setPassword('');
      await refresh(session.token);
    } catch (failure) {
      setError(errorMessage(failure, t));
      setLoading(false);
    }
  }

  async function handleSignOut() {
    try { await signOut(token); } catch { /* discard the in-memory session either way */ }
    setToken(''); setMandate(null); setRelationships([]); setForm(toForm(null)); setSuccess(false);
  }

  function validate() {
    const next = {};
    if (!Number.isInteger(CURRENCY_MINOR_UNITS[form.currency])) next.currency = t('mandateSetup.currencyRequired');
    const maxAmountMinor = parseMandateMajorAmount(form.amountText ?? '', form.currency);
    if (!maxAmountMinor) next.maxAmountMinor = t('mandateSetup.amountInvalid', { decimals: CURRENCY_MINOR_UNITS[form.currency] ?? 2 });
    if (!form.allowedCategories.length) next.allowedCategories = t('mandateSetup.categoryRequired');
    if (typeof form.meetupRules.requirePublicPlace !== 'boolean' || !form.meetupRules.timeZone || !form.meetupRules.daytimeStart || !form.meetupRules.daytimeEnd || form.meetupRules.daytimeStart >= form.meetupRules.daytimeEnd) next.meetupRules = t('mandateSetup.timeInvalid');
    if (!form.expiry) next.expiry = t('mandateSetup.expiryRequired');
    else if (new Date(`${form.expiry}T23:59:59Z`).getTime() <= Date.now()) next.expiry = t('mandateSetup.expiryPast');
    if (!eligibleGuardians.some((item) => item.guardianId === form.guardianId)) next.guardianId = t('mandateSetup.guardianRequired');
    if (String(form.riskThreshold).trim() === '' || !Number.isInteger(Number(form.riskThreshold)) || Number(form.riskThreshold) < 0 || Number(form.riskThreshold) > 100) next.riskThreshold = t('mandateSetup.riskInvalid');
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSave(event) {
    event.preventDefault();
    setError(''); setSuccess(false);
    if (!validate()) return;
    setSaving(true);
    const payload = {
      maxAmountMinor: parseMandateMajorAmount(form.amountText, form.currency),
      currency: form.currency,
      allowedCategories: form.allowedCategories,
      meetupRules: { ...form.meetupRules },
      expiresAt: `${form.expiry}T23:59:59Z`,
      guardianId: form.guardianId,
      riskThreshold: Number(form.riskThreshold),
    };
    try {
      await saveCurrentMandate(token, payload);
      await refresh(token, { throwOnError: true });
      setSuccess(true);
    } catch (failure) {
      setError(errorMessage(failure, t));
    } finally { setSaving(false); }
  }

  async function handleInvite(event) {
    event.preventDefault(); setInviteBusy(true); setGuardianMessage(''); setError('');
    if (!inviteEmail.trim()) { setInviteBusy(false); return; }
    try {
      const created = await inviteGuardian(token, inviteEmail.trim());
      setInvitation(created); setInviteEmail(''); setGuardianMessage(t('mandateSetup.invitationCreated'));
      setRelationships(await getGuardianRelationships(token));
    } catch (failure) { setError(errorMessage(failure, t)); }
    finally { setInviteBusy(false); }
  }

  async function handleAccept(event) {
    event.preventDefault(); setAcceptBusy(true); setGuardianMessage(''); setError('');
    if (!acceptEmail.trim() || !acceptPassword || !relationshipId.trim()) { setError(t('mandateSetup.acceptFieldsRequired')); setAcceptBusy(false); return; }
    let session;
    try {
      session = await signInAccount(acceptEmail.trim(), acceptPassword);
      const accepted = await acceptGuardianInvitation(session.token, relationshipId.trim());
      setGuardianMessage(t('mandateSetup.invitationAccepted', { buyer: accepted.guardianEmail }));
      setAcceptPassword(''); setRelationshipId('');
    } catch (failure) { setError(errorMessage(failure, t)); }
    finally { if (session?.token) await signOut(session.token).catch(() => {}); setAcceptBusy(false); }
  }

  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const updateMeetup = (key, value) => setForm((current) => ({ ...current, meetupRules: { ...current.meetupRules, [key]: value } }));

  return <PageFrame className="app-page"><div className="page-shell subpage-shell mandate-page">
    <header className="subpage-heading"><div><span className="eyebrow"><ShieldCheck size={13}/>{t('mandateSetup.eyebrow')}</span><h1>{t('mandateSetup.title')}<em>{t('mandateSetup.titleAccent')}</em></h1><p>{t('mandateSetup.description')}</p></div>{token && <div className="workspace-chip">{buyerEmail}</div>}</header>
    {error && <div className="mandate-alert error" role="alert"><AlertTriangle size={16}/>{error}</div>}
    {success && <div className="mandate-alert success" role="status"><Check size={16}/>{t('mandateSetup.saved')}</div>}
    {!token ? <section className="panel mandate-auth"><KeyRound size={20}/><div><span className="eyebrow">{t('mandateSetup.buyerSession')}</span><h2>{t('mandateSetup.signInTitle')}</h2><p>{t('mandateSetup.signInBody')}</p></div><form onSubmit={handleBuyerSignIn} className="mandate-auth-form"><label>{t('mandateSetup.email')}<input type="email" autoComplete="username" required maxLength={254} value={buyerEmail} onChange={(event) => setBuyerEmail(event.target.value)}/></label><label>{t('mandateSetup.password')}<input type="password" autoComplete="current-password" required maxLength={256} value={password} onChange={(event) => setPassword(event.target.value)}/></label><button className="button button-lime" disabled={loading}>{loading ? <LoaderCircle className="spin" size={15}/> : t('mandateSetup.signIn')}<ArrowRight size={14}/></button></form></section> : <>
      {loading ? <div className="panel mandate-loading" role="status"><LoaderCircle className="spin"/>{t('mandateSetup.loading')}</div> : <>
        <div className="mandate-toolbar"><span className={`mandate-state ${mandate ? 'is-saved' : ''}`}><i/>{mandate ? t('mandateSetup.persistedState') : t('mandateSetup.emptyState')}</span><div><button type="button" className="button button-outline button-small" onClick={() => refresh(token)}><RefreshCw size={14}/>{t('mandateSetup.refresh')}</button><button type="button" className="button button-outline button-small" onClick={handleSignOut}><LogOut size={14}/>{t('mandateSetup.signOut')}</button></div></div>
        <form className="mandate-editor" onSubmit={handleSave} noValidate>
          <section className="panel mandate-form-panel"><header><span className="form-number">01</span><div><span className="eyebrow">{t('mandateSetup.spending')}</span><h2>{t('mandateSetup.limitTitle')}</h2><p>{t('mandateSetup.limitBody')}</p></div></header><div className="mandate-field-grid"><label className="mandate-field wide"><span>{t('mandateSetup.amountLabel')}</span><div className="amount-entry"><input aria-label={t('mandateSetup.amountLabel')} inputMode="decimal" value={form.amountText ?? ''} placeholder={t('mandateSetup.amountPlaceholder')} onChange={(event) => set('amountText', event.target.value)}/><select value={form.currency} onChange={(event) => set('currency', event.target.value)} aria-label={t('mandateSetup.currency')}><option value="">{t('mandateSetup.chooseCurrency')}</option>{Object.keys(CURRENCY_MINOR_UNITS).map((currency) => <option key={currency} value={currency}>{currency}</option>)}</select></div>{fieldErrors.currency && <small className="field-error">{fieldErrors.currency}</small>}{fieldErrors.maxAmountMinor ? <small className="field-error">{fieldErrors.maxAmountMinor}</small> : <small>{t('mandateSetup.amountHelp', { decimals: CURRENCY_MINOR_UNITS[form.currency] ?? 2 })}</small>}</label></div></section>
          <section className="panel mandate-form-panel"><header><span className="form-number">02</span><div><span className="eyebrow">{t('mandateSetup.purchases')}</span><h2>{t('mandateSetup.categoriesTitle')}</h2><p>{t('mandateSetup.categoriesBody')}</p></div></header><div className="mandate-categories">{CATEGORIES.map((category) => <label key={category}><input type="checkbox" checked={form.allowedCategories.includes(category)} onChange={(event) => set('allowedCategories', event.target.checked ? [...form.allowedCategories, category] : form.allowedCategories.filter((item) => item !== category))}/><span><Check size={13}/></span>{t(`mandateSetup.category.${category}`)}</label>)}</div>{fieldErrors.allowedCategories && <small className="field-error">{fieldErrors.allowedCategories}</small>}</section>
          <section className="panel mandate-form-panel"><header><span className="form-number">03</span><div><span className="eyebrow">{t('mandateSetup.meetups')}</span><h2>{t('mandateSetup.meetupTitle')}</h2><p>{t('mandateSetup.meetupBody')}</p></div></header><label className="mandate-field mandate-place-select"><span>{t('mandateSetup.publicPlace')}</span><select value={form.meetupRules.requirePublicPlace === null ? '' : String(form.meetupRules.requirePublicPlace)} onChange={(event) => updateMeetup('requirePublicPlace', event.target.value === '' ? null : event.target.value === 'true')}><option value="">{t('mandateSetup.chooseRequirement')}</option><option value="true">{t('mandateSetup.required')}</option><option value="false">{t('mandateSetup.notRequired')}</option></select><small>{t('mandateSetup.publicPlaceHelp')}</small></label><div className="mandate-field-grid"><label className="mandate-field"><span>{t('mandateSetup.dayStart')}</span><input type="time" value={form.meetupRules.daytimeStart} onChange={(event) => updateMeetup('daytimeStart', event.target.value)}/></label><label className="mandate-field"><span>{t('mandateSetup.dayEnd')}</span><input type="time" value={form.meetupRules.daytimeEnd} onChange={(event) => updateMeetup('daytimeEnd', event.target.value)}/></label><label className="mandate-field wide"><span>{t('mandateSetup.timeZone')}</span><select value={form.meetupRules.timeZone} onChange={(event) => updateMeetup('timeZone', event.target.value)}><option value="">{t('mandateSetup.chooseTimeZone')}</option>{ZONES.map((zone) => <option key={zone}>{zone}</option>)}</select></label></div>{fieldErrors.meetupRules && <small className="field-error">{fieldErrors.meetupRules}</small>}</section>
          <section className="panel mandate-form-panel"><header><span className="form-number">04</span><div><span className="eyebrow">{t('mandateSetup.oversight')}</span><h2>{t('mandateSetup.guardianTitle')}</h2><p>{t('mandateSetup.guardianBody')}</p></div></header>
            {eligibleGuardians.length ? <label className="mandate-field"><span>{t('mandateSetup.selectGuardian')}</span><select value={form.guardianId} onChange={(event) => set('guardianId', event.target.value)}><option value="">{t('mandateSetup.chooseGuardian')}</option>{eligibleGuardians.map((guardian) => <option key={guardian.relationshipId} value={guardian.guardianId}>{guardian.guardianEmail}</option>)}</select>{fieldErrors.guardianId && <small className="field-error">{fieldErrors.guardianId}</small>}</label> : <div className="mandate-empty-guardian"><AlertTriangle size={17}/><div><b>{t('mandateSetup.noGuardian')}</b><p>{t('mandateSetup.noGuardianBody')}</p></div></div>}
            <div className="guardian-action"><label className="mandate-field"><span>{t('mandateSetup.inviteLabel')}</span><input type="email" maxLength={254} value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder={t('mandateSetup.invitePlaceholder')}/></label><button type="button" onClick={handleInvite} className="button button-outline" disabled={inviteBusy || !inviteEmail.trim()}>{inviteBusy ? t('mandateSetup.sending') : <><UserPlus size={14}/>{t('mandateSetup.invite')}</>}</button></div>
            {invitation && <p className="mandate-help">{t('mandateSetup.shareRelationshipId')} <code>{invitation.relationshipId}</code></p>}
            <details className="guardian-accept"><summary>{t('mandateSetup.acceptTitle')}</summary><p>{t('mandateSetup.acceptBody')}</p><div><div className="guardian-accept-grid"><label className="mandate-field"><span>{t('mandateSetup.relationshipId')}</span><input value={relationshipId} onChange={(event) => setRelationshipId(event.target.value)}/></label><label className="mandate-field"><span>{t('mandateSetup.email')}</span><input type="email" autoComplete="username" value={acceptEmail} onChange={(event) => setAcceptEmail(event.target.value)}/></label><label className="mandate-field"><span>{t('mandateSetup.password')}</span><input type="password" autoComplete="current-password" value={acceptPassword} onChange={(event) => setAcceptPassword(event.target.value)}/></label></div><button type="button" onClick={handleAccept} className="button button-outline" disabled={acceptBusy}>{acceptBusy ? t('mandateSetup.accepting') : t('mandateSetup.acceptButton')}</button></div></details>
            {guardianMessage && <p className="mandate-help" role="status">{guardianMessage}</p>}
            <div className="mandate-field-grid mandate-lower-fields"><label className="mandate-field"><span>{t('mandateSetup.riskThreshold')}</span><input type="number" min="0" max="100" step="1" value={form.riskThreshold} placeholder="0–100" onChange={(event) => set('riskThreshold', event.target.value)}/><small>{t('mandateSetup.riskHelp')}</small>{fieldErrors.riskThreshold && <small className="field-error">{fieldErrors.riskThreshold}</small>}</label><label className="mandate-field"><span>{t('mandateSetup.expiry')}</span><input type="date" value={form.expiry ?? ''} onChange={(event) => set('expiry', event.target.value)}/>{fieldErrors.expiry && <small className="field-error">{fieldErrors.expiry}</small>}</label></div>
          </section>
          <aside className="panel mandate-summary-card"><span className="eyebrow">{t('mandateSetup.summary')}</span><h2>{t('mandateSetup.summaryTitle')}</h2><div className="mandate-summary-limit">{form.amountText && parseMandateMajorAmount(form.amountText, form.currency) ? money(parseMandateMajorAmount(form.amountText, form.currency), form.currency) : '—'}<small>{t('mandateSetup.perPurchase')}</small></div><div className="mandate-summary-row"><span>{t('mandateSetup.categoriesTitle')}</span><b>{form.allowedCategories.length ? form.allowedCategories.join(', ') : '—'}</b></div><div className="mandate-summary-row"><span>{t('mandateSetup.publicPlace')}</span><b>{typeof form.meetupRules.requirePublicPlace === 'boolean' ? t(form.meetupRules.requirePublicPlace ? 'mandateSetup.required' : 'mandateSetup.notRequired') : '—'}</b></div><div className="mandate-summary-row"><span>{t('mandateSetup.dayStart')}–{t('mandateSetup.dayEnd')}</span><b>{form.meetupRules.daytimeStart && form.meetupRules.daytimeEnd ? `${form.meetupRules.daytimeStart}–${form.meetupRules.daytimeEnd}` : '—'}</b></div><div className="mandate-summary-row"><span>{t('mandateSetup.timeZone')}</span><b>{form.meetupRules.timeZone || '—'}</b></div><div className="mandate-summary-row"><span>{t('mandateSetup.selectGuardian')}</span><b>{eligibleGuardians.find((item) => item.guardianId === form.guardianId)?.guardianEmail ?? '—'}</b></div><div className="mandate-summary-row"><span>{t('mandateSetup.riskThreshold')}</span><b>{form.riskThreshold === '' ? '—' : form.riskThreshold}</b></div><div className="mandate-summary-row"><span>{t('mandateSetup.expiry')}</span><b>{form.expiry || '—'}</b></div><p>{t('mandateSetup.summaryNote')}</p><button type="submit" className="button button-lime" disabled={saving || loading || !eligibleGuardians.length}>{saving ? <LoaderCircle className="spin" size={15}/> : <Check size={15}/ >}{mandate ? t('mandateSetup.saveUpdate') : t('mandateSetup.createMandate')}</button></aside>
        </form>
      </>}
    </>}
  </div></PageFrame>;
}
