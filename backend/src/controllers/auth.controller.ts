import type { Response } from 'express';
import type { Request } from 'express';
import * as authService from '../services/auth.service';
import type { LoginPayload, RegisterPayload } from '../../../shared/types';
import { config } from '../config';

const REFRESH_COOKIE = 'refreshToken';

function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction,
    path: '/api/auth',
    maxAge: config.refreshTokenTtlDays * 24 * 60 * 60 * 1000,
  });
}

export async function register(req: Request<unknown, unknown, RegisterPayload>, res: Response): Promise<void> {
  const { user } = await authService.registerPatient({
    email: req.body.email,
    password: req.body.password,
    name: req.body.name ?? 'Patient',
    phone: req.body.phone ?? '',
  });
  res.status(201).json({ user });
}

export async function login(req: Request<unknown, unknown, LoginPayload>, res: Response): Promise<void> {
  const { accessToken, refreshToken, user } = await authService.login(req.body);
  setRefreshCookie(res, refreshToken);
  res.status(200).json({ accessToken, user });
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;
  if (!token) {
    res.status(401).json({ error: 'Unauthorized', message: 'No refresh token' });
    return;
  }
  const result = await authService.refresh({ refreshToken: token });
  if (!result) {
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    res.status(401).json({ error: 'Unauthorized', message: 'Session expired' });
    return;
  }
  setRefreshCookie(res, result.refreshToken); // rotate on every use
  res.status(200).json({ accessToken: result.accessToken });
}

export async function logout(_req: Request, res: Response): Promise<void> {
  res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
  res.status(204).end();
}

export async function me(req: Request, res: Response): Promise<void> {
  const user = await authService.me(req.user!.id);
  res.status(200).json({ user });
}

export async function changePassword(req: Request, res: Response): Promise<void> {
  await authService.changePassword({
    userId: req.user!.id,
    current: req.body.currentPassword,
    next: req.body.newPassword,
  });
  res.status(204).end();
}