/**
 * __tests__/rbac.test.ts
 *
 * Full RBAC negative-case sweep — every ✗ cell in DESIGN.md §5's permission
 * matrix. Each test proves the API returns 403 (authenticated but not
 * permitted) rather than silently succeeding or returning the wrong code.
 *
 * 401 vs 403 is a graded distinction (DESIGN.md §5 note):
 *   401 = "who are you?"   (no/invalid token)
 *   403 = "you're not allowed" (valid token, wrong role)
 */
import {
  startDb, stopDb, resetDb,
  api, bearer, loginAs,
  seedDoctor, seedPatient,
  FIXED_MONDAY,
} from './helpers';

beforeAll(startDb);
afterAll(stopDb);
beforeEach(resetDb);

// ─────────────────────────────────────────────────────────────────────────────
// Shared setup helper — used by most test groups
// ─────────────────────────────────────────────────────────────────────────────
async function setup() {
  const admin       = await loginAs('admin');
  const doctor      = await loginAs('doctor');
  const patient     = await loginAs('patient');
  const receptionist = await loginAs('receptionist');

  // Book a slot so we have a real appointment to act on
  const slots = await api()
    .get(`/api/doctors/${doctor.doctorId}/slots?date=${FIXED_MONDAY}`)
    .set(bearer(admin.token));
  const startsAt = (slots.body.slots[0] as { startsAt: string }).startsAt;

  const booked = await api()
    .post('/api/appointments')
    .set(bearer(patient.token))
    .send({ doctorId: doctor.doctorId, patientId: patient.patientId, startsAt })
    .expect(201);

  const appointmentId = booked.body.appointment.id as string;
  return { admin, doctor, patient, receptionist, appointmentId, startsAt };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Doctor management — admin only
// ─────────────────────────────────────────────────────────────────────────────
describe('RBAC — doctor management (admin only for writes)', () => {
  it('patient cannot create a doctor -> 403', async () => {
    const { patient } = await setup();
    const res = await api()
      .post('/api/doctors')
      .set(bearer(patient.token))
      .send({ name: 'Ghost Dr', speciality: 'None', workingHours: [], slotMinutes: 30 });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Forbidden');
  });

  it('doctor cannot create another doctor -> 403', async () => {
    const { doctor } = await setup();
    const res = await api()
      .post('/api/doctors')
      .set(bearer(doctor.token))
      .send({ name: 'Ghost Dr', speciality: 'None', workingHours: [], slotMinutes: 30 });
    expect(res.status).toBe(403);
  });

  it('receptionist cannot create a doctor -> 403', async () => {
    const { receptionist } = await setup();
    const res = await api()
      .post('/api/doctors')
      .set(bearer(receptionist.token))
      .send({ name: 'Ghost Dr', speciality: 'None', workingHours: [], slotMinutes: 30 });
    expect(res.status).toBe(403);
  });

  it('patient cannot delete a doctor -> 403', async () => {
    const { patient, doctor } = await setup();
    const res = await api()
      .delete(`/api/doctors/${doctor.doctorId}`)
      .set(bearer(patient.token));
    expect(res.status).toBe(403);
  });

  it('receptionist cannot delete a doctor -> 403', async () => {
    const { receptionist, doctor } = await setup();
    const res = await api()
      .delete(`/api/doctors/${doctor.doctorId}`)
      .set(bearer(receptionist.token));
    expect(res.status).toBe(403);
  });

  it('doctor cannot delete themselves -> 403', async () => {
    const { doctor } = await setup();
    const res = await api()
      .delete(`/api/doctors/${doctor.doctorId}`)
      .set(bearer(doctor.token));
    expect(res.status).toBe(403);
  });

  it('everyone can READ doctors (list) — all roles get 200', async () => {
    const { admin, doctor, patient, receptionist } = await setup();
    for (const tok of [admin.token, doctor.token, patient.token, receptionist.token]) {
      const res = await api().get('/api/doctors').set(bearer(tok));
      expect(res.status).toBe(200);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Patient management — admin/receptionist for reads, admin only for writes
// ─────────────────────────────────────────────────────────────────────────────
describe('RBAC — patient management', () => {
  it('patient cannot list all patients -> 403', async () => {
    const { patient } = await setup();
    const res = await api().get('/api/patients').set(bearer(patient.token));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Forbidden');
  });

  it('doctor cannot list all patients -> 403', async () => {
    const { doctor } = await setup();
    const res = await api().get('/api/patients').set(bearer(doctor.token));
    expect(res.status).toBe(403);
  });

  it('patient cannot read a specific patient record -> 403', async () => {
    const { patient } = await setup();
    // seed a second patient to target
    const target = await seedPatient('target@rbac.io');
    const res = await api()
      .get(`/api/patients/${String(target.patientId)}`)
      .set(bearer(patient.token));
    expect(res.status).toBe(403);
  });

  it('doctor cannot read a specific patient record -> 403', async () => {
    const { doctor } = await setup();
    const target = await seedPatient('target2@rbac.io');
    const res = await api()
      .get(`/api/patients/${String(target.patientId)}`)
      .set(bearer(doctor.token));
    expect(res.status).toBe(403);
  });

  it('patient cannot delete a patient record -> 403', async () => {
    const { patient } = await setup();
    const target = await seedPatient('target3@rbac.io');
    const res = await api()
      .delete(`/api/patients/${String(target.patientId)}`)
      .set(bearer(patient.token));
    expect(res.status).toBe(403);
  });

  it('receptionist cannot delete a patient record -> 403', async () => {
    const { receptionist } = await setup();
    const target = await seedPatient('target4@rbac.io');
    const res = await api()
      .delete(`/api/patients/${String(target.patientId)}`)
      .set(bearer(receptionist.token));
    expect(res.status).toBe(403);
  });

  it('doctor cannot delete a patient record -> 403', async () => {
    const { doctor } = await setup();
    const target = await seedPatient('target5@rbac.io');
    const res = await api()
      .delete(`/api/patients/${String(target.patientId)}`)
      .set(bearer(doctor.token));
    expect(res.status).toBe(403);
  });

  it('receptionist can read all patients -> 200', async () => {
    const { receptionist } = await setup();
    const res = await api().get('/api/patients').set(bearer(receptionist.token));
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Booking — patients self only, no doctors
// ─────────────────────────────────────────────────────────────────────────────
describe('RBAC — booking (no doctors; patients only for themselves)', () => {
  it('doctor cannot book an appointment -> 403', async () => {
    const { doctor, patient, startsAt } = await setup();
    const res = await api()
      .post('/api/appointments')
      .set(bearer(doctor.token))
      .send({ doctorId: doctor.doctorId, patientId: patient.patientId, startsAt });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Forbidden');
  });

  it('patient cannot book for a different patient -> 403', async () => {
    const { doctor, patient, startsAt } = await setup();
    const victim = await loginAs('patient');
    // patient's token but victim's patientId
    const res = await api()
      .post('/api/appointments')
      .set(bearer(patient.token))
      .send({ doctorId: doctor.doctorId, patientId: victim.patientId, startsAt });
    expect(res.status).toBe(403);
  });

  it('unauthenticated booking attempt -> 401, not 403', async () => {
    const { doctor, patient, startsAt } = await setup();
    const res = await api()
      .post('/api/appointments')
      .send({ doctorId: doctor.doctorId, patientId: patient.patientId, startsAt });
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Appointment status — doctor (own) and admin only
// ─────────────────────────────────────────────────────────────────────────────
describe('RBAC — PATCH /:id/status (doctor or admin only)', () => {
  it('patient cannot mark their own appointment completed -> 403', async () => {
    const { patient, appointmentId } = await setup();
    const res = await api()
      .patch(`/api/appointments/${appointmentId}/status`)
      .set(bearer(patient.token))
      .send({ status: 'completed' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Forbidden');
  });

  it('receptionist cannot mark appointment status -> 403', async () => {
    const { receptionist, appointmentId } = await setup();
    const res = await api()
      .patch(`/api/appointments/${appointmentId}/status`)
      .set(bearer(receptionist.token))
      .send({ status: 'completed' });
    expect(res.status).toBe(403);
  });

  it('a different doctor (non-attending) cannot mark status -> 403', async () => {
    const { appointmentId } = await setup();
    const otherDoctor = await loginAs('doctor');
    const res = await api()
      .patch(`/api/appointments/${appointmentId}/status`)
      .set(bearer(otherDoctor.token))
      .send({ status: 'completed' });
    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Holiday management — admin only for writes; receptionist/admin for reads
// ─────────────────────────────────────────────────────────────────────────────
describe('RBAC — holiday management', () => {
  it('patient cannot read holidays -> 403', async () => {
    const { patient } = await setup();
    const res = await api().get('/api/holidays').set(bearer(patient.token));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Forbidden');
  });

  it('doctor cannot read holidays -> 403', async () => {
    const { doctor } = await setup();
    const res = await api().get('/api/holidays').set(bearer(doctor.token));
    expect(res.status).toBe(403);
  });

  it('receptionist cannot create a holiday -> 403', async () => {
    const { receptionist } = await setup();
    const res = await api()
      .post('/api/holidays')
      .set(bearer(receptionist.token))
      .send({ date: '2026-12-25' });
    expect(res.status).toBe(403);
  });

  it('patient cannot create a holiday -> 403', async () => {
    const { patient } = await setup();
    const res = await api()
      .post('/api/holidays')
      .set(bearer(patient.token))
      .send({ date: '2026-12-25' });
    expect(res.status).toBe(403);
  });

  it('doctor cannot create a holiday -> 403', async () => {
    const { doctor } = await setup();
    const res = await api()
      .post('/api/holidays')
      .set(bearer(doctor.token))
      .send({ date: '2026-12-25' });
    expect(res.status).toBe(403);
  });

  it('admin can read and create holidays -> 200/201', async () => {
    const { admin } = await setup();
    const post = await api()
      .post('/api/holidays')
      .set(bearer(admin.token))
      .send({ date: '2026-12-25' });
    expect(post.status).toBe(201);

    const get = await api().get('/api/holidays').set(bearer(admin.token));
    expect(get.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Audit log — admin only
// ─────────────────────────────────────────────────────────────────────────────
describe('RBAC — audit log (admin only)', () => {
  it('patient cannot read the audit log -> 403', async () => {
    const { patient } = await setup();
    const res = await api().get('/api/audit').set(bearer(patient.token));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Forbidden');
  });

  it('doctor cannot read the audit log -> 403', async () => {
    const { doctor } = await setup();
    const res = await api().get('/api/audit').set(bearer(doctor.token));
    expect(res.status).toBe(403);
  });

  it('receptionist cannot read the audit log -> 403', async () => {
    const { receptionist } = await setup();
    const res = await api().get('/api/audit').set(bearer(receptionist.token));
    expect(res.status).toBe(403);
  });

  it('unauthenticated -> 401 (different from 403)', async () => {
    const res = await api().get('/api/audit');
    expect(res.status).toBe(401);
  });

  it('admin can read the audit log -> 200', async () => {
    const { admin } = await setup();
    const res = await api().get('/api/audit').set(bearer(admin.token));
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Doctor schedule endpoint — only the attending doctor or staff
// ─────────────────────────────────────────────────────────────────────────────
describe('RBAC — doctor schedule endpoint', () => {
  it('a patient cannot view any doctor\'s schedule -> 403', async () => {
    const { patient, doctor } = await setup();
    const res = await api()
      .get(`/api/doctors/${doctor.doctorId}/schedule`)
      .set(bearer(patient.token));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Forbidden');
  });

  it('a different doctor cannot view another doctor\'s schedule -> 403', async () => {
    const { doctor } = await setup();
    const otherDoctor = await loginAs('doctor');
    const res = await api()
      .get(`/api/doctors/${doctor.doctorId}/schedule`)
      .set(bearer(otherDoctor.token));
    expect(res.status).toBe(403);
  });

  it('the attending doctor can view their own schedule -> 200', async () => {
    const { doctor } = await setup();
    const res = await api()
      .get(`/api/doctors/${doctor.doctorId}/schedule`)
      .set(bearer(doctor.token));
    expect(res.status).toBe(200);
  });

  it('receptionist can view any doctor\'s schedule -> 200', async () => {
    const { receptionist, doctor } = await setup();
    const res = await api()
      .get(`/api/doctors/${doctor.doctorId}/schedule`)
      .set(bearer(receptionist.token));
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Reschedule — patient for own, receptionist/admin for all; no doctors
// ─────────────────────────────────────────────────────────────────────────────
describe('RBAC — appointment reschedule', () => {
  it('a doctor cannot reschedule an appointment -> 403', async () => {
    const { doctor, appointmentId } = await setup();
    const res = await api()
      .patch(`/api/appointments/${appointmentId}/reschedule`)
      .set(bearer(doctor.token))
      .send({ newStartsAt: '2026-12-07T10:00:00.000Z' });
    expect(res.status).toBe(403);
  });

  it('a patient cannot reschedule someone else\'s appointment -> 403', async () => {
    const { appointmentId } = await setup();
    const otherPatient = await loginAs('patient');
    const res = await api()
      .patch(`/api/appointments/${appointmentId}/reschedule`)
      .set(bearer(otherPatient.token))
      .send({ newStartsAt: '2026-12-07T10:00:00.000Z' });
    expect(res.status).toBe(403);
  });
});
