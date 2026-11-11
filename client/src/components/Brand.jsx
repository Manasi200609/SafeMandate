import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
export default function Brand({light=false}){const { t } = useTranslation();
return <Link className={`brand ${light?'brand-light':''}`} to="/" aria-label={t("copy.safe_mandate_home_327f7fe")}><span className="brand-mark"><ShieldCheck size={20} strokeWidth={1.8}/></span><span>{t("copy.safe_bf31c52")}<span className="brand-word">{t("copy.mandate_20dfcdc")}</span></span></Link>;}
