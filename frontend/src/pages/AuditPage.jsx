import React, { useEffect, useState } from 'react';
import { auditApi } from '../api/client.js';
import Spinner from '../components/Spinner.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';

const ACTIONS = ['appointment.read', 'schedule.read', 'patient.read', 'slots.read'];
const ROLES = ['patient', 'doctor', 'receptionist', 'admin'];
const PER_PAGE = 25;

/** Admin-only audit-trail viewer with role/action filters and pagination. */
export default function AuditPage() {
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  const [role, setRole] = useState('');
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    auditApi
      .list({ role: role || undefined, action: action || undefined, page, perPage: PER_PAGE })
      .then((res) => !cancelled && setState(res))
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [role, action, page]);

  if (error && !state) return <ErrorBanner error={error} onDismiss={() => setError(null)} />;
  if (!state) return <Spinner label="Loading audit trail…" />;

  const fmt = (iso) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <div className="page">
      <div className="page-head">
        <h1>Audit trail</h1>
        <div className="row">
          <label className="field audit-filter">
            <span className="field-label">Role</span>
            <select value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }}>
              <option value="">All roles</option>
              {ROLES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </label>
          <label className="field audit-filter">
            <span className="field-label">Action</span>
            <select value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }}>
              <option value="">All actions</option>
              {ACTIONS.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      <div className="card table-card">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Actor</th>
                <th>Role</th>
                <th>Action</th>
                <th>Resource</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {state.logs.map((l) => (
                <tr key={l.id}>
                  <td className="nowrap">{fmt(l.createdAt)}</td>
                  <td>{l.actorEmail ?? l.actorId}</td>
                  <td><span className="pill pill-role">{l.actorRole}</span></td>
                  <td><code>{l.action}</code></td>
                  <td>{l.resource}{l.resourceId ? ` · ${l.resourceId.slice(0, 8)}` : ''}</td>
                  <td className="muted">{l.ip || '—'}</td>
                </tr>
              ))}
              {state.logs.length === 0 ? (
                <tr><td colSpan="6" className="muted">No audit records match.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {state.pages > 1 ? (
          <div className="row pager">
            <button className="btn btn-sm" type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              ← Prev
            </button>
            <span className="muted small">
              Page {state.page} of {state.pages} · {state.total} records
            </span>
            <button className="btn btn-sm" type="button" disabled={page >= state.pages} onClick={() => setPage((p) => p + 1)}>
              Next →
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
