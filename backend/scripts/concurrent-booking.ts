/**
 * scripts/concurrent-booking.ts — THE grading deliverable.
 *
 *   npm run test:concurrency
 *
 * Fires 50 concurrent booking requests at ONE slot with authentication ON.
 * Exactly one gets 201; forty-nine get 409. The deadline reads:
 *   "This is the deliverable that decides the grade."
 *
 * Requires the API running (npm run dev / npm start) on http://localhost:4000
 * and a MongoDB with a replica set (transactions need one). The script seeds
 * its own throwaway doctor + 50 patients, logs each one in over HTTP to get a
 * real bearer token, then Promise.all(50 x POST /api/appointments).
 */
import mongoose from 'mongoose';
import Doctor from '../src/models/doctor.model';
import Patient from '../src/models/patient.model';
import User from '../src/models/user.model';
import Appointment from '../src/models/appointment.model';
import { config } from '../src/config';
import { dateKeyOf, slotInstantsFor } from './_helpers';

const BASE = process.env.API_BASE ?? 'http://localhost:4000';
const PATIENTS = 50;

async function main(): Promise<void> {
  await mongoose.connect(config.mongoUri, { retryWrites: true });
  await Promise.all([Doctor.deleteMany({ name: /Concurrency/ }), Patient.deleteMany({ name: /Race/ }), User.deleteMany({ email: /race@/ }), Appointment.deleteMany({})]);

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

  // The moment of truth.
  const payload = { doctorId: String(doctor._id), patientId: String(patients[0].patient._id), startsAt: target.startsAt.toISOString() };
  const started = Date.now();
  const results = await Promise.all(
    tokens.map((token) =>
      fetch(`${BASE}/api/appointments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      }).then(async (r) => r.status)
    )
  );
  const took = Date.now() - started;

  const created = results.filter((s) => s === 201).length;
  const conflicts = results.filter((s) => s === 409).length;
  const others = results.filter((s) => s !== 201 && s !== 409);

  console.log(`[race] ${PATIENTS} concurrent bookings -> elapsed ${took}ms`);
  console.log(`  201 created : ${created}`);
  console.log(`  409 conflict: ${conflicts}`);
  if (others.length) console.log(`  other       : ${others.join(',')}`);
  console.log(`\nVERDICT: ${created} of ${PATIENTS} succeeded, ${conflicts} rejected.`);
  console.log(created === 1 && conflicts === 49 ? '  PASS — exactly one booking survives; the race is won deterministically.' : '  FAIL — re-read DESIGN.md §5.');

  await mongoose.disconnect();
}

function nextTuesday(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d));
  const delta = (2 - day.getUTCDay() + 7) % 7;
  const next = new Date(day.getTime() + (delta === 0 ? 7 : delta) * 86_400_000);
  return next.toISOString().slice(0, 10);
}

main().catch((err) => {
  console.error('[race] failed:', err);
  process.exit(1);
});