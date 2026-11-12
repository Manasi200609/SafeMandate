import { User } from '../models/User.js';
import { Session } from '../models/Session.js';
import { Mandate } from '../models/Mandate.js';
import { Transaction } from '../models/Transaction.js';
import { TransactionAuditEvent } from '../models/TransactionAuditEvent.js';
import { HandoffConfirmation } from '../models/HandoffConfirmation.js';
import { CheckInEvent } from '../models/CheckInEvent.js';
import { PaypalProviderReference } from '../models/PaypalProviderReference.js';
import { GuardianRelationship } from '../models/GuardianRelationship.js';
import { PaymentOperation } from '../models/PaymentOperation.js';
import { AiAssessmentAudit } from '../models/AiAssessmentAudit.js';
import { DuplicateKeyError } from './errors.js';

function plain(document) {
  if (!document) return null;
  const { _id, __v, ...record } = typeof document.toObject === 'function' ? document.toObject() : document;
  // Normalize Mongoose/driver values to plain JSON at the persistence boundary
  // so the domain receives exactly the shape it validates, clones, and hashes.
  return JSON.parse(JSON.stringify(record));
}

function mapUser(document) {
  const record = plain(document);
  return record ? { ...record, email: String(record.email).toLowerCase() } : null;
}

function mapSession(document) {
  const record = plain(document);
  if (!record) return null;
  return { ...record, expiresAt: new Date(record.expiresAt).toISOString() };
}

function rethrowDuplicate(error) {
  if (error?.code === 11000) throw new DuplicateKeyError('A record with the same unique identity already exists.');
  throw error;
}

/** MongoDB repository implementation using Mongoose models. */
export function createMongoRepositories() {
  return Object.freeze({
    kind: 'mongodb',
    users: {
      async insert(user) {
        try {
          await User.create(user);
        } catch (error) {
          rethrowDuplicate(error);
        }
        return { ...user };
      },
      async findByEmail(email) {
        return mapUser(await User.findOne({ email: String(email).toLowerCase() }).select('+passwordHash').lean());
      },
      async findByUserId(userId) {
        return mapUser(await User.findOne({ userId }).lean());
      },
      async setRole(userId, role) {
        const result = await User.updateOne({ userId, accountStatus: 'ACTIVE' }, { $set: { role } });
        return result.modifiedCount === 1;
      },
    },
    sessions: {
      async insert(session) {
        try {
          await Session.create(session);
        } catch (error) {
          rethrowDuplicate(error);
        }
        return mapSession(session);
      },
      async findByTokenHash(tokenHash) {
        return mapSession(await Session.findOne({ tokenHash }).lean());
      },
      async revokeByTokenHash(tokenHash, revokedAt) {
        const result = await Session.updateOne({ tokenHash, revokedAt: null }, { $set: { revokedAt: new Date(revokedAt) } });
        return result.modifiedCount === 1;
      },
      async updateRoleByUserId(userId, role) {
        await Session.updateMany({ userId, revokedAt: null }, { $set: { role } });
      },
    },
    mandates: {
      async insert(mandate) {
        try {
          await Mandate.create(mandate);
        } catch (error) {
          rethrowDuplicate(error);
        }
        return { ...mandate };
      },
      async findByMandateId(mandateId) {
        return plain(await Mandate.findOne({ mandateId }).lean());
      },
      async findCurrentForBuyer(buyerId) {
        return plain(await Mandate.findOne({ buyerId }).sort({ createdAt: -1 }).lean());
      },
    },
    transactions: {
      async insert(record) {
        try {
          await Transaction.create(record);
        } catch (error) {
          rethrowDuplicate(error);
        }
        return plain(record);
      },
      async findById(transactionId) {
        return plain(await Transaction.findOne({ transactionId }).lean());
      },
      async listForParticipant(userId, { limit = 50 } = {}) {
        const records = await Transaction.find({ $or: [{ buyerId: userId }, { sellerId: userId }] })
          .sort({ createdAt: -1 })
          .limit(Math.min(Math.max(limit, 1), 100))
          .lean();
        return records.map(plain);
      },
      async updateWithVersion({ transactionId, expectedVersion, record }) {
        const updated = await Transaction.findOneAndUpdate(
          { transactionId, version: expectedVersion },
          { $set: record },
          { new: true },
        ).lean();
        return Boolean(updated);
      },
    },
    auditEvents: {
      async appendMany(transactionId, events) {
        if (!events.length) return true;
        await TransactionAuditEvent.bulkWrite(
          events.map((event, index) => ({
            updateOne: {
              filter: { eventId: event.eventId },
              update: {
                $setOnInsert: {
                  eventId: event.eventId,
                  transactionId,
                  version: index + 1,
                  previousState: event.previousState,
                  newState: event.newState,
                  eventType: event.eventType,
                  actor: { id: event.actor.id, role: event.actor.role },
                  timestamp: event.timestamp,
                  reason: event.reason,
                  metadata: event.metadata ?? {},
                  recordedAt: new Date(),
                },
              },
              upsert: true,
            },
          })),
          { ordered: false },
        );
        return true;
      },
      async listByTransaction(transactionId) {
        return (await TransactionAuditEvent.find({ transactionId }).sort({ version: 1 }).lean()).map(plain);
      },
    },
    handoffConfirmations: {
      async upsert(confirmation) {
        await HandoffConfirmation.updateOne(
          { transactionId: confirmation.transactionId, party: confirmation.party },
          { $setOnInsert: confirmation },
          { upsert: true },
        );
        return { ...confirmation };
      },
      async listByTransaction(transactionId) {
        return (await HandoffConfirmation.find({ transactionId }).lean()).map(plain);
      },
    },
    checkIns: {
      async insert(checkIn) {
        try {
          await CheckInEvent.create(checkIn);
        } catch (error) {
          rethrowDuplicate(error);
        }
        return { ...checkIn };
      },
      async listByTransaction(transactionId) {
        return (await CheckInEvent.find({ transactionId }).sort({ createdAt: 1 }).lean()).map(plain);
      },
    },
    paypalReferences: {
      async upsert(reference) {
        await PaypalProviderReference.updateOne(
          { transactionId: reference.transactionId },
          { $set: reference },
          { upsert: true },
        );
        return { ...reference };
      },
      async findByTransactionId(transactionId) {
        return plain(await PaypalProviderReference.findOne({ transactionId }).lean());
      },
    },
    guardianRelationships: {
      async insert(record) {
        try { await GuardianRelationship.create(record); } catch (error) { rethrowDuplicate(error); }
        return { ...record };
      },
      async findById(relationshipId) {
        return plain(await GuardianRelationship.findOne({ relationshipId }).lean());
      },
      async listForBuyer(buyerId) {
        return (await GuardianRelationship.find({ buyerId }).sort({ createdAt: -1 }).lean()).map(plain);
      },
      async accept({ relationshipId, guardianId, respondedAt }) {
        const result = await GuardianRelationship.updateOne(
          { relationshipId, guardianId, status: 'PENDING' },
          { $set: { status: 'ACCEPTED', respondedAt } },
        );
        return result.modifiedCount === 1;
      },
      async findAccepted(buyerId, guardianId) {
        return plain(await GuardianRelationship.findOne({ buyerId, guardianId, status: 'ACCEPTED' }).lean());
      },
    },
    paymentOperations: {
      async reserve(operation) {
        try {
          await PaymentOperation.create(operation);
          return { operation: { ...operation }, created: true };
        } catch (error) {
          if (error?.code !== 11000) throw error;
          const existing = await PaymentOperation.findOne({ transactionId: operation.transactionId, kind: operation.kind }).lean();
          if (existing) return { operation: plain(existing), created: false };
          rethrowDuplicate(error);
        }
      },
      async findByTransactionAndKind(transactionId, kind) {
        return plain(await PaymentOperation.findOne({ transactionId, kind }).lean());
      },
      async listByTransaction(transactionId) {
        return (await PaymentOperation.find({ transactionId }).sort({ createdAt: 1 }).lean()).map(plain);
      },
      async update({ operationId, expectedStatus, updates }) {
        return plain(await PaymentOperation.findOneAndUpdate(
          { operationId, status: expectedStatus },
          { $set: updates },
          { new: true },
        ).lean());
      },
    },
    aiAssessmentAudits: {
      async insert(record) {
        try { await AiAssessmentAudit.create(record); } catch (error) { rethrowDuplicate(error); }
        return { ...record };
      },
      async findById(assessmentId) {
        return plain(await AiAssessmentAudit.findOne({ assessmentId }).lean());
      },
    },
  });
}
