import { Schema, model, type Types } from 'mongoose';

export interface AuditLog {
  actorId: Types.ObjectId;
  actorRole: string;
  action: string;        // e.g. 'appointment.read', 'schedule.read', 'patient.read'
  targetPatient?: Types.ObjectId;
  targetDoctor?: Types.ObjectId;
  resource: string;      // 'appointment' | 'patient' | 'schedule'
  resourceId?: string;
  ip?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const auditLogSchema = new Schema<AuditLog>(
  {
    actorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    actorRole: { type: String, required: true },
    action: { type: String, required: true },
    targetPatient: { type: Schema.Types.ObjectId, ref: 'Patient' },
    targetDoctor: { type: Schema.Types.ObjectId, ref: 'Doctor' },
    resource: { type: String, required: true },
    resourceId: { type: String },
    ip: { type: String },
  },
  { timestamps: true }
);

auditLogSchema.index({ targetPatient: 1, createdAt: -1 });
auditLogSchema.index({ createdAt: 1 });

export default model<AuditLog>('AuditLog', auditLogSchema);