# Clinic Appointment Booking System

A full-stack web application for managing clinic appointments. Patients can browse doctors, view real-time slot availability, and book appointments. Reception staff and admins manage the clinic calendar, holidays, and patient records. The system enforces a hard concurrency invariant: **the same doctor slot can never be double-booked**, proven under 50 simultaneous competing requests over real HTTP.

---

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Setup & Installation](#setup--installation)
- [Running the Application](#running-the-application)
- [Seeding Demo Data](#seeding-demo-data)
- [Running Tests](#running-tests)
- [Environment Variables](#environment-variables)
- [User Roles](#user-roles)
- [Documentation Index](#documentation-index)
- [API Quick Reference — one curl per endpoint](#api-quick-reference--one-curl-per-endpoint)

---

## Features

- **Appointment booking** — patients browse doctors by speciality, view a month calendar and daily slot grid, and book a slot in one click
- **Concurrency-safe booking** — a partial unique compound index on `(doctor, startsAt)` at the MongoDB storage engine, layered with replica-set transactions, prevents double-booking even under 50 simultaneous requests
- **Role-based access control** — four roles (patient, doctor, receptionist, admin) with granular per-route permissions enforced in middleware
- **Holiday management** — admins mark clinic-wide or doctor-specific holidays; the booking path re-checks closures inside the transaction so a race between "add holiday" and "book slot" is closed
- **Audit logging** — every individual patient record read is written to an immutable audit trail; admins can query who read what and when
- **Timezone-aware scheduling** — working hours are expressed in the clinic's IANA timezone (`CLINIC_TZ`); slots are stored as UTC instants; the UI renders them in the viewer's local zone
- **Refresh token rotation** — httpOnly-cookie refresh tokens with version bumping on password change, invalidating all outstanding sessions
- **Indian (Saka) calendar display** — Saka year and major festival captions shown alongside Gregorian dates in the booking calendar (display only)
- **Rate limiting** — per-IP login throttle, per-user booking throttle, global API limiter
- **Request tracing** — every request carries an `X-Request-Id` through logs and responses

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend language | TypeScript 5 (strict mode, no `any`) |
| HTTP framework | Express 4 |
| Database | MongoDB (replica set **required** for transactions) |
| ODM | Mongoose 8 |
| Authentication | bcrypt 6 + jsonwebtoken 9 + httpOnly cookies |
| Frontend language | JavaScript (React 18 JSX) |
| Frontend build | Vite 5 |
| Frontend routing | react-router-dom v6 |
| Styling | Hand-written responsive CSS (no UI framework) |
| Rate limiting | express-rate-limit 7 |
| Backend testing | Jest 29 + ts-jest + supertest + mongodb-memory-server |
| Frontend testing | Node built-in `--test` runner (date utilities) |

---

## Project Structure

```
AWT/
├── backend/                  # Express + Mongoose API
│   ├── src/
│   │   ├── app.ts            # buildApp() factory — no listen()
│   │   ├── server.ts         # Entry point — calls buildApp() + listen()
│   │   ├── config.ts         # Environment config with secret validation
│   │   ├── db.ts             # Mongoose connection
│   │   ├── controllers/      # Parse request → call service → send response
│   │   ├── services/         # Business rules, transactions, query building
│   │   ├── models/           # Mongoose schemas, hooks, indexes
│   │   ├── routes/           # Method+path → handler, guard declarations
│   │   ├── middleware/       # authenticate, authorize, ownership, validate, etc.
│   │   ├── utils/            # errors, transaction, tz, asyncHandler
│   │   └── types/            # Express augmentation (req.user)
│   ├── __tests__/            # Jest test suite (14 files)
│   ├── scripts/              # concurrent-booking.ts, naive-booking.ts
│   ├── seed.ts               # Demo data seeder
│   ├── .env.example          # Environment variable template
│   └── package.json
│
├── frontend/                 # React 18 SPA
│   ├── src/
│   │   ├── App.jsx           # Router + route definitions
│   │   ├── api/              # client.js — all fetch calls, token management
│   │   ├── auth/             # AuthContext.jsx, ProtectedRoute.jsx, useAuth.js
│   │   ├── pages/            # One file per page/route
│   │   ├── components/       # Reusable UI components
│   │   └── lib/              # dates.js, indianCalendar.js
│   ├── public/images/        # Static assets
│   └── package.json
│
├── shared/
│   └── types.ts              # Shared DTOs, roles, statuses, HTTP constants
│
├── DESIGN.md                 # Detailed design decisions and evidence
├── README.md                 # This file
├── API_REFERENCE.md          # Full endpoint documentation
├── ARCHITECTURE.md           # System architecture and data model
└── SECURITY.md               # Auth, authorization, and security hardening
```

---

## Prerequisites

- **Node.js** 20+ and **npm** 9+
- **MongoDB** with a replica set. A standalone `mongod` will not work — transactions require a replica set. The quickest local setup is a single-node replica set:

```bash
# Start mongod with replica set enabled
mongod --replSet rs0 --dbpath /data/db

# In a separate terminal, initialise the replica set (once only)
mongosh --eval "rs.initiate()"
```

Alternatively, use [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) (free tier) — the connection string already includes `?replicaSet=...`.

---

## Setup & Installation

### 1. Clone the repository

```bash
git clone <repository-url>
cd AWT
```

### 2. Install backend dependencies

```bash
cd backend
npm install
```

### 3. Configure the backend environment

```bash
cp .env.example .env
```

Open `backend/.env` and fill in the required values. The server **refuses to boot** if secrets are missing, too short (< 32 chars), or still hold placeholder values — this is intentional.

Generate strong secrets:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Run this twice and use the two different outputs for `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`.

### 4. Install frontend dependencies

```bash
cd ../frontend
npm install
```

---

## Running the Application

Start both servers. Open **two terminals** from the project root.

**Terminal 1 — Backend**
```bash
cd backend
npm run dev
# Starts on http://localhost:4000 (or PORT from .env)
```

**Terminal 2 — Frontend**
```bash
cd frontend
npm run dev
# Starts on http://localhost:5173
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### Health check

```bash
curl http://localhost:4000/health
```

Returns `200 { status: "ok", db: { connected: true, pinged: true }, uptime, ts }` when the server is healthy and MongoDB is reachable. Returns `503` with `status: "degraded"` if the database is down.

---

## Seeding Demo Data

The seeder wipes all collections and creates a ready-to-use demo clinic:

```bash
cd backend
npm run seed
```

**Demo accounts created:**

| Email | Password | Role |
|---|---|---|
| `admin@clinic.io` | `AdminPass123` | admin |
| `reception@clinic.io` | `RecepPass123` | receptionist |
| `dr.nolan@clinic.io` | `NolanPass1` | doctor — General Practice |
| `dr.brady@clinic.io` | `BradyPass1` | doctor — Cardiology |
| `mary@example.com` | `MaryPass1` | patient |
| `john@example.com` | `JohnPass1` | patient |
| `siobhan@example.com` | `SiobPass1` | patient |
| `david@example.com` | `DavidPass1` | patient |

The seeder also creates several upcoming booked appointments and one clinic-wide holiday 10 days from today.

---

## Running Tests

### Backend test suite

```bash
cd backend
npm test
```

Runs 14 test files with Jest, ts-jest, and an in-memory MongoDB replica set. No live database or `.env` required — the test harness generates its own random JWT secrets per run.

**Individual test categories:**

```bash
npm run test:idor       # IDOR vulnerability before/after proof
```

### Concurrency proof (real HTTP)

Proves exactly one booking survives 50 simultaneous competing requests:

```bash
cd backend
npm run test:concurrency
```

Expected output:
```
[race] 50 concurrent bookings -> elapsed ~800ms
  201 created : 1
  409 conflict: 49
  rows in db  : 1 booked for this slot
VERDICT: PASS — exactly one booking survives; the race is won deterministically.
```

### Naive check-then-write demonstration

Shows what happens **without** the unique index — 50 rows stored for one slot:

```bash
cd backend
npm run test:naive
```

### Frontend date utility tests

```bash
cd frontend
npm test                # single run
npm run test:timezones  # 16 tests × 6 timezones = 96 total
```

---

## Environment Variables

All variables live in `backend/.env`. Copy from `.env.example` to get started.

| Variable | Default | Required | Description |
|---|---|---|---|
| `PORT` | `4000` | No | HTTP listen port |
| `NODE_ENV` | `development` | No | `production` suppresses error stack traces in responses |
| `MONGODB_URI` | `mongodb://localhost:27017/clinic?replicaSet=rs0` | No | MongoDB connection string — **replica set required** |
| `JWT_ACCESS_SECRET` | — | **Yes** | Signs access tokens. Min 32 chars, must differ from refresh secret |
| `JWT_REFRESH_SECRET` | — | **Yes** | Signs refresh tokens. Min 32 chars, must differ from access secret |
| `ACCESS_TOKEN_TTL` | `15m` | No | Access token lifetime (jsonwebtoken format: `15m`, `1h`, etc.) |
| `REFRESH_TOKEN_TTL_DAYS` | `7` | No | Refresh token lifetime in days |
| `CLINIC_TZ` | `Europe/Dublin` | No | IANA timezone for slot generation (e.g. `Asia/Kolkata`, `America/New_York`) |
| `CORS_ORIGIN` | `http://localhost:5173` | No | Allowed frontend origin |
| `X_API_VERSION` | `1` | No | Value of the `X-API-Version` response header |
| `X_REQUEST_ID_ON` | `yes` | No | Echo `X-Request-Id` header in responses |
| `RATE_LIMIT_LOGIN` | `5` | No | Max login attempts per IP per 15 minutes |
| `RATE_LIMIT_BOOKING` | `200` | No | Max booking actions per authenticated user per minute |
| `RATE_LIMIT_API` | `600` | No | Max all-API requests per IP per minute |

> **Security note**: the server will throw and refuse to start if either JWT secret is absent, shorter than 32 characters, matches a known placeholder (`changeme`, `secret`, `placeholder`, etc.), or if both secrets are identical. There is no fallback secret anywhere in the source.

---

## User Roles

| Role | Description |
|---|---|
| `patient` | Self-registers. Books, cancels, and reschedules their own appointments. Views their own data only. |
| `doctor` | Created by admin. Views their own schedule. Marks appointments as `completed` or `no-show`. |
| `receptionist` | Created by admin. Books/cancels for any patient. Views all patients, schedules, and holidays. Cannot create/delete records. |
| `admin` | Full access. Creates/updates/deletes doctors, patients, and holidays. Reads the full audit trail. |

---

## Documentation Index

| Document | Contents |
|---|---|
| [README.md](README.md) | Project overview, setup, running, testing (this file) |
| [API_REFERENCE.md](API_REFERENCE.md) | All endpoints, request/response shapes, status codes |
| [ARCHITECTURE.md](ARCHITECTURE.md) | System architecture, data model, layering contract, concurrency design |
| [SECURITY.md](SECURITY.md) | Authentication, authorization, IDOR protection, security hardening |
| [DESIGN.md](DESIGN.md) | Detailed design decisions with measurement evidence (the original design doc) |

---

## API Quick Reference — one `curl` per endpoint

All examples assume the server is running on `http://localhost:4000` and the
database has been seeded with `npm run seed`.

The snippets use two shell variables set once at the top:

```bash
# Seed first, then log in as admin to get a token for admin-only calls
ADMIN_TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@clinic.io","password":"AdminPass123"}' \
  | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).accessToken))")

# Log in as a patient for patient-scoped calls
PATIENT_TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"mary@example.io","password":"MaryPass1"}' \
  | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).accessToken))")
```

---

### Health

```bash
# GET /health — liveness + Mongo ping (no auth)
curl http://localhost:4000/health
# → 200 {"status":"ok","db":{"connected":true,"pinged":true},"uptime":12.3,"ts":"..."}
```

---

### Auth

```bash
# POST /api/auth/register — create a new patient account
curl -X POST http://localhost:4000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"newpatient@example.io","password":"TestPass1","name":"Test Patient","phone":"+353871112222"}'
# → 201 {"user":{"id":"...","email":"newpatient@example.io","role":"patient","patientId":"..."}}

# POST /api/auth/login — authenticate; sets httpOnly refreshToken cookie
curl -c cookies.txt -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"mary@example.io","password":"MaryPass1"}'
# → 200 {"accessToken":"<jwt>","user":{...}}

# POST /api/auth/refresh — exchange refresh cookie for a new access token
curl -b cookies.txt -X POST http://localhost:4000/api/auth/refresh
# → 200 {"accessToken":"<new-jwt>"}

# POST /api/auth/logout — clear the refresh cookie
curl -b cookies.txt -c cookies.txt -X POST http://localhost:4000/api/auth/logout
# → 204 No Content

# GET /api/auth/me — own profile
curl http://localhost:4000/api/auth/me \
  -H "Authorization: Bearer $PATIENT_TOKEN"
# → 200 {"user":{"id":"...","email":"mary@example.io","role":"patient","patientId":"..."}}

# PATCH /api/auth/password — change password (bumps refreshTokenVersion → logs out all other devices)
curl -X PATCH http://localhost:4000/api/auth/password \
  -H "Authorization: Bearer $PATIENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"currentPassword":"MaryPass1","newPassword":"MaryNewPass9"}'
# → 204 No Content
```

---

### Doctors

```bash
# GET /api/doctors — list all doctors (optional ?speciality= filter)
curl http://localhost:4000/api/doctors \
  -H "Authorization: Bearer $PATIENT_TOKEN"
# → 200 {"doctors":[{"id":"...","name":"Dr. Aoife Nolan","speciality":"General Practice",...}]}

# Capture doctor ID for subsequent calls
DOCTOR_ID=$(curl -s http://localhost:4000/api/doctors \
  -H "Authorization: Bearer $PATIENT_TOKEN" \
  | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).doctors[0].id))")

# GET /api/doctors/:id — single doctor
curl "http://localhost:4000/api/doctors/$DOCTOR_ID" \
  -H "Authorization: Bearer $PATIENT_TOKEN"
# → 200 {"doctor":{"id":"...","name":"Dr. Aoife Nolan","speciality":"General Practice","slotMinutes":30,"workingHours":[...]}}

# GET /api/doctors/:id/slots — availability grid for a date
curl "http://localhost:4000/api/doctors/$DOCTOR_ID/slots?date=2026-10-05" \
  -H "Authorization: Bearer $PATIENT_TOKEN"
# → 200 {"doctor":{...},"slots":[{"startsAt":"...","endsAt":"...","available":true},...]}

# GET /api/doctors/:id/calendar — month-wide open/closed summary
curl "http://localhost:4000/api/doctors/$DOCTOR_ID/calendar?month=2026-10" \
  -H "Authorization: Bearer $PATIENT_TOKEN"
# → 200 {"month":"2026-10","days":[{"date":"2026-10-01","open":true,"holiday":false,"total":16,"available":14},...]}

# GET /api/doctors/:id/schedule — booked appointments (doctor/receptionist/admin only; 403 for patients)
DOCTOR_TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"dr.nolan@clinic.io","password":"NolanPass1"}' \
  | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).accessToken))")
curl "http://localhost:4000/api/doctors/$DOCTOR_ID/schedule" \
  -H "Authorization: Bearer $DOCTOR_TOKEN"
# → 200 {"schedule":[{"id":"...","patient":{"name":"Mary Murphy","phone":"..."},"startsAt":"...","status":"booked"},...]}

# POST /api/doctors — create a doctor (admin only)
curl -X POST http://localhost:4000/api/doctors \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Dr. New Doctor","speciality":"Dermatology","slotMinutes":30,"workingHours":[{"day":1,"start":"09:00","end":"17:00"}],"email":"dr.new@clinic.io","password":"NewDocPass1"}'
# → 201 {"doctor":{"id":"...","name":"Dr. New Doctor","speciality":"Dermatology",...}}

# Capture new doctor ID
NEW_DOCTOR_ID=$(curl -s -X POST http://localhost:4000/api/doctors \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Dr. Patch Me","speciality":"Oncology","slotMinutes":20,"workingHours":[{"day":2,"start":"10:00","end":"14:00"}]}' \
  | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).doctor.id))")

# PATCH /api/doctors/:id — update doctor (admin only)
curl -X PATCH "http://localhost:4000/api/doctors/$NEW_DOCTOR_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"speciality":"Radiology","slotMinutes":15}'
# → 200 {"doctor":{"id":"...","speciality":"Radiology","slotMinutes":15,...}}

# DELETE /api/doctors/:id — delete doctor (admin only)
curl -X DELETE "http://localhost:4000/api/doctors/$NEW_DOCTOR_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
# → 204 No Content
```

---

### Patients

```bash
# GET /api/patients — list all patients (admin/receptionist only)
curl http://localhost:4000/api/patients \
  -H "Authorization: Bearer $ADMIN_TOKEN"
# → 200 {"patients":[{"id":"...","name":"Mary Murphy","phone":"+353861111111"}],"total":4,"page":1,"pages":1}

# Capture a patient ID
PATIENT_ID=$(curl -s http://localhost:4000/api/patients \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).patients[0].id))")

# GET /api/patients/:id — single patient (admin/receptionist only; audit log entry written)
curl "http://localhost:4000/api/patients/$PATIENT_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
# → 200 {"patient":{"id":"...","name":"Mary Murphy","phone":"+353861111111"}}

# POST /api/patients — create patient (admin only)
curl -X POST http://localhost:4000/api/patients \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Walk-In Patient","phone":"+353875559999"}'
# → 201 {"patient":{"id":"...","name":"Walk-In Patient","phone":"+353875559999"}}

# PATCH /api/patients/:id — update patient (admin only)
curl -X PATCH "http://localhost:4000/api/patients/$PATIENT_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"phone":"+353861000000"}'
# → 200 {"patient":{"id":"...","name":"Mary Murphy","phone":"+353861000000"}}

# DELETE /api/patients/:id — delete patient (admin only; linked user deactivated)
TEMP_PATIENT_ID=$(curl -s -X POST http://localhost:4000/api/patients \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Temp Patient","phone":"+353870000001"}' \
  | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).patient.id))")
curl -X DELETE "http://localhost:4000/api/patients/$TEMP_PATIENT_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
# → 204 No Content
```

---

### Appointments

```bash
# GET /api/appointments — list (scoped by role: patients see own, doctors see own, admin/receptionist see all)
curl http://localhost:4000/api/appointments \
  -H "Authorization: Bearer $PATIENT_TOKEN"
# → 200 {"appointments":[{"id":"...","doctor":{...},"patient":{...},"startsAt":"...","status":"booked"},...]}

# Capture an appointment ID belonging to Mary
APPT_ID=$(curl -s http://localhost:4000/api/appointments \
  -H "Authorization: Bearer $PATIENT_TOKEN" \
  | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).appointments[0].id))")

# GET /api/appointments/:id — single appointment (ownership enforced; audit log entry written)
curl "http://localhost:4000/api/appointments/$APPT_ID" \
  -H "Authorization: Bearer $PATIENT_TOKEN"
# → 200 {"appointment":{"id":"...","doctor":{...},"patient":{...},"startsAt":"...","endsAt":"...","status":"booked"}}

# POST /api/appointments — book a slot
# First get a free slot from the slots endpoint, then book it:
MARY_PATIENT_ID=$(curl -s http://localhost:4000/api/auth/me \
  -H "Authorization: Bearer $PATIENT_TOKEN" \
  | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).user.patientId))")

FREE_SLOT=$(curl -s "http://localhost:4000/api/doctors/$DOCTOR_ID/slots?date=2026-10-05" \
  -H "Authorization: Bearer $PATIENT_TOKEN" \
  | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const s=JSON.parse(d).slots.find(x=>x.available);console.log(s?s.startsAt:'')})")

curl -X POST http://localhost:4000/api/appointments \
  -H "Authorization: Bearer $PATIENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"doctorId\":\"$DOCTOR_ID\",\"patientId\":\"$MARY_PATIENT_ID\",\"startsAt\":\"$FREE_SLOT\"}"
# → 201 {"appointment":{"id":"...","doctor":{...},"patient":{...},"startsAt":"...","status":"booked"}}

# PATCH /api/appointments/:id/cancel — cancel a booking
curl -X PATCH "http://localhost:4000/api/appointments/$APPT_ID/cancel" \
  -H "Authorization: Bearer $PATIENT_TOKEN"
# → 204 No Content

# PATCH /api/appointments/:id/reschedule — move to a new slot (books a new slot in one atomic transaction)
NEW_SLOT=$(curl -s "http://localhost:4000/api/doctors/$DOCTOR_ID/slots?date=2026-10-06" \
  -H "Authorization: Bearer $PATIENT_TOKEN" \
  | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const s=JSON.parse(d).slots.find(x=>x.available);console.log(s?s.startsAt:'')})")

NEW_APPT_ID=$(curl -s -X POST http://localhost:4000/api/appointments \
  -H "Authorization: Bearer $PATIENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"doctorId\":\"$DOCTOR_ID\",\"patientId\":\"$MARY_PATIENT_ID\",\"startsAt\":\"$FREE_SLOT\"}" \
  | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).appointment.id))")

curl -X PATCH "http://localhost:4000/api/appointments/$NEW_APPT_ID/reschedule" \
  -H "Authorization: Bearer $PATIENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"newStartsAt\":\"$NEW_SLOT\"}"
# → 200 {"appointment":{"id":"...","startsAt":"<new time>","status":"booked"}}

# PATCH /api/appointments/:id/status — mark completed or no-show (doctor/admin only)
# First get one of the doctor's upcoming appointments
DR_APPT_ID=$(curl -s http://localhost:4000/api/appointments \
  -H "Authorization: Bearer $DOCTOR_TOKEN" \
  | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).appointments[0].id))")

curl -X PATCH "http://localhost:4000/api/appointments/$DR_APPT_ID/status" \
  -H "Authorization: Bearer $DOCTOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"completed"}'
# → 204 No Content
```

---

### Holidays

```bash
# GET /api/holidays — list holidays (admin/receptionist only)
curl http://localhost:4000/api/holidays \
  -H "Authorization: Bearer $ADMIN_TOKEN"
# → 200 {"holidays":[{"id":"...","date":"2026-10-11","doctor":null},...]}

# POST /api/holidays — add a clinic-wide closure (admin only)
curl -X POST http://localhost:4000/api/holidays \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"date":"2026-12-25"}'
# → 201 {"holiday":{"id":"...","date":"2026-12-25","doctor":null}}

# POST /api/holidays — add a doctor-specific closure
curl -X POST http://localhost:4000/api/holidays \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"date\":\"2026-12-26\",\"doctorId\":\"$DOCTOR_ID\"}"
# → 201 {"holiday":{"id":"...","date":"2026-12-26","doctor":"<doctorId>"}}

# Capture holiday ID for deletion
HOLIDAY_ID=$(curl -s -X POST http://localhost:4000/api/holidays \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"date":"2026-11-01"}' \
  | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).holiday.id))")

# DELETE /api/holidays/:id — remove a holiday (admin only)
curl -X DELETE "http://localhost:4000/api/holidays/$HOLIDAY_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
# → 204 No Content
```

---

### Audit

```bash
# GET /api/audit — full audit trail (admin only)
curl http://localhost:4000/api/audit \
  -H "Authorization: Bearer $ADMIN_TOKEN"
# → 200 {"logs":[{"id":"...","actorRole":"receptionist","action":"patient.read","ip":"127.0.0.1","createdAt":"..."}...],"total":12,"page":1,"pages":1}

# Filter by action type
curl "http://localhost:4000/api/audit?action=patient.read&page=1&perPage=5" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
# → 200 {"logs":[...],"total":3,"page":1,"pages":1}

# 403 when a non-admin tries to read the audit trail
curl http://localhost:4000/api/audit \
  -H "Authorization: Bearer $PATIENT_TOKEN"
# → 403 {"error":"ForbiddenError","message":"Insufficient role"}
```
