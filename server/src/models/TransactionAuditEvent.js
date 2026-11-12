import mongoose from 'mongoose';

/**
 * Append-only projection of transaction audit events. Event IDs are unique, so
 * replaying a projection is idempotent. The embedded audit log on the
 * transaction document remains the authoritative chain.
 */
const transactionAuditEventSchema = new mongoose.Schema(
  {
    eventId: { type: String, required: true, unique: true },
    transactionId: { type: String, required: true, index: true },
    version: { type: Number, required: true, min: 1 },
    previousState: { type: String, required: true },
    newState: { type: String, required: true },
    eventType: { type: String, required: true },
    actor: {
      id: { type: String, required: true },
      role: { type: String, required: true },
    },
    timestamp: { type: String, required: true },
    reason: { type: String, required: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    recordedAt: { type: Date, default: Date.now },
  },
  { versionKey: false },
);

transactionAuditEventSchema.index({ transactionId: 1, version: 1 });

export const TransactionAuditEvent =
  mongoose.models.TransactionAuditEvent ?? mongoose.model('TransactionAuditEvent', transactionAuditEventSchema);
