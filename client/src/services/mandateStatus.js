import { CURRENCY_MINOR_UNITS } from '../data/currencyMeta.js';

export function classifyPersistedMandate(mandate, now = Date.now()) {
  const rules = mandate?.meetupRules;
  const categoriesValid = Array.isArray(mandate?.allowedCategories)
    && mandate.allowedCategories.length > 0
    && mandate.allowedCategories.every((value) => typeof value === 'string' && value.trim())
    && new Set(mandate.allowedCategories).size === mandate.allowedCategories.length;
  let zoneValid = false;
  try { new Intl.DateTimeFormat('en', { timeZone: rules?.timeZone }).format(); zoneValid = true; } catch { /* invalid zone */ }
  const valid = Number.isSafeInteger(mandate?.maxAmountMinor) && mandate.maxAmountMinor > 0
    && Number.isInteger(CURRENCY_MINOR_UNITS[mandate?.currency])
    && categoriesValid
    && typeof rules?.requirePublicPlace === 'boolean'
    && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(rules?.daytimeStart ?? '')
    && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(rules?.daytimeEnd ?? '')
    && rules.daytimeStart < rules.daytimeEnd
    && zoneValid
    && typeof mandate?.guardianId === 'string' && mandate.guardianId.trim()
    && Number.isInteger(mandate?.riskThreshold) && mandate.riskThreshold >= 0 && mandate.riskThreshold <= 100
    && Number.isFinite(Date.parse(mandate?.expiresAt));
  if (!valid) return 'invalid';
  return Date.parse(mandate.expiresAt) <= now ? 'expired' : 'ready';
}
