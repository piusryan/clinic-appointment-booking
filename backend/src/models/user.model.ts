import { Schema, model, type Types } from 'mongoose';
import bcrypt from 'bcrypt';
import type { Role } from '../../../shared/types';

const BCRYPT_COST = 12;

export interface User {
  email: string;
  passwordHash: string;
  role: Role;
  refreshTokenVersion: number;
  isActive: boolean;
  lastLoginAt?: Date;
  patient?: Types.ObjectId;
  doctor?: Types.ObjectId;
}

export interface UserDoc extends User {
  comparePassword(candidate: string): Promise<boolean>;
}

const userSchema = new Schema<UserDoc>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'a valid email is required'],
    },
    // Never the raw password. `select: false` is defence in depth — the
    // toJSON override below is the second layer that makes the hash truly
    // impossible to leak.
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ['patient', 'doctor', 'receptionist', 'admin'], required: true },
    refreshTokenVersion: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    lastLoginAt: { type: Date },
    patient: { type: Schema.Types.ObjectId, ref: 'Patient' },
    doctor: { type: Schema.Types.ObjectId, ref: 'Doctor' },
  },
  { timestamps: true }
);

// Hash in a pre('save') hook — the Module 6 "middleware" lesson applied to
// security. Hashing in a controller would be a layering violation.
// The isModified guard prevents re-hashing an already-hashed value on any
// profile update, which would otherwise permanently lock the user out.
userSchema.pre('save', async function () {
  if (!this.isModified('passwordHash')) return;
  this.passwordHash = await bcrypt.hash(this.passwordHash, BCRYPT_COST);
});

userSchema.methods.comparePassword = function (candidate: string): Promise<boolean> {
  // The authenticate flow always loads the hash via .select('+passwordHash').
  return bcrypt.compare(candidate, this.passwordHash);
};

export interface UserJson {
  id: string;
  email: string;
  role: Role;
  isActive: boolean;
  lastLoginAt?: Date;
  patient?: Types.ObjectId;
  doctor?: Types.ObjectId;
}

// Defence in depth: strip the hash (and session bookkeeping) on serialisation
// even if a future query forgets select:false.
userSchema.set('toJSON', {
  versionKey: false,
  transform(_doc, ret) {
    const { _id } = ret;
    const copy: Record<string, unknown> = { ...ret };
    delete copy.passwordHash;
    delete copy.refreshTokenVersion;
    delete copy.__v;
    delete copy._id;
    copy.id = String(_id);
    return copy;
  },
});

export default model<UserDoc>('User', userSchema);
export { BCRYPT_COST };