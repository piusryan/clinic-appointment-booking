import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { type Types } from 'mongoose';
import request from 'supertest';
import { buildApp } from '../src/app';
import User from '../src/models/user.model';
import Doctor from '../src/models/doctor.model';
import Patient from '../src/models/patient.model';
import { signAccessToken } from '../src/services/auth.service';
import type { Role } from '../../shared/types';

let replset: MongoMemoryReplSet;

export async function startDb(): Promise<void> {
  // Transactions require a replica set — even in tests (module 6 of the brief).
  replset = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  await replset.waitUntilRunning();
  await mongoose.connect(replset.getUri());
}

export async function stopDb(): Promise<void> {
  await mongoose.disconnect();
  await replset.stop();
}

// ONE app instance per test file so rate-limiters and cookies behave like a
// real server (fresh stores per app() call would defeat the 429 assertions).
const app = buildApp();
export const api = () => request(app);

export interface TestDoctor {
  _id: Types.ObjectId;
  email: string;
  password: string;
}

export interface TestPatient {
  patientId: Types.ObjectId;
  email: string;
  password: string;
}

export const FIXED_MONDAY = '2026-12-07'; // Dublin = UTC+0 in December

/** A clinic general-practice doctor that works Mondays. */
export async function seedDoctor(user: { email: string; password: string }, hoursMins: [string, string][] = [['09:00', '17:00']], slotMinutes = 30): Promise<TestDoctor> {
  const info = await makeUser(user.email, user.password, 'doctor');
  const doc = await Doctor.create({
    name: `Dr ${user.email}`,
    speciality: 'General Practice',
    workingHours: hoursMins.map(([start, end]) => ({ day: 1, start, end })), // Mondays
    slotMinutes,
    user: info.user._id,
  });
  info.user.doctor = doc._id;
  await info.user.save();
  return { _id: doc._id, email: user.email, password: user.password };
}

export async function seedPatient(email: string, password = 'Patient1a'): Promise<TestPatient> {
  const info = await makeUser(email, password, 'patient');
  const p = await Patient.create({ name: `Patient ${email}`, phone: `+35370${Math.floor(Math.random() * 1e8)}`, user: info.user._id });
  info.user.patient = p._id;
  await info.user.save();
  return { patientId: p._id, email, password };
}

export async function seedAdmin(email = 'admin@test.io', password = 'AdminPass1'): Promise<string> {
  return seedToken(email, password, 'admin');
}

export async function seedReceptionist(email = 'recep@test.io', password = 'RecepPass1'): Promise<string> {
  return seedToken(email, password, 'receptionist');
}

async function makeUser(email: string, password: string, role: Role) {
  const user = await User.create({ email, passwordHash: password, role });
  return { user };
}

async function seedToken(email: string, password: string, role: Role): Promise<string> {
  const { user } = await makeUser(email, password, role);
  return signAccessToken(user);
}

export async function tokenForPatient(p: TestPatient): Promise<string> {
  const user = await User.findOne({ email: p.email });
  return signAccessToken(user!);
}

export async function tokenForDoctor(d: TestDoctor): Promise<string> {
  const user = await User.findOne({ email: d.email });
  return signAccessToken(user!);
}

export const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

/** Every test boots a clean DB: wipe between suites. */
export async function resetDb(): Promise<void> {
  await Promise.all([
    User.deleteMany({}),
    Doctor.deleteMany({}),
    Patient.deleteMany({}),
    require('../src/models/appointment.model').default.deleteMany({}),
    require('../src/models/holiday.model').default.deleteMany({}),
    require('../src/models/audit.model').default.deleteMany({}),
  ]);
}