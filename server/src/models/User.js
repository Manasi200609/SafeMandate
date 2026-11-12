import mongoose from 'mongoose';
import { USER_ROLES } from '../auth/roles.js';

const userSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, unique: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 320 },
    displayName: { type: String, required: true, trim: true, maxlength: 120 },
    role: { type: String, required: true, enum: USER_ROLES, index: true },
    accountStatus: { type: String, required: true, enum: ['ACTIVE', 'SUSPENDED'], default: 'ACTIVE', index: true },
    passwordHash: { type: String, required: true, select: false },
  },
  { timestamps: true, versionKey: false },
);

export const User = mongoose.models.User ?? mongoose.model('User', userSchema);
