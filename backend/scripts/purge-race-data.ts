/**
 * scripts/purge-race-data.ts
 *
 * Deletes ONLY the throwaway fixtures created by concurrent-booking.ts:
 *   - users       where email matches race\d+@example.io
 *   - patients    where name matches "Race Patient <n>"
 *   - doctors     named "Concurrency Proof Doctor"
 *   - appointments belonging to any of the above
 *
 * Nothing else in the database is touched.
 *
 *   npm run purge:race
 */

import mongoose from 'mongoose';
import { config } from '../src/config';

const RACE_EMAIL = /^race\d+@example\.io$/;

async function main() {
  await mongoose.connect(config.mongoUri, { retryWrites: true });
  const db = mongoose.connection.db!;

  // 1. Find IDs of race fixtures
  const raceUsers    = await db.collection('users').find({ email: RACE_EMAIL }).project({ _id: 1 }).toArray();
  const racePatients = await db.collection('patients').find({ name: /^Race Patient \d+$/ }).project({ _id: 1 }).toArray();
  const raceDoctors  = await db.collection('doctors').find({ name: 'Concurrency Proof Doctor' }).project({ _id: 1 }).toArray();

  const patientIds = racePatients.map(p => p._id);
  const doctorIds  = raceDoctors.map(d => d._id);
  const userIds    = raceUsers.map(u => u._id);

  // 2. Delete appointments tied to race patients or proof doctor
  const apptResult = await db.collection('appointments').deleteMany({
    $or: [
      { patient: { $in: patientIds } },
      { doctor:  { $in: doctorIds  } },
    ],
  });

  // 3. Delete the fixtures themselves
  const patResult  = await db.collection('patients').deleteMany({ _id: { $in: patientIds } });
  const docResult  = await db.collection('doctors').deleteMany({ _id: { $in: doctorIds } });
  const userResult = await db.collection('users').deleteMany({ _id: { $in: userIds } });

  const total = apptResult.deletedCount + patResult.deletedCount + docResult.deletedCount + userResult.deletedCount;

  if (total === 0) {
    console.log('Nothing to clean up — database already clear of race fixtures.');
  } else {
    console.log('Purge complete:');
    console.log(`  appointments : ${apptResult.deletedCount} deleted`);
    console.log(`  patients     : ${patResult.deletedCount} deleted`);
    console.log(`  doctors      : ${docResult.deletedCount} deleted`);
    console.log(`  users        : ${userResult.deletedCount} deleted`);
    console.log(`  ─────────────────────────`);
    console.log(`  total        : ${total} documents removed`);
  }

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('Purge failed:', err);
  process.exit(1);
});
