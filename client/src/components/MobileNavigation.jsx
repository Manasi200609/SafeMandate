import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink } from 'react-router-dom';
import { Home, Sparkles, ReceiptText, SlidersHorizontal, MoreHorizontal, UserRound, Activity, Settings, ShieldCheck, Volume2, VolumeX } from 'lucide-react';
import LanguageSelector from './LanguageSelector.jsx';
import Modal from './Modal.jsx';
import { useSound } from './SoundContext.jsx';

const links=[
  {to:'/app',label:'nav.home',Icon:Home,end:true},
  {to:'/app/agent',label:'nav.agent',Icon:Sparkles},
  {to:'/app/transactions',label:'nav.transactions',Icon:ReceiptText},
  {to:'/app/mandate',label:'nav.mandate',Icon:SlidersHorizontal},
];

export default function MobileNavigation(){
  const { t }=useTranslation();
  const { enabled: soundEnabled, toggle: toggleSound }=useSound();
  const [moreOpen,setMoreOpen]=useState(false);
  return <>
    <nav className="mobile-tabbar" aria-label={t('copy.main_navigation_efd197f')}>
      {links.map(({to,label,Icon,end})=><NavLink key={label} to={to} end={end} className={({isActive})=>`mobile-tab ${isActive?'active':''}`}><Icon size={19} strokeWidth={1.8}/><span>{t(label)}</span></NavLink>)}
      <button type="button" className={`mobile-tab mobile-more-tab ${moreOpen?'active':''}`} aria-haspopup="dialog" aria-expanded={moreOpen} onClick={()=>setMoreOpen(true)}><MoreHorizontal size={19} strokeWidth={1.8}/><span>{t('nav.more')}</span></button>
    </nav>
    <Modal open={moreOpen} title={t('nav.more')} onClose={()=>setMoreOpen(false)}>
      <div className="mobile-profile-sheet">
        <div className="mobile-more-profile"><UserRound size={17}/><span><b>{t('nav.profile')}</b><small>{t('profile.accountPreview')}</small></span></div>
        <div className="mobile-more-settings"><Settings size={17}/>{t('nav.settings')}</div>
        <div className="sound-setting"><span className="sound-setting-icon">{soundEnabled?<Volume2 size={15}/>:<VolumeX size={15}/>}</span><span><b>{t('sound.title')}</b><small>{t('sound.description')}</small></span><button type="button" role="switch" aria-checked={soundEnabled} aria-label={t('sound.title')} className={`sound-switch ${soundEnabled?'is-on':''}`} onClick={toggleSound}><i/></button></div>
        <div className="mobile-profile-language"><span>{t('settings.language')}</span><LanguageSelector/></div>
        <Link to="/app/activity" onClick={()=>setMoreOpen(false)}><Activity size={17}/>{t('profile.activity')}</Link>
        <Link to="/guardian/demo-review" onClick={()=>setMoreOpen(false)}><ShieldCheck size={17}/>{t('nav.guardian')}</Link>
      </div>
    </Modal>
  </>;
}
