import mongoose, { type ClientSession } from 'mongoose';

/**
 * utils/transaction.ts — the project's one generic.
 *
 * `withTransaction<T>` owns the whole session lifecycle: open a session, run
 * the callback inside `session.withTransaction` (so MongoDB itself retries the
 * body on a transient transaction error and commits or aborts as a unit), and
 * `endSession()` in a `finally` so no caller can leak a session. `T` is the
 * caller's return type, so a transaction's value flows back out typed rather
 * than through a cast at each call site.
 *
 * Every multi-document write in this codebase goes through it: booking,
 * reschedule, cancel, status change, registration, doctor and patient
 * creation. It is the reason `MONGODB_URI` must carry `?replicaSet=rs0` —
 * a standalone mongod has no transactions.
 */
export async function withTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession();
  try {
    return (await session.withTransaction(() => fn(session))) as T;
  } finally {
    await session.endSession();
  }
}
