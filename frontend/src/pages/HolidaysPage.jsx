import React, { useEffect, useState } from 'react';
import { holidaysApi, doctorsApi } from '../api/client.js';
import Spinner from '../components/Spinner.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import { useToast } from '../components/Toast.jsx';

/** Admin holiday management: whole-clinic or per-doctor closures. */
export default function HolidaysPage() {
  const [holidays, setHolidays] = useState(null);
  const [doctors, setDoctors] = useState([]);
  const [error, setError] = useState(null);
  const [date, setDate] = useState('');
  const [doctorId, setDoctorId] = useState('');
  const [busy, setBusy] = useState(false);
  const [pendingRemove, setPendingRemove] = useState(null);
  const [removing, setRemoving] = useState(false);
  const { toast } = useToast();

  const removeOne = async (id) => {
    try {
      await holidaysApi.remove(id);
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const confirmRemove = async () => {
    if (!pendingRemove) return;
    setRemoving(true);
    setError(null);
    await removeOne(pendingRemove);
    setPendingRemove(null);
    toast('Closure removed', 'info');
    setRemoving(false);
  };

  const load = () =>
    holidaysApi
      .list()
      .then((res) => setHolidays(res.holidays))
      .catch((err) => setError(err.message));

  useEffect(() => {
    load();
    doctorsApi.list().then((res) => setDoctors(res.doctors)).catch(() => {});
  }, []);

  if (error && !holidays) return <ErrorBanner error={error} onDismiss={() => setError(null)} />;
  if (!holidays) return <Spinner label="Loading holidays…" />;

  return (
    <div className="page">
      <h1>Clinic closures</h1>
      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      <form
        className="card row"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await holidaysApi.create(date, doctorId);
            setDate('');
            toast('Closure added', 'success');
            await load();
          } catch (err) {
            setError(err.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field">
          <span className="field-label">Date</span>
          <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Scope</span>
          <select value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
            <option value="">Entire clinic</option>
            {doctors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <button className="btn btn-primary" type="submit" disabled={busy || !date}>
          {busy ? 'Adding…' : 'Close clinic'}
        </button>
      </form>

      <ul className="appt-list">
        {holidays.map((h) => (
          <li key={h.id} className="card appt-row">
            <span className="appt-main">{new Date(h.date).toDateString()}</span>
            <span className="muted">{h.doctor ? h.doctor.name : 'Entire clinic'}</span>
            <button
              className="btn btn-sm btn-danger"
              type="button"
              onClick={() => setPendingRemove(h.id)}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={pendingRemove !== null}
        title="Remove closure?"
        message="This re-opens slots for that date. This can't be undone."
        confirmLabel="Remove"
        busy={removing}
        onConfirm={confirmRemove}
        onCancel={() => setPendingRemove(null)}
      />
    </div>
  );
}