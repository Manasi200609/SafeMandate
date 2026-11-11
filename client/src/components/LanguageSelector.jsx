import { useTranslation } from 'react-i18next';
import i18n,{languageNames,supportedLanguages} from '../locales/index.js';

export default function LanguageSelector({compact=false}){
  const {t}=useTranslation();
  return <label className={`language-selector ${compact?'compact':''}`}>
    <span className="sr-only">{t('language.label')}</span>
    <select aria-label={t('language.label')} value={i18n.resolvedLanguage??i18n.language} onChange={event=>i18n.changeLanguage(event.target.value)}>
      {supportedLanguages.map(language=><option value={language} key={language}>{languageNames[language]}</option>)}
    </select>
  </label>;
}
