# Architecture

Clinic appointment booking system. TypeScript monorepo with a Node/Express backend, a React SPA frontend, and a shared types package.

---

## Repository layout

```
AWT/
├── backend/          # Express API (TypeScript, compiled via tsc)
│   ├── src/
│   │   ├── app.ts            # buildApp() — middleware pipeline + route mounting
│   │   ├── server.ts         # HTTP server entry point
│   │   ├── config.ts         # All env vars, secret validation
│   │   ├── db.ts             # Mongoose connect/disconnect
│   │   ├── controllers/      # Read req → call service → send response
│   │   ├── services/         # Business logic, DB queries, transactions
│   │   ├── models/           # Mongoose schemas + interfaces
│   │   ├── routes/           # Express routers — middleware chains only
│   │   ├── middleware/       # authenticate, authorize, ownership, validate, …
│   │   ├── utils/            # asyncHandler, errors, transaction, tz
│   │   └── types/            # Express augmentation (req.user), RequestUser
│   ├── scripts/              # Stand-alone concurrency proof scripts
│   └── __tests__/            # Vitest integration test suite
├── frontend/         # React 18 + Vite SPA (JavaScript)
│   └── src/
│       ├── pages/            # One file per page (LoginPage, DashboardPage, …)
│       ├── components/       # Shared UI components
│       └── api/              # Fetch wrappers for each backend resource
└── shared/           # types.ts — Role, AppointmentStatus, DTOs shared by both sides
```

---

## Layering

The backend enforces a strict four-layer contract. Each layer has exactly one responsibility and may only call the layer below it.

```
HTTP Request
    │
    ▼
Routes (routes/*.routes.ts)
    • Declare the middleware chain for each endpoint
    • No business logic, no Mongoose imports
    │
    ▼
Controllers (controllers/*.controller.ts)
    • Parse req, call exactly one service function, send res
    • No role branches, no DB access
    │
    ▼
Services (services/*.service.ts)
    • All business logic, role-scoped filtering, state-machine rules
    • The only layer that calls Mongoose models directly
    • Role checks live here, not in controllers
    │
    ▼
Models (models/*.model.ts)
    • Mongoose schemas, field validation, indexes
    • Pre-save hooks (password hashing)
    • No application logic
```

An `if (user.role === ...)` inside a controller is a layering violation — `listAppointmentsFor` in `appointment.service.ts` is the canonical demonstration that role-scoped reads belong in the service.

---

## Request lifecycle

```
Request
  → requestLogger          (assign/propagate X-Request-Id, redact sensitive body keys)
  → apiLimiter             (600 req/min per IP across all /api/* routes)
  → cors                   (origin from CORS_ORIGIN env var, credentials: true)
  → express.json           (body parse, 2 MB cap)
  → cookieParser
  → security headers       (X-API-Version, X-Powered-By: clinic-..., X-Content-Type-Options: nosniff)
  → route handler
      → authenticate       (JWT verification, req.user population)
      → authorize(roles)   (role guard → 403 if not in list)
      → ownership guard    (ownsAppointment / ownsDoctorSchedule / patientWithinScope)
      → validate(source)   (declarative field rules → 400)
      → bookingLimiter     (200 req/min per user, on mutating appointment routes)
      → asyncHandler       (wraps async controllers, forwards thrown errors)
      → controller
  → notFoundHandler        (catch unmatched routes → 404)
  → errorHandler           (translate all errors to { error, message } JSON)
```

---

## Data model

MongoDB with Mongoose. All multi-document writes use `withTransaction` (requires `?replicaSet=rs0` in the connection URI). Relationships are `ObjectId` references; slots are computed, never stored.

### Entity diagram (simplified)

```
User ──────────┬── Patient (one-to-one, optional back-ref via user field)
               └── Doctor  (one-to-one, optional back-ref via user field)

Doctor ──── Appointment ──── Patient
  │
  └── Holiday (doctor-specific closure; null doctor = clinic-wide)

User ──── AuditLog (actor)
Patient ──── AuditLog (targetPatient)
Doctor  ──── AuditLog (targetDoctor)
```

### User

| Field | Type | Notes |
|---|---|---|
| `email` | String | unique, lowercase, trimmed, email-validated |
| `passwordHash` | String | bcrypt cost 12; `select: false`; hashed in `pre('save')` |
| `role` | `'patient' \| 'doctor' \| 'receptionist' \| 'admin'` | |
| `refreshTokenVersion` | Number | default 0; bumped on password change to invalidate all refresh tokens |
| `isActive` | Boolean | default true; inactive users are rejected at authenticate |
| `lastLoginAt` | Date | optional |
| `patient` | ObjectId → Patient | set when the user owns a patient profile |
| `doctor` | ObjectId → Doctor | set when the user owns a doctor profile |

`toJSON` strips `passwordHash`, `refreshTokenVersion`, `__v` on every serialisation.

### Patient

| Field | Type | Notes |
|---|---|---|
| `name` | String | required, trimmed |
| `phone` | String | unique; regex `/^\+?\d{7,15}$/` |
| `user` | ObjectId → User | optional back-reference |

Index: `{ name: 1 }`.

### Doctor

| Field | Type | Notes |
|---|---|---|
| `name` | String | required, trimmed |
| `speciality` | String | required, trimmed |
| `workingHours` | `WorkingHours[]` | embedded array; each entry `{ day: 0–6, start: HH:MM, end: HH:MM }` |
| `slotMinutes` | Number | 5–240; slot duration for this doctor |
| `user` | ObjectId → User | optional back-reference |

`workingHours` is embedded (not a separate collection) because it always travels with the doctor and is never queried independently. Schema-level validator enforces uniqueness per weekday and `start < end`. Index: `{ speciality: 1 }`.

### Appointment

| Field | Type | Notes |
|---|---|---|
| `doctor` | ObjectId → Doctor | required |
| `patient` | ObjectId → Patient | required |
| `startsAt` | Date | required; UTC instant |
| `endsAt` | Date | required; `startsAt + slotMinutes` |
| `status` | `'booked' \| 'cancelled' \| 'completed' \| 'no-show'` | default `'booked'` |
| `cancelledAt` | Date | optional; set when cancelled |

Critical index: `{ doctor: 1, startsAt: 1 }` with `partialFilterExpression: { status: 'booked' }`. This means only one *booked* appointment per doctor per time slot; cancelled slots can be rebooked. This is the DB-level concurrency backstop — see [Concurrency](#concurrency) below.

Additional index: `{ patient: 1, startsAt: 1 }`.

### Holiday

| Field | Type | Notes |
|---|---|---|
| `doctor` | ObjectId → Doctor \| null | `null` = clinic-wide closure |
| `date` | Date | UTC midnight only (validated) |

Index: `{ doctor: 1, date: 1 }`.

### AuditLog

| Field | Type | Notes |
|---|---|---|
| `actorId` | ObjectId → User | required |
| `actorRole` | String | required |
| `action` | String | e.g. `'appointment.read'`, `'patient.read'` |
| `targetPatient` | ObjectId → Patient | optional |
| `targetDoctor` | ObjectId → Doctor | optional |
| `resource` | String | `'appointment' \| 'patient' \| 'schedule'` |
| `resourceId` | String | optional |
| `ip` | String | optional |

Indexes: `{ targetPatient: 1, createdAt: -1 }`, `{ createdAt: 1 }`.

---

## Slot model

Slots are **never stored**. They are computed on demand from three inputs:

```
slotInstantsFor(doctor, date)
    = workingHours windows for weekday(date, clinicTz)
    → step slotMinutes ms from win.start to win.end
    → only full slots that fit inside the window
```

Availability is then derived by subtracting holidays and booked appointments:

```
getAvailability(doctor, doctorId, date)
    if isHoliday(doctorId, date) → []
    occupied = booked appointment startsAt values for that doctor+day
    return slotInstants.map(s => ({ ...s, available: !occupied.has(s.startsAt) }))
```

The month calendar view (`monthCalendar`) evaluates an entire month with two range queries (one for holidays, one for booked appointments), not one query per day.

All times are UTC instants. Working hours are clinic-local wall clock (configured via `CLINIC_TZ`). Conversion is done in `utils/tz.ts` using `Intl.DateTimeFormat`.

---

## Concurrency

Booking uses a double-check pattern with a DB-level hard backstop:

1. **Pre-flight** (outside transaction): `isDerivableSlot` and `isHoliday` reject off-schedule or closed requests cheaply before opening a transaction.
2. **Transaction** (`withTransaction`): explicit `Appointment.exists({ doctor, startsAt, status: 'booked' })` check before creating. If the slot was taken while the client was deciding → 409.
3. **Unique index backstop**: `{ doctor, startsAt }` partial index on `status: 'booked'`. If two transactions race to the last microsecond, the DB rejects the second with E11000 → caught and mapped to 409. Exactly one booking survives.

`withTransaction<T>` in `utils/transaction.ts` owns the full session lifecycle: open → `session.withTransaction` (MongoDB auto-retry + atomic commit/abort) → `endSession` in `finally`. No caller can leak a session. Every multi-document write (registration, booking, cancel, reschedule, status change, doctor/patient create) goes through it.

---

## Appointment state machine

```
booked ──→ cancelled   (any role that passes ownsAppointment)
booked ──→ completed   (doctor owning the appointment, or admin)
booked ──→ no-show     (doctor owning the appointment, or admin)
booked ──→ booked      (reschedule — same slot rejected as BadRequest)
```

All other transitions are rejected with 422 (semantically impossible, not a conflict).

---

## Error model

`AppError` base class with a fixed `{ error, message, details? }` JSON shape and an `X-Error-Code` response header. All errors go through one `errorHandler`. Mongoose `CastError` → 400, `ValidationError` → 400, `E11000` → 409, everything else → 500. Stack traces and `details` are stripped in production.

| Class | Status | Code |
|---|---|---|
| `BadRequestError` | 400 | `BadRequest` |
| `UnauthorizedError` | 401 | `Unauthorized` |
| `ForbiddenError` | 403 | `Forbidden` |
| `NotFoundError` | 404 | `NotFound` |
| `ConflictError` | 409 | `Conflict` |
| `UnprocessableError` | 422 | `UnprocessableContent` |
| `TooManyRequestsError` | 429 | `TooManyRequests` |
| `InternalServerError` | 500 | `InternalServerError` |

---

## Configuration

All environment variables are read in `src/config.ts`. JWT secrets are validated at boot — the server refuses to start if a secret is missing, shorter than 32 characters, matches a known placeholder, or if both JWT secrets are identical.

| Variable | Default | Notes |
|---|---|---|
| `NODE_ENV` | `development` | `production` strips error details |
| `PORT` | `4000` | |
| `MONGODB_URI` | `mongodb://localhost:27017/clinic?replicaSet=rs0` | replica set required |
| `CLINIC_TZ` | `Europe/Dublin` | clinic wall-clock timezone |
| `CORS_ORIGIN` | `http://localhost:5173` | |
| `JWT_ACCESS_SECRET` | **required** | min 32 chars, no placeholders |
| `JWT_REFRESH_SECRET` | **required** | must differ from access secret |
| `ACCESS_TOKEN_TTL` | `15m` | |
| `REFRESH_TOKEN_TTL_DAYS` | `7` | also accepts `7d` form |
| `X_API_VERSION` | `1` | echoed in `X-API-Version` header |
| `X_REQUEST_ID_ON` | `true` | echo `X-Request-Id` in responses |
| `RATE_LIMIT_LOGIN` | `5` | per 15 min per IP |
| `RATE_LIMIT_BOOKING` | `200` | per 1 min per user |
| `RATE_LIMIT_API` | `600` | per 1 min per IP |

---

## Frontend

React 18 SPA, built with Vite 5, hand-written CSS (no UI kit), JavaScript (not TypeScript). Talks to the backend exclusively via the `/api` base path. Imports shared types from the `shared/` workspace package.

Pages: Login, Register, Dashboard, Doctors, Doctor detail (slots + calendar), My Appointments, Account (password change), Admin Doctors, Admin Patients, Audit, Holidays, Not Found.
