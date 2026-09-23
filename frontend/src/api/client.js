/**
 * api/client.js — THE single data layer. Components never call fetch();
 * every request in the app goes through here (module 9 deliverable).
 *
 * Token story (see DESIGN.md for the argument):
 *   - the refresh token lives in an httpOnly cookie the server sets; JS can
 *     never read it, so an XSS cannot exfiltrate it.
 *   - the short-lived access token is held in memory only and attached as an
 *     Authorization header; a CSRF request cannot forge that header.
 *   - on app boot (and on any 401) we call /auth/refresh once and retry the
 *     original request transparently. Components never see this dance.
 */

export const API_BASE = (import.meta.env.VITE_API_BASE ?? 'http://localhost:4000') + '/api';

let accessToken = null;
let refreshInFlight = null;

export function setAccessToken(token) {
  accessToken = token;
}
export function clearAccessToken() {
  accessToken = null;
}

function parseError(status, body) {
  const message = body?.message ?? `Request failed (${status})`;
  const err = new Error(message);
  err.status = status;
  err.code = body?.error;
  return err;
}

async function doFetch(path, options) {
  const headers = { ...(options.headers ?? {}) };
  if (!(options.body instanceof FormData) && options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers,
    body: options.body === undefined ? undefined : typeof options.body === 'string' ? options.body : JSON.stringify(options.body),
  });

  if (res.status === 204) return null;
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw parseError(res.status, body);
  return body;
}

/**
 * Every call goes through here: on 401 it refreshes ONCE (serialised so a
 * burst of parallel 401s fires a single refresh) and retries the request.
 */
export async function api(path, options = {}) {
  try {
    return await doFetch(path, options);
  } catch (err) {
    if (err.status === 401 && !options._retried) {
      const refreshed = await refreshAccessToken();
      if (refreshed) return doFetch(path, { ...options, _retried: true });
      window.dispatchEvent(new CustomEvent('auth:expired'));
    }
    throw err;
  }
}

export function refreshAccessToken() {
  if (!refreshInFlight) {
    refreshInFlight = doFetch('/auth/refresh', { method: 'POST' })
      .then((body) => {
        accessToken = body.accessToken;
        return true;
      })
      .catch(() => false)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

const authHeaders = () => ({ Authorization: `Bearer ${accessToken}` });

export const authApi = {
  register: (payload) => api('/auth/register', { method: 'POST', body: payload }),
  login: (payload) => api('/auth/login', { method: 'POST', body: payload }),
  logout: () => api('/auth/logout', { method: 'POST' }).finally(clearAccessToken),
  me: () => api('/auth/me'),
  changePassword: (currentPassword, newPassword) =>
    api('/auth/password', { method: 'PATCH', body: { currentPassword, newPassword } }),
};

export const doctorsApi = {
  list: (speciality) => api(`/doctors${speciality ? `?speciality=${encodeURIComponent(speciality)}` : ''}`),
  get: (id) => api(`/doctors/${id}`),
  slots: (id, date) => api(`/doctors/${id}/slots?date=${encodeURIComponent(date)}`),
  calendar: (id, month) => api(`/doctors/${id}/calendar?month=${encodeURIComponent(month)}`),
  schedule: (id, date) => (date ? api(`/doctors/${id}/schedule?date=${encodeURIComponent(date)}`) : api(`/doctors/${id}/schedule`)),
  create: (body) => api('/doctors', { method: 'POST', body }),
  update: (id, body) => api(`/doctors/${id}`, { method: 'PATCH', body }),
  remove: (id) => api(`/doctors/${id}`, { method: 'DELETE' }),
};

export const appointmentsApi = {
  list: () => api('/appointments'),
  book: (doctorId, patientId, startsAt) =>
    api('/appointments', { method: 'POST', body: { doctorId, patientId, startsAt } }),
  cancel: (id) => api(`/appointments/${id}/cancel`, { method: 'PATCH' }),
  reschedule: (id, newStartsAt) => api(`/appointments/${id}/reschedule`, { method: 'PATCH', body: { newStartsAt } }),
};

export const patientsApi = {
  list: (params) => api(`/patients?${new URLSearchParams(params ?? {})}`),
  get: (id) => api(`/patients/${id}`),
  create: (body) => api('/patients', { method: 'POST', body }),
  update: (id, body) => api(`/patients/${id}`, { method: 'PATCH', body }),
  remove: (id) => api(`/patients/${id}`, { method: 'DELETE' }),
};

export const holidaysApi = {
  list: () => api('/holidays'),
  create: (date, doctorId) => api('/holidays', { method: 'POST', body: { date, ...(doctorId ? { doctorId } : {}) } }),
  remove: (id) => api(`/holidays/${id}`, { method: 'DELETE' }),
};

export const auditApi = {
  list: (params = {}) => {
    const q = new URLSearchParams();
    if (params.role) q.set('role', params.role);
    if (params.action) q.set('action', params.action);
    if (params.page) q.set('page', String(params.page));
    if (params.perPage) q.set('perPage', String(params.perPage));
    const qs = q.toString();
    return api(`/audit${qs ? `?${qs}` : ''}`);
  },
};

export const header = authHeaders;
export const hasToken = () => Boolean(accessToken);