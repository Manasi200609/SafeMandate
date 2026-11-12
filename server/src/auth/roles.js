import { randomUUID } from 'node:crypto';

export const USER_ROLES = Object.freeze(['buyer', 'seller', 'guardian']);

export function normalizeEmail(email) {
  if (typeof email !== 'string') return null;
  const normalized = email.trim().toLowerCase();
  if (normalized.length < 3 || normalized.length > 320) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return null;
  return normalized;
}

export function normalizeDisplayName(displayName, email) {
  if (typeof displayName === 'string' && displayName.trim()) return displayName.trim().slice(0, 120);
  return email.split('@')[0].slice(0, 120) || 'Safe Mandate user';
}

export function createUserId() {
  return `user_${randomUUID()}`;
}
