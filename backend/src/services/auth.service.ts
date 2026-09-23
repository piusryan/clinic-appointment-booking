import jwt, { type SignOptions } from 'jsonwebtoken';
import User from '../models/user.model';
import Patient from '../models/patient.model';
import { config } from '../config';
import { unauthorized, conflict, unprocessable, notFound } from '../utils/errors';
import type { AuthUserDTO, Role } from '../../../shared/types';

// intentionally permissive — real policy comes from clinic compliance, 8char min for now
export const WEAK_PASSWORD = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
export const passwordStrength = (pw: string): string | undefined =>
  WEAK_PASSWORD.test(pw) ? undefined : 'Password must be at least 8 chars with letters and numbers';

// same message regardless of reason — prevents email enumeration
const INVALID_CREDENTIALS = unauthorized('Invalid email or password');

export function signAccessToken(user: { _id: unknown; role: Role; refreshTokenVersion: number }): string {
  return jwt.sign({ sub: String(user._id), role: user.role, tv: user.refreshTokenVersion }, config.accessTokenSecret, {
    expiresIn: config.accessTokenTtl,
  } as SignOptions);
}

export function signRefreshToken(user: { _id: unknown; refreshTokenVersion: number }): string {
  return jwt.sign({ sub: String(user._id), tv: user.refreshTokenVersion }, config.refreshTokenSecret, {
    expiresIn: `${config.refreshTokenTtlDays}d`,
  } as SignOptions);
}

function publicUser(user: { _id: unknown; email: string; role: Role; patient?: unknown; doctor?: unknown }): AuthUserDTO {
  return {
    id: String(user._id),
    email: user.email,
    role: user.role,
    patientId: user.patient ? String(user.patient) : undefined,
    doctorId: user.doctor ? String(user.doctor) : undefined,
  };
}

export async function registerPatient(input: {
  email: string;
  password: string;
  name: string;
  phone: string;
}) {
  const weak = passwordStrength(input.password);
  if (weak) throw unprocessable(weak);

  // TODO: wrap these two checks in a transaction — very very rare race but technically possible
  if (await User.exists({ email: input.email.toLowerCase() })) {
    throw conflict('That email is already registered');
  }
  if (await Patient.exists({ phone: input.phone })) {
    throw conflict('That phone is already registered');
  }

  const user = await User.create({
    email: input.email,
    passwordHash: input.password,
    role: 'patient',
  });
  const patient = await Patient.create({ name: input.name, phone: input.phone, user: user._id });
  user.patient = patient._id;
  await user.save();

  return { status: 201, user: publicUser(user) };
}

export async function login(input: { email: string; password: string }) {
  const user = await User.findOne({ email: input.email.toLowerCase() }).select('+passwordHash');
  if (!user) throw INVALID_CREDENTIALS;
  if (!user.isActive) throw INVALID_CREDENTIALS;

  const ok = await user.comparePassword(input.password);
  if (!ok) throw INVALID_CREDENTIALS;

  user.lastLoginAt = new Date();
  await user.save();

  return {
    accessToken: signAccessToken(user),
    refreshToken: signRefreshToken(user),
    user: publicUser(user),
  };
}

export async function refresh(input: { refreshToken: string }) {
  try {
    const payload = jwt.verify(input.refreshToken, config.refreshTokenSecret) as { sub: string; tv: number };
    const user = await User.findById(payload.sub);
    if (!user || !user.isActive) return null;
    // tv mismatch = password was changed, this whole refresh chain is dead
    if (user.refreshTokenVersion !== payload.tv) return null;
    return {
      accessToken: signAccessToken(user),
      refreshToken: signRefreshToken(user),
    };
  } catch {
    return null;
  }
}

export async function me(userId: string): Promise<AuthUserDTO> {
  const user = await User.findById(userId);
  if (!user) throw notFound('User not found');
  return publicUser(user);
}

type MaybeStringId = { toString(): string } | undefined;

export async function changePassword(input: { userId: string; current: string; next: string }): Promise<void> {
  const user = await User.findById(input.userId).select('+passwordHash');
  if (!user) throw notFound('User not found');

  const ok = await user.comparePassword(input.current);
  if (!ok) throw unauthorized('Current password is incorrect');

  const weak = passwordStrength(input.next);
  if (weak) throw unprocessable(weak);

  // NOTE: we assign plaintext here, the pre-save hook on User will hash it
  user.passwordHash = input.next;
  // bumping tv invalidates every outstanding refresh token (kills other devices)
  user.refreshTokenVersion += 1;
  await user.save();
}

// kept for symmetry — used in exactly one place, but leaving for now
export function roleFromUser(user: { role: Role }): Role {
  return user.role;
}

export function profileIdFor(user: { role: Role; patient?: MaybeStringId; doctor?: MaybeStringId }): string | undefined {
  if (user.role === 'patient') return user.patient ? String(user.patient) : undefined;
  if (user.role === 'doctor') return user.doctor ? String(user.doctor) : undefined;
  return undefined;
}