import mongoose from 'mongoose';

const aiAssessmentAuditSchema = new mongoose.Schema({
  assessmentId: { type: String, required: true, unique: true },
  buyerId: { type: String, required: true },
  transactionId: { type: String, default: null },
  provider: { type: String, required: true },
  model: { type: String, required: true },
  promptVersion: { type: String, required: true },
  inputDigest: { type: String, required: true },
  riskLevel: { type: String, required: true, enum: ['LOW', 'MEDIUM', 'HIGH', 'UNKNOWN'] },
  recommendation: { type: String, required: true, enum: ['ASK_SELLER', 'REVIEW_RISKS', 'CONTINUE_TO_POLICY_CHECK', 'INSUFFICIENT_INFORMATION'] },
  policyDecision: { type: String, required: true, enum: ['READY_FOR_PAYMENT', 'NEEDS_GUARDIAN', 'BLOCKED', 'EXPIRED'] },
  createdAt: { type: String, required: true },
}, { timestamps: false, versionKey: false });

aiAssessmentAuditSchema.index({ buyerId: 1, createdAt: -1 });
aiAssessmentAuditSchema.index({ transactionId: 1, createdAt: -1 });

export const AiAssessmentAudit = mongoose.models.AiAssessmentAudit
  ?? mongoose.model('AiAssessmentAudit', aiAssessmentAuditSchema);
