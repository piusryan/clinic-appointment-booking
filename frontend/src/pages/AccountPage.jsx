import React, { useState } from 'react';
import { useAuth } from '../auth/useAuth.js';
import { authApi } from '../api/client.js';
import ErrorBanner from '../components/ErrorBanner.jsx';
import { useToast } from '../components/Toast.jsx';

const empty = { current: '', next: '', confirm: '' };

/** Account page: profile summary + change-password (backend /auth/password). */
export default function AccountPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [form, setForm] = useState(empty);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (form.next !== form.confirm) {
      setError('New password and confirmation do not match.');
      return;
    }
    setBusy(true);
    try {
      await authApi.changePassword(form.current, form.next);
      setForm(empty);
      toast('Password updated successfully', 'success');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>My account</h1>
      </div>
      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      <div className="page-banner banner-account">
        <h2>Your profile &amp; security</h2>
        <p className="muted">Review your details and keep your password up to date.</p>
      </div>

      <div className="card account-summary">
        <h2>Profile</h2>
        <dl className="kv">
          <dt>Email</dt>
          <dd>{user.email}</dd>
          <dt>Role</dt>
          <dd>
            <span className="pill pill-role">{user.role}</span>
          </dd>
        </dl>
      </div>

      <form className="card" onSubmit={submit}>
        <h2>Change password</h2>
        <div className="form-grid">
          <label className="field">
            <span className="field-label">Current password</span>
            <input type="password" required value={form.current} onChange={(e) => set('current')(e.target.value)} autoComplete="current-password" />
          </label>
          <label className="field">
            <span className="field-label">New password</span>
            <input type="password" required minLength={8} value={form.next} onChange={(e) => set('next')(e.target.value)} autoComplete="new-password" />
          </label>
          <label className="field">
            <span className="field-label">Confirm new password</span>
            <input type="password" required minLength={8} value={form.confirm} onChange={(e) => set('confirm')(e.target.value)} autoComplete="new-password" />
          </label>
        </div>
        <p className="muted small">Minimum 8 characters.</p>
        <div className="row">
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Updating…' : 'Update password'}
          </button>
        </div>
      </form>
    </div>
  );
}
