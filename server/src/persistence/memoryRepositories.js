import { DuplicateKeyError } from './errors.js';

const clone = (value) => (value === null || value === undefined ? value : structuredClone(value));

/**
 * In-memory repository implementation for tests and local inspection.
 * It mirrors the persistence contract exactly but does not survive a process
 * restart; production traffic uses the MongoDB implementation.
 */
export function createMemoryRepositories() {
  const users = new Map();
  const userIdsByEmail = new Map();
  const sessions = new Map();
  const mandates = [];
  const transactions = new Map();
  const auditEvents = new Map();
  const handoffConfirmations = new Map();
  const checkIns = new Map();
  const paypalReferences = new Map();
  const guardianRelationships = new Map();
  const paymentOperations = new Map();
  const paymentOperationKeys = new Map();
  const aiAssessmentAudits = new Map();

  return Object.freeze({
    kind: 'memory',
    users: {
      async insert(user) {
        if (users.has(user.userId) || userIdsByEmail.has(user.email)) throw new DuplicateKeyError('User identity already exists.');
        const record = clone(user);
        users.set(record.userId, record);
        userIdsByEmail.set(record.email, record.userId);
        return clone(record);
      },
      async findByEmail(email) {
        const userId = userIdsByEmail.get(String(email).toLowerCase());
        return userId ? clone(users.get(userId)) : null;
      },
      async findByUserId(userId) {
        return users.has(userId) ? clone(users.get(userId)) : null;
      },
      async listActiveSellers({ excludeUserId } = {}) {
        return [...users.values()]
          .filter((user) => user.role === 'seller' && user.accountStatus === 'ACTIVE' && user.userId !== excludeUserId)
          .map(({ userId, displayName }) => ({ userId, displayName }))
          .sort((left, right) => left.displayName.localeCompare(right.displayName));
      },
      async setRole(userId, role) {
        const user = users.get(userId);
        if (!user || user.accountStatus !== 'ACTIVE') return false;
        user.role = role;
        return true;
      },
    },
    sessions: {
      async insert(session) {
        if (sessions.has(session.tokenHash)) throw new DuplicateKeyError('Session token already exists.');
        sessions.set(session.tokenHash, clone(session));
        return clone(session);
      },
      async findByTokenHash(tokenHash) {
        return sessions.has(tokenHash) ? clone(sessions.get(tokenHash)) : null;
      },
      async revokeByTokenHash(tokenHash, revokedAt) {
        const session = sessions.get(tokenHash);
        if (!session) return false;
        session.revokedAt = revokedAt;
        return true;
      },
      async updateRoleByUserId(userId, role) {
        for (const session of sessions.values()) if (session.userId === userId && !session.revokedAt) session.role = role;
      },
    },
    mandates: {
      async insert(mandate) {
        if (mandates.some((entry) => entry.mandateId === mandate.mandateId)) throw new DuplicateKeyError('Mandate already exists.');
        mandates.push(clone(mandate));
        return clone(mandate);
      },
      async findByMandateId(mandateId) {
        const found = mandates.find((entry) => entry.mandateId === mandateId);
        return found ? clone(found) : null;
      },
      async findCurrentForBuyer(buyerId) {
        const owned = mandates.filter((entry) => entry.buyerId === buyerId);
        return owned.length ? clone(owned[owned.length - 1]) : null;
      },
    },
    transactions: {
      async insert(record) {
        if (transactions.has(record.transactionId)) throw new DuplicateKeyError('Transaction already exists.');
        transactions.set(record.transactionId, clone(record));
        return clone(record);
      },
      async findById(transactionId) {
        return transactions.has(transactionId) ? clone(transactions.get(transactionId)) : null;
      },
      async listForParticipant(userId, { limit = 50 } = {}) {
        return [...transactions.values()]
          .filter((record) => record.buyerId === userId || record.sellerId === userId)
          .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
          .slice(0, limit)
          .map(clone);
      },
      async updateWithVersion({ transactionId, expectedVersion, record }) {
        const existing = transactions.get(transactionId);
        if (!existing || existing.version !== expectedVersion) return false;
        transactions.set(transactionId, clone(record));
        return true;
      },
    },
    auditEvents: {
      async appendMany(transactionId, events) {
        for (const [index, event] of events.entries()) {
          if (auditEvents.has(event.eventId)) continue;
          auditEvents.set(event.eventId, clone({ ...event, transactionId, version: index + 1, recordedAt: new Date().toISOString() }));
        }
        return true;
      },
      async listByTransaction(transactionId) {
        return [...auditEvents.values()]
          .filter((event) => event.transactionId === transactionId)
          .sort((a, b) => a.version - b.version)
          .map(clone);
      },
    },
    handoffConfirmations: {
      async upsert(confirmation) {
        handoffConfirmations.set(`${confirmation.transactionId}:${confirmation.party}`, clone(confirmation));
        return clone(confirmation);
      },
      async listByTransaction(transactionId) {
        return [...handoffConfirmations.values()]
          .filter((confirmation) => confirmation.transactionId === transactionId)
          .map(clone);
      },
    },
    checkIns: {
      async insert(checkIn) {
        if (checkIns.has(checkIn.checkInId)) throw new DuplicateKeyError('Check-in already exists.');
        checkIns.set(checkIn.checkInId, clone(checkIn));
        return clone(checkIn);
      },
      async listByTransaction(transactionId) {
        return [...checkIns.values()]
          .filter((checkIn) => checkIn.transactionId === transactionId)
          .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
          .map(clone);
      },
    },
    paypalReferences: {
      async upsert(reference) {
        paypalReferences.set(reference.transactionId, clone(reference));
        return clone(reference);
      },
      async findByTransactionId(transactionId) {
        return paypalReferences.has(transactionId) ? clone(paypalReferences.get(transactionId)) : null;
      },
    },
    guardianRelationships: {
      async insert(record) {
        if (guardianRelationships.has(record.relationshipId) || [...guardianRelationships.values()].some((r) => r.buyerId === record.buyerId && r.guardianId === record.guardianId)) {
          throw new DuplicateKeyError('Guardian relationship already exists.');
        }
        guardianRelationships.set(record.relationshipId, clone(record));
        return clone(record);
      },
      async findById(id) { return clone(guardianRelationships.get(id) ?? null); },
      async listForBuyer(buyerId) { return [...guardianRelationships.values()].filter((r) => r.buyerId === buyerId).map(clone); },
      async accept({ relationshipId, guardianId, respondedAt }) {
        const r = guardianRelationships.get(relationshipId);
        if (!r || r.guardianId !== guardianId || r.status !== 'PENDING') return false;
        r.status = 'ACCEPTED'; r.respondedAt = respondedAt; return true;
      },
      async findAccepted(buyerId, guardianId) {
        const found = [...guardianRelationships.values()].find((r) => r.buyerId === buyerId && r.guardianId === guardianId && r.status === 'ACCEPTED');
        return clone(found ?? null);
      },
    },
    paymentOperations: {
      async reserve(operation) {
        const key = `${operation.transactionId}:${operation.kind}`;
        if (paymentOperationKeys.has(key)) return { operation: clone(paymentOperations.get(paymentOperationKeys.get(key))), created: false };
        if ([...paymentOperations.values()].some((item) => item.requestId === operation.requestId)) {
          throw new DuplicateKeyError('Payment request identifier already exists.');
        }
        paymentOperations.set(operation.operationId, clone(operation));
        paymentOperationKeys.set(key, operation.operationId);
        return { operation: clone(operation), created: true };
      },
      async findByTransactionAndKind(transactionId, kind) {
        const id = paymentOperationKeys.get(`${transactionId}:${kind}`);
        return id ? clone(paymentOperations.get(id)) : null;
      },
      async listByTransaction(transactionId) {
        return [...paymentOperations.values()].filter((item) => item.transactionId === transactionId).map(clone);
      },
      async update({ operationId, expectedStatus, updates }) {
        const operation = paymentOperations.get(operationId);
        if (!operation || operation.status !== expectedStatus) return null;
        Object.assign(operation, clone(updates));
        return clone(operation);
      },
    },
    aiAssessmentAudits: {
      async insert(record) {
        if (aiAssessmentAudits.has(record.assessmentId)) throw new DuplicateKeyError('AI assessment audit already exists.');
        aiAssessmentAudits.set(record.assessmentId, clone(record));
        return clone(record);
      },
      async findById(assessmentId) { return clone(aiAssessmentAudits.get(assessmentId) ?? null); },
    },
  });
}
