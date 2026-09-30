# API Reference

Base URL: `http://localhost:4000` (configurable via `PORT` in `.env`)

All API routes are prefixed with `/api`. Responses are JSON. Errors always use the shape:

```json
{
  "error": "ErrorCode",
  "message": "Human-readable description",
  "details": "Extra context (development only, omitted in production)"
}
```

The `X-Error-Code` response header mirrors the `error` field — useful for programmatic checks without parsing the body.

---

## Authentication

Most routes require a JWT access token in the `Authorization` header:

```
Authorization: Bearer <accessToken>
```

Access tokens are short-lived (default 15 minutes). When one expires, call `POST /api/auth/refresh` using the httpOnly cookie that was set at login — the frontend does this automatically.

---

## Standard Status Codes

| Code | Meaning |
|---|---|
| `200` | OK |
| `201` | Created |
| `204` | No Content (success, no body) |
| `400` | Bad Request — malformed input (invalid ObjectId, bad date format, etc.) |
| `401` | Unauthorized — missing, expired, or invalid token |
| `403` | Forbidden — authenticated but not permitted for this resource |
| `404` | Not Found — resource does not exist |
| `409` | Conflict — duplicate booking attempt (concurrent slot race), already-cancelled appointment |
| `422` | Unprocessable Entity — valid input but business rule violation (outside working hours, illegal status transition) |
| `429` | Too Many Requests — rate limit exceeded |
| `500` | Internal Server Error |

---

## Health

### `GET /health`

Liveness + readiness probe. Performs a real MongoDB `admin.ping()` round-trip — a healthy response means the database is actually reachable, not just that the process is running.

**Auth**: none

**Response `200`**
```json
{
  "status": "ok",
  "db": { "connected": true, "pinged": true },
  "uptime": 142.7,
  "ts": "2026-09-30T10:00:00.000Z"
}
```

**Response `503`** — server is up but MongoDB is unreachable:
```json
{
  "status": "degraded",
  "db": { "connected": false, "pinged": false },
  "uptime": 3.1,
  "ts": "2026-09-30T10:00:00.000Z"
}
```

---

## Auth — `/api/auth`

### `POST /api/auth/register`

Register a new patient account. Creates a `User` and a linked `Patient` record in a single transaction.

**Auth**: none

**Request body**
```json
{
  "email": "mary@example.com",
  "password": "MaryPass1",
  "name": "Mary Murphy",
  "phone": "+353871234567"
}
```

| Field | Type | Required | Validation |
|---|---|---|---|
| `email` | string | Yes | Valid email format |
| `password` | string | Yes | Min 8 chars, must contain at least one letter and one digit |
| `name` | string | Yes | Non-empty string |
| `phone` | string | Yes | 7–15 digits, optional leading `+` |

**Response `201`**
```json
{
  "user": {
    "id": "64f1a2b3c4d5e6f7a8b9c0d1",
    "email": "mary@example.com",
    "role": "patient",
    "patientId": "64f1a2b3c4d5e6f7a8b9c0d2"
  }
}
```

**Errors**
- `409` — email or phone already registered

---

### `POST /api/auth/login`

Authenticate and receive tokens. Sets a `refreshToken` httpOnly cookie.

**Auth**: none  
**Rate limit**: 5 attempts per IP per 15 minutes

**Request body**
```json
{
  "email": "mary@example.com",
  "password": "MaryPass1"
}
```

**Response `200`**
```json
{
  "accessToken": "<jwt>",
  "user": {
    "id": "64f1a2b3c4d5e6f7a8b9c0d1",
    "email": "mary@example.com",
    "role": "patient",
    "patientId": "64f1a2b3c4d5e6f7a8b9c0d2"
  }
}
```

A `Set-Cookie: refreshToken=<jwt>; HttpOnly; SameSite=Lax; Path=/api/auth` header is also set.

**Errors**
- `401` — invalid credentials (same message for wrong password and unknown email — prevents email enumeration)
- `429` — rate limit exceeded

---

### `POST /api/auth/refresh`

Exchange a valid refresh token for a new access token. The old refresh token is invalidated and a new one is issued (rotation). Requires the httpOnly cookie set by `/login`.

**Auth**: httpOnly cookie (automatic — browser sends it; the frontend's `api/client.js` calls this automatically on 401)

**Response `200`**
```json
{
  "accessToken": "<new-jwt>"
}
```

A new `Set-Cookie: refreshToken=...` is set in the response.

**Errors**
- `401` — cookie missing, token expired, or token version mismatch (password was changed)

---

### `POST /api/auth/logout`

Clear the refresh token cookie.

**Auth**: none (cookie cleared regardless)

**Response `204`** — no body

---

### `GET /api/auth/me`

Get the authenticated user's profile.

**Auth**: Bearer token

**Response `200`**
```json
{
  "user": {
    "id": "64f1a2b3c4d5e6f7a8b9c0d1",
    "email": "mary@example.com",
    "role": "patient",
    "patientId": "64f1a2b3c4d5e6f7a8b9c0d2"
  }
}
```

`doctorId` is present instead of `patientId` for doctor accounts. Both are absent for admin/receptionist.

---

### `PATCH /api/auth/password`

Change the authenticated user's password. Bumps `refreshTokenVersion`, immediately invalidating all outstanding refresh tokens (logs out all other devices).

**Auth**: Bearer token

**Request body**
```json
{
  "currentPassword": "OldPass1",
  "newPassword": "NewPass99"
}
```

| Field | Type | Required | Validation |
|---|---|---|---|
| `currentPassword` | string | Yes | Must match the stored hash |
| `newPassword` | string | Yes | Min 8 chars, must contain at least one letter and one digit |

**Response `204`** — no body

**Errors**
- `401` — current password incorrect
- `422` — new password too weak

---

## Doctors — `/api/doctors`

### `GET /api/doctors`

List all doctors. Optionally filter by speciality.

**Auth**: Bearer token (all roles)

**Query parameters**

| Parameter | Type | Description |
|---|---|---|
| `speciality` | string | Case-insensitive partial match |

**Response `200`**
```json
{
  "doctors": [
    {
      "id": "64f1a2b3c4d5e6f7a8b9c0d3",
      "name": "Dr. Aoife Nolan",
      "speciality": "General Practice",
      "slotMinutes": 30,
      "workingHours": [
        { "day": 1, "start": "09:00", "end": "17:00" },
        { "day": 2, "start": "09:00", "end": "17:00" }
      ]
    }
  ]
}
```

`day` values: `0` = Sunday, `1` = Monday, …, `6` = Saturday.

---

### `GET /api/doctors/:id`

Get a single doctor by ID.

**Auth**: Bearer token (all roles)

**Response `200`**
```json
{
  "doctor": {
    "id": "64f1a2b3c4d5e6f7a8b9c0d3",
    "name": "Dr. Aoife Nolan",
    "speciality": "General Practice",
    "slotMinutes": 30,
    "workingHours": [
      { "day": 1, "start": "09:00", "end": "17:00" }
    ]
  }
}
```

**Errors**
- `404` — doctor not found

---

### `GET /api/doctors/:id/slots`

Get the availability grid for a doctor on a specific calendar date. Only free and taken (but not the patient's identity) is revealed — the occupant of a booked slot is never exposed.

**Auth**: Bearer token (all roles)  
**Audit**: logged as `slots.read`

**Query parameters**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `date` | `YYYY-MM-DD` | Yes | Calendar date in the clinic's timezone |

**Response `200`**
```json
{
  "doctor": { "id": "...", "name": "Dr. Aoife Nolan", "slotMinutes": 30 },
  "slots": [
    { "startsAt": "2026-10-06T08:00:00.000Z", "endsAt": "2026-10-06T08:30:00.000Z", "available": true },
    { "startsAt": "2026-10-06T08:30:00.000Z", "endsAt": "2026-10-06T09:00:00.000Z", "available": false }
  ]
}
```

Returns an empty `slots` array if the date is a holiday or the doctor has no working hours on that weekday.

`startsAt` / `endsAt` are UTC ISO 8601 strings. The frontend renders them in the viewer's local timezone.

---

### `GET /api/doctors/:id/calendar`

Month-wide availability summary. Used by the booking calendar to highlight open/closed/partially-available days without fetching full slot grids for every day.

**Auth**: Bearer token (all roles)  
**Audit**: logged as `calendar.read`

**Query parameters**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `month` | `YYYY-MM` | Yes | Month in the clinic's timezone |

**Response `200`**
```json
{
  "month": "2026-10",
  "days": [
    {
      "date": "2026-10-01",
      "weekday": 4,
      "open": true,
      "holiday": false,
      "total": 16,
      "available": 14
    },
    {
      "date": "2026-10-05",
      "weekday": 1,
      "open": false,
      "holiday": false,
      "total": 0,
      "available": 0
    }
  ]
}
```

`weekday`: `0` = Sunday … `6` = Saturday. `open`: doctor has working hours that day. `holiday`: clinic-wide or doctor-specific closure covers this date.

---

### `GET /api/doctors/:id/schedule`

The doctor's booked (and completed/no-show) appointments. Returns patient name and phone for each appointment. Cancelled appointments are excluded.

**Auth**: Bearer token  
**Roles**: doctor (own schedule only), receptionist, admin  
**Blocked for**: patients — returns `403`  
**Audit**: logged as `schedule.read`

**Query parameters**

| Parameter | Type | Description |
|---|---|---|
| `date` | `YYYY-MM-DD` | Filter to a single day (omit for all upcoming) |

**Response `200`**
```json
{
  "schedule": [
    {
      "id": "64f1a2b3c4d5e6f7a8b9c0d5",
      "doctor": { "id": "...", "name": "Dr. Aoife Nolan", "speciality": "General Practice", "slotMinutes": 30 },
      "patient": { "id": "...", "name": "Mary Murphy", "phone": "+353871234567" },
      "startsAt": "2026-10-06T08:00:00.000Z",
      "endsAt": "2026-10-06T08:30:00.000Z",
      "status": "booked"
    }
  ]
}
```

---

### `POST /api/doctors`

Create a new doctor. Optionally creates a linked login account.

**Auth**: Bearer token  
**Roles**: admin only

**Request body**
```json
{
  "name": "Dr. Aoife Nolan",
  "speciality": "General Practice",
  "slotMinutes": 30,
  "workingHours": [
    { "day": 1, "start": "09:00", "end": "17:00" },
    { "day": 2, "start": "09:00", "end": "17:00" },
    { "day": 3, "start": "09:00", "end": "17:00" },
    { "day": 4, "start": "09:00", "end": "17:00" },
    { "day": 5, "start": "09:00", "end": "17:00" }
  ],
  "email": "dr.nolan@clinic.io",
  "password": "NolanPass1"
}
```

| Field | Type | Required | Validation |
|---|---|---|---|
| `name` | string | Yes | Non-empty |
| `speciality` | string | Yes | Non-empty |
| `slotMinutes` | number | Yes | 5–240 |
| `workingHours` | array | No | Each entry: `day` 0–6, `start`/`end` in `HH:MM`; `start < end`; at most one entry per weekday |
| `email` | string | No | Creates a login account if provided (with `password`) |
| `password` | string | No | Required if `email` is given; min 8 chars with letter + digit |

**Response `201`**
```json
{
  "doctor": { "id": "...", "name": "Dr. Aoife Nolan", "speciality": "General Practice", "slotMinutes": 30, "workingHours": [...] }
}
```

---

### `PATCH /api/doctors/:id`

Update doctor details or working hours.

**Auth**: Bearer token  
**Roles**: admin only

**Request body** (all fields optional)
```json
{
  "name": "Dr. Aoife Nolan",
  "speciality": "Family Medicine",
  "slotMinutes": 20,
  "workingHours": [
    { "day": 1, "start": "09:00", "end": "13:00" }
  ]
}
```

**Response `200`**
```json
{
  "doctor": { "id": "...", "name": "Dr. Aoife Nolan", "speciality": "Family Medicine", "slotMinutes": 20, "workingHours": [...] }
}
```

---

### `DELETE /api/doctors/:id`

Delete a doctor. The linked user account is also deactivated.

**Auth**: Bearer token  
**Roles**: admin only

**Response `204`** — no body

---

## Patients — `/api/patients`

### `GET /api/patients`

List all patients. Paginated.

**Auth**: Bearer token  
**Roles**: admin, receptionist

**Query parameters**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `phone` | string | — | Filter by phone number (partial match) |
| `page` | number | `1` | Page number (1-indexed) |
| `perPage` | number | `20` | Results per page |

**Response `200`**
```json
{
  "patients": [
    { "id": "...", "name": "Mary Murphy", "phone": "+353871234567" }
  ],
  "total": 42,
  "page": 1,
  "perPage": 20,
  "pages": 3
}
```

---

### `GET /api/patients/:id`

Get a single patient by ID.

**Auth**: Bearer token  
**Roles**: admin, receptionist  
**Audit**: logged as `patient.read` with actor identity and role

**Response `200`**
```json
{
  "patient": { "id": "...", "name": "Mary Murphy", "phone": "+353871234567" }
}
```

**Errors**
- `404` — patient not found

---

### `POST /api/patients`

Create a new patient record (admin creates for walk-in patients). Optionally creates a linked login account.

**Auth**: Bearer token  
**Roles**: admin only

**Request body**
```json
{
  "name": "John Doherty",
  "phone": "+353851234567",
  "email": "john@example.com",
  "password": "JohnPass1"
}
```

| Field | Type | Required | Validation |
|---|---|---|---|
| `name` | string | Yes | Non-empty |
| `phone` | string | Yes | 7–15 digits, optional leading `+`; must be unique |
| `email` | string | No | Creates a login account if provided (with `password`) |
| `password` | string | No | Required if `email` is given; min 8 chars with letter + digit |

**Response `201`**
```json
{
  "patient": { "id": "...", "name": "John Doherty", "phone": "+353851234567" }
}
```

---

### `PATCH /api/patients/:id`

Update a patient's name or phone.

**Auth**: Bearer token  
**Roles**: admin only

**Request body** (all fields optional)
```json
{
  "name": "John P. Doherty",
  "phone": "+353851111111"
}
```

**Response `200`**
```json
{
  "patient": { "id": "...", "name": "John P. Doherty", "phone": "+353851111111" }
}
```

---

### `DELETE /api/patients/:id`

Delete a patient record. The linked user account is deactivated (soft delete on the auth side).

**Auth**: Bearer token  
**Roles**: admin only

**Response `204`** — no body

---

## Appointments — `/api/appointments`

All booking-related write routes (`POST /`, `PATCH /:id/cancel`, `PATCH /:id/reschedule`) are subject to the booking rate limiter: 200 actions per authenticated user per minute.

### `GET /api/appointments`

List appointments. Results are automatically scoped by role:

- **patient** — only their own appointments
- **doctor** — only appointments for their doctor record
- **receptionist / admin** — can filter freely

**Auth**: Bearer token (all roles)

**Query parameters** (receptionist/admin only — ignored for patient and doctor)

| Parameter | Type | Description |
|---|---|---|
| `doctorId` | ObjectId | Filter by doctor |
| `patientId` | ObjectId | Filter by patient |
| `status` | `booked \| cancelled \| completed \| no-show \| all` | Filter by status |
| `from` | ISO date string | Only appointments on or after this date |

**Response `200`**
```json
{
  "appointments": [
    {
      "id": "64f1a2b3c4d5e6f7a8b9c0d5",
      "doctor": { "id": "...", "name": "Dr. Aoife Nolan", "speciality": "General Practice", "slotMinutes": 30 },
      "patient": { "id": "...", "name": "Mary Murphy", "phone": "+353871234567" },
      "startsAt": "2026-10-06T08:00:00.000Z",
      "endsAt": "2026-10-06T08:30:00.000Z",
      "status": "booked"
    }
  ]
}
```

Results are sorted by `startsAt` descending. Hard cap of 100 results.

---

### `GET /api/appointments/:id`

Get a single appointment by ID.

**Auth**: Bearer token (all roles)  
**Ownership**: patient and doctor may only access appointments they are party to  
**Audit**: logged as `appointment.read`

**Response `200`**
```json
{
  "appointment": {
    "id": "64f1a2b3c4d5e6f7a8b9c0d5",
    "doctor": { "id": "...", "name": "Dr. Aoife Nolan", "speciality": "General Practice", "slotMinutes": 30 },
    "patient": { "id": "...", "name": "Mary Murphy", "phone": "+353871234567" },
    "startsAt": "2026-10-06T08:00:00.000Z",
    "endsAt": "2026-10-06T08:30:00.000Z",
    "status": "booked"
  }
}
```

**Errors**
- `403` — appointment belongs to a different patient/doctor
- `404` — appointment not found

---

### `POST /api/appointments`

Book an appointment slot.

**Auth**: Bearer token  
**Roles**: patient, receptionist, admin  
**Ownership**: a patient may only book for their own `patientId` (enforced by `patientWithinScope` middleware)  
**Rate limit**: booking limiter (per user)

**Request body**
```json
{
  "doctorId": "64f1a2b3c4d5e6f7a8b9c0d3",
  "patientId": "64f1a2b3c4d5e6f7a8b9c0d2",
  "startsAt": "2026-10-06T08:00:00.000Z"
}
```

| Field | Type | Required | Validation |
|---|---|---|---|
| `doctorId` | ObjectId string | Yes | Must be a valid MongoDB ObjectId |
| `patientId` | ObjectId string | Yes | Must be a valid MongoDB ObjectId |
| `startsAt` | ISO 8601 UTC string | Yes | Must correspond to a derivable slot in the doctor's working hours |

**Booking pipeline**:
1. Validates `startsAt` maps to a real slot in the doctor's working hours
2. Checks the date is not a holiday (clinic-wide or doctor-specific)
3. Opens a MongoDB transaction:
   - Re-checks the slot is still free (within the transaction)
   - Creates the appointment document
   - Commits atomically
4. On duplicate key (E11000) → `409` — the unique partial index caught a concurrent race

**Response `201`**
```json
{
  "appointment": {
    "id": "64f1a2b3c4d5e6f7a8b9c0d5",
    "doctor": { "id": "...", "name": "Dr. Aoife Nolan", "speciality": "General Practice", "slotMinutes": 30 },
    "patient": { "id": "...", "name": "Mary Murphy", "phone": "+353871234567" },
    "startsAt": "2026-10-06T08:00:00.000Z",
    "endsAt": "2026-10-06T08:30:00.000Z",
    "status": "booked"
  }
}
```

**Errors**
- `403` — patient tried to book for someone else
- `404` — doctor or patient not found
- `409` — slot was taken by a concurrent request
- `422` — `startsAt` is outside the doctor's working hours, or the date is a holiday

---

### `PATCH /api/appointments/:id/cancel`

Cancel a booked appointment.

**Auth**: Bearer token  
**Roles**: patient, doctor, receptionist, admin  
**Ownership**: patient may only cancel their own; doctor may only cancel from their own schedule  
**Rate limit**: booking limiter (per user)

**Response `204`** — no body

**Errors**
- `403` — not the appointment owner
- `404` — appointment not found
- `409` — appointment is already cancelled
- `422` — appointment is not in `booked` status (e.g. already completed)

---

### `PATCH /api/appointments/:id/reschedule`

Move a booked appointment to a new slot.

**Auth**: Bearer token  
**Roles**: patient, receptionist, admin  
**Ownership**: patient may only reschedule their own appointments  
**Rate limit**: booking limiter (per user)

**Request body**
```json
{
  "newStartsAt": "2026-10-07T09:00:00.000Z"
}
```

| Field | Type | Required | Validation |
|---|---|---|---|
| `newStartsAt` | ISO 8601 UTC string | Yes | Must correspond to a derivable slot in the doctor's working hours |

The rescheduling runs inside a transaction: it re-checks that the new slot is free and that the date is not a holiday before committing.

**Response `200`** — returns the updated appointment (same shape as `POST /api/appointments`)

**Errors**
- `400` — `newStartsAt` is the same as the current time
- `403` — not the appointment owner
- `404` — appointment not found
- `409` — the new slot is already taken
- `422` — new slot is outside working hours, date is a holiday, or appointment is not `booked`

---

### `PATCH /api/appointments/:id/status`

Mark a booked appointment as `completed` or `no-show`. This is the doctor's post-visit lifecycle action.

**Auth**: Bearer token  
**Roles**: doctor (own appointments only), admin  
**Ownership**: doctor may only update appointments in their own schedule

**Request body**
```json
{
  "status": "completed"
}
```

| Field | Type | Allowed values |
|---|---|---|
| `status` | string | `completed`, `no-show` |

**Response `204`** — no body

**Errors**
- `403` — doctor tried to update a different doctor's appointment
- `404` — appointment not found
- `422` — appointment is not currently in `booked` status (status `422`, not `409` — this is a state-machine violation, not a concurrency conflict)

---

## Holidays — `/api/holidays`

Holidays block the entire affected day. A holiday with `doctor: null` is a clinic-wide closure; one with a `doctorId` blocks only that doctor. The booking path re-checks holidays inside the transaction, so creating a holiday while a booking is in flight correctly blocks the write.

### `GET /api/holidays`

List holidays.

**Auth**: Bearer token  
**Roles**: admin, receptionist

**Query parameters**

| Parameter | Type | Description |
|---|---|---|
| `doctorId` | ObjectId | Filter to a specific doctor's holidays (omit for clinic-wide) |
| `from` | `YYYY-MM-DD` | Start of date range |
| `to` | `YYYY-MM-DD` | End of date range |

**Response `200`**
```json
{
  "holidays": [
    {
      "id": "64f1a2b3c4d5e6f7a8b9c0d6",
      "date": "2026-10-10",
      "doctor": null
    },
    {
      "id": "64f1a2b3c4d5e6f7a8b9c0d7",
      "date": "2026-10-15",
      "doctor": "64f1a2b3c4d5e6f7a8b9c0d3"
    }
  ]
}
```

`doctor: null` indicates a clinic-wide closure.

---

### `POST /api/holidays`

Add a holiday. Use `doctorId: null` (or omit) for a clinic-wide closure.

**Auth**: Bearer token  
**Roles**: admin only

**Request body**
```json
{
  "date": "2026-12-25",
  "doctorId": null
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `date` | `YYYY-MM-DD` | Yes | Calendar date — stored as a zone-less string |
| `doctorId` | ObjectId or `null` | No | Omit or `null` for clinic-wide; provide a doctor's ObjectId for a doctor-specific closure |

**Response `201`**
```json
{
  "holiday": { "id": "...", "date": "2026-12-25", "doctor": null }
}
```

**Errors**
- `409` — a holiday already exists for that date/doctor combination

---

### `DELETE /api/holidays/:id`

Remove a holiday (reopen the day).

**Auth**: Bearer token  
**Roles**: admin only

**Response `204`** — no body

---

## Audit — `/api/audit`

### `GET /api/audit`

Retrieve the audit trail of all sensitive medical record reads. Every `GET /api/patients/:id`, `GET /api/appointments/:id`, and `GET /api/doctors/:id/schedule` call is recorded.

**Auth**: Bearer token  
**Roles**: admin only

**Query parameters**

| Parameter | Type | Description |
|---|---|---|
| `role` | string | Filter by actor role (`patient`, `doctor`, `receptionist`, `admin`) |
| `action` | string | Filter by action (`patient.read`, `appointment.read`, `schedule.read`, `slots.read`, `calendar.read`) |
| `patientId` | ObjectId | Filter to reads involving a specific patient |
| `page` | number | Page number (1-indexed, default `1`) |
| `perPage` | number | Results per page (default `20`) |

**Response `200`**
```json
{
  "logs": [
    {
      "id": "64f1a2b3c4d5e6f7a8b9c0d8",
      "actorId": "64f1a2b3c4d5e6f7a8b9c0d1",
      "actorRole": "receptionist",
      "actorEmail": "reception@clinic.io",
      "action": "patient.read",
      "resource": "Patient",
      "resourceId": "64f1a2b3c4d5e6f7a8b9c0d2",
      "targetPatient": "64f1a2b3c4d5e6f7a8b9c0d2",
      "ip": "127.0.0.1",
      "createdAt": "2026-09-30T10:00:00.000Z"
    }
  ],
  "total": 87,
  "page": 1,
  "pages": 5
}
```

---

## Response Headers

Every response from the API includes these headers:

| Header | Example value | Description |
|---|---|---|
| `X-API-Version` | `1` | API version (configurable via `X_API_VERSION` env var) |
| `X-Powered-By` | `clinic-appointment-booking` | Replaces Express's default — does not expose the stack |
| `X-Content-Type-Options` | `nosniff` | Prevents MIME-type sniffing |
| `X-Request-Id` | `550e8400-e29b-41d4-a716-446655440000` | UUID echoed on every request; present in server logs for tracing |
| `RateLimit-*` | (RFC draft-7 format) | Rate limit status on all `/api` routes |
| `X-Error-Code` | `Conflict` | Present on error responses; mirrors the `error` field in the body |
