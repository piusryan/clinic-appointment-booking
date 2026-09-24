/**
 * shared/types.ts — the single API contract imported by BOTH halves.
 *
 * The backend compiles against these types (strict mode, no `any`).
 * The frontend (JS, bundler natively understands TS) imports the plain
 * value constants below (ROLES, APPOINTMENT_STATUS) so the UI never
 * hard-codes a value that disagrees with the server. The type-only
 * exports are erased at compile time on the JS side.
 */

export type Role = 'patient' | 'doctor' | 'receptionist' | 'admin';
export type AppointmentStatus = 'booked' | 'cancelled' | 'completed' | 'no-show';

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** Local "HH:MM" (24-hour) opening/closing bounds for one weekday. */
export interface WorkingHours {
  day: Weekday;
  start: string;
  end: string;
}

export interface DoctorDTO {
  id: string;
  name: string;
  speciality: string;
  workingHours: WorkingHours[];
  slotMinutes: number;
}

export interface PatientDTO {
  id: string;
  name: string;
  phone: string;
}

export interface AppointmentDTO {
  id: string;
  doctor: DoctorDTO | string;
  patient: PatientDTO | string;
  startsAt: string; // ISO UTC
  endsAt: string;   // ISO UTC
  status: AppointmentStatus;
}

/** A single derived slot on the grid. Never stored. */
export interface SlotDTO {
  startsAt: string; // ISO UTC
  endsAt: string;   // ISO UTC
  available: boolean;
}

/** One day of the month availability grid (calendar view). */
export interface CalendarDayDTO {
  date: string; // YYYY-MM-DD
  weekday: Weekday;
  open: boolean; // the doctor has scheduled working hours that day
  holiday: boolean; // blocked by a clinic/doctor closure
  total: number; // slot count if the day is open
  available: number; // free slots left on an open day
}

export interface AuthUserDTO {
  id: string;
  email: string;
  role: Role;
  patientId?: string;
  doctorId?: string;
}

export interface AuthTokensDTO {
  accessToken: string;
  user: AuthUserDTO;
}

/** ---- Request payloads --------------------------------------------------- */

export interface RegisterPayload {
  email: string;
  password: string;
  role?: Exclude<Role, 'admin'>;
  name?: string;
  phone?: string;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface CreateDoctorPayload {
  name: string;
  speciality: string;
  workingHours: WorkingHours[];
  slotMinutes: number;
  email?: string;
  password?: string;
}

export interface UpdateDoctorPayload {
  name?: string;
  speciality?: string;
  workingHours?: WorkingHours[];
  slotMinutes?: number;
}

export interface CreatePatientPayload {
  name: string;
  phone: string;
  email: string;
  password: string;
}

export interface UpdatePatientPayload {
  name?: string;
  phone?: string;
}

export interface BookAppointmentPayload {
  doctorId: string;
  patientId: string;
  startsAt: string; // ISO UTC start of the requested slot
}

export interface ReschedulePayload {
  newStartsAt: string; // ISO UTC start of the new slot
}

export interface HolidayPayload {
  date: string; // YYYY-MM-DD
}

export interface ErrorDTO {
  error: string;
  message: string;
  details?: string;
}

/** ---- Value constants shared with the frontend --------------------------- */

export const ROLES = ['patient', 'doctor', 'receptionist', 'admin'] as const;

export const APPOINTMENT_STATUS: AppointmentStatus[] = [
  'booked',
  'cancelled',
  'completed',
  'no-show',
];

export const HTTP = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE: 422,
  TOO_MANY: 429,
  INTERNAL: 500,
} as const;