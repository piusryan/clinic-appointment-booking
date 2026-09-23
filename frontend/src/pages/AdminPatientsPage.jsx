import React, { useEffect, useState } from 'react';
import { patientsApi } from '../api/client.js';
import Spinner from '../components/Spinner.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import { useToast } from '../components/Toast.jsx';

const emptyForm = { name: '', email: '', phone: '' };

/** Admin + receptionist patient directory (admin may delete, edit). */
export default function AdminPatientsPage() {
  const [patients, setPatients] = useState(null);
  const [meta, setMeta] = useState({ page: 1, pages: 1, total: 0, perPage: 50 });
  const [page, setPage] = useState(1);
  const [error, setError] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [editId, setEditId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const { toast } = useToast();

  const load = () =>
    patientsApi
      .list({ page, perPage: 50 })
      .then((res) => {
        setPatients(res.patients);
        setMeta({ page: res.page, pages: res.pages, total: res.total, perPage: res.perPage });
      })
      .catch((err) => setError(err.message));

  useEffect(() => {
    load();
  }, [page]);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const body = editId ? { name: form.name, phone: form.phone } : form;
      if (editId) await patientsApi.update(editId, body);
      else await patientsApi.create(body);
      setForm(emptyForm);
      setEditId(null);
      toast(editId ? 'Patient updated' : 'Patient created', 'success');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    setError(null);
    try {
      await patientsApi.remove(pendingDelete);
      setPendingDelete(null);
      toast('Patient removed', 'info');
      await load();
    } catch (err) {
      setError(err.message);
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  };

  if (error && !patients) return <ErrorBanner error={error} onDismiss={() => setError(null)} />;
  if (!patients) return <Spinner label="Loading patients…" />;

  return (
    <div className="page">
      <h1>Patients</h1>
      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      <form className="card" onSubmit={submit}>
        <h2>{editId ? 'Edit patient' : 'New patient'}</h2>
        <div className="form-grid">
          <label className="field">
            <span className="field-label">Name</span>
            <input value={form.name} required onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label className="field">
            <span className="field-label">Email</span>
            <input type="email" value={form.email} required={!editId} disabled={Boolean(editId)} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </label>
          <label className="field">
            <span className="field-label">Phone</span>
            <input value={form.phone} required onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </label>
        </div>
        <div className="row">
          <button className="btn btn-primary" type="submit" disabled={saving}>
            {saving ? 'Saving…' : editId ? 'Save changes' : 'Add patient'}
          </button>
          {editId ? (
            <button className="btn" type="button" onClick={() => { setEditId(null); setForm(emptyForm); }}>
              Cancel edit
            </button>
          ) : null}
        </div>
      </form>

      <ul className="appt-list">
        {patients.map((p) => (
          <li key={p.id} className="card appt-row">
            <div className="appt-main">
              <strong>{p.name}</strong>
              <span className="muted">{p.phone}</span>
            </div>
            <div className="appt-actions">
              <button
                className="btn btn-sm"
                type="button"
                onClick={() => {
                  setEditId(p.id);
                  setForm({ name: p.name, email: p.email ?? '', phone: p.phone });
                }}
              >
                Edit
              </button>
              <button
                className="btn btn-sm btn-danger"
                type="button"
                onClick={() => setPendingDelete(p.id)}
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>

      <div className="pager row">
        <span className="muted">
          {meta.total} patient{meta.total === 1 ? '' : 's'} · page {meta.page} of {meta.pages}
        </span>
        <button className="btn btn-sm" type="button" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
          Prev
        </button>
        <button className="btn btn-sm" type="button" disabled={page >= meta.pages} onClick={() => setPage((p) => p + 1)}>
          Next
        </button>
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete patient?"
        message="This permanently removes the patient record and their appointments. This can't be undone."
        confirmLabel="Delete patient"
        busy={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}