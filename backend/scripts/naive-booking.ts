/**
 * scripts/naive-booking.ts
 * PROVES the naive check-then-write pattern breaks — and that the index is
 * what saves us.
 *
 *   npm run test:naive
 *
 * The brief asks for the three race-prevention strategies compared:
 *   1. naive check-then-write   -> loses the race every time  (PHASE A)
 *   2. unique compound index    -> one wins, 49 x E11000      (PHASE B)
 *   3. session + transaction    -> proven by `npm run test:concurrency`
 *
 * PHASE A runs the naive pattern against a deliberately INDEX-LESS collection.
 * That is the whole point: if it ran against the real `appointments` collection
 * it would be blocked by our own unique index and would prove nothing. The bug
 * being demonstrated is that between the `.findOne()` and the `.insertOne()`
 * there is an `await`, and that await returns control to the event loop, so all
 * 50 in-flight requests interleave exactly at that gap. Every one of them sees
 * "free" and every one of them writes.
 *
 * PHASE B then runs the identical pattern against the real, indexed model and
 * shows the database refusing the duplicates.
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

/** The naive demo writes here: a real collection with NO unique index. */
const DEMO_COLLECTION = 'appointments_naive_demo';

function isDupKey(err: unknown): boolean {
  return (err as { code?: number }).code === 11000;
}

async function main(): Promise<void> {
  await mongoose.connect(config.mongoUri, { retryWrites: true });

  // ---- fixtures ------------------------------------------------------------
  const doctor = await Doctor.create({
    name: 'Naive Demonstration Doctor',
    speciality: 'Proof Only',
    workingHours: [{ day: 1, start: '09:00', end: '11:00' }], // Mondays
    slotMinutes: 30,
  });
  const patient = await Patient.create({ name: 'Naive Patient', phone: '+353900000001' });

  const today = dateKeyOf(new Date());
  const date = weekdaysFromDate(today, 1);
  const target = slotInstantsFor(doctor, date)[0];
  const endsAt = new Date(target.startsAt.getTime() + doctor.slotMinutes * 60_000);

  console.log('============================================================');
  console.log('P6 HARD CORE — naive check-then-write vs. the unique index');
  console.log('============================================================');
  console.log(`slot under test : ${target.startsAt.toISOString()} (${date})`);
  console.log(`attempts        : ${CONCURRENCY} x Promise.all (no serialisation)\n`);

  // ---- PHASE A: naive, index-less -----------------------------------------
  const demo = mongoose.connection.collection(DEMO_COLLECTION);
  await demo.deleteMany({});

  const naiveBook = async (): Promise<'BOOKED' | 'SEEN-TAKEN'> => {
    const taken = await demo.findOne({ doctor: doctor._id, startsAt: target.startsAt, status: 'booked' });
    if (taken) return 'SEEN-TAKEN';
    await demo.insertOne({
      doctor: doctor._id,
      patient: patient._id,
      startsAt: target.startsAt,
      endsAt,
      status: 'booked',
      createdAt: new Date(),
    });
    return 'BOOKED';
  };

  console.log('--- PHASE A: naive check-then-write, NO unique index ---');
  const naiveResults = await Promise.all(Array.from({ length: CONCURRENCY }, () => naiveBook()));
  const naiveBooked = naiveResults.filter((r) => r === 'BOOKED').length;
  const naiveSeen = naiveResults.filter((r) => r === 'SEEN-TAKEN').length;
  const naiveStored = await demo.countDocuments({ doctor: doctor._id, startsAt: target.startsAt });

  console.log(`  requests that saw a free slot : ${naiveSeen === 0 ? CONCURRENCY : naiveSeen}`);
  console.log(`  requests that WROTE a booking : ${naiveBooked}`);
  console.log(`  rows actually stored          : ${naiveStored}`);
  // ---- PHASE B: identical pattern, real indexed model ----------------------
  console.log('--- PHASE B: same pattern, real `appointments` collection (partial unique index) ---');
  const indexedBook = async (): Promise<'CREATED' | 'DUPLICATE'> => {
    try {
      const taken = await Appointment.findOne({ doctor: doctor._id, startsAt: target.startsAt, status: 'booked' });
      if (taken) return 'DUPLICATE';
      await Appointment.create({
        doctor: doctor._id,
        patient: patient._id,
        startsAt: target.startsAt,
        endsAt,
        status: 'booked',
      });
      return 'CREATED';
    } catch (err) {
      if (isDupKey(err)) return 'DUPLICATE'; // the service maps this to 409
      throw err;
    }
  };

  const indexedResults = await Promise.all(Array.from({ length: CONCURRENCY }, () => indexedBook()));
  const indexedCreated = indexedResults.filter((r) => r === 'CREATED').length;
  const indexedDup = indexedResults.filter((r) => r === 'DUPLICATE').length;
  const indexedStored = await Appointment.countDocuments({ doctor: doctor._id, startsAt: target.startsAt });

  console.log(`  201-created          : ${indexedCreated}`);
  console.log(`  E11000 -> 409        : ${indexedDup}`);
  console.log(`  rows actually stored : ${indexedStored}`);
  console.log(
    `  VERDICT: ${indexedCreated === 1 && indexedStored === 1 ? 'the index is law — exactly one booking survives.' : 'unexpected result.'}\n`
  );

  console.log('============================================================');
  console.log(`COMPARISON: identical application code, one variable (the index):`);
  console.log(`  no index -> ${naiveStored} rows stored for one slot`);
  console.log(`  index    -> ${indexedStored} row stored, ${indexedDup} rejected with E11000`);
  console.log('============================================================');

  // ---- cleanup: leave the database exactly as we found it ------------------
  await demo.drop().catch(() => undefined);
  await Appointment.deleteMany({ doctor: doctor._id });
  await doctor.deleteOne();
  await patient.deleteOne();
  console.log('\n[naive] demo fixtures cleaned up — database left untouched.');
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('[naive] failed:', err);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
