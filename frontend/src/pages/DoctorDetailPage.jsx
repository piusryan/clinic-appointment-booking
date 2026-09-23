import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { doctorsApi, appointmentsApi } from '../api/client.js';
import { useAuth } from '../auth/useAuth.js';
import Spinner from '../components/Spinner.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import SlotGrid from '../components/SlotGrid.jsx';
import BookingCalendar from '../components/BookingCalendar.jsx';
import { useToast } from '../components/Toast.jsx';
import { addMonths, indianOccasions, sakaCaption, toISODate } from '../lib/indianCalendar.js';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const fmtTime = (s) =>
  s
    ? new Date(`2000-01-01T${s}`).toLocaleString([], { hour: '2-digit', minute: '2-digit' })
    : '—';

/** Readable weekday working-hours block, sorted by weekday. */
function WorkingHoursStrip({ hours }) {
  const sorted = [...(hours ?? [])].sort((a, b) => a.day - b.day);
  if (sorted.length === 0) return <p className="muted">No scheduled working hours.</p>;
  return (
    <ul className="hours-strip">
      {sorted.map((h) => (
        <li key={h.day} className="hours-chip">
          <strong>{DAY_NAMES[h.day]}</strong>
          <span>
            {fmtTime(h.start)} – {fmtTime(h.end)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** One-line summary of the selected day: occasion, closure or free slots. */
function DayNote({ days, date }) {
  const info = days?.find((d) => d.date === date);
  if (!info) return <p className="cal-note muted">Select a day to see its slots.</p>;
  const occ = indianOccasions(date);
  const weekday = new Date(`${date}T12:00:00`).toLocaleString('en-IN', { weekday: 'long' });
  if (info.holiday) {
    return <p className="cal-note cal-note-closed">Clinic closed — {occ.join(', ') || 'holiday'}.</p>;
  }
  if (!info.open) return <p className="cal-note cal-note-closed">Doctor is not working this day.</p>;
  return (
    <p className="cal-note">
      {weekday}, {date} · Saka {sakaCaption(date)} — {info.available} of {info.total} slots free.
    </p>
  );
}

/**
 * Day slot grid for one doctor + confirm booking form.
 * Handles 409 plainly: the slot was lost while the user decided, so we
 * refresh the grid and say so (module 4 frontend requirement).
 */
export default function DoctorDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const { toast } = useToast();
  const [doctor, setDoctor] = useState(null);
  const [grid, setGrid] = useState(null);
  const [date, setDate] = useState(() => toISODate(new Date()));
  const [month, setMonth] = useState(() => date.slice(0, 7));
  const [days, setDays] = useState(null);
  const [calLoading, setCalLoading] = useState(false);
  const [picked, setPicked] = useState(null);
  const [patientId, setPatientId] = useState(user.role === 'patient' ? user.patientId : '');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const loadGrid = async (d) => {
    setGrid(null);
    setError(null);
    try {
      const res = await doctorsApi.slots(id, d);
      setGrid(res.slots);
    } catch (err) {
      setError(err.message);
      setGrid([]);
    }
  };

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    doctorsApi
      .get(id)
      .then((res) => !cancelled && setDoctor(res.doctor))
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Month availability summary from the calendar API.
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setCalLoading(true);
    setDays(null);
    doctorsApi
      .calendar(id, month)
      .then((res) => !cancelled && setDays(res.days))
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setCalLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, month]);

  useEffect(() => {
    if (id) loadGrid(date);
  }, [id, date]);

  const selectMonth = (m) => {
    setMonth(m);
    const t = toISODate(new Date());
    setDate(m === t.slice(0, 7) ? t : `${m}-01`);
    setPicked(null);
    setError(null);
  };

  const confirmBooking = async () => {
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      await appointmentsApi.book(id, patientId, picked.startsAt);
      setPicked(null);
      toast(`Booked ${new Date(picked.startsAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} with ${doctor.name}`, 'success');
      await loadGrid(date); // 409-safe: re-read the real grid after a win
    } catch (err) {
      if (err.status === 409) {
        // The brief's canonical UI moment: slot taken while deciding.
        setError('That slot was just taken by someone else — the grid has been refreshed.');
        await loadGrid(date);
      } else if (err.status === 422) {
        setError(err.message);
        await loadGrid(date);
      } else {
        setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  };

  if (error && !grid && !doctor) return <ErrorBanner error={error} onDismiss={() => setError(null)} />;
  if (!doctor) return <Spinner label="Loading doctor…" />;

  return (
    <div className="page">
      <p>
        <Link to="/doctors" className="back-link">
          ← All doctors
        </Link>
      </p>
      <div className="page-head">
        <div>
          <h1>{doctor.name}</h1>
          <p className="speciality">{doctor.speciality}</p>
        </div>
      </div>

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      <div className="card hours-card">
        <div className="hours-head">
          <span className="field-label">Working hours</span>
          <span className="muted small">{doctor.slotMinutes} min slots</span>
        </div>
        <WorkingHoursStrip hours={doctor.workingHours} />
      </div>

      <div className="card cal-card">
        <BookingCalendar
          month={month}
          days={days}
          selected={date}
          loading={calLoading}
          onPrev={() => selectMonth(addMonths(month, -1))}
          onNext={() => selectMonth(addMonths(month, 1))}
          onToday={() => selectMonth(toISODate(new Date()).slice(0, 7))}
          onSelectDay={(d) => {
            setError(null);
            setPicked(null);
            setDate(d);
          }}
        />
        <DayNote days={days} date={date} />
      </div>

      {!grid ? <Spinner label="Loading availability…" /> : <SlotGrid slots={grid} onPick={(s) => { setError(null); setPicked(s); }} />}

      {picked ? (
        <form
          className="card booking-form"
          onSubmit={(e) => {
            e.preventDefault();
            confirmBooking();
          }}
        >
          <h2>Confirm booking</h2>
          <p className="muted">
            {new Date(picked.startsAt).toLocaleString([], { dateStyle: 'full', timeStyle: 'short' })} · {doctor.slotMinutes} min
          </p>
          {user.role !== 'patient' ? (
            <label className="field">
              <span className="field-label">Patient</span>
              <input value={patientId} onChange={(e) => setPatientId(e.target.value)} placeholder="Patient id" required />
            </label>
          ) : (
            <p className="muted">You are booking for yourself.</p>
          )}
          <div className="row">
            <button className="btn btn-primary" type="submit" disabled={busy || !patientId}>
              {busy ? 'Booking…' : 'Confirm booking'}
            </button>
            <button className="btn" type="button" onClick={() => setPicked(null)}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}