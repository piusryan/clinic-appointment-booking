import express, { type Express, type Request, type Response } from 'express';
import request from 'supertest';
import Appointment from '../src/models/appointment.model';
import * as appointmentService from '../src/services/appointment.service';
import { logRead } from '../src/services/audit.service';
import { asyncHandler } from '../src/utils/asyncHandler';
import { startDb, stopDb, resetDb, api, bearer, loginAs, seedDoctor, FIXED_MONDAY, type TestDoctor, type LoggedInAs } from './helpers';

/**
 * THE NAMED IDOR TARGET — exploited for real, not described.
 *
 * Three surfaces, each demonstrated twice:
 *
 *   BEFORE — a deliberately VULNERABLE build, assembled in this file: the
 *   ownership guard is removed and nothing replaces it. Same database, same
 *   fixtures, same tokens. This is the "check the user did not bother to
 *   write" version, and it is what the transcripts pasted into SECURITY.md
 *   were recorded from.
 *
 *   AFTER — this project's real app, via `buildApp()`.
 *
 * The three surfaces are the doctor's schedule (the brief's target), a
 * patient's own appointment read, and a cancel on someone else's row.
 */

let doctor: TestDoctor;
let victim: LoggedInAs; // the patient whose data is being targeted
let attacker: LoggedInAs; // a different, legitimate patient
let victimAppointmentId: string;

/**
 * A vulnerable rebuild of the two routes under test. Everything else — auth,
 * validation, services, models, the database — is the real thing, so the only
 * variable in the comparison is the missing ownership check.
 */
function buildVulnerableApp(): Express {
  const app = express();
  app.use(express.json());

  // The shipped app minus its guards. Same controller, same service.
  const showAppointment = asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
    const row = await appointmentService.getAppointment(req.params.id);
    await logRead({ actor: req.user!, action: 'appointment.read', targetPatient: row.patientId, resourceId: row.id });
    res.status(200).json({ appointment: row });
  });
  const cancelAppointment = asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
    await appointmentService.cancelAppointment(req.params.id);
    res.status(204).end();
  });
  const schedule = asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
    res.status(200).json({ schedule: await appointmentService.getSchedule(req.params.id) });
  });

  // `req.user` is asserted, not derived: the point of this app is that
  // authentication happens and AUTHORIZATION does not.
  const pretendAuthenticated = (req: Request, _res: Response, next: () => void) => {
    req.user = {
      id: attacker.userId,
      email: attacker.email,
      role: 'patient',
      tv: 0,
      patientId: attacker.patientId,
    };
    next();
  };

  app.get('/api/doctors/:id/schedule', pretendAuthenticated, schedule);
  app.get('/api/appointments/:id', pretendAuthenticated, showAppointment);
  app.patch('/api/appointments/:id/cancel', pretendAuthenticated, cancelAppointment);
  return app;
}

const vulnerable = () => request(buildVulnerableApp());

beforeAll(startDb);
afterAll(stopDb);

beforeEach(async () => {
  await resetDb();
  doctor = await seedDoctor({ email: 'idor-dr@test.io', password: 'IdorPass1' }, [['09:00', '17:00']], 30);

  victim = await loginAs('patient');
  attacker = await loginAs('patient');

  const grid = await api().get(`/api/doctors/${doctor._id}/slots?date=${FIXED_MONDAY}`).set(bearer(victim.token));
  const booked = await api()
    .post('/api/appointments')
    .set(bearer(victim.token))
    .send({
      doctorId: String(doctor._id),
      patientId: victim.patientId,
      startsAt: (grid.body.slots[0] as { startsAt: string }).startsAt,
    })
    .expect(201);
  victimAppointmentId = booked.body.appointment.id;
});

describe('IDOR 1 — GET /api/doctors/:id/schedule (the brief\'s target)', () => {
  it('BEFORE: a patient enumerates a doctor\'s schedule -> 200 and the whole patient list leaks', async () => {
    const res = await vulnerable().get(`/api/doctors/${doctor._id}/schedule`).set(bearer(attacker.token));

    expect(res.status).toBe(200);
    // The disclosure is real and specific: another human being's name and
    // phone number, plus when they are expected in the chair.
    const leaked = res.body.schedule as { patient: { name: string; phone: string }; startsAt: string }[];
    expect(leaked).toHaveLength(1);
    expect(leaked[0].patient.name).toContain('patient');
    expect(leaked[0].patient.phone).toMatch(/^\+353/);
  });

  it('AFTER: the same request against this build -> 403 and nothing leaks', async () => {
    const res = await api().get(`/api/doctors/${doctor._id}/schedule`).set(bearer(attacker.token));

    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      error: 'Forbidden',
      message: 'Only the doctor themselves may view their schedule',
    });
    expect(JSON.stringify(res.body)).not.toContain('+353');
  });

  it('AFTER: the doctor themselves and staff still get their 200', async () => {
    const doc = await loginAs('doctor', { email: doctor.email, password: doctor.password });
    const asDoctor = await api().get(`/api/doctors/${doctor._id}/schedule`).set(bearer(doc.token));
    expect(asDoctor.status).toBe(200);
    expect(asDoctor.body.schedule).toHaveLength(1);

    const recep = await loginAs('receptionist');
    const asRecep = await api().get(`/api/doctors/${doctor._id}/schedule`).set(bearer(recep.token));
    expect(asRecep.status).toBe(200);
  });

  it('AFTER: an anonymous caller -> 401, which is a different answer from 403', async () => {
    const res = await api().get(`/api/doctors/${doctor._id}/schedule`);
    expect(res.status).toBe(401);
  });
});

describe('IDOR 2 — GET /api/appointments/:otherId', () => {
  it('BEFORE: swapping the id in the URL reads another patient\'s record -> 200', async () => {
    const res = await vulnerable().get(`/api/appointments/${victimAppointmentId}`).set(bearer(attacker.token));

    expect(res.status).toBe(200);
    expect(String(res.body.appointment.patient.id)).toBe(victim.patientId);
  });

  it('AFTER: the same request -> 403, and the response carries no patient data', async () => {
    const res = await api().get(`/api/appointments/${victimAppointmentId}`).set(bearer(attacker.token));

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Forbidden', message: 'Not your appointment' });
    expect(res.body.appointment).toBeUndefined();
  });

  it('AFTER: the owner can still read their own -> 200', async () => {
    const res = await api().get(`/api/appointments/${victimAppointmentId}`).set(bearer(victim.token));
    expect(res.status).toBe(200);
    expect(String(res.body.appointment.id)).toBe(victimAppointmentId);
  });

  it('AFTER: an id that does not exist -> 404, so the guard is not a 404 oracle', async () => {
    const res = await api().get('/api/appointments/000000000000000000000001').set(bearer(attacker.token));
    expect(res.status).toBe(404);
  });
});

describe('IDOR 3 — PATCH /api/appointments/:id/cancel', () => {
  it('BEFORE: cancelling a stranger\'s appointment succeeds -> 204 and the row is destroyed', async () => {
    const res = await vulnerable()
      .patch(`/api/appointments/${victimAppointmentId}/cancel`)
      .set(bearer(attacker.token));

    expect(res.status).toBe(204);
    // Real damage, not just a disclosure: the victim's slot is now freed.
    const row = await Appointment.findById(victimAppointmentId);
    expect(row?.status).toBe('cancelled');
  });

  it('AFTER: the same request -> 403 and the appointment is untouched', async () => {
    const res = await api()
      .patch(`/api/appointments/${victimAppointmentId}/cancel`)
      .set(bearer(attacker.token));

    expect(res.status).toBe(403);
    const row = await Appointment.findById(victimAppointmentId);
    expect(row?.status).toBe('booked');
  });

  it('AFTER: the owner can still cancel their own -> 204', async () => {
    await api().patch(`/api/appointments/${victimAppointmentId}/cancel`).set(bearer(victim.token)).expect(204);
    const row = await Appointment.findById(victimAppointmentId);
    expect(row?.status).toBe('cancelled');
  });
});

describe('the free-slot enumeration rule (no occupant disclosure)', () => {
  it('the availability grid says free/taken and never who has it', async () => {
    const res = await api().get(`/api/doctors/${doctor._id}/slots?date=${FIXED_MONDAY}`).set(bearer(attacker.token));

    expect(res.status).toBe(200);
    const slots = res.body.slots as { startsAt: string; available: boolean }[];
    expect(slots.some((s) => !s.available)).toBe(true);
    // The booked slot is visible as "not available" — that is booking
    // information. The WHO is not, and that is the distinction.
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(victim.patientId);
    expect(body).not.toContain('patientId');
  });

  it('the calendar month summary likewise exposes counts, not identities', async () => {
    const res = await api().get(`/api/doctors/${doctor._id}/calendar?month=2026-12`).set(bearer(attacker.token));
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(victim.patientId);
  });
});