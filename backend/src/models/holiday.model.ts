import { Schema, model, type Types } from 'mongoose';

export interface Holiday {
  doctor: Types.ObjectId | null; // null = clinic-wide closure
  date: Date;                    // normalized to midnight UTC
}

const holidaySchema = new Schema<Holiday>(
  {
    doctor: { type: Schema.Types.ObjectId, ref: 'Doctor', default: null },
    // Store only the calendar date (UTC midnight). Comparisons in the slot
    // service are done on the exact same representation.
    date: {
      type: Date,
      required: true,
      validate: {
        validator(d: Date) {
          return d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
        },
        message: 'Holiday date must be a calendar date at UTC midnight.',
      },
    },
  },
  { timestamps: true }
);

holidaySchema.index({ doctor: 1, date: 1 });

export default model<Holiday>('Holiday', holidaySchema);