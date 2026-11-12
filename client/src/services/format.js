import { CURRENCY_MINOR_UNITS } from '../data/currencyMeta.js';
import i18n,{localeByLanguage} from '../locales/index.js';
export const currentLocale=()=>localeByLanguage[i18n.resolvedLanguage??i18n.language]??localeByLanguage.en;
export const money=(minor,currency='INR',locale=currentLocale())=>{const exponent=CURRENCY_MINOR_UNITS[currency]??2;return new Intl.NumberFormat(locale,{style:'currency',currency,minimumFractionDigits:exponent,maximumFractionDigits:exponent}).format(minor/10**exponent);};
export const numberLabel=(value,options={},locale=currentLocale())=>new Intl.NumberFormat(locale,options).format(value);
export const majorMoney=(value,currency='INR',locale=currentLocale())=>new Intl.NumberFormat(locale,{style:'currency',currency}).format(value);
function parsedDate(value, dateOnlyAtNoon = false) {
  if (!(typeof value === 'string' || typeof value === 'number' || value instanceof Date)) return null;
  const dateInput = dateOnlyAtNoon && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T12:00:00Z`
    : value;
  const date = new Date(dateInput);
  return Number.isNaN(date.getTime()) ? null : date;
}
export const dateLabel=(value,locale=currentLocale())=>{const date=parsedDate(value,true);return date?new Intl.DateTimeFormat(locale,{day:'numeric',month:'short',year:'numeric'}).format(date):'—';};
export const dateTimeLabel=(value,locale=currentLocale())=>{const date=parsedDate(value);return date?new Intl.DateTimeFormat(locale,{dateStyle:'medium',timeStyle:'short'}).format(date):'—';};
export const minorToInput=(minor,currency='INR')=>{const exp=CURRENCY_MINOR_UNITS[currency]??2;if(!exp)return String(minor);const divisor=10**exp;return `${Math.floor(minor/divisor)}.${String(minor%divisor).padStart(exp,'0')}`;};
