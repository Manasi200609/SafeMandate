import { isPlainData, parseIsoInstant, validIanaTimeZone } from './validationPrimitives.js';
import { isSupportedCurrency } from './currencies.js';
const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function validateMandate(mandate) {
  const errors = [];
  if (!mandate || typeof mandate !== 'object' || Array.isArray(mandate) || !isPlainData(mandate)) return { valid: false, errors: ['Mandate must be a plain JSON-compatible object.'] };
  if (typeof mandate.mandateId !== 'string' || !mandate.mandateId.trim()) errors.push('mandateId must be a non-empty string.');
  if (!Number.isSafeInteger(mandate.maxAmountMinor) || mandate.maxAmountMinor <= 0) errors.push('maxAmountMinor must be a positive safe integer in minor currency units.');
  if (typeof mandate.currency !== 'string' || !isSupportedCurrency(mandate.currency)) errors.push('currency must be in the supported ISO currency-code allowlist.');
  if (!Array.isArray(mandate.allowedCategories) || mandate.allowedCategories.length === 0 || mandate.allowedCategories.some((v) => typeof v !== 'string' || !v.trim()) || new Set(mandate.allowedCategories).size !== mandate.allowedCategories.length) errors.push('allowedCategories must be a non-empty array of unique, non-empty strings.');
  const rules = mandate.meetupRules;
  if (!rules || typeof rules !== 'object' || Array.isArray(rules)) errors.push('meetupRules must be an object.');
  else {
    if (typeof rules.requirePublicPlace !== 'boolean') errors.push('meetupRules.requirePublicPlace must be a boolean.');
    if (typeof rules.daytimeStart !== 'string' || !TIME_RE.test(rules.daytimeStart)) errors.push('meetupRules.daytimeStart must use 24-hour HH:mm format.');
    if (typeof rules.daytimeEnd !== 'string' || !TIME_RE.test(rules.daytimeEnd)) errors.push('meetupRules.daytimeEnd must use 24-hour HH:mm format.');
    if (TIME_RE.test(rules.daytimeStart ?? '') && TIME_RE.test(rules.daytimeEnd ?? '') && rules.daytimeStart >= rules.daytimeEnd) errors.push('meetupRules.daytimeStart must be earlier than daytimeEnd.');
    if (!validIanaTimeZone(rules.timeZone)) errors.push('meetupRules.timeZone must be a valid IANA timezone.');
  }
  if (parseIsoInstant(mandate.expiresAt) === null) errors.push('expiresAt must be a valid ISO-8601 timestamp with a real calendar date and timezone.');
  if (typeof mandate.guardianId !== 'string' || !mandate.guardianId.trim()) errors.push('guardianId must be a non-empty string.');
  if (!Number.isInteger(mandate.riskThreshold) || mandate.riskThreshold < 0 || mandate.riskThreshold > 100) errors.push('riskThreshold must be an integer from 0 to 100.');
  return { valid: errors.length === 0, errors };
}

export function isMandateActive(mandate, now) {
  const expiry = parseIsoInstant(mandate?.expiresAt), instant = parseIsoInstant(now);
  return expiry !== null && instant !== null && expiry > instant;
}



