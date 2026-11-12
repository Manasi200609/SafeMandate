import mongoose from 'mongoose';

/**
 * Buyer check-in events are append-only evidence and never advance the
 * transaction state machine by themselves.
 */
const checkInEventSchema = new mongoose.Schema(
  {
    checkInId: { type: String, required: true, unique: true },
    transactionId: { type: String, required: true, index: true },
    buyerId: { type: String, required: true, index: true },
    type: { type: String, required: true, enum: ['ARRIVAL', 'SAFETY_CHECK'] },
    stateAtCheckIn: { type: String, required: true },
    expiresAt: { type: String, default: null },
    revokedAt: { type: String, default: null },
    note: { type: String, default: null, maxlength: 500 },
    createdAt: { type: String, required: true },
    recordedAt: { type: Date, default: Date.now },
  },
  { versionKey: false },
);

checkInEventSchema.index({ transactionId: 1, createdAt: -1 });

export const CheckInEvent = mongoose.models.CheckInEvent ?? mongoose.model('CheckInEvent', checkInEventSchema);
