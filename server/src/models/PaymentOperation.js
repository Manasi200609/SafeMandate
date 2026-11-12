import mongoose from 'mongoose';

const paymentOperationSchema = new mongoose.Schema({
  operationId: { type: String, required: true, unique: true },
  transactionId: { type: String, required: true, index: true },
  kind: { type: String, required: true, enum: ['CREATE_ORDER', 'AUTHORIZE', 'CAPTURE', 'VOID'] },
  status: { type: String, required: true, enum: ['PENDING', 'UNKNOWN', 'COMPLETED', 'FAILED'] },
  requestId: { type: String, required: true, unique: true },
  amountMinor: { type: Number, required: true },
  currency: { type: String, required: true },
  providerResourceId: { type: String, default: null },
  providerStatus: { type: String, default: null },
  providerTimestamp: { type: String, default: null },
  approvalUrl: { type: String, default: null },
  providerErrorCode: { type: String, default: null },
  providerErrorField: { type: String, default: null },
  providerDebugId: { type: String, default: null },
  createdAt: { type: String, required: true },
  updatedAt: { type: String, required: true },
}, { timestamps: false, versionKey: false });

paymentOperationSchema.index({ transactionId: 1, kind: 1 }, { unique: true });
paymentOperationSchema.index({ transactionId: 1, status: 1 });

export const PaymentOperation = mongoose.models.PaymentOperation
  ?? mongoose.model('PaymentOperation', paymentOperationSchema);
