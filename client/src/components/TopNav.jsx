import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Bell, ChevronDown, Menu, X, Shield, Volume2, VolumeX } from 'lucide-react';
import Brand from './Brand.jsx';
import LanguageSelector from './LanguageSelector.jsx';
import { useSound } from './SoundContext.jsx';

const items=[['nav.overview','/app'],['nav.agent','/app/agent'],['nav.transactions','/app/transactions'],['nav.mandate','/app/mandate'],['nav.guardian','/guardian/demo-review']];
export default function TopNav({marketing=false}){const { t } = useTranslation();
 const { enabled: soundEnabled, toggle: toggleSound } = useSound();

 const [open,setOpen]=useState(false),[notice,setNotice]=useState(false),[profile,setProfile]=useState(false),[scrolled,setScrolled]=useState(false);
 useEffect(()=>{if(!marketing)return;const update=()=>setScrolled(window.scrollY>12);update();window.addEventListener('scroll',update,{passive:true});return()=>window.removeEventListener('scroll',update);},[marketing]);
 const appNav=items.map(([label,to])=><NavLink key={label} to={to} end={to==='/app'} className={({isActive})=>`nav-link ${isActive?'active':''}`} onClick={()=>setOpen(false)}>{t(label)}</NavLink>);
 return <header className={`topnav ${marketing?'marketing-nav':''} ${marketing&&scrolled?'is-scrolled':''}`}>
  <div className="nav-inner"><Brand/>
   {marketing?<><nav className="marketing-links"><a href="#how">{t("copy.how_it_works_1dd6a17")}</a><a href="#protection">{t("copy.protection_0f8cc4f")}</a><a href="#features">{t("copy.features_fc338f8")}</a></nav><div className="nav-actions"><LanguageSelector compact/><Link className="nav-signin" to="/app">{t("copy.sign_in_ada2e9e")}</Link><Link className="button button-lime button-small" to="/app">{t("copy.enter_application_a63a41e")}<span aria-hidden="true">↗</span></Link></div></>:
   <><nav className="app-links">{appNav}</nav><div className="app-nav-actions"><LanguageSelector compact/><div className="nav-pop-wrap"><button className={`icon-button ${notice?'selected':''}`} aria-label={t("copy.notifications_753a22b")} aria-expanded={notice} onClick={()=>{setNotice(!notice);setProfile(false);}}><Bell size={17}/><i className="notification-dot"/></button>{notice&&<div className="nav-popover"><div className="popover-title">{t("copy.notifications_cd93422")}<span className="live-dot"/></div><p className="popover-message">{t("copy.one_proposal_is_waiting_for_guardian_r_41118f1")}</p><Link to="/app/transactions" onClick={()=>setNotice(false)}>{t("copy.review_proposal_3ae0f97")}<span>↗</span></Link></div>}</div><div className="nav-pop-wrap"><button className="profile-button" aria-label={t("copy.open_profile_menu_3697580")} aria-expanded={profile} onClick={()=>{setProfile(!profile);setNotice(false);}}><span className="avatar">MR</span><span className="profile-name">Mansi Rao</span><ChevronDown size={14}/></button>{profile&&<div className="nav-popover profile-pop"><div className="popover-title">{t("copy.demo_workspace_8ac2bdb")}</div><p className="popover-message">{t("copy.buyer_account_local_preview_13f4f1f")}</p><div className="sound-setting"><span className="sound-setting-icon">{soundEnabled?<Volume2 size={15}/>:<VolumeX size={15}/>}</span><span><b>{t('sound.title')}</b><small>{t('sound.description')}</small></span><button type="button" role="switch" aria-checked={soundEnabled} aria-label={t('sound.title')} className={`sound-switch ${soundEnabled?'is-on':''}`} onClick={toggleSound}><i/></button></div><span className="language-setting-label">{t('settings.language')}</span><LanguageSelector/><Link to="/" onClick={()=>setProfile(false)}>{t("copy.return_to_product_site_16f8f2f")}</Link></div>}</div><button className="mobile-menu-button" aria-label={t(open?'nav.close':'nav.menu')} aria-expanded={open} onClick={()=>setOpen(!open)}>{open?<X size={20}/>:<Menu size={20}/>}</button></div></>}
  </div>
  {!marketing&&open&&<nav className="mobile-nav">{appNav}<Link className="mobile-guardian-link" to="/guardian/demo-review" onClick={()=>setOpen(false)}><Shield size={16}/>{t("copy.guardian_preview_5b81c83")}</Link></nav>}
 </header>
}
