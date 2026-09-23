import AuditLog from '../src/models/audit.model';
import { startDb, stopDb, resetDb, api, bearer, seedAdmin, seedPatient, tokenForPatient } from './helpers';

describe('patients CRUD + read audit trail (healthcare reads are auditable)', () => {
  beforeAll(startDb);
  afterAll(stopDb);
  beforeEach(resetDb);

  it('admin patient CRUD lifecycle: 201 -> list 200 -> show 200 -> 204 -> 404', async () => {
    const admin = await seedAdmin();
    const create = await api()
      .post('/api/patients')
      .set(bearer(admin))
      .send({ name: 'Jane Doe', phone: '+353911111111', email: 'jane@test.io', password: 'JanePass1' });
    expect(create.status).toBe(201);
    const id = create.body.patient.id;

    const list = await api().get('/api/patients').set(bearer(admin));
    expect(list.status).toBe(200);
    expect(list.body.patients.length).toBeGreaterThanOrEqual(1);

    const show = await api().get(`/api/patients/${id}`).set(bearer(admin));
    expect(show.status).toBe(200);
    expect(show.body.patient.name).toBe('Jane Doe');

    await api().patch(`/api/patients/${id}`).set(bearer(admin)).send({ phone: '+353922222222' }).expect(200);
    await api().delete(`/api/patients/${id}`).set(bearer(admin)).expect(204);
    expect((await api().get(`/api/patients/${id}`).set(bearer(admin))).status).toBe(404);
  });

  it('paginates the patient list (Gap 5)', async () => {
    await seedPatient('pag01@test.io');
    await seedPatient('pag02@test.io');
    await seedPatient('pag03@test.io');
    const admin = await seedAdmin();

    const page1 = await api().get('/api/patients?perPage=2&page=1').set(bearer(admin));
    expect(page1.status).toBe(200);
    expect(page1.body.patients).toHaveLength(2);
    expect(page1.body.total).toBeGreaterThanOrEqual(3);
    expect(page1.body.pages).toBe(2);
    expect(page1.body.page).toBe(1);

    const page2 = await api().get('/api/patients?perPage=2&page=2').set(bearer(admin));
    expect(page2.status).toBe(200);
    expect(page2.body.patients).toHaveLength(1);
    expect(page2.body.page).toBe(2);

    // Names are distinct from other suites' seeds, so IDs must not overlap.
    const ids1 = page1.body.patients.map((p: { id: string }) => p.id).sort();
    const ids2 = page2.body.patients.map((p: { id: string }) => p.id).sort();
    expect(ids1.filter((id: string) => ids2.includes(id))).toHaveLength(0);
  });

  it('every read of a patient record is logged with the reader identity', async () => {
    const admin = await seedAdmin();
    const created = await api()
      .post('/api/patients')
      .set(bearer(admin))
      .send({ name: 'Audited', phone: '+353933333333', email: 'aud@test.io', password: 'AudPass1' });
    const id = created.body.patient.id;

    await api().get(`/api/patients/${id}`).set(bearer(admin)).expect(200);

    const logs = await AuditLog.find({ resource: 'patient', resourceId: id });
    expect(logs.length).toBe(1);
    expect(String(logs[0].actorRole)).toBe('admin');
    expect(String(logs[0].actorId)).toBeTruthy();
  });

  it('a patient cannot read another patient record (sensitive data) -> 403', async () => {
    const target = await seedPatient('target@test.io');
    const sneak = await seedPatient('sneak@test.io');
    const res = await api().get(`/api/patients/${target.patientId}`).set(bearer(await tokenForPatient(sneak)));
    expect(res.status).toBe(403);
  });
});