import { CURRENCY_MINOR_UNITS } from '../data/currencyMeta.js';

export function parseMajorAmount(value, currency) {
  const places = CURRENCY_MINOR_UNITS[currency];
  if (!Number.isInteger(places) || typeof value !== 'string') return null;
  const pattern = places ? new RegExp(`^(0|[1-9]\\d*)(?:\\.(\\d{1,${places}}))?$`) : /^(0|[1-9]\d*)$/;
  const match = pattern.exec(value.trim());
  if (!match) return null;
  const whole = BigInt(match[1]);
  const fraction = places ? BigInt((match[2] ?? '').padEnd(places, '0') || '0') : 0n;
  const amountMinor = whole * (10n ** BigInt(places)) + fraction;
  return amountMinor > 0n && amountMinor <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(amountMinor) : null;
}

export function isValidLocalDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function canStartPayPalCheckout(state) {
  return state === 'READY_FOR_PAYMENT' || state === 'PAYMENT_PENDING';
}

export function acquireSubmissionLock(lock) {
  if (lock.current) return false;
  lock.current = true;
  return true;
}
