/**
 * scripts/naive-booking.ts
 * PROVES the naive check-then-write pattern breaks.
 *
 * This is fossilised Module 4 controller logic: "if the slot looks free,
 * write the appointment". Between the .find() and the .create() there is an
 * `await`, and that await returns CONTROL TO THE EVENT LOOP, so all 50
 * in-flight requests interleave exactly at that gap. Every one of them sees
 * "free", and every one of them writes. No index, no transaction — the clinic
 * is double-booked 50 times.
 *
 * Usage: tsx scripts/naive-booking.ts   (needs a running MongoDB w/ replica set)
 */
import mongoose from 'mongoose';
import Doctor from '../src/models/doctor.model';
import Patient from '../src/models/patient.model';
import Appointment from '../src/models/appointment.model';
import { config } from '../src/config';
import { dateKeyOf, slotInstantsFor, weekdaysFromDate } from './_helpers';

const CONCURRENCY = 50;

async function main(): Promise<void> {
  await mongoose.connect(config.mongoUri, { retryWrites: true });
  console.log(`[naive] target slot tries: ${CONCURRENCY}`);
  console.log('[naive] booking pattern: (find if free) -> (await) -> (insert). No index, no transaction.\n');

  const doctor = await Doctor.create({
    name: 'Naive Demonstration Doctor',
    speciality: 'Proof Only',
    workingHours: [{ day: 1, start: '09:00', end: '11:00' }],
    slotMinutes: 30,
  });
  const patient = await Patient.create({ name: 'Naive Patient', phone: '+353900000001' });

  const today = dateKeyOf(new Date());
  const date = weekdaysFromDate(today, 1);
  const slots = slotInstantsFor(doctor, date);
  const target = slots[0];
  console.log(`[naive] racing on slot ${target.startsAt.toISOString()} (${date})\n`);

  const flag = Symbol();
  const naiveBook = async (): Promise<string> => {
    const taken = await Appointment.findOne({ doctor: doctor._id, startsAt: target.startsAt, status: 'booked' });
    if (taken) return 'SEEN-TAKEN';
    await Appointment.create({ doctor: doctor._id, patient: patient._id, startsAt: target.startsAt, endsAt: target.endsAt, status: 'booked' });
    return 'BOOKED';
  };

  const results = await Promise.all(Array.from({ length: CONCURRENCY }, () => naiveBook()));
  const booked = results.filter((r) => r === 'BOOKED').length;
  const seen = results.filter((r) => r === 'SEEN-TAKEN').length;

  console.log(`  booked:   ${booked}`);
  console.log(`  saw-taken:${seen}`);
  console.log(`\nRESULT: ${booked}/${CONCURRENCY} concurrent requests "succeeded".`);
  console.log(booked > 1 ? '  The clinic is now DOUBLE-BOOKED. The naive pattern loses the race every time.' : '  (unexpected — the naive pattern appears to have held)');

  const stored = await Appointment.countDocuments({ doctor: doctor._id, status: 'booked' });
  console.log(`  Rows actually stored for that slot: ${stored}  ${stored > 1 ? '<= DOUBLE BOOKING PROVEN' : ''}`);
  void flag;
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});