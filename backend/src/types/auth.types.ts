import type { Role } from '../../../shared/types';

/** What we trust from a verified access token / refreshed session. */
export interface RequestUser {
  id: string;          // User._id
  email: string;
  role: Role;
  tv: number;          // refreshTokenVersion captured at token issue time
  patientId?: string;  // set when the user owns a Patient profile
  doctorId?: string;   // set when the user owns a Doctor profile
}