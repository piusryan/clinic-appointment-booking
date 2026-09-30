import { type ClientSession, type Types } from 'mongoose';
import Doctor from '../models/doctor.model';
import User from '../models/user.model';
import { notFound, conflict, unprocessable } from '../utils/errors';
import { withTransaction } from '../utils/transaction';
import { passwordStrength } from './auth.service';
import type { CreateDoctorPayload, DoctorDTO, UpdateDoctorPayload } from '../../../shared/types';
import type { Role } from '../../../shared/types';
import type { WorkingHours } from '../../../shared/types';

type Id = string | Types.ObjectId;

export function toDoctorDTO(d: { _id: Types.ObjectId; name: string; speciality: string; workingHours: WorkingHours[]; slotMinutes: number }): DoctorDTO {
  return {
    id: String(d._id),
    name: d.name,
    speciality: d.speciality,
    workingHours: d.workingHours.map((w) => ({ day: w.day, start: w.start, end: w.end })),
    slotMinutes: d.slotMinutes,
  };
}

export async function listDoctors(speciality?: string): Promise<DoctorDTO[]> {
  const q = speciality ? { speciality } : {};
  const rows = await Doctor.find(q).sort({ name: 1 }).limit(200);
  return rows.map(toDoctorDTO);
}

export async function getDoctor(id: Id): Promise<DoctorDTO> {
  const doc = await Doctor.findById(id);
  if (!doc) throw notFound('Doctor not found');
  return toDoctorDTO(doc);
}

async function createLinkedUser(
  email: string | undefined,
  password: string | undefined,
  role: Role,
  session: ClientSession
) {
  if (!email || !password) return null;
  const weak = passwordStrength(password);
  if (weak) throw unprocessable(weak);
  if (await User.exists({ email: email.toLowerCase() }).session(session)) {
    throw conflict('That email is already in use');
  }
  const [user] = await User.create([{ email, passwordHash: password, role }], { session });
  return user;
}

/** Admin creates a doctor; optional credentials make it a login account. */
export async function createDoctor(payload: CreateDoctorPayload): Promise<DoctorDTO> {
  const created = await withTransaction(async (session) => {
    const user = await createLinkedUser(payload.email, payload.password, 'doctor', session);
    const [doc] = await Doctor.create(
      [
        {
          name: payload.name,
          speciality: payload.speciality,
          workingHours: payload.workingHours,
          slotMinutes: payload.slotMinutes,
          user: user?._id,
        },
      ],
      { session }
    );
    if (user) {
      user.doctor = doc._id;
      await user.save({ session });
    }
    return doc;
  });
  return toDoctorDTO(created);
}

/** Whitelisted fields only — never a raw update-object forwarded from the controller (role/PATCH exploit block). */
export async function updateDoctor(id: Id, payload: UpdateDoctorPayload): Promise<DoctorDTO> {
  const doc = await Doctor.findById(id);
  if (!doc) throw notFound('Doctor not found');

  if (payload.name !== undefined) doc.name = payload.name;
  if (payload.speciality !== undefined) doc.speciality = payload.speciality;
  if (payload.slotMinutes !== undefined) doc.slotMinutes = payload.slotMinutes;
  if (payload.workingHours !== undefined) doc.workingHours = payload.workingHours;

  await doc.save();
  return toDoctorDTO(doc);
}

export async function deleteDoctor(id: Id): Promise<void> {
  const doc = await Doctor.findById(id);
  if (!doc) throw notFound('Doctor not found');
  await doc.deleteOne();
  if (doc.user) {
    // Never hard-delete an account with credentials; deactivate instead.
    await User.updateOne({ _id: doc.user }, { isActive: false });
  }
}