import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { doctorsApi, appointmentsApi } from '../api/client.js';
import { useAuth } from '../auth/useAuth.js';
import Spinner from '../components/Spinner.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import SlotGrid from '../components/SlotGrid.jsx';
import WeekGrid, { WeekSummary } from '../components/WeekGrid.jsx';
import BookingCalendar from '../components/BookingCalendar.jsx';
import { useToast } from '../components/Toast.jsx';
import { addMonths, indianOccasions, sakaCaption } from '../lib/indianCalendar.js';
import { localDateKey, localMonthKey, weekOf, addDays, dayLabel, dateTimeLabel } from '../lib/dates';

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
 *
 * Day and week share one selection model. `date` is always the anchor — in
 * week view it is the day whose column is focused, and the week shown is the
 * one containing it. That means the calendar, the day grid and the week grid
 * can never disagree about which day is selected.
 */
export default function DoctorDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const { toast } = useToast();
  const [doctor, setDoctor] = useState(null);
  const [grid, setGrid] = useState(null);
  const [date, setDate] = useState(() => localDateKey());
  const [month, setMonth] = useState(() => localMonthKey());
  const [days, setDays] = useState(null);
  const [calLoading, setCalLoading] = useState(false);
  const [picked, setPicked] = useState(null);
  const [patientId, setPatientId] = useState(user.role === 'patient' ? user.patientId : '');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState('day');
  const [week, setWeek] = useState(null);
  const [weekLoading, setWeekLoading] = useState(false);

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

  /**
   * Week data: one request per day, in parallel, only while the week view is
   * actually open. A day with no availability comes back as an empty array
   * (a closure, or a day the doctor does not work), which the grid renders as
   * "Closed" — the same answer the day view gives.
   */
  useEffect(() => {
    if (!id || view !== 'week') return;
    let cancelled = false;
    const keys = weekOf(date);
    setWeekLoading(true);
    setWeek(null);
    Promise.all(
      keys.map(async (key) => {
        try {
          const res = await doctorsApi.slots(id, key);
          return [key, res.slots];
        } catch {
          return [key, []];
        }
      })
    )
      .then((pairs) => {
        if (cancelled) return;
        setWeek(Object.fromEntries(pairs));
      })
      .finally(() => {
        if (!cancelled) setWeekLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, view, date]);

  const selectMonth = (m) => {
    setMonth(m);
    const t = localDateKey();
    setDate(m === localMonthKey() ? t : `${m}-01`);
    setPicked(null);
    setError(null);
  };

  const stepWeek = (delta) => {
    setDate((d) => addDays(d, delta * 7));
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
      toast(`Booked ${dateTimeLabel(picked.startsAt)} with ${doctor.name}`, 'success');
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
          onToday={() => selectMonth(localMonthKey())}
          onSelectDay={(d) => {
            setError(null);
            setPicked(null);
            setDate(d);
          }}
        />
        <DayNote days={days} date={date} />
      </div>

      <div className="card slots-card">
        <div className="slots-head">
          <div className="segmented" role="group" aria-label="Availability range">
            <button
              type="button"
              className={view === 'day' ? 'seg seg-active' : 'seg'}
              aria-pressed={view === 'day'}
              onClick={() => setView('day')}
            >
              Day
            </button>
            <button
              type="button"
              className={view === 'week' ? 'seg seg-active' : 'seg'}
              aria-pressed={view === 'week'}
              onClick={() => setView('week')}
            >
              Week
            </button>
          </div>

          {view === 'week' ? (
            <div className="week-nav">
              <button type="button" className="btn btn-small" onClick={() => stepWeek(-1)}>
                ← Previous week
              </button>
              <span className="muted small">
                {dayLabel(weekOf(date)[0])} – {dayLabel(weekOf(date)[6])}
              </span>
              <button type="button" className="btn btn-small" onClick={() => stepWeek(1)}>
                Next week →
              </button>
            </div>
          ) : (
            <span className="muted small">{dayLabel(date)}</span>
          )}
        </div>

        {view === 'day' ? (
          !grid ? (
            <Spinner label="Loading availability…" />
          ) : (
            <SlotGrid slots={grid} onPick={(s) => { setError(null); setPicked(s); }} />
          )
        ) : weekLoading || !week ? (
          <Spinner label="Loading the week…" />
        ) : (
          <>
            <WeekSummary days={weekOf(date)} byDay={week} />
            <WeekGrid
              days={weekOf(date)}
              byDay={week}
              onPick={(s) => { setError(null); setPicked(s); }}
              onSelectDay={(key) => { setError(null); setPicked(null); setDate(key); }}
            />
          </>
        )}
      </div>

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
            {dateTimeLabel(picked.startsAt)} · {doctor.slotMinutes} min
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