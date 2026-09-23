import { Schema, model, type Types } from 'mongoose';

export interface Patient {
  name: string;
  phone: string;
  user?: Types.ObjectId;
}

const patientSchema = new Schema<Patient>(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, unique: true, trim: true, match: [/^\+?\d{7,15}$/, 'a valid phone is required'] },
    user: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

patientSchema.index({ name: 1 });

export default model<Patient>('Patient', patientSchema);