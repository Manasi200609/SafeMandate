import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import {
  Activity, ArrowDown, ArrowRight, ArrowUpRight, BadgeCheck, Banknote,
  BookOpenCheck, Bot, Check, CircleDollarSign, ClipboardCheck, Compass,
  FileClock, Fingerprint, Gauge, HandCoins, Handshake, LockKeyhole,
  MessageSquareText, PackageSearch, ScanSearch, ShieldCheck, Sparkles,
  UserRoundCheck, WalletCards, Waypoints, Zap,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import TopNav from '../components/TopNav.jsx';
import PageFrame from '../components/PageFrame.jsx';
import RibbonScene from '../components/RibbonScene.jsx';
import { useToast } from '../components/ToastContext.jsx';
import '../styles/landing.css';

const reveal={initial:{opacity:0,y:10},whileInView:{opacity:1,y:0},viewport:{once:true,amount:.18},transition:{duration:.38,ease:[.22,1,.36,1]}};

function ProductPreview(){
  const {t}=useTranslation();
  const steps=[['01',t('landingV2.preview.step1'),true],['02',t('landingV2.preview.step2'),true],['03',t('landingV2.preview.step3'),true],['04',t('landingV2.preview.step4'),false],['05',t('landingV2.preview.step5'),false]];
  return <motion.div className="landing-product" {...reveal}>
    <RibbonScene className="lp-ribbon-mark" />
    <div className="lp-orbit lp-orbit-one" aria-hidden="true"/><div className="lp-orbit lp-orbit-two" aria-hidden="true"/>
    <div className="lp-product-window">
      <div className="lp-window-bar"><div className="lp-brand-mini"><span><ShieldCheck size={13}/></span>safemandate</div><span className="lp-preview-tag"><i/>{t('landingV2.preview.illustrative')}</span><span className="lp-window-account">{t('landingV2.preview.buyer')}</span></div>
      <div className="lp-product-content">
        <div className="lp-product-title"><div><span className="lp-kicker">{t('landingV2.preview.eyebrow')}</span><h2>{t('landingV2.preview.title')}</h2></div><span className="lp-reference">SM · 2041</span></div>
        <article className="lp-proposal-card">
          <div className="lp-item-icon"><PackageSearch size={20}/></div>
          <div className="lp-item-copy"><span>{t('landingV2.preview.sampleListing')}</span><h3>{t('landingV2.preview.product')}</h3><small>{t('landingV2.preview.seller')}</small></div>
          <div className="lp-item-price"><strong>₹12,400</strong><span>INR</span></div>
          <div className="lp-rule-state"><span className="lp-check-icon"><Check size={12}/></span><div><b>{t('landingV2.preview.withinMandate')}</b><small>{t('landingV2.preview.exampleOnly')}</small></div><span className="lp-state-chip">{t('landingV2.preview.sample')}</span></div>
          <div className="lp-spend-row"><span>{t('landingV2.preview.spendingLimit')}</span><b>₹15,000</b></div>
          <div className="lp-meter"><span/></div>
          <div className="lp-meter-foot"><span>{t('landingV2.preview.utilized')} <b>₹12,400</b></span><span>{t('landingV2.preview.remaining')} <b>₹2,600</b></span></div>
          <div className="lp-assessment"><div className="lp-assessment-icon"><Sparkles size={15}/></div><div><small>{t('landingV2.preview.aiAssessment')}</small><b>{t('landingV2.preview.aiAssessmentValue')}</b></div><span>{t('landingV2.preview.illustrative')}</span></div>
          <div className="lp-assessment lp-policy-assessment"><div className="lp-assessment-icon"><Gauge size={15}/></div><div><small>{t('landingV2.preview.policyAssessment')}</small><b>{t('landingV2.preview.assessmentValue')}</b></div><span>{t('landingV2.preview.illustrative')}</span></div>
          <div className="lp-payment-note"><LockKeyhole size={13}/><span>{t('landingV2.preview.noPayment')}</span></div>
        </article>
        <div className="lp-lifecycle-heading"><span>{t('landingV2.preview.lifecycle')}</span><small>{t('landingV2.preview.plannedSteps')}</small></div>
        <ol className="lp-lifecycle">{steps.map(([number,label,complete])=><li className={complete?'is-complete':''} key={number}><span className="lp-step-node">{complete?<Check size={11}/>:number}</span><small>{label}</small></li>)}</ol>
      </div>
    </div>
    <div className="lp-float-note lp-note-policy"><span><ShieldCheck size={15}/></span><div><b>{t('landingV2.preview.policyLayer')}</b><small>{t('landingV2.preview.deterministic')}</small></div><i/></div>
    <div className="lp-float-note lp-note-guardian"><span><UserRoundCheck size={15}/></span><div><b>{t('landingV2.preview.humanLayer')}</b><small>{t('landingV2.preview.exceptionsOnly')}</small></div></div>
  </motion.div>;
}

function ProblemSection(){
  const {t}=useTranslation();
  const issues=[['01','unrestricted',Fingerprint],['02','unclear',ScanSearch],['03','release',CircleDollarSign]];
  return <section className="lp-problem lp-section" id="problem"><div className="lp-container lp-problem-layout"><motion.div {...reveal} className="lp-section-intro"><span className="lp-eyebrow">{t('landingV2.problem.eyebrow')}</span><h2>{t('landingV2.problem.title')}</h2><p>{t('landingV2.problem.body')}</p></motion.div><div className="lp-issue-list">{issues.map(([n,key,Icon])=><motion.article {...reveal} className="lp-issue" key={key}><span className="lp-issue-number">{n}</span><span className="lp-issue-icon"><Icon size={18}/></span><div><h3>{t(`landingV2.problem.${key}Title`)}</h3><p>{t(`landingV2.problem.${key}Body`)}</p></div><ArrowUpRight size={15}/></motion.article>)}</div></div></section>;
}

function HowItWorks(){
  const {t}=useTranslation();
  const steps=[['01','discover',Compass],['02','evaluate',ScanSearch],['03','enforce',ShieldCheck],['04','confirm',Handshake],['05','settle',Banknote]];
  return <section className="lp-how lp-section" id="how"><div className="lp-container"><motion.div {...reveal} className="lp-section-heading"><span className="lp-eyebrow">{t('landingV2.how.eyebrow')}</span><h2>{t('landingV2.how.title')}</h2><p>{t('landingV2.how.body')}</p></motion.div><div className="lp-timeline">{steps.map(([number,key,Icon],i)=><motion.article {...reveal} className={`lp-timeline-step ${i===2?'lp-step-policy':''}`} key={key}><div className="lp-timeline-top"><span>{number}</span><i/><Icon size={17}/></div><h3>{t(`landingV2.how.${key}Title`)}</h3><p>{t(`landingV2.how.${key}Body`)}</p>{i===2&&<span className="lp-step-owner">{t('landingV2.how.owner')}</span>}{i===4&&<span className="lp-planned-label">{t('landingV2.common.planned')}</span>}</motion.article>)}</div><p className="lp-ai-boundary"><Bot size={15}/>{t('landingV2.how.boundary')}</p></div></section>;
}

function Architecture(){
  const {t}=useTranslation();
  const layers=[['01','ai',Sparkles,false],['02','policy',ClipboardCheck,false],['03','payment',WalletCards,true]];
  return <section className="lp-architecture lp-section" id="protection"><div className="lp-container"><motion.div {...reveal} className="lp-section-heading"><span className="lp-eyebrow">{t('landingV2.architecture.eyebrow')}</span><h2>{t('landingV2.architecture.title')}</h2><p>{t('landingV2.architecture.body')}</p></motion.div><div className="lp-layer-stack">{layers.map(([num,key,Icon,planned])=><motion.article {...reveal} className={`lp-layer lp-layer-${key}`} key={key}><div className="lp-layer-top"><span>{t('landingV2.architecture.layer')} {num}</span>{planned&&<span className="lp-planned-label">{t('landingV2.common.planned')}</span>}</div><div className="lp-layer-title"><span><Icon size={19}/></span><h3>{t(`landingV2.architecture.${key}Title`)}</h3></div><p>{t(`landingV2.architecture.${key}Body`)}</p><ul>{[1,2,3].map(i=><li key={i}><Check size={12}/>{t(`landingV2.architecture.${key}${i}`)}</li>)}</ul><div className="lp-layer-role">{t(`landingV2.architecture.${key}Role`)}</div></motion.article>)}</div><div className="lp-layer-guard"><span><Waypoints size={15}/></span>{t('landingV2.architecture.guardrail')}</div></div></section>;
}

function Features(){
  const {t}=useTranslation();
  const items=[['discovery',PackageSearch,false],['risk',Activity,false],['mandate',BookOpenCheck,false],['limits',Gauge,false],['guardian',UserRoundCheck,false],['checkins',FileClock,true],['handoff',Handshake,true],['capture',HandCoins,true],['audit',MessageSquareText,false]];
  return <section className="lp-features lp-section" id="features"><div className="lp-container"><motion.div {...reveal} className="lp-section-heading lp-feature-heading"><div><span className="lp-eyebrow">{t('landingV2.features.eyebrow')}</span><h2>{t('landingV2.features.title')}</h2></div><p>{t('landingV2.features.body')}</p></motion.div><div className="lp-feature-grid">{items.map(([key,Icon,planned],i)=><motion.article {...reveal} className={`lp-feature lp-feature-${i+1}`} key={key}><span className="lp-feature-icon"><Icon size={17}/></span><h3>{t(`landingV2.features.${key}Title`)}</h3><p>{t(`landingV2.features.${key}Body`)}</p>{planned&&<small className="lp-planned-label">{t('landingV2.common.planned')}</small>}</motion.article>)}</div></div></section>;
}

function FinalCTA(){const {t}=useTranslation();return <section className="lp-final"><div className="lp-container lp-final-inner"><div><span className="lp-eyebrow">{t('landingV2.final.eyebrow')}</span><h2>{t('landingV2.final.title')}</h2><p>{t('landingV2.final.body')}</p></div><div className="lp-final-actions"><Link className="lp-cta lp-cta-primary" to="/app">{t('landingV2.final.primary')}<ArrowRight size={16}/></Link><a className="lp-cta lp-cta-secondary" href="#how">{t('landingV2.final.secondary')}<ArrowUpRight size={15}/></a></div></div><span className="lp-final-index" aria-hidden="true">SM / 01</span></section>}

function Footer(){const {t}=useTranslation();const notify=useToast();return <footer className="lp-footer"><div className="lp-container lp-footer-main"><div className="lp-footer-brand"><Link className="lp-footer-logo" to="/"><span><ShieldCheck size={18}/></span>safemandate</Link><p>{t('landingV2.footer.body')}</p><span className="lp-footer-caption">{t('copy.2026_safe_mandate_phase_1_domain_previ_f868528')}</span></div><div className="lp-footer-links"><span>{t('landingV2.footer.explore')}</span><a href="#how">{t('copy.how_it_works_1dd6a17')}</a><a href="#protection">{t('copy.protection_0f8cc4f')}</a><a href="#features">{t('copy.features_fc338f8')}</a></div><div className="lp-footer-links"><span>{t('landingV2.footer.product')}</span><Link to="/app">{t('copy.sign_in_ada2e9e')}</Link><Link to="/app/activity">{t('copy.activity_preview_5206f25')}</Link><button onClick={()=>notify(t('landing.aboutPreview'))}>{t('copy.about_this_preview_dc012b8')}</button></div></div><div className="lp-container lp-footer-bottom"><span>© 2026 Safe Mandate</span><span>{t('landingV2.footer.disclaimer')}</span></div></footer>}

export default function LandingPage(){
  const {t}=useTranslation();
  return <PageFrame className="landing-page lp-page"><TopNav marketing/><main>
    <section className="lp-hero"><div className="lp-hero-grid" aria-hidden="true"/><div className="lp-container lp-hero-layout"><div className="lp-hero-copy"><motion.div initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} transition={{duration:.35}}><span className="lp-eyebrow lp-hero-eyebrow"><i/>{t('landingV2.hero.eyebrow')}</span><h1><span>{t('landingV2.hero.line1')}</span><span>{t('landingV2.hero.line2')}</span><span className="lp-accent-line">{t('landingV2.hero.line3')}</span></h1><p>{t('landingV2.hero.body')}</p><div className="lp-hero-actions"><Link className="lp-cta lp-cta-primary" to="/app">{t('landingV2.hero.primary')}<ArrowUpRight size={16}/></Link><a className="lp-cta lp-cta-secondary" href="#how"><span className="lp-play">▶</span>{t('landingV2.hero.secondary')}</a></div><div className="lp-trust-row">{['rule','guardian','handoff'].map(key=><span key={key}><Check size={13}/>{t(`landingV2.hero.trust.${key}`)}</span>)}</div></motion.div><div className="lp-mobile-product"><ProductPreview/></div></div><ProductPreview/></div><a className="lp-scroll-cue" href="#problem"><span>{t('landingV2.hero.scroll')}</span><ArrowDown size={14}/></a></section>
    <ProblemSection/><HowItWorks/><Architecture/><Features/><FinalCTA/><Footer/>
  </main></PageFrame>;
}
