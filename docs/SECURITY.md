# Security

Security decisions made in this codebase, and the reasoning behind each one.

---

## 1. Authentication

### Token strategy

The API uses stateless JWT with **two independent tokens**:

- **Access token** — short-lived (default 15 minutes), sent as a `Bearer` header, carries `{ sub, role, tv }`.
- **Refresh token** — long-lived (default 7 days), stored in an **HttpOnly cookie** (`path: /api/auth`, `sameSite: lax`, `secure: true` in production), carries `{ sub, tv }`.

The access token is short enough that a stolen token has a narrow usability window. The refresh token is in an HttpOnly cookie so JavaScript cannot read it, which defeats XSS-based token theft.

### Two independent signing secrets

`JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` are required to be different. If the same secret were used for both, a refresh token would pass `jwt.verify` against the access secret — meaning a stolen refresh cookie would grant full API access with no further checks. The server refuses to boot if the two values are equal (`config.ts`).

### Refresh rotation

Every call to `POST /api/auth/refresh` issues a new access token and a new refresh token. This limits the damage from a stolen refresh token: the legitimate user's next automatic refresh invalidates the attacker's copy.

### Token version (`tv`)

`User.refreshTokenVersion` is stored in the DB and embedded in both tokens at issue time. On `POST /api/auth/refresh`, the `tv` in the token is compared against the current DB value. If they differ (because the user changed their password), the entire refresh chain is dead and the caller gets 401. This makes password change an effective "log out all other devices" without needing a token blocklist.

### Authenticate middleware

`src/middleware/authenticate.ts` is the single entry point for every protected route:

1. Reads `Authorization: Bearer <token>` — missing or malformed → 401, no details.
2. Calls `jwt.verify(token, accessTokenSecret)` — expired or tampered → 401, no reason exposed.
3. Loads the `User` document from DB and checks `isActive`. A valid token for a deactivated account → 401 (not 403: the token's identity claim no longer applies).
4. Populates `req.user: RequestUser` with `{ id, email, role, tv, patientId?, doctorId? }`.

The `patientId` and `doctorId` on `req.user` come from the DB, not from the token. They cannot be forged by manipulating the JWT payload.

### Password storage

Passwords are hashed with **bcrypt** at cost factor **12** in a Mongoose `pre('save')` hook on the User model. Hashing in a hook rather than a controller is intentional: it is impossible to create or update a User document without hashing, regardless of which code path creates the document. The `isModified` guard prevents re-hashing an already-hashed value on any subsequent save.

`passwordHash` is declared with `select: false` — it is excluded from all queries that do not explicitly opt in with `.select('+passwordHash')`. The `toJSON` transform provides a second layer: even if a future query accidentally includes the field, serialising the document will strip it.

### Email enumeration prevention

`POST /api/auth/login` returns the same error message ("Invalid email or password") whether the email does not exist or the password is wrong. There is no timing side-channel because the `bcrypt.compare` call runs regardless.

### Password strength

Minimum 8 characters with at least one letter and one digit. The function `passwordStrength` in `auth.service.ts` is deliberately lenient: the comment in the source notes that real strength policy comes from clinic compliance requirements, not from the codebase.

---

## 2. Authorization

### Two-question model

The codebase distinguishes 401 from 403 cleanly:

- **401 Unauthorized** — "who are you?" The caller has no valid token, or their token is expired/invalid.
- **403 Forbidden** — "are you allowed to?" The caller is authenticated but does not have permission.

This distinction matters operationally: a 401 tells the client to re-authenticate; a 403 tells it to stop trying.

### Role guard (`authorize`)

`src/middleware/authorize.ts` is a factory that returns a middleware which checks `req.user.role` against a whitelist. It is declared directly in the route file so the full permission model of each resource is readable in one place.

Roles: `patient`, `doctor`, `receptionist`, `admin`.

### Ownership guards (`src/middleware/ownership.ts`)

Role alone is not enough for resource-level access. Three ownership guards enforce the "your data only" rule:

**`ownsAppointment`** — used on `GET /appointments/:id` and all `PATCH /appointments/:id/*`:
- `admin` and `receptionist` pass unconditionally.
- `doctor` passes if `appointment.doctor === req.user.doctorId`.
- `patient` passes if `appointment.patient === req.user.patientId`.
- All other cases → 403.

Returning 403 (not 404) on a foreign row is deliberate. Returning 404 would allow an attacker to enumerate which IDs exist by observing the difference between "this ID has no row" and "this ID belongs to someone else." 403 closes that information channel.

**`ownsDoctorSchedule`** — used on `GET /doctors/:id/schedule`:
- The schedule endpoint returns a doctor's full day of bookings, including patient names. Patients are 403'd here. Without this guard, a patient could enumerate any doctor's patient list by calling the schedule endpoint for each doctor — an IDOR that leaks who else is receiving care.

**`patientWithinScope`** — used on `POST /appointments` and `PATCH /appointments/:id/reschedule`:
- A patient may only book or reschedule for their own `patientId`. Booking on behalf of another patient is 403. Only `admin` and `receptionist` can act for an arbitrary patient.

### Role-based scoping in the service layer

For list endpoints, role enforcement lives in the service, not the controller. `listAppointmentsFor(actor, query)` in `appointment.service.ts` hard-codes the `patient` filter to `actor.patientId` and the `doctor` filter to `actor.doctorId` — these are identity constraints that cannot be overridden by query parameters. A `patient` calling `GET /appointments?patientId=<other>` still only sees their own rows.

### Role matrix

| Endpoint | patient | doctor | receptionist | admin |
|---|---|---|---|---|
| `GET /doctors` | ✓ | ✓ | ✓ | ✓ |
| `GET /doctors/:id/slots`, `/calendar` | ✓ | ✓ | ✓ | ✓ |
| `GET /doctors/:id/schedule` | ✗ | own only | ✓ | ✓ |
| `POST /PATCH /DELETE /doctors` | ✗ | ✗ | ✗ | ✓ |
| `GET /patients` | ✗ | ✗ | ✓ | ✓ |
| `GET /patients/:id` | ✗ | ✗ | ✓ | ✓ |
| `POST /PATCH /DELETE /patients` | ✗ | ✗ | ✗ | ✓ |
| `GET /appointments` | own only | own only | all | all |
| `GET /appointments/:id` | own only | own only | all | all |
| `POST /appointments` | self only | ✗ | ✓ | ✓ |
| `PATCH /:id/cancel` | own only | own only | all | all |
| `PATCH /:id/reschedule` | own only | ✗ | all | all |
| `PATCH /:id/status` (complete/no-show) | ✗ | own only | ✗ | ✓ |
| `GET /holidays` | ✗ | ✗ | ✓ | ✓ |
| `POST /DELETE /holidays` | ✗ | ✗ | ✗ | ✓ |
| `GET /audit` | ✗ | ✗ | ✗ | ✓ |

---

## 3. IDOR prevention

Three specific IDOR risks are closed in this codebase.

### Appointment IDOR

A patient calling `GET /appointments/<other patient's appointment id>` receives 403, not 404. This prevents an attacker from mapping the appointment ID space to confirm which IDs belong to real appointments.

The check is in `ownsAppointment` middleware, applied before the controller executes.

### Schedule endpoint IDOR

`GET /doctors/:id/schedule` returns a full appointment list including patient names. Without the `ownsDoctorSchedule` guard, any authenticated patient could enumerate every doctor's patient list. The guard returns 403 for any role that is not `admin`, `receptionist`, or the doctor whose ID matches the route parameter.

### Availability grid — occupant not revealed

`GET /doctors/:id/slots` returns `{ startsAt, endsAt, available: boolean }`. The `available` flag is the only information given — there is no patient name, no appointment ID, no occupant data. A patient looking at the availability grid learns which slots are free; they cannot infer anything about the patients who hold the booked slots.

This is enforced in `slot.service.ts` (`getAvailability`) rather than in the controller, so it cannot be accidentally bypassed by a future controller change.

---

## 4. Input validation

`src/middleware/validate.ts` provides a declarative rule system applied at the route level, before the controller runs.

Key rules and their attack surface:

| Rule | Purpose |
|---|---|
| `isObjectId(field)` | Accepts only 24-char hex strings; rejects MongoDB query operators like `{ $ne: null }` in path params and query strings |
| `isCalendarDate(field)` | YYYY-MM-DD with round-trip check; rejects impossible dates like 2026-02-30 |
| `isIsoDate(field)` | ISO datetime via `Date.parse` |
| `isEnum(field, values)` | Strict whitelist; rejects unknown values |
| `isEmail(field)` | Regex + type check |
| `bodyHas(fields)` | Required field presence before any further processing |

`isObjectId` is applied to query parameters (e.g. `?doctorId=`) as well as path params. Without this, a caller could pass `{ $ne: null }` as a query parameter and turn a scoped query into a full-collection scan or leak unintended rows.

All validation failures return 400 with a human-readable message. The `details` field is only included outside production.

---

## 5. Rate limiting

Three tiers from `express-rate-limit` (`src/middleware/rateLimit.ts`), each with an isolated `MemoryStore`:

| Limiter | Window | Limit | Key | Applied to |
|---|---|---|---|---|
| `apiLimiter` | 1 min | 600 (env: `RATE_LIMIT_API`) | IP | All `/api/*` routes |
| `loginLimiter` | 15 min | 5 (env: `RATE_LIMIT_LOGIN`) | IP | `POST /api/auth/login` |
| `bookingLimiter` | 1 min | 200 (env: `RATE_LIMIT_BOOKING`) | **user ID** | `POST /appointments`, all `PATCH /appointments/*` |

The booking limiter is keyed by **authenticated user ID**, not IP. An attacker spreading a flood across many IPs from a NATted network would not exhaust the per-IP budget — keying by user ID means a single account cannot flood bookings regardless of how many IPs it rotates through.

Rate limit responses use the same `{ error, message }` JSON shape as all other errors (via `sendError`), so a 429 is not structurally distinguishable from a 409 to a generic client.

---

## 6. Secret management

`src/config.ts` enforces at boot:

1. `JWT_ACCESS_SECRET` must be set, non-empty, at least 32 characters, and not a known placeholder (`changeme`, `replace`, `todo`, `xxx`, …).
2. `JWT_REFRESH_SECRET` must meet the same requirements.
3. The two secrets must not be equal.

If any check fails, the process exits with a clear error message and a command to generate a suitable secret. There is no fallback value. A forgotten `.env` does not produce a silently-insecure running server.

Tests generate a per-run random secret in `__tests__/setup-env.ts`, so `npm test` works without a `.env`.

---

## 7. Logging and request tracing

`src/middleware/requestLog.ts` makes three deliberate choices:

1. **`Authorization` and `Cookie` headers are never logged.** Logging a Bearer token or a refresh cookie would mean a server-side log breach leaks credentials.
2. **Request bodies are redacted.** The keys `password`, `passwordHash`, `newPassword`, `currentPassword` are replaced with `[REDACTED]` before any body content is written to the log. Passwords cannot appear in log files.
3. **Request IDs.** Each request is assigned a UUID (`X-Request-Id`). An inbound ID from a proxy is honoured (capped at 128 chars to prevent header injection). The ID is echoed back in the response so a user-visible error can be matched to the exact server-side log line. This can be disabled with `X_REQUEST_ID_ON=false`.

---

## 8. Error response shape

All errors — application errors, Mongoose errors, unexpected exceptions — go through the single `errorHandler` in `src/middleware/errorHandler.ts`. The response body is always:

```json
{
  "error": "ConflictError",
  "message": "That slot was taken while you were deciding",
  "details": "..."  // only in non-production
}
```

The `details` field is stripped in production. The `X-Error-Code` header carries the machine-readable code for programmatic handling.

A uniform error shape means a client cannot fingerprint the server by looking for structural differences between error types.

`X-Powered-By` is replaced with `clinic-appointment-booking` (not the default `Express`) so the server does not advertise its framework version.

---

## 9. Transactions and atomic writes

All multi-document writes use `withTransaction` in `src/utils/transaction.ts`. This wrapper owns the entire MongoDB session lifecycle and never leaks a session. Transactions require a replica set (`?replicaSet=rs0` in `MONGODB_URI`) — a standalone `mongod` silently ignores session options, which would make the atomicity guarantee invisible rather than enforced.

The booking flow specifically relies on this: User + Patient creation in registration and Doctor + slot existence checks in booking are both atomic. A concurrent duplicate registration fails on the unique index and is caught and returned as 409 rather than creating a half-initialised user.

---

## 10. Audit trail

`GET /appointments/:id`, `GET /doctors/:id/schedule`, and `GET /patients/:id` write `AuditLog` entries. Each entry records the actor's user ID and role, the action string, the target patient/doctor, the resource ID, and the requester's IP.

Audit logs are append-only in normal operation (no update or delete routes). Only `admin` can read the audit trail (`GET /api/audit`). This provides a non-repudiable record of who accessed sensitive patient data.

---

## 11. CORS

CORS is configured with a single allowed origin (`CORS_ORIGIN`, default `http://localhost:5173`) and `credentials: true`. This allows the refresh token HttpOnly cookie to be sent cross-origin while restricting which origins can make credentialed requests. Wildcard origins with `credentials: true` are not used.

---

## 12. Body size limit

`express.json` is configured with `{ limit: '2mb' }`. This prevents an attacker from sending a multi-gigabyte JSON payload to exhaust server memory or cause a slow parse.

---

## 13. NoSQL injection

MongoDB query operators (`$ne`, `$gt`, `$where`, `$regex`, …) can be smuggled into query string parameters or JSON bodies if they are passed as objects rather than plain strings. For example, without validation a caller could send:

```
GET /api/appointments?doctorId[$ne]=null
```

Node.js + Express would parse that as `{ doctorId: { $ne: null } }`, turning a scoped filter into a full-collection scan that returns every appointment in the database.

### What this codebase does

**1. `isObjectId` validator on every ID parameter**

`src/middleware/validate.ts` applies `isObjectId` to every query parameter and path segment that is supposed to be a MongoDB ObjectId:

```typescript
// appointment.routes.ts (representative)
router.get('/', authenticate, validate([
  isObjectId('doctorId', { from: 'query', optional: true }),
  isObjectId('patientId', { from: 'query', optional: true }),
]), controller.list);
```

`isObjectId` accepts only a 24-character hex string and rejects anything else — including objects — with a `400`. A `$ne`-style object can never reach the service layer.

**2. Mongoose schema types provide a second gate**

All ObjectId fields in the schemas are declared as `{ type: mongoose.Schema.Types.ObjectId, ref: ... }`. Mongoose coerces the value through `new ObjectId(value)` — if that throws, the query is rejected before it hits the database. This is not the primary defence (the middleware is), but it closes the gap for any code path that might bypass a route's validator.

**3. Body fields are typed and validated before the controller runs**

Validated with `bodyHas`, `isEnum`, `isCalendarDate`, `isIsoDate`, and `isEmail` in `validate.ts`. No raw request body field is passed directly to a Mongoose query.

### Before / After — query string injection

**Before** (hypothetical vulnerable handler with no `isObjectId` guard):

```bash
# Attacker sends a MongoDB operator as a query-string object
curl "http://localhost:4000/api/appointments?doctorId[\$ne]=null" \
  -H "Authorization: Bearer $TOKEN"
# → 200 with every appointment in the database for every doctor
```

**After** (with `isObjectId` middleware in place):

```bash
curl "http://localhost:4000/api/appointments?doctorId[\$ne]=null" \
  -H "Authorization: Bearer $TOKEN"
# → 400 Bad Request
# {"error":"ValidationError","message":"doctorId must be a valid ObjectId"}
```

---

## 14. Mass assignment

Mass assignment happens when a client-controlled body is spread directly into a model update — e.g. `Object.assign(doc, req.body)`. An attacker can then elevate their role or forge their `patientId` by adding unexpected fields to the request.

### What this codebase does

**Controllers extract only named fields from the body.** No service receives `req.body` wholesale; each controller extracts the specific fields it expects:

```typescript
// patient.controller.ts (representative)
const { name, phone } = req.body;
await patientService.updatePatient(id, { name, phone });
```

The service therefore only ever sees `{ name, phone }` regardless of what else the caller sent. Fields like `role`, `isActive`, `refreshTokenVersion`, or `patientId` cannot be supplied by the client in a `PATCH /api/patients/:id` request.

**Mongoose `select: false` on sensitive fields**

`passwordHash` is declared with `select: false` on the `User` model. Even if a query were to return the full document, `passwordHash` is excluded from the result unless explicitly requested with `.select('+passwordHash')`. The `toJSON` transform strips it from serialised output as a second layer.

**`role`, `isActive`, and `refreshTokenVersion` are never accepted from the client**

These fields are managed only by specific service functions (`auth.service.ts` → `changePassword`, `registerPatient`) and never accepted from request bodies on any update route.

### Before / After — role elevation attempt

**Before** (hypothetical vulnerable handler):

```bash
curl -X PATCH http://localhost:4000/api/auth/me \
  -H "Authorization: Bearer $PATIENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"role":"admin","isActive":true}'
# → Hypothetical: role updated in DB, attacker now has admin access
```

**After** (actual behaviour — the route does not accept `role` or `isActive`):

```bash
curl -X PATCH http://localhost:4000/api/auth/password \
  -H "Authorization: Bearer $PATIENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"currentPassword":"MaryPass1","newPassword":"NewPass99","role":"admin"}'
# → 204 No Content — password changed; `role` field silently ignored
# The DB row still has role: "patient"
```

---

## 15. IDOR — before and after `curl` transcripts

This section shows the live attack and the fix. The test suite in `__tests__/idor.test.ts` builds both app variants (with and without the guard) in the same Jest process and asserts the before/after contrast programmatically.

### Setup

```bash
# seed the database and obtain two patient tokens
npm run seed

# log in as mary (patient A)
MARY_TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"mary@example.io","password":"MaryPass1"}' \
  | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).accessToken))")

# log in as john (patient B)
JOHN_TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"john@example.io","password":"JohnPass1"}' \
  | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).accessToken))")

# get one of Mary's appointment IDs (she has one from the seed)
MARY_APPT=$(curl -s http://localhost:4000/api/appointments \
  -H "Authorization: Bearer $MARY_TOKEN" \
  | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).appointments[0].id))")
```

### Attack 1 — Appointment IDOR

**Before** (no `ownsAppointment` guard):

```bash
# John reads Mary's appointment — should be 403, gets 200
curl -s http://localhost:4000/api/appointments/$MARY_APPT \
  -H "Authorization: Bearer $JOHN_TOKEN"
# → 200 {"appointment":{"id":"...","patient":{"name":"Mary Murphy","phone":"+353861111111"},...}}
# John can read Mary's medical appointment data.
```

**After** (`ownsAppointment` middleware in place):

```bash
curl -s http://localhost:4000/api/appointments/$MARY_APPT \
  -H "Authorization: Bearer $JOHN_TOKEN"
# → 403 {"error":"ForbiddenError","message":"Access denied"}
```

Note: the response is **403, not 404**. Returning 404 would allow John to enumerate which IDs exist by observing the difference between "no row" and "belongs to someone else." A uniform 403 closes that information channel.

### Attack 2 — Doctor schedule IDOR (patient enumeration)

```bash
# get the doctor's ID
DOCTOR_ID=$(curl -s http://localhost:4000/api/doctors \
  -H "Authorization: Bearer $MARY_TOKEN" \
  | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).doctors[0].id))")

# Before (no ownsDoctorSchedule guard):
curl -s "http://localhost:4000/api/doctors/$DOCTOR_ID/schedule" \
  -H "Authorization: Bearer $MARY_TOKEN"
# → 200 {"schedule":[
#   {"patient":{"name":"Mary Murphy","phone":"+353861111111"},...},
#   {"patient":{"name":"John Doherty","phone":"+353862222222"},...},
#   {"patient":{"name":"Siobhan Casey","phone":"+353863333333"},...}
# ]}
# Any patient can enumerate who else is receiving care from this doctor.

# After (ownsDoctorSchedule guard):
curl -s "http://localhost:4000/api/doctors/$DOCTOR_ID/schedule" \
  -H "Authorization: Bearer $MARY_TOKEN"
# → 403 {"error":"ForbiddenError","message":"Access denied"}
```

### Attack 3 — Slot occupant not revealed

```bash
# Even without the IDOR guard, the slots endpoint never exposes patient data
curl -s "http://localhost:4000/api/doctors/$DOCTOR_ID/slots?date=2026-10-06" \
  -H "Authorization: Bearer $MARY_TOKEN"
# → 200 {"slots":[
#   {"startsAt":"2026-10-06T08:00:00.000Z","endsAt":"2026-10-06T08:30:00.000Z","available":true},
#   {"startsAt":"2026-10-06T08:30:00.000Z","endsAt":"2026-10-06T09:00:00.000Z","available":false}
# ]}
# "available: false" tells Mary the slot is taken. It does not tell her by whom.
# The patient's identity is enforced in slot.service.ts, not the controller.
```

---

## 16. What we knowingly left out

This section is here because a security write-up that does not state its gaps is not trustworthy. The following mitigations are absent and the reason is stated for each.

| Omission | Why it was not included | Risk level in this context |
|---|---|---|
| **HTTPS / TLS termination** | TLS belongs at the reverse proxy (nginx, Caddy) or load balancer, not in the application server. The code is correct for a deployment behind a proxy; adding `https.createServer` inside Express would be wrong architecture for a production system. | Low — the `secure: true` flag on the refresh cookie is conditioned on `NODE_ENV === 'production'`, which is where TLS is expected. |
| **Refresh token rotation family tracking / absolute revocation** | The current token version approach revokes all refresh tokens on password change. It does not track "families" to detect the full rotation-abuse scenario (attacker gets a refresh token → rotates it → legitimate user's rotation is rejected → server detects the conflict). Full family tracking requires a per-token store (Redis or a DB table), which adds infrastructure. | Medium — mitigated by the short access token TTL (15 min) and the rate limiter. |
| **Content Security Policy (CSP)** | CSP headers would reduce the impact of any XSS that does land. Not added because the static assets are served by Vite (dev) and a CDN (prod), neither of which is configured here. | Low — the httpOnly refresh cookie is already XSS-resistant; adding CSP is a defence-in-depth layer. |
| **Helmet.js** | Only a subset of Helmet's headers are added manually (`X-Content-Type-Options`, `X-Powered-By` replacement). Adding Helmet itself would make the deliverable headers implicit rather than explicit, which would obscure the Module 2 evidence. | Low — the specific headers required are set. |
| **Brute-force lockout (account lock after N failures)** | The login rate limiter (5 per 15 min per IP) throttles guessing but does not lock accounts. Account locking introduces denial-of-service risk (an attacker could lock any account whose email they know). Throttling is safer for a public-facing service. | Low — combined with bcrypt cost 12 (≈ 0.3 guesses/sec per core), the rate limiter makes an online brute-force attack impractical. |
| **Distributed rate limiting (Redis store)** | The rate limiter uses `MemoryStore`. In a multi-process deployment each process has its own counter, so the per-user booking limit effectively multiplies by the number of instances. Fixing this requires a shared store (Redis). | Medium — acceptable for a single-instance clinic system; the comment in `rateLimit.ts` flags this explicitly. |
| **Audit log write failures treated as non-fatal** | If the audit log insert fails, the underlying read request still succeeds. The trade-off is explicit: blocking a legitimate patient read because an audit entry failed to write would be wrong. A missed audit entry is less harmful than a blocked care interaction. A `console.error` is emitted so the failure is visible in server logs. | Low — the log is append-only; a crash during the insert is unlikely and is observable. |
