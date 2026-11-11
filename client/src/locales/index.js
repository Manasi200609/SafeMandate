import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en/translation.json' with { type: 'json' };
import hi from './hi/translation.json' with { type: 'json' };
import mr from './mr/translation.json' with { type: 'json' };

export const supportedLanguages=['en','hi','mr'];
export const languageNames={en:'English',hi:'हिन्दी',mr:'मराठी'};
export const localeByLanguage={en:'en-IN',hi:'hi-IN',mr:'mr-IN'};
export const LANGUAGE_STORAGE_KEY='safe-mandate-language';

export function getStoredLanguage(storage=globalThis.localStorage){
  try{const saved=storage?.getItem(LANGUAGE_STORAGE_KEY);return supportedLanguages.includes(saved)?saved:'en';}catch{return 'en';}
}
export function persistLanguage(language,storage=globalThis.localStorage){
  if(!supportedLanguages.includes(language))return false;
  try{storage?.setItem(LANGUAGE_STORAGE_KEY,language);return Boolean(storage);}catch{return false;}
}

i18n.use(initReactI18next).init({
  resources:{en:{translation:en},hi:{translation:hi},mr:{translation:mr}},
  lng:getStoredLanguage(),fallbackLng:'en',supportedLngs:supportedLanguages,
  keySeparator:false,interpolation:{escapeValue:false},react:{useSuspense:false}
});
const updateDocumentLanguage=language=>{if(typeof document!=='undefined')document.documentElement.lang=language;};
updateDocumentLanguage(i18n.resolvedLanguage??i18n.language);
i18n.on('languageChanged',language=>{persistLanguage(language);updateDocumentLanguage(language);});

export default i18n;
