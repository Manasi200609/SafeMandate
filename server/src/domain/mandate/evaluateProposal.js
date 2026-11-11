import { createHash } from 'node:crypto';
import { validateMandate, isMandateActive } from './validateMandate.js';
import { isSupportedCurrency } from './currencies.js';
import { parseIsoInstant, validIanaTimeZone, isPlainData } from './validationPrimitives.js';
const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function validateProposal(p) {
  const errors = [];
  if (!p || typeof p !== 'object' || Array.isArray(p) || !isPlainData(p)) return { valid: false, errors: ['Proposal must be a plain JSON-compatible object.'] };
  for (const key of ['proposalId','itemName','description','category','meetupLocation']) if (typeof p[key] !== 'string' || !p[key].trim()) errors.push(`${key} must be a non-empty string.`);
  if (!Number.isSafeInteger(p.amountMinor) || p.amountMinor <= 0) errors.push('amountMinor must be a positive safe integer in minor currency units.');
  if (typeof p.currency !== 'string' || !isSupportedCurrency(p.currency)) errors.push('currency must be in the supported ISO currency-code allowlist.');
  if (p.sellerName !== undefined && p.sellerName !== null && typeof p.sellerName !== 'string') errors.push('sellerName must be a string when provided.');
  if (p.sellerId !== undefined && p.sellerId !== null && (typeof p.sellerId !== 'string' || !p.sellerId.trim())) errors.push('sellerId must be a non-empty string when provided.');
  if (typeof p.locationIsPublic !== 'boolean') errors.push('locationIsPublic must be a boolean.');
  if (typeof p.proposedLocalMeetupTime !== 'string' || !TIME_RE.test(p.proposedLocalMeetupTime)) errors.push('proposedLocalMeetupTime must use 24-hour HH:mm format.');
  if (!validIanaTimeZone(p.timeZone)) errors.push('timeZone must be a valid IANA timezone.');
  if (!Number.isInteger(p.aiRiskScore) || p.aiRiskScore < 0 || p.aiRiskScore > 100) errors.push('aiRiskScore must be an integer from 0 to 100.');
  if (!Array.isArray(p.riskSignals) || p.riskSignals.some((x) => typeof x !== 'string')) errors.push('riskSignals must be an array of strings.');
  if (!Array.isArray(p.supportingEvidence) || p.supportingEvidence.some((x) => typeof x !== 'string')) errors.push('supportingEvidence must be an array of strings.');
  if (parseIsoInstant(p.createdAt) === null) errors.push('createdAt must be a valid ISO-8601 timestamp with a real calendar date and timezone.');
  return { valid: errors.length === 0, errors };
}

function canonical(value, seen = new WeakSet()) {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? String(value);
  if (seen.has(value)) return '"[Circular]"';
  seen.add(value);
  let out;
  if (Array.isArray(value)) out = '[' + value.map((v) => canonical(v, seen)).join(',') + ']';
  else out = '{' + Object.keys(value).sort().map((k) => JSON.stringify(k) + ':' + canonical(value[k], seen)).join(',') + '}';
  seen.delete(value);
  return out;
}
export function proposalFingerprint(proposal) { return createHash('sha256').update(canonical(proposal)).digest('hex'); }

export function evaluateProposal(mandate, proposal, now = new Date().toISOString()) {
  const mv = validateMandate(mandate);
  if (!mv.valid) return result('BLOCKED', ['INVALID_MANDATE'], mv.errors.join(' '), false, false);
  if (parseIsoInstant(now) === null) return result('BLOCKED', ['INVALID_EVALUATION_TIME'], 'Evaluation time is invalid.', false, false);
  if (!isMandateActive(mandate, now)) return result('EXPIRED', ['MANDATE_EXPIRED'], 'The mandate has expired.', false, false);
  const pv = validateProposal(proposal);
  if (!pv.valid) return result('BLOCKED', ['INVALID_PROPOSAL'], pv.errors.join(' '), false, false);
  if (proposal.currency !== mandate.currency) return result('BLOCKED', ['CURRENCY_MISMATCH'], 'Proposal currency does not match the mandate.', false, false);
  const reasons = [], explain = [];
  if (proposal.amountMinor > mandate.maxAmountMinor) { reasons.push('OVER_BUDGET'); explain.push('Amount exceeds the mandate maximum.'); }
  if (!mandate.allowedCategories.includes(proposal.category)) { reasons.push('CATEGORY_NOT_ALLOWED'); explain.push('Category is not allowed by the mandate.'); }
  if (mandate.meetupRules.requirePublicPlace && !proposal.locationIsPublic) { reasons.push('MEETUP_NOT_PUBLIC'); explain.push('Meetup must be in a public place.'); }
  if (proposal.timeZone !== mandate.meetupRules.timeZone) { reasons.push('MEETUP_TIMEZONE_MISMATCH'); explain.push('Meetup timezone does not match the mandate timezone.'); }
  else if (proposal.proposedLocalMeetupTime < mandate.meetupRules.daytimeStart || proposal.proposedLocalMeetupTime > mandate.meetupRules.daytimeEnd) { reasons.push('MEETUP_OUTSIDE_DAYTIME'); explain.push('Meetup is outside the permitted daytime window.'); }
  if (proposal.aiRiskScore >= mandate.riskThreshold) { reasons.push('RISK_ABOVE_THRESHOLD'); explain.push('AI risk score meets or exceeds the maximum acceptable threshold.'); }
  if (reasons.length) return result('NEEDS_GUARDIAN', reasons, explain.join(' '), true, false);
  return result('READY_FOR_PAYMENT', [], 'Proposal satisfies the active mandate.', false, true);
}
function result(decision, reasonCodes, explanation, requiresGuardianApproval, paymentEligible) { return { decision, reasonCodes, explanation, requiresGuardianApproval, paymentEligible }; }

