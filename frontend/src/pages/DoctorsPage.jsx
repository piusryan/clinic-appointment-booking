import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { doctorsApi } from '../api/client.js';
import Spinner from '../components/Spinner.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';

/**
 * Doctor list with a live speciality filter. The fetch happens here; the
 * rows come from a data layer, never from inline fetch in a component.
 */
export default function DoctorsPage() {
  const [doctors, setDoctors] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    let cancelled = false;
    doctorsApi
      .list()
      .then((res) => !cancelled && setDoctors(res.doctors))
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, []);

  const specialities = useMemo(() => {
    if (!doctors) return [];
    return [...new Set(doctors.map((d) => d.speciality))].sort();
  }, [doctors]);

  const visible = useMemo(() => {
    if (!doctors) return [];
    const q = filter.trim();
    if (!q) return doctors;
    return doctors.filter((d) => d.speciality.toLowerCase().includes(q.toLowerCase()));
  }, [doctors, filter]);

  if (error) return <ErrorBanner error={error} onDismiss={() => setError(null)} />;
  if (!doctors) return <Spinner label="Loading doctors…" />;

  return (
    <div className="page">
      <div className="page-head">
        <h1>Our doctors</h1>
        <label className="filter">
          <span className="field-label">Speciality</span>
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">All specialities</option>
            {specialities.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="page-banner banner-doctors">
        <h2>Book your next visit online</h2>
        <p className="muted">
          Pick a speciality, check live availability and reserve a slot in seconds.
        </p>
      </div>

      <div className="card-grid">
        {visible.map((d) => (
          <Link to={`/doctors/${d.id}`} key={d.id} className="card doctor-card">
            <h2>{d.name}</h2>
            <p className="speciality">{d.speciality}</p>
            <p className="muted">
              {d.workingHours.length} working day{d.workingHours.length === 1 ? '' : 's'} · {d.slotMinutes} min slots
            </p>
          </Link>
        ))}
        {visible.length === 0 ? <p className="muted">No doctors match that filter.</p> : null}
      </div>
    </div>
  );
}