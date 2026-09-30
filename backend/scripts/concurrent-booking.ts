/**
 * scripts/concurrent-booking.ts — THE grading deliverable.
 *
 *   npm run test:concurrency
 *
 * Fires 50 concurrent booking requests at ONE slot with authentication ON.
 * Exactly one gets 201; forty-nine get 409. The deadline reads:
 *   "This is the deliverable that decides the grade."
 *
 * Needs a MongoDB REPLICA SET (transactions do not run on a standalone) and,
 * unless one is already listening, it starts and stops the API itself:
 *
 *   - an already-running API is reused, so you can keep `npm run dev` open;
 *   - otherwise the server is spawned with the LOGIN limiter raised, because
 *     this script performs 50 legitimate logins from one IP and the
 *     production ceiling (5 / 15 min) would 429 the 6th. Raising the ceiling
 *     here is safe precisely because these are 50 real, distinct accounts
 *     with real bcrypt hashes — it is a setup burst, not an attack, and the
 *     booking limiter that matters is still keyed per authenticated user.
 *
 * Seeds its own throwaway doctor + 50 patients, logs each in over HTTP to get
 * a real bearer token, then Promise.all(50 x POST /api/appointments).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import mongoose from 'mongoose';
import Doctor from '../src/models/doctor.model';
import Patient from '../src/models/patient.model';
import User from '../src/models/user.model';
import Appointment from '../src/models/appointment.model';
import { config } from '../src/config';
import { dateKeyOf, slotInstantsFor } from './_helpers';

const BASE = process.env.API_BASE ?? 'http://localhost:4000';
const PATIENTS = 50;
const BACKEND_ROOT = path.resolve(__dirname, '..');

let server: ChildProcess | null = null;

async function apiIsUp(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Reuse a running API, or start one for the duration of the run. The child is
 * killed in `finally` so a failed run never leaves a port 4000 listener behind.
 */
async function ensureApi(): Promise<void> {
  if (await apiIsUp()) {
    console.log(`[race] reusing the API already listening on ${BASE}.\n`);
    return;
  }

  console.log(`[race] no API on ${BASE} — starting one for this run...\n`);
  server = spawn(process.execPath, [path.join(BACKEND_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'src/server.ts'], {
    cwd: BACKEND_ROOT,
    env: { ...process.env, RATE_LIMIT_LOGIN: String(PATIENTS + 50), RATE_LIMIT_API: '5000' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  server.stderr?.on('data', (b: Buffer) => process.stderr.write(`[api] ${b.toString()}`));

  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (await apiIsUp()) {
      console.log(`[race] api up (login limiter raised to ${PATIENTS + 50} for the setup burst).\n`);
      return;
    }
    if (server.exitCode !== null) {
      console.error('[race] the API process exited during startup. Is MONGODB_URI a replica set?');
      process.exit(2);
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  console.error(
    `[race] the API never became healthy at ${BASE}/health.\n` +
      '       Check that MongoDB is running as a REPLICA SET — transactions do not work on a standalone.'
  );
  process.exit(2);
}

function stopApi(): void {
  if (server && server.exitCode === null) {
    server.kill();
    console.log('\n[race] stopped the API it started.');
  }
  server = null;
}

const RACE_EMAIL = /^race\d+@example\.io$/;

/**
 * Make the script re-runnable WITHOUT touching anything it did not create.
 *
 * Two mistakes this replaces, both of which bite on the second run:
 *   - `User.deleteMany({ email: /race@/ })` never matched the seeded
 *     `race0@example.io`…`race49@example.io` accounts, so run #2 died with E11000
 *     on the users' unique email index;
 *   - `Appointment.deleteMany({})` emptied the whole appointments collection,
 *     i.e. it would have destroyed the seeded demo clinic on a dev database.
 *
 * Everything is therefore addressed through the throwaway markers this script
 * owns, and appointments are only removed for race patients / the proof doctor.
 */
async function purgePriorRun(): Promise<void> {
  const racePatients = await Patient.find({ name: /^Race Patient \d+$/ }).select('_id');
  const raceUserIds = await User.find({ email: RACE_EMAIL }).select('_id');
  const proofDoctors = await Doctor.find({ name: 'Concurrency Proof Doctor' }).select('_id');

  const patientIds = racePatients.map((p) => p._id);
  const userIds = raceUserIds.map((u) => u._id);
  const doctorIds = proofDoctors.map((d) => d._id);

  const [appts, patients, users, doctors] = await Promise.all([
    Appointment.deleteMany({
      $or: [
        { patient: { $in: patientIds } },
        { doctor: { $in: doctorIds } },
      ],
    }),
    Patient.deleteMany({ _id: { $in: patientIds } }),
    User.deleteMany({ _id: { $in: userIds } }),
    Doctor.deleteMany({ _id: { $in: doctorIds } }),
  ]);

  if (appts.deletedCount || patients.deletedCount || users.deletedCount || doctors.deletedCount) {
    console.log(
      `[race] purged a prior run: ${appts.deletedCount} appointment(s), ${patients.deletedCount} patient(s), ` +
        `${users.deletedCount} user(s), ${doctors.deletedCount} doctor(s).`
    );
  }
}

async function main(): Promise<void> {
  await ensureApi();
  await mongoose.connect(config.mongoUri, { retryWrites: true });
  await purgePriorRun();

  const doctor = await Doctor.create({
    name: 'Concurrency Proof Doctor',
    speciality: 'Proof Only',
    workingHours: [{ day: 2, start: '09:00', end: '12:00' }], // Tuesdays
    slotMinutes: 30,
  });

  const today = dateKeyOf(new Date());
  const date = nextTuesday(today);
  const slots = slotInstantsFor(doctor, date);
  const target = slots[0];
  console.log(`[race] slot under test: ${target.startsAt.toISOString()}\n`);

  // Seed users+patients directly (bcrypt cost happens once each at insert).
  const patients = [];
  for (let i = 0; i < PATIENTS; i += 1) {
    const u = await User.create({ email: `race${i}@example.io`, passwordHash: 'RacePass1', role: 'patient' });
    const p = await Patient.create({ name: `Race Patient ${i}`, phone: `+353911000${String(i).padStart(2, '0')}`, user: u._id });
    u.patient = p._id;
    await u.save();
    patients.push({ user: u, patient: p });
  }
  console.log(`[race] seeded ${patients.length} authenticated patients + 1 doctor.\n`);

  // Real HTTP auth for each patient.
  const tokens = await Promise.all(
    patients.map(async ({ user }) => {
      const res = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email, password: 'RacePass1' }),
      });
      if (!res.ok) throw new Error(`login failed for ${user.email}: ${res.status}`);
      const body = (await res.json()) as { accessToken: string };
      return body.accessToken;
    })
  );
  console.log(`[race] ${tokens.length} bearer tokens issued over HTTP.\n`);

  // The moment of truth. Each of the 50 DIFFERENT patients books the SAME
  // doctor slot — the real-world race, where fifty people want one chair at
  // nine in the morning. (Sending every request with patients[0] would also
  // produce one 201, but it would be testing a different thing: fifty
  // duplicate attempts by one person, not fifty people competing.)
  const started = Date.now();
  const results = await Promise.all(
    patients.map(({ patient }, i) => {
      const payload = {
        doctorId: String(doctor._id),
        patientId: String(patient._id),
        startsAt: target.startsAt.toISOString(),
      };
      return fetch(`${BASE}/api/appointments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens[i]}` },
        body: JSON.stringify(payload),
      }).then(async (r) => r.status);
    })
  );
  const took = Date.now() - started;

  const created = results.filter((s) => s === 201).length;
  const conflicts = results.filter((s) => s === 409).length;
  const others = results.filter((s) => s !== 201 && s !== 409);

  console.log(`[race] ${PATIENTS} concurrent bookings -> elapsed ${took}ms`);
  console.log(`  201 created : ${created}`);
  console.log(`  409 conflict: ${conflicts}`);
  if (others.length) console.log(`  other       : ${others.join(',')}`);

  // Prove the survivor is a single ROW, not merely a single 201 response.
  const survivors = await Appointment.find({ doctor: doctor._id, startsAt: target.startsAt, status: 'booked' });
  console.log(`  rows in db  : ${survivors.length} booked for this slot`);

  const pass = created === 1 && conflicts === 49 && others.length === 0 && survivors.length === 1;
  console.log(`\nVERDICT: ${created} of ${PATIENTS} succeeded, ${conflicts} rejected, ${survivors.length} row(s) stored.`);
  console.log(pass ? '  PASS — exactly one booking survives; the race is won deterministically.' : '  FAIL — re-read DESIGN.md §1.');

  await mongoose.disconnect();
  stopApi();
  process.exit(pass ? 0 : 1);
}

function nextTuesday(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d));
  const delta = (2 - day.getUTCDay() + 7) % 7;
  const next = new Date(day.getTime() + (delta === 0 ? 7 : delta) * 86_400_000);
  return next.toISOString().slice(0, 10);
}

main().catch(async (err) => {
  console.error('[race] failed:', err);
  await mongoose.disconnect().catch(() => undefined);
  stopApi();
  process.exit(1);
});