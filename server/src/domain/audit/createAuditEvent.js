export function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) deepFreeze(value[key], seen);
  return Object.freeze(value);
}

export function createAuditEvent({ eventId, transactionId, previousState, newState, eventType, actor, timestamp, reason, metadata = {} }) {
  if (![eventId, transactionId, eventType, timestamp, reason, actor?.id, actor?.role].every((v) => typeof v === 'string' && v.trim())) throw new TypeError('Audit event fields must be non-empty strings.');
  return deepFreeze({ eventId, transactionId, previousState, newState, eventType, actor: { id: actor.id, role: actor.role }, timestamp, reason, metadata: structuredClone(metadata) });
}
