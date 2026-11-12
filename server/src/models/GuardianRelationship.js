import mongoose from 'mongoose';

const guardianRelationshipSchema = new mongoose.Schema({
  relationshipId: { type: String, required: true, unique: true },
  buyerId: { type: String, required: true, index: true },
  guardianId: { type: String, required: true, index: true },
  guardianEmail: { type: String, required: true, lowercase: true },
  status: { type: String, required: true, enum: ['PENDING', 'ACCEPTED', 'REJECTED'], default: 'PENDING' },
  createdAt: { type: String, required: true },
  respondedAt: { type: String, default: null },
}, { timestamps: false, versionKey: false });

guardianRelationshipSchema.index({ buyerId: 1, guardianId: 1 }, { unique: true });
export const GuardianRelationship = mongoose.models.GuardianRelationship
  ?? mongoose.model('GuardianRelationship', guardianRelationshipSchema);
