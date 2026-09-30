import { type Types } from 'mongoose';
import Patient from '../models/patient.model';
import User from '../models/user.model';
import { notFound, conflict, unprocessable } from '../utils/errors';
import { withTransaction } from '../utils/transaction';
import { passwordStrength } from './auth.service';
import type { CreatePatientPayload, PatientDTO, UpdatePatientPayload } from '../../../shared/types';

type Id = string | Types.ObjectId;

export function toPatientDTO(p: { _id: Types.ObjectId; name: string; phone: string }): PatientDTO {
  return { id: String(p._id), name: p.name, phone: p.phone };
}

export interface PatientPage {
  patients: PatientDTO[];
  total: number;
  page: number;
  perPage: number;
  pages: number;
}

export async function listPatients(phoneFilter?: string, page = 1, perPage = 50): Promise<PatientPage> {
  const q = phoneFilter ? { phone: phoneFilter } : {};
  const safePage = Math.max(1, page);
  const safePerPage = Math.min(500, Math.max(1, perPage));
  const [rows, total] = await Promise.all([
    Patient.find(q).sort({ name: 1 }).skip((safePage - 1) * safePerPage).limit(safePerPage),
    Patient.countDocuments(q),
  ]);
  return {
    patients: rows.map(toPatientDTO),
    total,
    page: safePage,
    perPage: safePerPage,
    pages: Math.max(1, Math.ceil(total / safePerPage)),
  };
}

export async function getPatient(id: Id): Promise<PatientDTO> {
  const doc = await Patient.findById(id);
  if (!doc) throw notFound('Patient not found');
  return toPatientDTO(doc);
}

/** Admin creates a patient; credentials optional but seeded patients get them. */
export async function createPatient(payload: CreatePatientPayload): Promise<PatientDTO> {
  const created = await withTransaction(async (session) => {
    if (payload.email) {
      const weak = passwordStrength(payload.password ?? '');
      if (weak) throw unprocessable(weak);
      if (await User.exists({ email: payload.email.toLowerCase() }).session(session)) {
        throw conflict('That email is already in use');
      }
    }
    if (await Patient.exists({ phone: payload.phone }).session(session)) {
      throw conflict('That phone is already in use');
    }

    const [user] = payload.email && payload.password
      ? await User.create([{ email: payload.email, passwordHash: payload.password, role: 'patient' as const }], { session })
      : [null];

    const [doc] = await Patient.create(
      [{ name: payload.name, phone: payload.phone, user: user?._id }],
      { session }
    );
    if (user) {
      user.patient = doc._id;
      await user.save({ session });
    }
    return doc;
  });
  return toPatientDTO(created);
}

export async function updatePatient(id: Id, payload: UpdatePatientPayload): Promise<PatientDTO> {
  const doc = await Patient.findById(id);
  if (!doc) throw notFound('Patient not found');
  if (payload.name !== undefined) doc.name = payload.name;
  if (payload.phone !== undefined) doc.phone = payload.phone;
  await doc.save();
  return toPatientDTO(doc);
}

export async function deletePatient(id: Id): Promise<void> {
  const doc = await Patient.findById(id);
  if (!doc) throw notFound('Patient not found');
  await doc.deleteOne();
  if (doc.user) {
    await User.updateOne({ _id: doc.user }, { isActive: false });
  }
}