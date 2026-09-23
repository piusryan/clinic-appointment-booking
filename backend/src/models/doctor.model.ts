import { Schema, model, type Types } from 'mongoose';
import type { WorkingHours, Weekday } from '../../../shared/types';

const DAY_SET: Weekday[] = [0, 1, 2, 3, 4, 5, 6];

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

const workingHoursSchema = new Schema<WorkingHours>(
  {
    day: { type: Number, required: true, min: 0, max: 6, enum: DAY_SET },
    start: { type: String, required: true, match: HHMM },
    end: { type: String, required: true, match: HHMM },
  },
  { _id: false }
);

export interface Doctor {
  name: string;
  speciality: string;
  workingHours: WorkingHours[];
  slotMinutes: number;
  user?: Types.ObjectId;
}

const doctorSchema = new Schema<Doctor>(
  {
    name: { type: String, required: true, trim: true },
    speciality: { type: String, required: true, trim: true },
    // Embedded value semantics — a doctor's hours travel with the doctor and
    // are never queried independently, so embedding wins over a ref here.
    workingHours: {
      type: [workingHoursSchema],
      validate: {
        validator(v: WorkingHours[]) {
          // start < end, and each weekday may appear at most once.
          const seen = new Set<number>();
          return v.every((w) => {
            if (seen.has(w.day)) return false;
            seen.add(w.day);
            return timeToMin(w.start) < timeToMin(w.end);
          });
        },
        message: 'Each weekday must appear once and start must precede end.',
      },
    },
    slotMinutes: { type: Number, required: true, min: 5, max: 240 },
    user: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

doctorSchema.index({ speciality: 1 });

function timeToMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export default model<Doctor>('Doctor', doctorSchema);