/**
 * seed.ts — one command, realistic running data, one account per role.
 *   npm run seed
 * Wipes the collection and re-seeds. All passwords meet the policy
 * (letter + digit, >= 8 chars) so every seeded login actually works.
 */
import mongoose from 'mongoose';
import User from './src/models/user.model';
import Doctor from './src/models/doctor.model';
import Patient from './src/models/patient.model';
import Appointment from './src/models/appointment.model';
import Holiday from './src/models/holiday.model';
import { config } from './src/config';
import { dateKeyOf, slotInstantsFor, dayStartUtc } from './src/services/slot.service';
import { calendarDate } from './src/services/holiday.service';
import { wallToUtc } from './src/utils/tz';

const CREDS: Array<{ email: string; password: string; role: string }> = [];

function weekdaysFromToday(dateStr: string, weekday: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d));
  const delta = (weekday - day.getUTCDay() + 7) % 7;
  const next = new Date(day.getTime() + (delta === 0 ? 7 : delta) * 86_400_000);
  return next.toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  await mongoose.connect(config.mongoUri, { retryWrites: true });

  await Promise.all([
    User.deleteMany({}),
    Doctor.deleteMany({}),
    Patient.deleteMany({}),
    Appointment.deleteMany({}),
    Holiday.deleteMany({}),
  ]);

  const announce = (email: string, password: string, role: string) => {
    CREDS.push({ email, password, role });
    console.log(`  ${role.padEnd(12)} ${email.padEnd(28)} / ${password}`);
  };

  // ---- staff ---------------------------------------------------------------
  const admin = await User.create({ email: 'admin@clinic.io', passwordHash: 'AdminPass123', role: 'admin' });
  announce('admin@clinic.io', 'AdminPass123', 'admin');
  const reception = await User.create({ email: 'reception@clinic.io', passwordHash: 'RecepPass123', role: 'receptionist' });
  announce('reception@clinic.io', 'RecepPass123', 'receptionist');

  // ---- doctors (Mon-Fri, trailing half hour that doesn't divide: proves the
  // non-even-division rule drops the partial slot) ----------------------------
  const drAoife = await Doctor.create({
    name: 'Dr. Aoife Nolan',
    speciality: 'General Practice',
    workingHours: [
      { day: 1, start: '09:00', end: '17:00' }, // Mon
      { day: 2, start: '09:00', end: '17:00' },
      { day: 3, start: '09:00', end: '17:00' },
      { day: 4, start: '09:00', end: '17:00' },
      { day: 5, start: '09:00', end: '17:15' }, // Fri ends :15 -> 16:30 slot is last
    ],
    slotMinutes: 30,
  });
  const docs1 = await User.create({ email: 'dr.nolan@clinic.io', passwordHash: 'NolanPass1', role: 'doctor' });
  docs1.doctor = drAoife._id;
  await docs1.save();
  announce('dr.nolan@clinic.io', 'NolanPass1', 'doctor');

  const drBrady = await Doctor.create({
    name: 'Dr. Tom Brady',
    speciality: 'Cardiology',
    workingHours: [
      { day: 1, start: '09:00', end: '13:00' },
      { day: 3, start: '09:00', end: '13:00' },
      { day: 5, start: '09:00', end: '13:00' },
    ],
    slotMinutes: 20,
  });
  const docs2 = await User.create({ email: 'dr.brady@clinic.io', passwordHash: 'BradyPass1', role: 'doctor' });
  docs2.doctor = drBrady._id;
  await docs2.save();

  // ---- patients -------------------------------------------------------------
  const patients = [];
  const roster = [
    ['Mary Murphy', '+353861111111', 'mary@example.io', 'MaryPass1'],
    ['John Doherty', '+353862222222', 'john@example.io', 'JohnPass1'],
    ['Siobhan Casey', '+353863333333', 'siobhan@example.io', 'SiobhanPass1'],
    ['David Byrne', '+353864444444', 'david@example.io', 'DavidPass1'],
  ] as const;
  for (const [name, phone, email, pw] of roster) {
    const u = await User.create({ email, passwordHash: pw, role: 'patient' });
    const p = await Patient.create({ name, phone, user: u._id });
    u.patient = p._id;
    await u.save();
    patients.push({ patient: p, user: u, email, pw });
    announce(email, pw, 'patient');
  }

  // ---- output the doctor docs too (they login through a doctor account) -----
  console.log('  (Dr Brady logs in as dr.brady@clinic.io / BradyPass1 — role doctor)');

  // ---- appointments: a few upcoming bookings + one completed in the past ----
  const today = dateKeyOf(new Date());
  const mondays = weekdaysFromToday(today, 1);
  const nextFriday = weekdaysFromToday(today, 5);
  const lastFriday = weekdaysFromToday(today, 5);
  // For the "completed" record, go one week further back from the next Friday.
  const pastFriday = (() => {
    const [y, m, d] = lastFriday.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d) - 7 * 86_400_000).toISOString().slice(0, 10);
  })();

  const aoifeSlots = slotInstantsFor(drAoife, mondays);
  if (aoifeSlots.length >= 6) {
    await Appointment.create([
      {
        doctor: drAoife._id,
        patient: patients[0].patient._id,
        startsAt: aoifeSlots[1].startsAt,
        endsAt: aoifeSlots[1].endsAt,
        status: 'booked',
      },
      {
        doctor: drAoife._id,
        patient: patients[1].patient._id,
        startsAt: aoifeSlots[3].startsAt,
        endsAt: aoifeSlots[3].endsAt,
        status: 'booked',
      },
      {
        doctor: drAoife._id,
        patient: patients[2].patient._id,
        startsAt: aoifeSlots[5].startsAt,
        endsAt: aoifeSlots[5].endsAt,
        status: 'booked',
      },
    ]);
  }
  const bradySlots = slotInstantsFor(drBrady, nextFriday);
  if (bradySlots.length > 2) {
    await Appointment.create({
      doctor: drBrady._id,
      patient: patients[3].patient._id,
      startsAt: bradySlots[2].startsAt,
      endsAt: bradySlots[2].endsAt,
      status: 'booked',
    });
  }
  const pastSlots = slotInstantsFor(drBrady, pastFriday);
  if (pastSlots.length > 0) {
    await Appointment.create({
      doctor: drBrady._id,
      patient: patients[0].patient._id,
      startsAt: pastSlots[0].startsAt,
      endsAt: pastSlots[0].endsAt,
      status: 'completed',
    });
  }

  // ---- a clinic-wide holiday for the coming weekday -------------------------
  const holidayDay = dateKeyOf(new Date(dayStartUtc(today, config.clinicTz).getTime() + 10 * 86_400_000));
  await Holiday.create({ doctor: null, date: calendarDate(holidayDay) });

  console.log('\nSeed complete. Credentials:');
  CREDS.forEach((c) => console.log(`  ${c.role.padEnd(12)} ${c.email.padEnd(28)} / ${c.password}`));
  console.log(`Clinic-wide holiday on ${holidayDay} (slots hidden that day).`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});