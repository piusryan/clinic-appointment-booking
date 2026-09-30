# DESIGN.md — P6 Clinic Appointment Booking

Every design decision this project required defending. This is the CO2/CO4
evidence for the hard core, the data modelling, the permission matrix, and the
token-storage argument.

---

## 1. Problem statement and the hard core

Two patients click **Book** on the **same slot at the same millisecond**. The
business rule is absolute: **the same doctor slot must never be booked twice.**

A "check-then-write" controller (read availability, then insert) *loses* the
race every time and is exactly the failure the brief warns about. This project
solves it at the **data layer**, not the controller.

### 1.1 Why the naive version loses — the event loop, concretely

This is the part worth being precise about, because "check-then-write is racy"
is usually asserted and rarely demonstrated.

Node is **single-threaded** with an event loop. Each request handler runs as a
callback; I/O yields the thread. The naive handler has an `await` *between* the
check and the write:

```ts
const taken = await Appointment.findOne({ doctor, startsAt, status: 'booked' });
if (taken) return 'SEEN-TAKEN';          // <-- all 50 see "free" and pass this
await Appointment.create({ ... });        // <-- all 50 then write
```

What actually happens with 50 simultaneous requests:

| t    | Event-loop action                                                              |
| ---- | ------------------------------------------------------------------------------ |
| t0   | request #1 starts, hits `await findOne`, **yields the thread**                 |
| t1   | requests #2…#50 start, each hits its own `await findOne`, all yield            |
| t2   | #1's `findOne` callback fires: no row yet → `taken` undefined → passes         |
| t3   | #2…#50's callbacks fire in the same loop phase: still no row → all pass         |
| t4   | all 50 `create` calls are issued, the 50 inserts land                          |

The interleave happens **at the `await`, not inside a thread race**. No amount of
care in the JavaScript avoids it: the check and the write are separated by an I/O
boundary, and every other in-flight request is scheduled in that gap. This is why
"it's single-threaded so it can't happen" is wrong, and why the fix has to be
somewhere other than the application code.

Note also *where* the fix cannot go. A mutex, an `if (!busy)` flag, or a
promise-queue serialisation inside the process would all work — and all would be
wrong: they protect **one process**, while the API is designed to run behind a
load balancer, and a second instance would reintroduce the identical race. The
invariant has to be enforced by something that every instance shares: the
database.

### 1.2 The three strategies, compared

All three were implemented and measured. `npm run test:naive` runs strategies 1
and 2 back to back in one process against one database, so the only variable is
the mechanism.

| # | Strategy                              | Where the guard lives        | Survives a 2nd process? | Result              |
| - | ------------------------------------- | ---------------------------- | ----------------------- | ------------------- |
| 1 | naive check-then-write                | application code             | no                      | **50 rows**         |
| 2 | unique compound index                 | MongoDB storage engine       | **yes**                 | **1 row, 49 × E11000** |
| 3 | session + transaction                 | MongoDB, multi-document      | **yes**                 | **1 row, 49 × 409** |

Real output from `npm run test:naive` (identical application code in both phases;
Phase A writes to a deliberately index-less collection, because running the naive
pattern against the *real* `appointments` collection would be blocked by our own
index and would prove nothing):

```
P6 HARD CORE — naive check-then-write vs. the unique index
slot under test : 2026-10-05T08:00:00.000Z (2026-10-05)
attempts        : 50 x Promise.all (no serialisation)

--- PHASE A: naive check-then-write, NO unique index ---
  requests that saw a free slot : 50
  requests that WROTE a booking : 50
  rows actually stored          : 50
--- PHASE B: same pattern, real `appointments` collection (partial unique index) ---
  201-created          : 1
  E11000 -> 409        : 49
  rows actually stored : 1
  VERDICT: the index is law — exactly one booking survives.

COMPARISON: identical application code, one variable (the index):
  no index -> 50 rows stored for one slot
  index    -> 1 row stored, 49 rejected with E11000
```

**Verdict: strategy 2 (the index) is the load-bearing mechanism**, and strategy
3 is layered on top because booking is not a single-document write. Strategy 1 is
rejected — and the proof above is the reason, not an opinion.

### 1.3 Index-enforced invariant (the real backstop)

```ts
// backend/src/models/appointment.model.ts
appointmentSchema.index(
  { doctor: 1, startsAt: 1 },
  { unique: true, partialFilterExpression: { status: 'booked' } }
);
```

A unique index is atomic at the storage engine — two concurrent inserts of the
same `(doctor, startsAt)` cannot both succeed. One wins; the other aborts with
`E11000`, which the service maps to **HTTP 409**. The partial filter means a
*cancelled* appointment correctly frees its slot (uniqueness only applies while
`status === 'booked'`), which is the desired domain behaviour.

Two properties of this index that a plain unique index would get wrong:

- **`partialFilterExpression: { status: 'booked' }`** — without the filter, a
  cancelled appointment would keep occupying its `(doctor, startsAt)` forever and
  the slot could never be rebooked. The filter scopes the constraint to the only
  state in which the slot is actually taken.
- **The key is `(doctor, startsAt)`, not `patient`** — the invariant is about a
  *chair*, not a person. One patient may legitimately hold several appointments
  (and rebooking after cancelling must be allowed), so a `patient`-keyed index
  would be both too strict and useless for the race.

### 1.4 Transactions for multi-document invariants

Booking is not one insert. It reads availability, checks holidays, writes the
appointment, and (in the same request) touches the audit trail. Those steps must
not be able to half-apply, so they run inside a **replica-set transaction**
(`utils/transaction.ts` → `withTransaction<T>()`).

The `withTransaction` helper exists because the naive `session.startTransaction()`
pattern has a specific failure mode: if the callback throws, a hand-rolled
implementation often forgets `abortTransaction()` and leaks a session — and a
leaked session is held for the transaction lifetime. The helper wraps the whole
body in `try/finally` so the abort happens on **every** exit path, and returns a
typed value instead of making every caller cast the result out of
`session.withTransaction`'s `void`.

Transactions require a replica set — which is why `MONGODB_URI` carries
`?replicaSet=rs0`, and why a standalone `mongod` makes booking fail loudly rather
than silently. `/health` pings the database and reports `db.connected` so this
misconfiguration is visible instead of looking like a healthy server.

### 1.5 Evidence: end-to-end over real HTTP

`backend/scripts/concurrent-booking.ts` (`npm run test:concurrency`) closes the
loop: **50 distinct, fully authenticated patients**, each with a real bearer token
obtained by logging in over HTTP, all `POST /api/appointments` for the *same*
doctor slot, all fired in one `Promise.all`. Real output:

```
[race] api up (login limiter raised to 100 for the setup burst).
[race] purged a prior run: 1 appointment(s), 50 patient(s), 50 user(s), 1 doctor(s).
[race] slot under test: 2026-10-06T08:00:00.000Z
[race] seeded 50 authenticated patients + 1 doctor.
[race] 50 bearer tokens issued over HTTP.
[race] 50 concurrent bookings -> elapsed 796ms
  201 created : 1
  409 conflict: 49
  rows in db  : 1 booked for this slot

VERDICT: 1 of 50 succeeded, 49 rejected, 1 row(s) stored.
  PASS — exactly one booking survives; the race is won deterministically.
```

Three details make this a real proof rather than a restatement of the index
definition:

1. **50 different patients**, each booking *their own* appointment for the shared
   slot. (An earlier version of this script sent all 50 requests as
   `patients[0]`; that also yields one `201`, but it tests one person hammering
   their own slot, not fifty people competing for one chair. The fix is
   commented in the script.)
2. **The `rows in db` line queries Mongo afterwards.** A single `201` among the
   responses is not sufficient — the script independently counts the stored rows
   and fails unless exactly one exists. This would catch a case where the index
   behaved but a compensating write elsewhere deleted the winner.
3. **Authentication is on**, over real HTTP, so the whole path — limiter,
   `authorize`, validation, service, transaction, index, error mapping to 409 —
   is exercised, not a shortcut straight to the model layer.

The script is re-runnable and self-contained: it reuses an already-running API
if it finds one, otherwise starts and stops its own, and its cleanup deletes only
the fixtures it created (it purges by its own markers, never `Appointment.deleteMany({})`).


## 2. Tech stack

| Concern      | Choice                                | Why                                            |
| ------------ | ------------------------------------- | ---------------------------------------------- |
| Language     | TypeScript (strict, no `any`)         | Shared contract + compile-time safety (§3)     |
| HTTP         | Express (v4)                          | Mature MVC host                                |
| ODM          | Mongoose (v8)                         | Schemas, hooks, indexes, transactions          |
| Auth         | bcrypt + JWT + httpOnly cookies       | §7 token-storage argument                      |
| Frontend     | React 18 + Vite                       | Composed components, hand-written CSS          |
| Attributes   | Hand-written responsive CSS           | No UI framework (deliverable)                  |

## 3. The shared contract (`shared/types.ts`)

A single TypeScript module defines every DTO, role, status, and the value
constants that both halves agree on. The backend compiles against the types in
strict mode; the frontend imports the plain constants (`ROLES`,
`APPOINTMENT_STATUS`, `HTTP`) so the UI can never hard-code a value that
disagrees with the server. This is the "shared types/module defines the API
contract used by both halves" deliverable.

## 4. Data model & schema diagram

```
User  ──1─┬──0..1──> Patient
     └──1─┴──0..1──> Doctor

Doctor  1──────* Appointment *──────1  Patient
Doctor  1──────* Holiday      (doctor null = clinic-wide)
Appointment ──> AuditLog (one write per medical read)
```

| Collection   | Key fields                                              | Notes                              |
| ------------ | ------------------------------------------------------- | ---------------------------------- |
| `User`       | `email` (unique), `passwordHash` (select:false), `role`, `refreshTokenVersion`, `isActive`, `patient?`, `doctor?` | password hash never leaks (§7) |
| `Patient`    | `name`, `phone` (unique), `user?`                       |                                   |
| `Doctor`     | `name`, `speciality`, `workingHours[]` (embedded), `slotMinutes`, `user?` |                                   |
| `Appointment`| `doctor` (ref), `patient` (ref), `startsAt`, `endsAt`, `status` | partial unique index `(doctor,startsAt)` |
| `Holiday`    | `doctor` (null=clinic-wide), `date`                       | calendar date stored at UTC midnight |
| `AuditLog`   | `actor`, `actorRole`, `action`, `targetPatient?`, `ts`   | every patient read is logged       |

### Embed-vs-reference justification

- **Embedded: `Doctor.workingHours`.** Opening hours are *value semantics* that
  travel with the doctor, are never queried independently, and are always
  fetched with the doctor. Embedding avoids a join, keeps a doctor readable in
  one round-trip, and there is no separate "working-hours" resource. Schema
  validation enforces `start < end` and one entry per weekday.
- **Referenced: `Appointment.doctor` / `Appointment.patient`.** Appointments are
  the growth axis and are queried by doctor/patient independently. Duplicating
  the doctor's and patient's data into every appointment would bloat documents
  and cause update anomalies when, e.g., a patient's phone changes. A reference
  keeps the truth in one place.
- **Referenced: `User.doctor` / `User.patient`.** Auth identity is separate from
  the domain record; two documents linked by ObjectId is the clean split.

## 5. Permission matrix

Guards are **declared in the routes file** and **enforced in middleware**
(`authorize`, `ownership`), never as `if (user.role === ...)` in a controller —
that is the graded layering contract.

| Route                         | patient | doctor | receptionist | admin |
| ----------------------------- | :-----: | :----: | :----------: | :---: |
| `auth` /me /password          |   ✓    |   ✓    |      ✓       |   ✓   |
| `doctors` GET (list/show)     |   ✓    |   ✓    |      ✓       |   ✓   |
| `doctors/:id/slots`           |   ✓    |   ✓    |      ✓       |   ✓   |
| `doctors/:id/schedule`        |  **403**| own only|      ✓       |   ✓   |
| `doctors` POST/PATCH/DELETE   |   ✗    |   ✗    |      ✗       |   ✓   |
| `patients` GET (all)          |   ✗    |   ✗    |      ✓       |   ✓   |
| `patients/:id` GET            |   ✗    |   ✗    |      ✓       |   ✓   |
| `patients` POST/PATCH/DELETE  |   ✗    |   ✗    |      ✗       |   ✓   |
| `appointments` GET            | own only| own only|    ✓       |   ✓   |
| `appointments` POST (book)    | self only| ✗    |      ✓       |   ✓   |
| `appointments/:id/cancel`     | own     | own    |      ✓       |   ✓   |
| `appointments/:id/reschedule` | own     | ✗      |      ✓       |   ✓   |
| `appointments/:id/status`     |   ✗    | own (attending) | ✗  |   ✓   |
| `holidays` GET                |   ✗    |   ✗    |      ✓       |   ✓   |
| `holidays` POST/DELETE        |   ✗    |   ✗    |      ✗       |   ✓   |
| `audit` GET                   |   ✗    |   ✗    |      ✗       |   ✓   |

Notes:

- **401 vs 403.** `authenticate` answers "who are you?" (401 with no/invalid
  token). `authorize`/`ownership` answer "are you allowed to?" and return **403**
  (the caller *is* authenticated, just not permitted). This distinction is
  graded.
- **Ownership checks** (`ownership.ts`) scopes row-level access: a patient can
  only book/cancel/reschedule *their own* appointment (`patientWithinScope`,
  `ownsAppointment`), and a doctor can only manage their own schedule.
- **The IDOR target is deliberately closed** — `doctors/:id/schedule` returns
  **403 to patients** rather than leaking a doctor's patient list. See
  `SECURITY.md` for the before/after curl transcripts.

## 6. The layering contract

| Layer      | May do                                    | May never do                                  |
| ---------- | ----------------------------------------- | --------------------------------------------- |
| Model      | Schema, validation, hooks, virtuals, indexes | Import Express; know status codes          |
| Service    | Business rules, transactions, orchestration | Reference `req`/`res` (grep-checked)       |
| Controller | Parse request, call service, send response | Build raw Mongoose queries inline          |
| Routes     | Map method+path to handler, declare guards | Contain an `if` (incl. role checks)        |
| Middleware | Authenticate, authorize, validate, handle errors | Contain domain rules that belong in a service |
| Component  | Render, own local UI state                | Call `fetch` directly (that belongs in `api/`) |

`app.ts` exports `buildApp()` **without calling `listen()`** so tests can import
and boot it in-process (`server.ts` is the only file that calls `app.listen`).

### 6.1 Authorization vs. the transaction boundary

These are two different concerns that are easy to conflate, so the boundary is
stated explicitly.

**Authorization ("may this caller do this?") is decided *before* the transaction
opens.** It is a pure read of the caller's identity and the target's owner, it
needs no write lock, and it must fail fast so a rejected request never opens a
transaction at all. It lives in middleware (`authorize`, `ownership`), declared
on the route:

```ts
// appointment.routes.ts
router.patch('/:id/cancel', authenticate, authorize(ROLES.PATIENT, ROLES.ADMIN), ownsAppointment, controller.cancel);
```

**Consistency ("may this *write* proceed, and is it atomic?") is decided *inside*
the transaction.** Two checks are deliberately *not* in middleware, because doing
them outside would be a check-then-write — exactly the §1 bug:

| Check                                            | Why it is in the service, not middleware |
| ------------------------------------------------ | ---------------------------------------- |
| holiday closure on the target date               | a holiday can be created between the check and the write; re-read inside the txn so a closed day cannot be booked |
| slot still free / still owned (reschedule)       | the state can change between check and write — this *is* the race |
| status-transition legality (`booked` → `completed`/`no-show`) | must be evaluated against the row as it is inside the txn |
| the unique-index conflict                         | only knowable at insert time; surfaces as `E11000` → `409` |

The resulting request path is:

```
request
  ├─ authenticate        → 401 if no/invalid token            (no DB write)
  ├─ authorize(role)     → 403 if the role is not permitted    (no DB write)
  ├─ ownership(target)   → 403 if not the owner                (no DB write)
  ├─ validate(body)      → 400 if malformed                    (no DB write)
  └─ service:
       └─ withTransaction(…)
            ├─ re-check state that could have changed (holiday, slot, status)
            ├─ write
            └─ commit   ── or abort on any throw (finally)
                 └─ errorHandler maps AppError → status; E11000 → 409
```

**Why the holiday check is the clearest illustration.** A middleware
`ensureDoctorWorking` looks tidy, but a holiday is created by an admin in a
*different request*. Checking it in middleware leaves a window in which an admin
closes the clinic and a patient books a slot on the closed day anyway — the
write succeeds because nothing re-validated it. Re-reading holidays inside the
transaction narrows that window to what the transaction itself can protect, and
`backend/__tests__/holiday.test.ts` asserts the closure at the **write path**
(not only the read path) for both booking and rescheduling.

**The one thing authorization must never do** is be "re-checked inside the
transaction" as a substitute for being done in middleware. Duplicating it there
would be noise; the transaction is for *state*, not for *identity*.

## 7. Token-storage argument (CO4)

- **Access token**: short-lived (15 min), sent as `Authorization: Bearer`, and
  *not* stored in `localStorage` (XSS-stealable). It lives in memory in the
  frontend data layer.
- **Refresh token**: stored in an **httpOnly + Secure (in prod)** cookie so
  JavaScript can never read it, reducing the XSS exfiltration surface. This is
  the safer choice over `localStorage` for a healthcare app.
- **Rotation + reuse detection**: every refresh issues a new refresh token and
  bumps the user's `refreshTokenVersion`; a replayed old token is rejected. A
  password change also bumps the version, instantly invalidating all previously
  issued refresh tokens.

## 8. Auditability of medical reads

Patient records are medical data. Every individual `GET /api/patients/:id` is
written to `AuditLog` with the actor identity and role (`patient.read`). An
admin-only `GET /api/audit` lets the clinic demonstrate *who read what and
when* — a HIPAA-aligned "access logging" behaviour.

## 9. Calendar, timezones, and the Indian-calendar scope

This is the subtlest correctness surface in the project, and it is a place where
a plausible-looking implementation is quietly wrong.

### 9.1 Two different kinds of "date"

| Kind                            | Example                                  | Where it lives                    | Rule                                |
| ------------------------------- | ---------------------------------------- | --------------------------------- | ----------------------------------- |
| **instant** (a moment in time)   | `2026-10-06T08:00:00.000Z`               | `Appointment.startsAt` / `endsAt` | UTC on the wire (`Date.toISOString()`) |
| **calendar date** (a labelled day)| `2026-10-06`                            | `Holiday.date`, request `?date=`, the browser's date input | a bare `YYYY-MM-DD` string with **no zone at all** |

A `Holiday.date` is **not** an instant. `new Date('2026-10-06')` parses as
UTC midnight, which in Dublin is 01:00 on the 6th and in Kolkata is 05:30 on
the 6th — and for a zone *behind* UTC it lands on the **5th**. Storing a
timezone-less concept as an instant is a bug that only appears for users east or
west of Greenwich, so holiday dates are stored as plain `YYYY-MM-DD` strings and
compared as strings. The test suite pins this in six zones (§9.4).

### 9.2 Clinic timezone vs. viewer timezone

`CLINIC_TZ` (`Europe/Dublin` in `.env.example`) is used for exactly one thing:
**deriving which UTC instants a doctor's working hours correspond to.** A doctor
working `09:00–17:00` is generating 09:00 *Dublin* instants, so the server must
build the slot grid in the clinic's zone regardless of where the request came
from. Deriving it in the server's local zone would silently shift every slot for
any deployment not running in Dublin.

Slot *instants* are then rendered in the **viewer's** local zone in the UI,
because "what time do I have to turn up" is a question about the person asking.
The two are different questions with different correct answers, and conflating
them is the bug. This is a deliberate choice and it is commented at the call site
in `SlotGrid.jsx`.

### 9.3 The bug this project actually had

The original `SlotGrid` derived a weekday from an instant with:

```ts
new Date(slot.startsAt).toLocaleDateString(undefined, { weekday: 'short' })
```

`toLocaleDateString` uses the **viewer's** zone to pick the day, while the
server had produced the slot in the **clinic's** zone. For a viewer in
`America/Los_Angeles` the Dublin 09:00 slot is 01:00 *the previous day*, so the
grid rendered the appointment under the wrong column — a patient would turn up a
day early or late, and the header said one thing while the slot was another.

The fix routes every date through `frontend/src/lib/dates.js` rather than calling
`toLocaleDateString` or `toISOString().slice(0, 10)` ad hoc at each call site.
`localDateKey()` is the only sanctioned way to turn a `Date` into a `YYYY-MM-DD`,
and `parseIsoDateNoon()` is the only sanctioned way to go the other way — parsing
at **noon** so a DST transition inside the day cannot shift the date.

### 9.4 Saka / Indian calendar — explicit scope

`frontend/src/lib/indianCalendar.js` renders the Saka year and the major festival
captions alongside the Gregorian date.

**Scope, stated honestly: display only.**

- It is a **presentation** layer. It does not participate in slot generation,
  availability, holiday enforcement, or any booking invariant.
- The Gregorian `YYYY-MM-DD` remains the single source of truth for every stored
  date and every API contract. No Saka value is persisted, indexed, or compared.
- Saka year boundaries do not line up with the Gregorian year (they change in
  March/April), so a "Saka year" is *not* interchangeable with a calendar year
  for any scheduling purpose. It is rendered as a caption only, and the code
  says so.
- Festival dates come from a small curated table, not an astronomical
  computation, so they are accurate for the years listed and are **not** a
  general-purpose panchang. It is not used to decide whether the clinic is open.

### 9.5 Regression evidence

`frontend/src/lib/dates.test.js` is run under six timezones by
`npm run test:timezones` — 16 tests each, 96 test cases total, all green:

```
UTC                 16/16
Asia/Kolkata        16/16
Pacific/Kiritimati  16/16
America/Los_Angeles 16/16
Pacific/Auckland    16/16
America/Sao_Paulo   16/16
6/6 timezones green
```

The set is chosen to straddle the problem: a zone **ahead** of UTC by nearly a
day (`Kiritimati`, UTC+14) and one **behind** by eight (`Los_Angeles`, UTC−8),
plus a half-hour zone (`Kolkata`, +5:30) and a southern-hemisphere zone with DST
(`Sao_Paulo`). One test is a deliberate regression witness: it asserts that the
old `.toISOString().slice(0, 10)` approach disagrees with `localDateKey()` when
the zone offset is non-zero, so the original bug cannot silently return.

## 10. Deviations from the baseline, and why

Every one of these is a deliberate departure from the original scaffold. They
are listed so a reviewer does not have to discover them.

| # | Deviation                                                                                                                                                             | Why                                                                                                                  |
| - | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 1 | **A custom error middleware replaced the per-controller `res.status(...).json({ error: ... })` pattern.**                                                               | Centralises the shape and stops every controller from inventing a body. Services now throw typed `AppError`s, so a service file contains no status code and does not import Express — which is what makes the layering contract greppable. |
| 2 | **Business rules moved out of controllers into services** (availability maths, holiday checks, status transitions, view shaping).                                            | Controllers were becoming the de-facto service layer. Keeping them thin is what allows the same rules to be tested without HTTP and reused by the seed/proof scripts. |
| 3 | **Repeated hand-rolled `session.startTransaction()` / `commit` / `abort` blocks replaced by `withTransaction<T>()`.**                                                        | The hand-rolled version leaked the session whenever the callback threw. The helper aborts in a `finally` on every path and returns a typed result. |
| 4 | **`/health` reports a real Mongo ping and `X-Request-Id` propagates through responses and logs.**                                                                        | A hardcoded `"ok"` makes a balancer's health check lie while the database is down. The request id makes a user-reported failure traceable. |
| 5 | **Every calendar date is a plain `YYYY-MM-DD` string; `CLINIC_TZ` drives slot derivation; `localDateKey()` is the only date formatter.**                                     | Timezone drift was a real, shipped bug (§9.3). One canonical helper and one storage representation removes the class of bug rather than the instance. |
| 6 | **`setAppointmentStatus` returns `422` for an illegal transition (was `409`).**                                                                                          | `409 Conflict` means "concurrent modification" and is reserved for the genuine race; a state-machine violation is `422 Unprocessable Entity`. Reserving 409 for the index conflict keeps the two failure modes distinguishable by status alone. |
| 7 | **Rate limiters were given explicit `MemoryStore`s.**                                                                                                                   | The implicit default store could not be reset, which made the rate-limit tests order-dependent on a module singleton. |
| 8 | **Status codes were changed in the tests too, deliberately.** Where a test previously asserted the old status, it was updated **and** the new status is now justified in row 6 above. | Otherwise the suite would have been "fixed" by loosening the assertion, which is how a contract change hides. |
| 9 | **The concurrency script spawns its own API and purges only its own fixtures.**                                                                                          | It previously did `Appointment.deleteMany({})`, which would have destroyed the seeded demo clinic, and its cleanup regex never matched its own seed emails, so a second run died on the unique email index. |
| 10 | **`config.ts` refuses to boot on placeholder/short/shared secrets** instead of warning.                                                                                 | A copied `.env.example` otherwise yields a server that starts, signs tokens with a public string, and gives every deployment the same signing key. Failing closed is the only safe default. |

## 11. Design decisions summary (defensible)

1. Unique **partial** index `(doctor, startsAt)` + transactions ⇒ hard-core
   "same slot never double-booked" is storage-enforced, not controller-discipline.
   Measured, not asserted: 50 rows without the index, 1 row with it (§1.2).
2. The naive pattern loses at the **`await`**, not at a thread race (§1.1) — which
   is why the fix is in the database and not in a mutex.
3. Authorization in middleware **before** the transaction; mutable-state
   re-checks **inside** it (§6.1).
4. Embed `workingHours`, reference `patients`/`doctors` in appointments —
   value semantics vs the growth axis.
5. Guards declared in routes, enforced in middleware — layering contract holds
   (`grep -r "req." src/services/` returns nothing).
6. Token split: in-memory access token + httpOnly-cookie refresh token with
   rotation, version bump on password change.
7. `401` vs `403` kept semantically correct everywhere, and `404` is proven not
   to be an existence oracle.
8. IDOR closed deliberately with an **executable** before/after proof — a
   vulnerable build and this build in one process, same request (SECURITY.md §3).
9. Shared `shared/types.ts` contract compiled by both halves.
10. Audit logging on every sensitive medical read.
11. Calendar dates are zone-less strings; instants are UTC; the clinic zone drives
    slot generation. Verified in six timezones (§9.5).
12. Deviations from the baseline are enumerated rather than buried (§10).

