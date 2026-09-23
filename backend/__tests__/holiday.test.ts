import { resetDb, seedDoctor, startDb, stopDb, type TestDoctor } from './helpers';
import * as holidayService from '../src/services/holiday.service';

let doctor: TestDoctor;

beforeAll(async () => {
  await startDb();
});

afterAll(async () => {
  await stopDb();
});

beforeEach(async () => {
  await resetDb();
  doctor = await seedDoctor({ email: 'holiday-dr@test.io', password: 'HolidayPass1' }, [['09:00', '17:00']], 30);
});

describe('holiday.service', () => {
  it('adds a clinic-wide closure', async () => {
    const h = await holidayService.addHoliday({ doctorId: null, date: '2026-12-25' });
    expect(h.id).toBeTruthy();
    expect(h.date).toBe('2026-12-25');

    const list = await holidayService.listHolidays({});
    expect(list).toHaveLength(1);
    expect(list[0].doctor).toBeNull();
  });

  it('adds a per-doctor closure', async () => {
    const h = await holidayService.addHoliday({ doctorId: String(doctor._id), date: '2026-12-26' });
    expect(h.id).toBeTruthy();

    const list = await holidayService.listHolidays({ doctorId: String(doctor._id) });
    expect(list).toHaveLength(1);
    expect(String(list[0].doctor)).toBe(String(doctor._id));
  });

  it('rejects a duplicate closure on the same date', async () => {
    await holidayService.addHoliday({ doctorId: null, date: '2026-12-25' });
    await expect(holidayService.addHoliday({ doctorId: null, date: '2026-12-25' })).rejects.toThrow(/already covers/i);
  });

  it('allows the same date for different scopes (clinic + doctor)', async () => {
    await holidayService.addHoliday({ doctorId: null, date: '2026-12-25' });
    const per = await holidayService.addHoliday({ doctorId: String(doctor._id), date: '2026-12-25' });
    expect(per.id).toBeTruthy();
  });

  it('filters by date range', async () => {
    await holidayService.addHoliday({ doctorId: null, date: '2026-12-24' });
    await holidayService.addHoliday({ doctorId: null, date: '2026-12-25' });

    const dec25 = await holidayService.listHolidays({ from: '2026-12-25', to: '2026-12-25' });
    expect(dec25).toHaveLength(1);
    expect(dec25[0].date).toBe('2026-12-25');

    const decRange = await holidayService.listHolidays({ from: '2026-12-24', to: '2026-12-30' });
    expect(decRange).toHaveLength(2);
  });

  it('removes a holiday', async () => {
    const h = await holidayService.addHoliday({ doctorId: null, date: '2026-12-31' });
    await holidayService.removeHoliday(h.id);
    const list = await holidayService.listHolidays({});
    expect(list).toHaveLength(0);
  });

  it('throws 404 when removing an unknown holiday', async () => {
    await expect(holidayService.removeHoliday('000000000000000000000000')).rejects.toMatchObject({ status: 404 });
  });
});
