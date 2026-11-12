import { useTranslation } from 'react-i18next';
import { lazy, Suspense, useEffect, useState } from 'react';
import { AnimatePresence, MotionConfig } from 'framer-motion';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { WifiOff, RefreshCw } from 'lucide-react';
import TopNav from './components/TopNav.jsx';
import MobileNavigation from './components/MobileNavigation.jsx';
import { ToastProvider } from './components/ToastContext.jsx';
import { SoundProvider } from './components/SoundContext.jsx';
const LandingPage=lazy(()=>import('./pages/LandingPage.jsx'));
const DashboardPage=lazy(()=>import('./pages/DashboardPage.jsx'));
const AgentPage=lazy(()=>import('./pages/AgentPage.jsx'));
const MandatePage=lazy(()=>import('./pages/MandatePage.jsx'));
const TransactionsPage=lazy(()=>import('./pages/TransactionsPage.jsx'));
const GuardianPage=lazy(()=>import('./pages/GuardianPage.jsx'));
const MeetupPage=lazy(()=>import('./pages/MeetupPage.jsx'));
const ActivityPage=lazy(()=>import('./pages/ActivityPage.jsx'));
const PaypalCallbackPage=lazy(()=>import('./pages/PaypalCallbackPage.jsx'));

function RouteView(){const { t } = useTranslation();
const location=useLocation();const app=location.pathname.startsWith('/app');const [online,setOnline]=useState(()=>navigator.onLine);useEffect(()=>{const onlineAgain=()=>setOnline(true),offline=()=>setOnline(false);window.addEventListener('online',onlineAgain);window.addEventListener('offline',offline);return()=>{window.removeEventListener('online',onlineAgain);window.removeEventListener('offline',offline);};},[]);useEffect(()=>{if(online)window.scrollTo({top:0,behavior:'instant'});},[location.pathname,online]);if(!online)return <main className="offline-screen" role="status"><div className="offline-mark"><WifiOff size={28}/></div><span className="eyebrow">{t("copy.safe_mandate_offline_e937f73")}</span><h1>{t("copy.you_re_offline_b9a8159")}</h1><p>{t("copy.live_transaction_and_guardian_informat_27fab7d")}</p><button className="button button-lime" onClick={()=>window.location.reload()}><RefreshCw size={15}/>{t("copy.try_again_63044a8")}</button></main>;return <>{app&&<><TopNav/><MobileNavigation/></>}<Suspense fallback={<main className="route-loading" role="status">{t("copy.opening_safe_mandate_f5564a3")}</main>}><AnimatePresence mode="wait" initial={false}><Routes location={location} key={location.pathname}><Route path="/" element={<LandingPage/>}/><Route path="/paypal/return" element={<PaypalCallbackPage outcome="return"/>}/><Route path="/paypal/cancel" element={<PaypalCallbackPage outcome="cancel"/>}/><Route path="/app" element={<DashboardPage/>}/><Route path="/app/agent" element={<AgentPage/>}/><Route path="/app/mandate" element={<MandatePage/>}/><Route path="/app/transactions" element={<TransactionsPage/>}/><Route path="/app/meetup/:transactionId" element={<MeetupPage/>}/><Route path="/app/activity" element={<ActivityPage/>}/><Route path="/guardian/:token" element={<GuardianPage/>}/><Route path="*" element={<Navigate to="/" replace/>}/></Routes></AnimatePresence></Suspense></>}
export default function App(){return <MotionConfig reducedMotion="user"><SoundProvider><ToastProvider><RouteView/></ToastProvider></SoundProvider></MotionConfig>}
