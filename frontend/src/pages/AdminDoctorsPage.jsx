import React, { useEffect, useState } from 'react';
import { doctorsApi } from '../api/client.js';
import Spinner from '../components/Spinner.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import WorkingHoursEditor from '../components/WorkingHoursEditor.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import { useToast } from '../components/Toast.jsx';

const emptyForm = { name: '', speciality: '', slotMinutes: '30', workingHours: [] };

/**
 * Admin-only doctor CRUD: create (with optional login credentials), update
 * slot length / working patterns, delete.
 */
export default function AdminDoctorsPage() {
  const [doctors, setDoctors] = useState(null);
  const [error, setError] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [editId, setEditId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const { toast } = useToast();

  const load = () =>
    doctorsApi
      .list()
      .then((res) => setDoctors(res.doctors))
      .catch((err) => setError(err.message));

  useEffect(() => {
    load();
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const body = {
      name: form.name,
      speciality: form.speciality,
      slotMinutes: Number(form.slotMinutes),
      workingHours: form.workingHours,
    };
    try {
      if (editId) await doctorsApi.update(editId, body);
      else await doctorsApi.create(body);
      setForm(emptyForm);
      setEditId(null);
      toast(editId ? 'Doctor updated' : 'Doctor created', 'success');
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
      await doctorsApi.remove(pendingDelete);
      setPendingDelete(null);
      toast('Doctor removed', 'info');
      await load();
    } catch (err) {
      setError(err.message);
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  };

  if (error && !doctors) return <ErrorBanner error={error} onDismiss={() => setError(null)} />;
  if (!doctors) return <Spinner label="Loading doctors…" />;

  return (
    <div className="page">
      <h1>Manage doctors</h1>
      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      <form className="card" onSubmit={submit}>
        <h2>{editId ? 'Edit doctor' : 'New doctor'}</h2>
        <div className="form-grid">
          <label className="field">
            <span className="field-label">Name</span>
            <input value={form.name} required onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label className="field">
            <span className="field-label">Speciality</span>
            <input value={form.speciality} required onChange={(e) => setForm({ ...form, speciality: e.target.value })} />
          </label>
          <label className="field">
            <span className="field-label">Slot minutes</span>
            <input
              type="number"
              min="5"
              max="240"
              step="5"
              value={form.slotMinutes}
              onChange={(e) => setForm({ ...form, slotMinutes: e.target.value })}
            />
          </label>
        </div>
        <div className="field">
          <span className="field-label">Working hours</span>
          <WorkingHoursEditor
            value={form.workingHours}
            onChange={(workingHours) => setForm({ ...form, workingHours })}
          />
        </div>
        <div className="row">
          <button className="btn btn-primary" type="submit" disabled={saving}>
            {saving ? 'Saving…' : editId ? 'Save changes' : 'Create doctor'}
          </button>
          {editId ? (
            <button
              className="btn"
              type="button"
              onClick={() => {
                setEditId(null);
                setForm(emptyForm);
              }}
            >
              Cancel edit
            </button>
          ) : null}
        </div>
      </form>

      <ul className="appt-list">
        {doctors.map((d) => (
          <li key={d.id} className="card appt-row">
            <div className="appt-main">
              <strong>{d.name}</strong>
              <span className="speciality">{d.speciality}</span>
            </div>
            <div className="appt-detail muted">
              {d.workingHours.length} days · {d.slotMinutes} min
            </div>
            <div className="appt-actions">
              <button
                className="btn btn-sm"
                type="button"
                onClick={() => {
                  setEditId(d.id);
                  setForm({
                    name: d.name,
                    speciality: d.speciality,
                    slotMinutes: String(d.slotMinutes),
                    workingHours: (d.workingHours || []).map((w) => ({ ...w })),
                  });
                }}
              >
                Edit
              </button>
              <button
                className="btn btn-sm btn-danger"
                type="button"
                onClick={() => setPendingDelete(d.id)}
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete doctor?"
        message="This removes the doctor and their appointments. This can't be undone."
        confirmLabel="Delete doctor"
        busy={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}