import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { type Types } from 'mongoose';
import request from 'supertest';
import { buildApp } from '../src/app';
import User from '../src/models/user.model';
import Doctor from '../src/models/doctor.model';
import Patient from '../src/models/patient.model';
import Appointment from '../src/models/appointment.model';
import Holiday from '../src/models/holiday.model';
import AuditLog from '../src/models/audit.model';
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

/** A second, independent app instance — for tests that need a virgin limiter. */
export const freshApp = () => request(buildApp());

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
export async function seedDoctor(
  user: { email: string; password: string },
  hoursMins: [string, string][] = [['09:00', '17:00']],
  slotMinutes = 30
): Promise<TestDoctor> {
  const doc = await Doctor.create({
    name: `Dr ${user.email}`,
    speciality: 'General Practice',
    workingHours: hoursMins.map(([start, end]) => ({ day: 1, start, end })), // Mondays
    slotMinutes,
  });
  const u = await User.create({ email: user.email, passwordHash: user.password, role: 'doctor', doctor: doc._id });
  await doc.updateOne({ user: u._id });
  return { _id: doc._id, email: user.email, password: user.password };
}

export async function seedPatient(email: string, password = 'Patient1a'): Promise<TestPatient> {
  const p = await Patient.create({
    name: `Patient ${email}`,
    phone: `+35370${Math.floor(Math.random() * 1e8)}`,
  });
  await User.create({ email, passwordHash: password, role: 'patient', patient: p._id });
  return { patientId: p._id, email, password };
}

export async function seedStaff(email: string, password: string, role: Role): Promise<string> {
  await User.create({ email, passwordHash: password, role });
  return email;
}

// ---------------------------------------------------------------------------
// loginAs(role) — brief §11.1 "login helper"
//
// Every bearer token used anywhere in this suite is obtained by POSTING to the
// real /api/auth/login endpoint. Nothing signs a token in-process. That matters:
// a test that mints its own token proves nothing about the auth path, and it
// hides exactly the class of bug that appears when the login response, the
// cookie, the refresh flow or the role claims are wrong.
// ---------------------------------------------------------------------------

export interface LoggedInAs {
  token: string;
  role: Role;
  userId: string;
  email: string;
  password: string;
  patientId?: string;
  doctorId?: string;
  /** Auth header object, so tests read `loginAs('admin').auth`. */
  auth: { Authorization: string };
}

let counter = 0;
function uniqueEmail(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}@test.io`;
}

/** Perform a real login and return the tokens, failing loudly on non-200. */
export async function login(email: string, password: string): Promise<LoggedInAs> {
  const res = await api().post('/api/auth/login').send({ email, password });
  if (res.status !== 200) {
    throw new Error(`loginAs(${email}) failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const token: string = res.body.accessToken;
  return {
    token,
    role: res.body.user.role,
    userId: res.body.user.id,
    email,
    password,
    patientId: res.body.user.patientId,
    doctorId: res.body.user.doctorId,
    auth: { Authorization: `Bearer ${token}` },
  };
}

/**
 * Create (if needed) an account for `role` and log in over HTTP as it.
 *
 *   const admin    = await loginAs('admin');
 *   const doctor   = await loginAs('doctor');
 *   const patient  = await loginAs('patient');
 *
 * Pass `account` to reuse/extend an existing seeded account instead.
 */
export async function loginAs(
  role: Role,
  account?: { email: string; password: string; doctorId?: string; patientId?: string }
): Promise<LoggedInAs> {
  const email = account?.email ?? uniqueEmail(role);
  const password = account?.password ?? `${role[0].toUpperCase()}${role}Pass1`;

  if (account) return login(account.email, account.password);

  switch (role) {
    case 'doctor': {
      const d = await seedDoctor({ email, password });
      return { ...(await login(email, password)), doctorId: String(d._id) };
    }
    case 'patient': {
      const p = await seedPatient(email, password);
      return { ...(await login(email, password)), patientId: String(p.patientId) };
    }
    case 'admin':
    case 'receptionist':
      await User.create({ email, passwordHash: password, role });
      return login(email, password);
    default: {
      // Exhaustive: a new role must be handled here, not silently fall through.
      const never: never = role;
      throw new Error(`loginAs: unhandled role ${String(never)}`);
    }
  }
}

/** Bearer token for a role, when the test only needs the string. */
export async function tokenFor(role: Role): Promise<string> {
  return (await loginAs(role)).token;
}

export async function seedAdmin(): Promise<string> {
  return (await loginAs('admin')).token;
}

export async function seedReceptionist(): Promise<string> {
  return (await loginAs('receptionist')).token;
}

export async function tokenForPatient(p: TestPatient): Promise<string> {
  return (await login(p.email, p.password)).token;
}

export async function tokenForDoctor(d: TestDoctor): Promise<string> {
  return (await login(d.email, d.password)).token;
}

export const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

/** Every test boots a clean DB: wipe between suites. */
export async function resetDb(): Promise<void> {
  await Promise.all([
    User.deleteMany({}),
    Doctor.deleteMany({}),
    Patient.deleteMany({}),
    Appointment.deleteMany({}),
    Holiday.deleteMany({}),
    AuditLog.deleteMany({}),
  ]);
}
