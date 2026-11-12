import mongoose from 'mongoose';
import { STATES } from '../domain/transactions/transitionRules.js';

/**
 * Authoritative transaction aggregate document. The embedded `auditLog` keeps
 * the aggregate state and its audit chain in one atomically-updated document;
 * `TransactionAuditEvent` is an append-only queryable projection of the same
 * events. `version` is the compare-and-set token for every domain transition.
 */
const transactionSchema = new mongoose.Schema(
  {
    transactionId: { type: String, required: true, unique: true, trim: true },
    mandateId: { type: String, required: true, index: true },
    mandate: { type: mongoose.Schema.Types.Mixed, required: true },
    buyerId: { type: String, required: true, index: true },
    sellerId: { type: String, default: null, index: true },
    state: { type: String, required: true, enum: STATES },
    version: { type: Number, required: true, min: 0 },
    proposal: { type: mongoose.Schema.Types.Mixed, required: true },
    proposalVersion: { type: Number, required: true, min: 1 },
    proposalFingerprint: { type: String, required: true },
    policyEvidence: { type: mongoose.Schema.Types.Mixed, default: null },
    guardianApproval: { type: mongoose.Schema.Types.Mixed, default: null },
    handoffConfirmations: { type: mongoose.Schema.Types.Mixed, required: true },
    provider: { type: mongoose.Schema.Types.Mixed, required: true },
    createdAt: { type: String, required: true },
    updatedAt: { type: String, required: true },
    auditLog: { type: [mongoose.Schema.Types.Mixed], default: [] },
    eventDigests: { type: [mongoose.Schema.Types.Mixed], default: [] },
  },
  { timestamps: false, versionKey: false },
);

transactionSchema.index({ buyerId: 1, createdAt: -1 });
transactionSchema.index({ sellerId: 1, createdAt: -1 });
transactionSchema.index({ transactionId: 1, version: 1 });

export const Transaction = mongoose.models.Transaction ?? mongoose.model('Transaction', transactionSchema);
