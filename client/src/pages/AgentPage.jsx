import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ArrowRight, Check, Clipboard, FileSearch, KeyRound, LogOut, MessageSquareText, ShieldCheck, Sparkles } from 'lucide-react';
import PageFrame from '../components/PageFrame.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { ApiRequestError, getCurrentMandate, postAiAssessment, signInBuyer, signOut } from '../services/api.js';
import { CURRENCY_MINOR_UNITS } from '../data/currencyMeta.js';
import { money } from '../services/format.js';
import './AgentPage.css';

function parseMajorAmount(value, currency) {
  const places = CURRENCY_MINOR_UNITS[currency];
  if (!Number.isInteger(places)) return null;
  const pattern = places ? new RegExp(`^(0|[1-9]\\d*)(?:\\.(\\d{1,${places}}))?$`) : /^(0|[1-9]\d*)$/;
  const match = pattern.exec(value.trim());
  if (!match) return null;
  const whole = BigInt(match[1]);
  const fraction = places ? BigInt((match[2] ?? '').padEnd(places, '0') || '0') : 0n;
  const amount = whole * (10n ** BigInt(places)) + fraction;
  return amount > 0n && amount <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(amount) : null;
}

function recommendationLabel(value) {
  return String(value ?? '').replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function fieldText(event) { return event.target.value; }

export default function AgentPage() {
  const { t } = useTranslation();
  const [token, setToken] = useState('');
  const [buyerName, setBuyerName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mandate, setMandate] = useState(null);
  const [loginBusy, setLoginBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [listingText, setListingText] = useState('');
  const [conversationText, setConversationText] = useState('');
  const [itemName, setItemName] = useState('');
  const [price, setPrice] = useState('');
  const [category, setCategory] = useState('');
  const [meetupLocation, setMeetupLocation] = useState('');
  const [meetupTime, setMeetupTime] = useState('12:00');
  const [publicPlace, setPublicPlace] = useState(false);
  const [transactionId, setTransactionId] = useState('');
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);

  async function handleSignIn(event) {
    event.preventDefault();
    setError('');
    setLoginBusy(true);
    try {
      const session = await signInBuyer(email.trim(), password);
      const storedMandate = await getCurrentMandate(session.token);
      setToken(session.token);
      setBuyerName(session.user.displayName || session.user.email);
      setMandate(storedMandate);
      setCategory(storedMandate.allowedCategories?.[0] ?? '');
      setPassword('');
    } catch (requestError) {
      setError(requestError instanceof ApiRequestError ? requestError.message : t('ai.error'));
    } finally {
      setLoginBusy(false);
    }
  }

  async function handleSignOut() {
    try { await signOut(token); } catch { /* The in-memory token is still discarded. */ }
    setToken('');
    setBuyerName('');
    setMandate(null);
    setResult(null);
    setError('');
  }

  async function handleAssessment(event) {
    event.preventDefault();
    setError('');
    setResult(null);
    setCopied(false);
    if (listingText.length > 8000 || conversationText.length > 8000) {
      setError(t('ai.inputLimit'));
      return;
    }
    let body;
    if (transactionId.trim()) {
      body = { transactionId: transactionId.trim(), ...(conversationText.trim() ? { conversationText: conversationText.trim() } : {}) };
    } else {
      const amountMinor = parseMajorAmount(price, mandate.currency);
      if (!amountMinor) {
        setError(t('ai.askingPrice') + ': ' + (mandate.currency === 'JPY' || mandate.currency === 'KRW' ? 'enter a positive whole amount.' : 'enter a valid positive amount.'));
        return;
      }
      body = {
        listingText: listingText.trim(),
        ...(conversationText.trim() ? { conversationText: conversationText.trim() } : {}),
        purchase: { itemName: itemName.trim(), amountMinor, category, meetupLocation: meetupLocation.trim(), locationIsPublic: publicPlace, proposedLocalMeetupTime: meetupTime },
      };
    }
    setBusy(true);
    try {
      setResult(await postAiAssessment(token, body));
    } catch (requestError) {
      if (requestError instanceof ApiRequestError && requestError.code === 'AI_NOT_CONFIGURED') setError(t('ai.unconfigured'));
      else if (requestError instanceof ApiRequestError && requestError.status === 0) setError(requestError.message);
      else if (requestError instanceof ApiRequestError && ['AI_PROVIDER_TIMEOUT', 'AI_PROVIDER_RATE_LIMITED', 'AI_PROVIDER_UNAVAILABLE', 'AI_INVALID_RESPONSE'].includes(requestError.code)) setError(t('ai.error'));
      else setError(requestError instanceof ApiRequestError ? requestError.message : t('ai.error'));
    } finally {
      setBusy(false);
    }
  }

  async function copyDraft() {
    const draft = result?.assessment?.negotiation?.messageDraft;
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(draft);
      setCopied(true);
    } catch {
      setError('Clipboard access is unavailable. Select and copy the draft manually.');
    }
  }

  const assessment = result?.assessment;
  const policy = result?.policyEvaluation;

  return <PageFrame className="app-page"><div className="page-shell subpage-shell">
    <div className="demo-ribbon copilot-ribbon"><span className="agent-live-dot"/>{t('copy.agent_workspace_preview_78e7b3f')}<span className="ribbon-right">AI ANALYSIS · POLICY REMAINS DETERMINISTIC</span></div>
    <div className="subpage-heading agent-heading">
      <div><span className="eyebrow"><Sparkles size={13}/>{t('copy.agent_workspace_preview_78e7b3f')}</span><h1>{t('copy.search_with_c46f9c6')}<em>{t('copy.intention_afae389')}</em></h1><p>Understand a listing, question unsupported claims, and draft a careful response before you decide.</p></div>
      {token && <div className="workspace-chip"><span className="agent-live-dot"/>{buyerName}</div>}
    </div>

    {!token ? <section className="panel copilot-auth-card">
      <div className="copilot-auth-icon"><KeyRound size={18}/></div>
      <div><span className="eyebrow">BUYER SESSION</span><h2>{t('ai.signInTitle')}</h2><p>{t('ai.signInBody')}</p></div>
      <form className="copilot-auth-form" onSubmit={handleSignIn}>
        <label>{t('ai.email')}<input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(fieldText(event))} required maxLength={254}/></label>
        <label>{t('ai.password')}<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(fieldText(event))} required maxLength={256}/></label>
        <button type="submit" className="button button-lime" disabled={loginBusy}>{loginBusy ? 'Signing in…' : t('ai.signIn')}<ArrowRight size={14}/></button>
      </form>
      <p className="copilot-disclosure"><ShieldCheck size={14}/>{t('ai.signInBody')}</p>
      {error && <p className="copilot-error" role="alert"><AlertTriangle size={15}/>{error}</p>}
    </section> : <>
      {mandate ? <div className="copilot-mandate-strip"><ShieldCheck size={16}/><span>Saved mandate</span><b>{money(mandate.maxAmountMinor, mandate.currency)} · {mandate.allowedCategories.join(', ')}</b><button type="button" className="copilot-signout" onClick={handleSignOut}><LogOut size={13}/>{t('ai.signOut')}</button></div> : <div role="status" className="copilot-loading">{t('ai.loadingMandate')}</div>}
      <div className="agent-workspace copilot-workspace">
        <section className="agent-conversation panel copilot-form-panel">
          <div className="conversation-head"><div className="conversation-avatar"><FileSearch size={17}/></div><div><b>{t('ai.analysisHeader')}</b><small>OpenAI-compatible model · no payment tools</small></div><span className="sample-tag">ADVISORY</span></div>
          <form className="copilot-form" onSubmit={handleAssessment}>
            <label className="copilot-field"><span>{t('ai.listingText')}</span><textarea value={listingText} onChange={(event) => setListingText(fieldText(event))} placeholder={t('ai.listingPlaceholder')} rows={5} maxLength={8000} disabled={Boolean(transactionId.trim()) || busy}/><small>{listingText.length}/8,000</small></label>
            <label className="copilot-field"><span>{t('ai.conversation')}</span><textarea value={conversationText} onChange={(event) => setConversationText(fieldText(event))} placeholder={t('ai.conversationPlaceholder')} rows={4} maxLength={8000} disabled={busy}/><small>{conversationText.length}/8,000</small></label>
            <details className="copilot-saved-transaction">
              <summary>{t('ai.savedTransaction')}</summary>
              <label className="copilot-field"><span>{t('ai.transactionOptional')}</span><input value={transactionId} onChange={(event) => setTransactionId(fieldText(event))} maxLength={120} disabled={busy} placeholder="tx_…"/></label>
              <small>{t('ai.savedPolicy')}</small>
            </details>
            {!transactionId.trim() && mandate && <>
              <div className="copilot-field-grid">
                <label className="copilot-field"><span>{t('ai.itemName')}</span><input value={itemName} onChange={(event) => setItemName(fieldText(event))} required maxLength={180} disabled={busy}/></label>
                <label className="copilot-field"><span>{t('ai.askingPrice')} · {mandate.currency}</span><input type="number" min="0" step={mandate.currency === 'JPY' || mandate.currency === 'KRW' ? '1' : mandate.currency === 'KWD' || mandate.currency === 'BHD' ? '0.001' : '0.01'} value={price} onChange={(event) => setPrice(fieldText(event))} required disabled={busy}/></label>
                <label className="copilot-field"><span>{t('ai.category')}</span><select value={category} onChange={(event) => setCategory(fieldText(event))} required disabled={busy}>{mandate.allowedCategories.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
                <label className="copilot-field"><span>{t('ai.handoffTime')} · {mandate.meetupRules.timeZone}</span><input type="time" value={meetupTime} onChange={(event) => setMeetupTime(fieldText(event))} required disabled={busy}/></label>
              </div>
              <label className="copilot-field"><span>{t('ai.handoffLocation')}</span><input value={meetupLocation} onChange={(event) => setMeetupLocation(fieldText(event))} required maxLength={180} disabled={busy}/></label>
              <label className="copilot-check"><input type="checkbox" checked={publicPlace} onChange={(event) => setPublicPlace(event.target.checked)} disabled={busy}/><span>{t('ai.publicPlace')}</span></label>
            </>}
            <p className="copilot-disclosure"><MessageSquareText size={14}/><span>{t('ai.providerDisclosure')} {t('ai.inputLimit')}</span></p>
            <button type="submit" className="button button-lime copilot-submit" disabled={busy || !mandate || (!transactionId.trim() && (!listingText.trim() || !itemName.trim() || !category || !meetupLocation.trim()))}>
              {busy ? <><span className="copilot-spinner" aria-hidden="true"/>{t('ai.analyzing')}</> : <><Sparkles size={14}/>{t('ai.analyze')}</>}
            </button>
          </form>
          {error && <p className="copilot-error" role="alert"><AlertTriangle size={15}/>{error}</p>}
        </section>

        <aside className="agent-side copilot-side">
          <section className="panel process-panel copilot-policy-panel">
            <div className="panel-head"><div><span className="eyebrow">AUTHORITY BOUNDARY</span><h2>{t('ai.policyCheck')}</h2></div><ShieldCheck size={17}/></div>
            {policy ? <><div className="policy-result-row"><span><ShieldCheck size={15}/>{policy.source === 'persisted_transaction' ? t('ai.savedPolicy') : t('ai.standalonePolicy')}</span><StatusBadge status={policy.decision} small/></div><p className="copilot-policy-explanation">{policy.explanation}</p>{policy.reasonCodes?.length > 0 && <div className="copilot-reason-codes">{policy.reasonCodes.map((code) => <span key={code}>{code}</span>)}</div>}<p className="copilot-evaluation-only"><Check size={13}/>{t('ai.evaluationOnly')}</p></> : <p className="copilot-policy-empty">{t('ai.noPolicy')}</p>}
            <p className="copilot-policy-foot"><b>AI cannot change this result.</b> No transaction state, guardian decision, authorization, capture, or void is written by this assessment.</p>
          </section>

          {assessment ? <section className="panel recommendation-panel copilot-result-panel" aria-live="polite">
            <div className="panel-head"><div><span className="eyebrow">{t('ai.riskLevel')}</span><h2>{recommendationLabel(assessment.riskLevel)}</h2></div><span className={`copilot-risk copilot-risk-${assessment.riskLevel.toLowerCase()}`}>{assessment.riskLevel}</span></div>
            <div className="copilot-model-meta">{result.provider} · {result.model}</div>
            <div className="copilot-summary"><b>{assessment.purchaseSummary.item || result.purchaseDetails.itemName || 'Purchase details'}</b><span>Proposed: {money(result.purchaseDetails.amountMinor, result.purchaseDetails.currency)}</span>{assessment.purchaseSummary.askingPrice && <small>AI-extracted listing price: {money(assessment.purchaseSummary.askingPrice.amountMinor, assessment.purchaseSummary.askingPrice.currency)}</small>}{assessment.purchaseSummary.condition && <p>{assessment.purchaseSummary.condition}</p>}</div>
            {assessment.purchaseSummary.sellerClaims.length > 0 && <div className="copilot-result-block"><h3>Seller claims</h3><ul>{assessment.purchaseSummary.sellerClaims.map((claim, index) => <li key={`${claim}-${index}`}>{claim}</li>)}</ul></div>}
            {assessment.purchaseSummary.details.length > 0 && <div className="copilot-result-block"><h3>Listing details</h3><ul>{assessment.purchaseSummary.details.map((detail, index) => <li key={`${detail}-${index}`}>{detail}</li>)}</ul></div>}
            <div className="copilot-result-block"><h3>{t('ai.findings')}</h3>{assessment.findings.length ? assessment.findings.map((finding, index) => <article className="copilot-finding" key={`${finding.code}-${index}`}><div><span className={`finding-severity severity-${finding.severity.toLowerCase()}`}>{finding.severity}</span><b>{finding.title}</b></div><p>{finding.explanation}</p><blockquote>“{finding.evidence}”</blockquote><small>{finding.whyItMatters}</small></article>) : <p>{t('ai.noFindings')}</p>}</div>
            <div className="copilot-result-block"><h3>{t('ai.missingInfo')}</h3><ul>{assessment.missingInformation.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul></div>
            <div className="copilot-result-block"><h3>{t('ai.questions')}</h3><ul>{assessment.sellerQuestions.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul></div>
            <div className="copilot-recommendation"><span className="eyebrow">{t('ai.recommendation')}</span><b>{recommendationLabel(assessment.recommendation.nextStep)}</b><p>{assessment.recommendation.explanation}</p></div>
            {assessment.negotiation.counteroffer && <div className="copilot-counteroffer"><span className="eyebrow">{t('ai.counteroffer')}</span><b>{money(assessment.negotiation.counteroffer.amountMinor, assessment.negotiation.counteroffer.currency)}</b><p>{assessment.negotiation.counteroffer.rationale}</p></div>}
            {assessment.negotiation.questions.length > 0 && <div className="copilot-result-block"><h3>Negotiation prompts</h3><ul>{assessment.negotiation.questions.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul></div>}
            <div className="copilot-draft"><div><span className="eyebrow">{t('ai.negotiationDraft')}</span><button type="button" className="button button-outline button-small" onClick={copyDraft} disabled={!assessment.negotiation.messageDraft}><Clipboard size={13}/>{copied ? t('ai.copied') : t('ai.copyDraft')}</button></div><p>{assessment.negotiation.messageDraft || 'No message draft was suggested.'}</p><small>{t('ai.messageReview')}</small></div>
          </section> : <section className="panel recommendation-panel copilot-empty-panel"><div className="panel-head"><div><span className="eyebrow">PURCHASE COPILOT</span><h2>Evidence before action</h2></div><Sparkles size={17}/></div><ul><li>Listing and conversation are analyzed as untrusted seller-provided data.</li><li>Evidence excerpts are checked against the submitted source text.</li><li>Policy evaluation is computed separately by Safe Mandate's deterministic engine.</li></ul><p>{t('ai.advisory')}</p></section>}
        </aside>
      </div>
    </>}

    <div className="agent-bottom-note"><ShieldCheck size={16}/><span><b>{t('copy.suggestions_are_not_decisions_afd69db')}</b> {t('copy.a_backend_policy_evaluation_is_require_7eee380')} {t('ai.advisory')}</span><ArrowRight size={14}/></div>
  </div></PageFrame>;
}
