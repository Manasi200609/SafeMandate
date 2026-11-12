import { CURRENCY_MINOR_UNITS } from '../data/currencyMeta.js';

export function parseMandateMajorAmount(value, currency) {
  const places = CURRENCY_MINOR_UNITS[currency];
  if (!Number.isInteger(places)) return null;
  const pattern = places ? new RegExp(`^(0|[1-9]\\d*)(?:\\.(\\d{1,${places}}))?$`) : /^(0|[1-9]\d*)$/;
  const match = pattern.exec(String(value).trim());
  if (!match) return null;
  const amount = BigInt(match[1]) * (10n ** BigInt(places)) + BigInt(places ? (match[2] ?? '').padEnd(places, '0') || '0' : '0');
  return amount > 0n && amount <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(amount) : null;
}
