import mongoose from 'mongoose';

/**
 * Mandates are append-only history; the newest record for a buyer is the
 * current mandate. `payload` is validated by the deterministic domain
 * validator before it is stored and again when it is loaded.
 */
const mandateSchema = new mongoose.Schema(
  {
    mandateId: { type: String, required: true, unique: true, trim: true },
    buyerId: { type: String, required: true, index: true },
    currency: { type: String, required: true },
    expiresAt: { type: String, required: true },
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { timestamps: true, versionKey: false },
);

mandateSchema.index({ buyerId: 1, createdAt: -1 });

export const Mandate = mongoose.models.Mandate ?? mongoose.model('Mandate', mandateSchema);
