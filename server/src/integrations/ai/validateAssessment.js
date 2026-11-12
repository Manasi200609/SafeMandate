import { CURRENCY_MINOR_UNITS } from '../../domain/mandate/currencies.js';

const LEVELS = new Set(['LOW', 'MEDIUM', 'HIGH', 'UNKNOWN']);
const NEXT_STEPS = new Set(['ASK_SELLER', 'REVIEW_RISKS', 'CONTINUE_TO_POLICY_CHECK', 'INSUFFICIENT_INFORMATION']);

function objectWithKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function text(value, maxLength, { empty = false } = {}) {
  return typeof value === 'string' && value.length <= maxLength && (empty || Boolean(value.trim()));
}

function textList(value, maxItems, maxLength) {
  return Array.isArray(value) && value.length <= maxItems && value.every((item) => text(item, maxLength));
}

export function validateAssessment(value, { listingText, conversationText = '', askingAmountMinor, askingCurrency } = {}) {
  const assessmentKeys = ['purchaseSummary', 'riskLevel', 'findings', 'missingInformation', 'sellerQuestions', 'negotiation', 'recommendation'];
  if (!objectWithKeys(value, assessmentKeys) || !LEVELS.has(value.riskLevel)) return null;

  const summary = value.purchaseSummary;
  if (!objectWithKeys(summary, ['item', 'askingPrice', 'condition', 'sellerClaims', 'handoffMethod', 'details'])
    || (summary.item !== null && !text(summary.item, 180))
    || (summary.condition !== null && !text(summary.condition, 240))
    || (summary.handoffMethod !== null && !text(summary.handoffMethod, 240))
    || !textList(summary.sellerClaims, 8, 300) || !textList(summary.details, 8, 300)) return null;
  if (summary.askingPrice !== null && (!objectWithKeys(summary.askingPrice, ['amountMinor', 'currency'])
    || !Number.isSafeInteger(summary.askingPrice.amountMinor) || summary.askingPrice.amountMinor <= 0
    || !Number.isInteger(CURRENCY_MINOR_UNITS[summary.askingPrice.currency]))) return null;

  if (!Array.isArray(value.findings) || value.findings.length > 8) return null;
  const sourceText = `${listingText}\n${conversationText}`;
  for (const finding of value.findings) {
    if (!objectWithKeys(finding, ['code', 'title', 'severity', 'explanation', 'evidence', 'whyItMatters'])
      || !/^[A-Z0-9_]{2,48}$/.test(finding.code) || !text(finding.title, 100)
      || !['LOW', 'MEDIUM', 'HIGH'].includes(finding.severity) || !text(finding.explanation, 600)
      || !text(finding.evidence, 400) || !sourceText.includes(finding.evidence.trim())
      || !text(finding.whyItMatters, 400)) return null;
  }

  if (!textList(value.missingInformation, 8, 240) || !textList(value.sellerQuestions, 8, 240)) return null;
  const negotiation = value.negotiation;
  if (!objectWithKeys(negotiation, ['questions', 'messageDraft', 'counteroffer'])
    || !textList(negotiation.questions, 8, 240) || !text(negotiation.messageDraft, 1200, { empty: true })) return null;
  if (negotiation.counteroffer !== null) {
    const offer = negotiation.counteroffer;
    if (!objectWithKeys(offer, ['amountMinor', 'currency', 'rationale'])
      || !Number.isSafeInteger(offer.amountMinor) || offer.amountMinor <= 0
      || !Number.isInteger(CURRENCY_MINOR_UNITS[offer.currency]) || !text(offer.rationale, 400)
      || !Number.isSafeInteger(askingAmountMinor) || offer.currency !== askingCurrency || offer.amountMinor >= askingAmountMinor) return null;
  }
  if (!objectWithKeys(value.recommendation, ['nextStep', 'explanation'])
    || !NEXT_STEPS.has(value.recommendation.nextStep) || !text(value.recommendation.explanation, 700)) return null;
  return structuredClone(value);
}
