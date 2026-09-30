# Upcoming Tests & Things Still To Do

Based on the full system — DESIGN.md, ARCHITECTURE.md, the existing __tests__/ suite,
and what the concurrency proof already covers — here is everything that is either
expected as a deliverable or is a natural next step.

---

## Already Done ✅

| What | Where |
|------|-------|
| Concurrent booking race — 50 patients, 1 slot, exactly 1 wins | `testing/CONCURRENCY_PROOF.md` |
| Naive check-then-write vs. index comparison (Phase A / Phase B) | `scripts/naive-booking.ts` |
| JWT auth, register, login, refresh, logout, password change | `__tests__/auth.test.ts` |
| Appointment CRUD — book, cancel, reschedule, status change | `__tests__/appointments.test.ts` |
| IDOR closure — patients can't read each other's data | `__tests__/idor.test.ts` |
| Holiday enforcement — booking blocked on closed dates | `__tests__/holiday.test.ts` |
| Slot computation — correct windows, boundaries, edge cases | `__tests__/slots.test.ts` |
| Timezone correctness — 6 zones, 96 test cases | `__tests__/timezone.test.ts` |
| Rate limiting — 429 after threshold | `__tests__/rateLimit.test.ts` |
| Input validation — bad body shapes rejected with 400 | `__tests__/validation.test.ts` |
| Audit log — patient reads recorded, admin-only retrieval | `__tests__/audit.test.ts` |
| Doctor management | `__tests__/doctors.test.ts` |
| Patient management | `__tests__/patients.test.ts` |
| Config boot-time secret validation | `__tests__/config.test.ts` |

---

## Things Still Expected / To Do

### 1. Reschedule Race Condition Test
**What:** Same as the booking race but for `PATCH /:id/reschedule`.
Two patients can't both move the same appointment to a new slot that is
simultaneously being grabbed by another booking.
**Why it matters:** The reschedule path also opens a transaction and re-checks
slot availability — the same pattern — but it hasn't been stress-tested
concurrently the way booking has.
**How:** Adapt `concurrent-booking.ts` — book 1 appointment first, then fire
50 concurrent reschedule requests to the same new slot.

---

### 2. Naive vs. Transaction Script (`test:naive`) — Screenshot / Proof
**What:** `npm run test:naive` already runs and shows Phase A (no index → 50 rows)
vs. Phase B (index → 1 row). This is the clearest visual proof of *why* the fix
works, but there is no captured output document for it yet.
**How:** Run `npm run test:naive`, capture the output, and save it to
`testing/NAIVE_PROOF.md` the same way the concurrency proof was done.

---

### 3. Load Test Under Sustained Traffic
**What:** The concurrency test is a single burst. A load test sends a steady
stream of requests over time (e.g. 500 bookings/min for 2 minutes) to verify:
- Rate limiter triggers at the right threshold (200/min per user)
- The server doesn't degrade or leak memory
- No double-bookings appear under sustained load
**Tools:** `autocannon` or `k6` — both work well against a local Express server.

---

### 4. Token Security Tests
**What:**
- Replay a used refresh token → should be rejected (reuse detection)
- Use an access token after password change → should be rejected (version bump)
- Tamper with the JWT payload → should return 401
- Use a refresh token from user A on user B's account → should fail
**Why it matters:** DESIGN.md §7 describes the rotation + reuse detection mechanism
but there are no dedicated tests for the attack scenarios, only the happy paths.

---

### 5. Holiday Race Condition
**What:** An admin creates a holiday for a date at the same millisecond a patient
books a slot on that date. The booking must be rejected because holidays are
re-checked **inside** the transaction (DESIGN.md §6.1).
**How:** Open two concurrent requests — `POST /api/holidays` and `POST /api/appointments`
for the same date — and verify the appointment either succeeds or fails cleanly
(never half-applies).

---

### 6. RBAC Boundary Tests (Negative Cases)
**What:** Systematically verify every ✗ cell in the permission matrix (DESIGN.md §5):
- Doctor tries to `POST /api/appointments` → should be 403
- Patient tries to view another patient's record → should be 403
- Patient tries to mark appointment `completed` → should be 403
- Receptionist tries to `DELETE /api/doctors/:id` → should be 403
- Non-admin tries to `GET /api/audit` → should be 403
**Why:** The existing IDOR tests cover some of this, but a full matrix sweep
against every ✗ cell is clean grading evidence.

---

### 7. Slot Boundary Edge Cases
**What:**
- Book the very last slot of the day (slot that ends exactly at `workingHours.end`)
- Try to book a slot that starts inside but ends outside the window → 422
- Doctor with no working hours on a given weekday → availability returns []
- Two doctors on the same slot — each can be booked independently
**Why:** `isDerivableSlot` does the boundary maths; these cases test the fence-post
arithmetic directly.

---

### 8. Cancellation → Rebook Test
**What:** Book a slot → cancel it → book the same slot again with a different patient.
Verify the partial unique index correctly allows the rebook (cancelled rows
don't block the slot).
**Why:** The `partialFilterExpression: { status: 'booked' }` on the index is
specifically designed for this — it hasn't been tested as an explicit flow.

---

### 9. Frontend Integration / E2E Test
**What:** A Playwright or Cypress test that:
1. Registers two patients in the browser
2. Both navigate to the same doctor's slot grid
3. Both click "Book" on the same slot at the same time
4. Verifies one sees a confirmation and the other sees an error
**Why:** Closes the loop from browser click all the way to the DB — the only
layer not covered by the existing backend tests.

---

### 10. Audit Log Completeness Test
**What:** For every action that is supposed to write an audit log entry
(patient.read, appointment.read, schedule.read), verify that:
- The log entry is written
- The `actorId`, `actorRole`, `action`, and `targetPatient` fields are correct
- A non-admin trying to read the audit log gets 403
**Why:** DESIGN.md §8 and ARCHITECTURE.md both describe this as a HIPAA-alignment
feature. The existing `audit.test.ts` covers the basics but not the full field
correctness.

---

## Priority Order

| Priority | Item |
|----------|------|
| 🔴 High | #2 — Naive proof document (quick win, strong visual evidence) |
| 🔴 High | #6 — RBAC negative cases (directly graded) |
| 🟡 Medium | #1 — Reschedule race (same pattern as booking, natural extension) |
| 🟡 Medium | #4 — Token security tests (security deliverable) |
| 🟡 Medium | #8 — Cancel → rebook (proves partial index behaviour) |
| 🟠 Lower | #3 — Load test (nice to have, not core grading) |
| 🟠 Lower | #5 — Holiday race (subtle, hard to trigger reliably) |
| 🟠 Lower | #7 — Slot boundary edge cases (likely already covered in slots.test.ts) |
| 🟢 Extra | #9 — E2E browser test (impressive but time-consuming) |
| 🟢 Extra | #10 — Audit log completeness (polish) |
