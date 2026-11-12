import mongoose from 'mongoose';

/**
 * Provider references observed by the trusted adapter. Phase 1 only persists
 * references reported by the authoritative domain aggregate; it never creates
 * orders or executes authorization, capture, or void operations.
 */
const paypalProviderReferenceSchema = new mongoose.Schema(
  {
    transactionId: { type: String, required: true, unique: true },
    environment: { type: String, required: true, enum: ['sandbox'] },
    orderId: { type: String, default: null },
    authorizationId: { type: String, default: null },
    captureId: { type: String, default: null },
    voidId: { type: String, default: null },
    lastEventType: { type: String, default: null },
    transactionState: { type: String, default: null },
    updatedAt: { type: String, required: true },
  },
  { versionKey: false },
);

export const PaypalProviderReference =
  mongoose.models.PaypalProviderReference ?? mongoose.model('PaypalProviderReference', paypalProviderReferenceSchema);
