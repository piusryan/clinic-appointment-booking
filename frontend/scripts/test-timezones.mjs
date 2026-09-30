/**
 * Runs the date-helper suite once per timezone.
 *
 * The bug these tests guard against only appears outside the developer's own
 * zone: a UTC-derived "today" is correct in Dublin and wrong in Kolkata,
 * Nairobi, Auckland and Honolulu. Passing a suite in one timezone is therefore
 * not evidence that the code is timezone-safe, so `npm run test:timezones`
 * re-runs the same file under six zones and fails if any disagree.
 *
 * Uses only Node's built-in test runner, so the frontend still has no test
 * framework dependency to install.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const testFile = path.join(here, '..', 'src', 'lib', 'dates.test.js');

/**
 * Chosen to cover the cases that break naive arithmetic:
 *  - UTC, the reference and the project's CLINIC_TZ in winter
 *  - IST +05:30, a half-hour offset — the case that breaks whole-hour maths
 *  - KIRT +14, the largest offset in civilian use, so a UTC "today" is
 *    already tomorrow and the difference is unmissable
 *  - PST -08, a negative offset, so "today" locally is still tomorrow in UTC
 *  - NZST +12, another southern-hemisphere zone with DST
 *  - America/Sao_Paulo, whose midnight does not exist on spring-forward days
 */
const ZONES = ['UTC', 'Asia/Kolkata', 'Pacific/Kiritimati', 'America/Los_Angeles', 'Pacific/Auckland', 'America/Sao_Paulo'];

let failed = 0;

for (const tz of ZONES) {
  process.stdout.write(`\n=== TZ=${tz} ===\n`);
  const res = spawnSync(process.execPath, ['--test', testFile], {
    stdio: 'inherit',
    env: { ...process.env, TZ: tz },
  });
  if (res.status !== 0) failed += 1;
}

process.stdout.write(`\n${ZONES.length - failed}/${ZONES.length} timezones green\n`);
process.exit(failed === 0 ? 0 : 1);
