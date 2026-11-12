import mongoose from 'mongoose';

/**
 * Only the SHA-256 hash of a session token is stored. The plaintext token is
 * returned to the authenticating client once and never persisted.
 */
const sessionSchema = new mongoose.Schema(
  {
    tokenHash: { type: String, required: true, unique: true },
    userId: { type: String, required: true, index: true },
    role: { type: String, required: true, enum: ['buyer', 'seller', 'guardian'] },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);

export const Session = mongoose.models.Session ?? mongoose.model('Session', sessionSchema);
