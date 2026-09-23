import { api, bearer, resetDb, seedAdmin, seedPatient, seedReceptionist, startDb, stopDb, tokenForPatient, type TestPatient } from './helpers';

const auditModel = () => require('../src/models/audit.model').default;

let patient: TestPatient;
let adminToken: string;

beforeAll(async () => {
  await startDb();
  adminToken = await seedAdmin();
  patient = await seedPatient('audit-patient@test.io');
});

afterAll(async () => {
  await stopDb();
});

beforeEach(async () => {
  await resetDb();
  adminToken = await seedAdmin();
  patient = await seedPatient('audit-patient@test.io');
});

describe('GET /api/audit', () => {
  it('does not list until an audited read has occurred', async () => {
    const res = await api().get('/api/audit').set(bearer(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.logs).toHaveLength(0);
  });

  it('records and returns an audited patient read for admin', async () => {
    // patient.show is admin/receptionist-only; a receptionist reading a
    // patient writes a patient.read audit row with the reader's identity.
    const receptionistToken = await seedReceptionist('recep-audit@test.io');
    const read = await api().get(`/api/patients/${patient.patientId}`).set(bearer(receptionistToken));
    expect(read.status).toBe(200);
    expect(await auditModel().countDocuments()).toBeGreaterThan(0);

    const res = await api().get('/api/audit').set(bearer(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThan(0);
    expect(res.body.logs[0].action).toBe('patient.read');
    expect(res.body.logs[0].actorRole).toBe('receptionist');
    expect(res.body.logs[0].targetPatient).toBe(String(patient.patientId));
  });

  it('supports role filter and pagination', async () => {
    const receptionistToken = await seedReceptionist('recep-audit2@test.io');
    for (let i = 0; i < 3; i++) {
      await api().get(`/api/patients/${patient.patientId}`).set(bearer(receptionistToken));
    }

    const filtered = await api().get('/api/audit?role=receptionist&perPage=2&page=1').set(bearer(adminToken));
    expect(filtered.status).toBe(200);
    expect(filtered.body.logs).toHaveLength(2);
    expect(filtered.body.pages).toBe(2);
    expect(filtered.body.total).toBeGreaterThanOrEqual(3);

    const page2 = await api().get('/api/audit?role=receptionist&perPage=2&page=2').set(bearer(adminToken));
    expect(page2.status).toBe(200);
    expect(page2.body.page).toBe(2);
  });

  it('403s for non-admin roles', async () => {
    const patientToken = await tokenForPatient(patient);
    const p2 = await api().get('/api/audit').set(bearer(patientToken));
    expect(p2.status).toBe(403);
  });

  it('rejects unauthenticated access', async () => {
    const res = await api().get('/api/audit');
    expect(res.status).toBe(401);
  });
});

