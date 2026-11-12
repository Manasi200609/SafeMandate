import mongoose from 'mongoose';

/** One confirmed handoff per transaction participant; unique by transaction and party. */
const handoffConfirmationSchema = new mongoose.Schema(
  {
    transactionId: { type: String, required: true, index: true },
    party: { type: String, required: true, enum: ['buyer', 'seller'] },
    actorId: { type: String, required: true },
    confirmationId: { type: String, default: null },
    confirmedAt: { type: String, required: true },
    expiresAt: { type: String, default: null },
    revokedAt: { type: String, default: null },
  },
  { timestamps: false, versionKey: false },
);

handoffConfirmationSchema.index({ transactionId: 1, party: 1 }, { unique: true });

export const HandoffConfirmation =
  mongoose.models.HandoffConfirmation ?? mongoose.model('HandoffConfirmation', handoffConfirmationSchema);
