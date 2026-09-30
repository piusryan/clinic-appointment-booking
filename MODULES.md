# MODULES.md — Module → File / Line Mapping

A table mapping each of the **nine course modules** to the specific file and
line where the skill is demonstrated.

**Line numbers below are exact for the current tree** — they were read from the
files, not estimated. If you refactor, search the named symbol rather than the
line; the symbol is given in backticks after every entry.

There is no M7 in this course's module list; the nine are M1–M6 and M8–M10.

| Module | Skill demonstrated | Where (file:line → symbol) |
| ------ | ------------------ | ------------------------- |
| **M1** | Project setup, monorepo layout, git hygiene | root `package.json` (workspace launcher: `install:all`, `dev`, `verify`); `backend/package.json`; `frontend/package.json`; `.gitignore`; `README.md` (one-command launch) |
| **M2** | HTTP + Express app, custom response headers, `/health`, request logging | `backend/src/app.ts:16` `buildApp`; `:33-35` the three custom `X-*` headers; `:45` `/health` (pings Mongo); `backend/src/middleware/requestLog.ts` (`X-Request-Id` generation, echo, and redaction) |
| **M3** | MVC + full CRUD on every primary resource | `patient.routes.ts` → `patient.controller.ts` → `patient.service.ts` → `patient.model.ts`; same shape for `doctor`, `appointment`, `holiday`, `audit` under `backend/src/` |
| **M4** | **Async controllers + Express 4 error forwarding, *plus* a custom error middleware** | `backend/src/utils/asyncHandler.ts` (wraps every async controller so a rejected promise reaches `next()`); every controller is `async function`; routes wrap handlers in `asyncHandler(...)`. **Correction to the original module note:** this build *does* add a custom error middleware — `backend/src/middleware/errorHandler.ts`, mounted last at `app.ts:73`. Express 4 does not forward async rejections on its own, so `asyncHandler` is still required; the middleware is what turns a thrown `AppError` into a status. The two are complementary, not alternatives. |
| **M5** | Mongoose schemas, validation, hooks, indexes | `user.model.ts:27` unique `email`; `:35` `passwordHash` `select:false`; `:50` `pre('save')` bcrypt hook; `:55` `comparePassword`; `:72` `toJSON` transform. `appointment.model.ts:31-33` the **partial unique index** on `{doctor, startsAt}` — the hard-core backstop. `doctor.model.ts` embedded `workingHours[]` with its `start < end` validator |
| **M6** | New-doc auth: hashing, JWT issue/verify/refresh rotation, middleware, roles, ownership | `auth.service.ts:17` `signAccessToken`; `:23` `signRefreshToken`; `:39` `registerPatient`; `:76` `login`; `:94` `refresh` (rotation + `refreshTokenVersion`); `:116` `changePassword` (bumps the version, invalidating all refresh tokens). `middleware/authenticate.ts`, `authorize.ts`, `ownership.ts`. `auth.controller.ts:9` `setRefreshCookie` (httpOnly), `:47` rotate on every refresh |
| **M8** | Composed React components, controlled forms, keyed lists, hand-written CSS, **all `fetch` in one `api/` module** | `frontend/src/api/client.js` (the only place `fetch` is called; imports the shared constants from `shared/types` so no value is hard-coded). `frontend/src/auth/AuthContext.jsx`, `ProtectedRoute.jsx`, `useAuth.js`. `frontend/src/components/*` — the twelve composed components: `SlotGrid.jsx`, `WeekGrid.jsx`, `BookingCalendar.jsx`, `WorkingHoursEditor.jsx`, `NavBar.jsx`, `FormField.jsx`, `ConfirmDialog.jsx`, `Toast.jsx`, `Spinner.jsx`, `ErrorBanner.jsx`, `ErrorBoundary.jsx`, `AuthLayout.jsx`. `frontend/src/App.css` (hand-written, responsive, no UI framework). Pages in `frontend/src/pages/*` |
| **M9** | Automated HTTP testing the right way: login helper, auth suites, race proof, IDOR proof, coverage | `backend/__tests__/helpers.ts` (`seedAdmin`, `seedReceptionist`, `seedDoctor`, `api`, `bearer`, `stopDb`). All **twelve** suites: `auth`, `appointments`, `patients`, `doctors`, `slots`, `audit`, `holiday`, `validation`, `rateLimit`, `timezone`, `config`, `idor`. Two of them exist specifically as *evidence* rather than coverage: `__tests__/idor.test.ts` (13 tests — builds a **vulnerable** app and the real app in one process and compares the same request against both) and the two runnable proofs `backend/scripts/naive-booking.ts` and `backend/scripts/concurrent-booking.ts`. Frontend: `frontend/src/lib/dates.test.js` (16 tests × 6 timezones) |
| **M10** | Layering contract + 401-vs-403 correctness + **consistent error shape via one custom middleware** | `backend/src/app.ts` exports `buildApp()` and never calls `listen`; `backend/src/server.ts` is the only file that calls `listen`. `middleware/authorize.ts` (the 401-vs-403 distinction, documented in-file). `middleware/errorHandler.ts` — one handler maps the `AppError` hierarchy in `utils/errors.ts` to statuses and adds `X-Error-Code`, so no controller writes its own error body. `DESIGN.md` §6 (layering) and §6.1 (authz vs. the transaction boundary) |

## Cross-cutting deliverables (any-module)

| Deliverable | Where |
| ----------- | ----- |
| Shared contract used by both halves | `shared/types.ts` — type-only imports in `backend/src/**`, value constants re-exported by `frontend/src/api/client.js` |
| **The hard core: a slot is never double-booked** | `appointment.model.ts:31-33` partial unique index (the load-bearing guard) + `utils/transaction.ts` `withTransaction<T>` (multi-document atomicity). Measured by `npm run test:naive` (50 rows without the index vs 1 with it) and `npm run test:concurrency` (1×`201`, 49×`409`, 1 row, over real HTTP) |
| Error hierarchy | `utils/errors.ts` — `AppError` + `ValidationError` 400 / `UnauthorizedError` 401 / `ForbiddenError` 403 / `NotFoundError` 404 / `ConflictError` 409 / `UnprocessableEntityError` 422 / `RateLimitError` 429. Services throw these; **no service file contains a status code or imports Express** |
| Request-scoped transaction helper | `utils/transaction.ts` — aborts in a `finally` on every exit path, returns a typed result |
| Config that fails closed | `src/config.ts` — rejects missing / short / well-known / `REPLACE_ME_…` secrets and an access secret equal to the refresh secret. Proven by `__tests__/config.test.ts`, which boots the real config in sandboxed child processes |
| Timezone correctness | `backend/src/utils/tz.ts` (`CLINIC_TZ` drives slot generation); `frontend/src/lib/dates.js` (`localDateKey`, `parseIsoDateNoon`, `weekOf`). Regression suite: `npm run test:timezones`, 16 tests × 6 zones |
| Seeded account per role | `backend/seed.ts` |
| `.env.example` with placeholders only | `backend/.env.example` (placeholders are intentionally *invalid* — the server must refuse to boot on them) |
| Request logging + real `/health` | `middleware/requestLog.ts`; `app.ts:45` (reports `db.connected` / `db.pinged` from an actual ping) |
| Rate limiting | `middleware/rateLimit.ts` — login keyed by IP, booking keyed by user id, both with explicit `MemoryStore`s and a `resetRateLimits()` the tests depend on. Trade-off written up in `SECURITY.md` §4 |

## Corrections to the original module notes

Three module descriptions in the baseline scaffold did not match the code, and
are corrected above rather than left to be discovered:

1. **M4 claimed "no custom error middleware".** This build has one
   (`middleware/errorHandler.ts`), and it is a graded deliverable in its own
   right — it is what gives every endpoint one error shape and an
   `X-Error-Code`. The corrected note keeps `asyncHandler` (still mandatory under
   Express 4) and explains that the two solve different problems.
2. **M9's file list was incomplete.** It omitted `config`, `rateLimit`,
   `timezone`, `validation`, `slots` and `idor`. All twelve suites are now
   listed.
3. **The baseline cited `appointment.model.ts:33` for the index** while the
   `schema.index(` call is on line 31 — a small thing, but a line number that is
   off by two sends a reader to the middle of the wrong statement. Every line
   number in the table above was read from the file.
