import { Schema, model, type Types } from 'mongoose';
import { APPOINTMENT_STATUS, type AppointmentStatus } from '../../../shared/types';

export interface Appointment {
  doctor: Types.ObjectId;
  patient: Types.ObjectId;
  startsAt: Date;
  endsAt: Date;
  status: AppointmentStatus;
  cancelledAt?: Date;
}

const appointmentSchema = new Schema<Appointment>(
  {
    doctor: { type: Schema.Types.ObjectId, ref: 'Doctor', required: true },
    patient: { type: Schema.Types.ObjectId, ref: 'Patient', required: true },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    status: {
      type: String,
      enum: APPOINTMENT_STATUS,
      default: 'booked',
    },
    cancelledAt: { type: Date },
  },
  { timestamps: true }
);

// the real backstop — transaction can still race at the edges, this index is law
// partial filter means cancelled rows don't block the same slot from being rebooked
appointmentSchema.index(
  { doctor: 1, startsAt: 1 },
  { unique: true, partialFilterExpression: { status: 'booked' } }
);

// common query pattern: patient + sorted by date
appointmentSchema.index({ patient: 1, startsAt: 1 });

export default model<Appointment>('Appointment', appointmentSchema);