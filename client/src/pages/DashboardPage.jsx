import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, ArrowUpRight, Bell, Clock3, Headphones, LockKeyhole, MapPin, ShieldCheck, Sparkles, WalletCards, Zap } from 'lucide-react';
import { Link } from 'react-router-dom';
import PageFrame from '../components/PageFrame.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { CategoryChart, OutcomeChart, WeeklyChart } from '../components/Charts.jsx';
import { demoService, deriveAnalytics } from '../services/demoService.js';
import { dateLabel, money, numberLabel } from '../services/format.js';
import { CURRENCY_MINOR_UNITS } from '../data/currencyMeta.js';

function Widget({ title, eyebrow, children, className = '', action }) {
  return <section className={`panel fin-widget ${className}`}><div className="fin-widget-head"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div>{action}</div>{children}</section>;
}

export default function DashboardPage() {
  const { t } = useTranslation();
  const [range, setRange] = useState(30);
  const mandate = demoService.getMandate();
  const transactions = demoService.getTransactions();
  const analytics = useMemo(() => deriveAnalytics(transactions, mandate, range), [transactions, mandate, range]);
  const categoryMix = useMemo(() => {
    const totals = new Map();
    for (const item of transactions) totals.set(item.category, (totals.get(item.category) ?? 0) + item.amountMinor / 10 ** (CURRENCY_MINOR_UNITS[item.currency] ?? 2));
    return [...totals].map(([name, value]) => ({ name, value: Math.round(value) }));
  }, [transactions]);
  const active = transactions.find(item => item.state === 'NEEDS_GUARDIAN');
  const amountUsed = transactions.filter(item => item.state === 'CAPTURED').reduce((sum, item) => sum + item.amountMinor, 0);
  const progress = Math.min(100, Math.round(amountUsed / mandate.maxAmountMinor * 100));
  const recent = [...transactions].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  const rangeControl = <label className="select-wrap range-select"><span className="sr-only">{t('copy.chart_date_range_b18d49f')}</span><select value={range} onChange={event => setRange(Number(event.target.value))}><option value="7">{t('copy.7_days_0a8dd6a')}</option><option value="30">{t('copy.30_days_7d4278a')}</option><option value="90">{t('copy.90_days_170621a')}</option></select></label>;

  return <PageFrame className="app-page dashboard-app-page"><div className="page-shell dashboard-shell fin-dashboard">
    <div className="demo-ribbon"><span className="demo-pulse"/>{t('demo.source')}<span className="ribbon-right">{t('copy.paypal_not_connected_e4a67aa')}</span></div>
    <header className="fin-dashboard-heading"><div><span className="eyebrow"><span className="live-dot"/>{t('copy.your_control_center_39b6ef1')}</span><h1>{t('nav.overview')}</h1><p>{t('copy.autonomous_discovery_deterministic_gua_e2384c1')}</p></div><div className="fin-heading-meta"><span><Clock3 size={13}/>{dateLabel('2026-11-09')}</span><span className="fin-secure-label"><LockKeyhole size={13}/>{t('copy.paypal_not_connected_e4a67aa')}</span></div></header>

    <div className="fin-dashboard-grid">
      <section className="fin-balance-card">
        <div className="fin-balance-top"><span>{t('copy.active_mandate_2a08611')}</span><span className="fin-balance-live"><i/>{t('copy.active_1df0eaf')}</span></div>
        <strong>{money(mandate.maxAmountMinor, mandate.currency)}</strong>
        <span className="fin-balance-caption">{t('copy.maximum_purchase_8503bee')}{mandate.currency}</span>
        <div className="fin-balance-progress"><span style={{ width: `${progress}%` }}/></div>
        <div className="fin-balance-bottom"><span>{t('metric.capturedSpend')}: {money(amountUsed, mandate.currency)}</span><Link to="/app/mandate">{t('copy.manage_mandate_9aeebad')}<ArrowUpRight size={14}/></Link></div>
        <div className="fin-balance-chips"><span><ShieldCheck size={12}/>{numberLabel(mandate.allowedCategories.length)} {t('dashboard.categories')}</span><span><Clock3 size={12}/>{t('copy.expires_2159403')}{dateLabel(mandate.expiresAt.slice(0, 10))}</span></div>
      </section>

      <Widget eyebrow={t('panel.attention')} title={t('metric.guardianReview')} className="fin-review-widget" action={<Link className="fin-icon-link" aria-label={t('copy.view_proposal_74fd7e2')} to="/app/transactions"><ArrowUpRight size={14}/></Link>}>
        <div className="fin-review-value">{numberLabel(analytics.counts.guardian)} <span>{t('metric.awaitingReview')}</span></div>
        <div className="fin-review-status"><span className="fin-status-dot"/><div><b>{active ? t('status.NEEDS_GUARDIAN') : t('copy.no_open_proposals_right_now_bde8195')}</b><small>{active ? active.item : t('copy.all_transactions_cae33d3')}</small></div></div>
        {active && <Link to={`/app/transactions?selected=${active.id}`} className="fin-text-link">{t('copy.review_proposal_3ae0f97')}<ArrowRight size={13}/></Link>}
      </Widget>

      <Widget eyebrow={t('panel.paymentProtection')} title={t('copy.your_money_stays_yours_12c8e81')} className="fin-protection-widget" action={<span className="fin-icon-link"><LockKeyhole size={13}/></span>}>
        <div className="fin-protection-value"><ShieldCheck size={22}/><span>{t('copy.no_payment_authorization_c84b308')}</span></div>
        <div className="fin-protection-note"><i/>{t('copy.not_connected_ff11fa8')}</div>
        <p>{t('copy.paypal_is_not_connected_no_order_hold__42085a2')}</p>
        <Link to="/app/activity" className="fin-text-link">{t('copy.view_activity_log_a84d9c9')}<ArrowRight size={13}/></Link>
      </Widget>

      <Widget eyebrow={t('panel.volume')} title={t('copy.weekly_purchase_activity_37005fe')} className="fin-budget-widget" action={rangeControl}>
        <div className="fin-widget-stat"><span>{t('copy.proposals_in_period_ba44ca0')}</span><b>{numberLabel(analytics.counts.total)} <small>{t('copy.total_5a537e2')}</small></b></div>
        <div className="fin-chart-area"><WeeklyChart data={analytics.weekly}/></div>
        <div className="fin-chart-legend"><span><i className="fin-legend-lime"/>{t('copy.proposals_in_period_ba44ca0')}</span><span><i className="fin-legend-muted"/>{t('copy.confirmed_captured_spend_only_820ef2b')}</span></div>
      </Widget>

      <Widget eyebrow={t('panel.policyOutcomes')} title={t('copy.proposal_decisions_62f6ad2')} className="fin-outcomes-widget">
        <div className="fin-outcome-chart"><OutcomeChart data={analytics.outcomes}/><div className="fin-outcome-total"><b>{numberLabel(analytics.counts.total)}</b><small>{t('copy.total_5a537e2')}</small></div></div>
        <div className="fin-outcome-legend"><span><i className="outcome-review"/>{t('status.NEEDS_GUARDIAN')}<b>{numberLabel(analytics.counts.guardian)}</b></span><span><i className="outcome-approval"/>{t('dashboard.approved')}<b>{numberLabel(analytics.counts.approved)}</b></span><span><i className="outcome-closed"/>{t('dashboard.closed')}<b>{numberLabel(analytics.counts.blocked)}</b></span></div>
      </Widget>

      <Widget eyebrow={t('dashboard.proposalMix')} title={t('copy.by_category_b0e3606')} className="fin-category-widget" action={<Link className="fin-icon-link" aria-label={t('copy.view_transactions_ff43509')} to="/app/transactions"><ArrowUpRight size={14}/></Link>}>
        <div className="fin-category-content"><div className="fin-category-chart"><CategoryChart data={categoryMix}/></div><div className="fin-category-legend">{categoryMix.slice(0, 4).map((item, index) => <div key={item.name}><i className={`legend-swatch swatch-${index % 5}`}/><span>{t(`category.${item.name}`)}</span><b>{money(item.value * 100, mandate.currency)}</b></div>)}</div></div>
      </Widget>

      <Widget eyebrow={t('panel.attention')} title={t('copy.current_purchase_7a0b638')} className="fin-active-widget" action={<Link className="fin-text-link" to="/app/transactions">{t('copy.all_transactions_cae33d3')}<ArrowRight size={13}/></Link>}>
        {active ? <><div className="fin-active-item"><span className="fin-product-icon"><Headphones size={20}/></span><div><b>{active.item}</b><small>{active.seller}</small></div><StatusBadge status={active.state} small/></div><div className="fin-active-price">{money(active.amountMinor, active.currency)}<span>{t('copy.seller_asking_30dc767')}</span></div><div className="fin-active-info"><span><MapPin size={12}/>{active.meetup}</span><span><Clock3 size={12}/>{active.meetupTime} · {mandate.meetupRules.timeZone}</span></div><div className="fin-active-exception"><Zap size={13}/>{active.policyCodes.map(code => t(`reasonCode.${code}`, { defaultValue: code })).join(' · ')}</div><Link className="button button-lime fin-review-button" to={`/app/transactions?selected=${active.id}`}>{t('copy.view_proposal_74fd7e2')}<ArrowRight size={14}/></Link></> : <div className="fin-empty-state">{t('copy.no_open_proposals_right_now_bde8195')}</div>}
      </Widget>

      <Widget eyebrow={t('panel.guardianConnection')} title={t('copy.a_human_in_the_loop_387bbf7')} className="fin-guardian-widget" action={<Link className="fin-icon-link" aria-label={t('copy.preview_21d4679')} to="/guardian/demo-review"><ArrowUpRight size={14}/></Link>}>
        <div className="fin-guardian-row"><span className="fin-guardian-avatar">AK</span><div><b>{t('copy.anika_kapoor_71ae171')}</b><small>{t('copy.nominated_guardian_demo_profile_915dd71')}</small></div><span className="fin-connected"><i/>{t('copy.connected_8950d06')}</span></div>
        <div className="fin-guardian-foot"><span><b>{numberLabel(analytics.counts.guardian)}</b>{t('copy.pending_review_57c2318')}</span><Link to="/guardian/demo-review">{t('copy.preview_21d4679')}<ArrowRight size={13}/></Link></div>
      </Widget>

      <Widget eyebrow={t('panel.agentWorkspace')} title={t('copy.agent_workspace_preview_78e7b3f')} className="fin-agent-widget" action={<Link className="fin-icon-link" aria-label={t('copy.open_workspace_f54c122')} to="/app/agent"><ArrowUpRight size={14}/></Link>}>
        <div className="fin-agent-callout"><span><Sparkles size={16}/></span><div><b>{t('copy.find_me_a_great_pair_of_headphones_und_b9cf736')}</b><small>{t('copy.sample_interaction_no_ai_service_conne_18538db')}</small></div></div>
        <div className="fin-agent-progress"><span/><span/><i/></div>
        <div className="fin-agent-steps"><span>{t('copy.listings_compared_f281a39')}</span><b>{t('copy.mandate_check_94118ba')}</b></div>
        <Link className="fin-text-link" to="/app/agent">{t('copy.open_workspace_f54c122')}<ArrowRight size={13}/></Link>
      </Widget>

      <Widget eyebrow={t('dashboard.recentActivity')} title={t('dashboard.transactionHistory')} className="fin-history-widget" action={<Link className="fin-icon-link" aria-label={t('copy.all_transactions_cae33d3')} to="/app/transactions"><ArrowUpRight size={14}/></Link>}>
        <div className="fin-history-filter"><span className="active">{t('dashboard.all')}</span><span>{t('dashboard.needsReview')}</span><Link to="/app/transactions">{t('dashboard.viewAll')}</Link></div>
        <div className="fin-history-list">{recent.map(item => <Link to={`/app/transactions?selected=${item.id}`} className="fin-history-item" key={item.id}><span className="fin-history-mark">{item.state === 'NEEDS_GUARDIAN' ? <Bell size={14}/> : item.state === 'CAPTURED' ? <WalletCards size={14}/> : <ShieldCheck size={14}/>}</span><span className="fin-history-copy"><b>{item.item}</b><small>{item.seller} · {dateLabel(item.date)}</small></span><span className="fin-history-amount">{money(item.amountMinor, item.currency)}<StatusBadge status={item.state} small/></span></Link>)}</div>
      </Widget>
    </div>
    <div className="fin-dashboard-footer"><span>{t('demo.source')}</span><Link to="/app/activity">{t('copy.view_activity_log_a84d9c9')}<ArrowRight size={13}/></Link></div>
  </div></PageFrame>;
}
