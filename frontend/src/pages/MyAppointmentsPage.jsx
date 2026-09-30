import React, { useEffect, useState } from 'react';
import { appointmentsApi, doctorsApi, CLINICIAN_TRANSITIONS } from '../api/client.js';
import { useAuth } from '../auth/useAuth.js';
import Spinner from '../components/Spinner.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import { useToast } from '../components/Toast.jsx';
import { localDateKey, dateTimeLabel, timeLabel } from '../lib/dates';

/**
 * Role-adaptive "my appointments":
 *  - patient: own bookings with cancel + reschedule
 *  - doctor: their own schedule (patients named) with complete / no-show
 *  - admin/receptionist: everything, filterable by patient (id)
 *
 * The clinician buttons are built from CLINICIAN_TRANSITIONS, the same closed
 * set the route's enum rule enforces, so this page cannot offer a transition
 * the server answers with a 400.
 */
const TRANSITION_LABELS = { completed: 'Mark complete', 'no-show': 'No-show' };
const TRANSITION_TOAST = { completed: 'Marked complete', 'no-show': 'Marked no-show' };

export default function MyAppointmentsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [rows, setRows] = useState(null);
  // localDateKey(), never new Date().toISOString().slice(0,10): toISOString
  // converts to UTC, so a user east of Greenwich opening this page late in the
  // evening would be looking at tomorrow's schedule, and a user west of it
  // would be looking at a date that has not started in Dublin yet.
  const [scheduleDate, setScheduleDate] = useState(() => localDateKey());
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  // Reschedule flow
  const [reschedId, setReschedId] = useState(null);
  const [reschedDate, setReschedDate] = useState(() => localDateKey());
  const [reschedSlots, setReschedSlots] = useState(null);
  const [pickedSlot, setPickedSlot] = useState(null);
  const [reschedBusy, setReschedBusy] = useState(false);

  // Cancel confirmation flow
  const [pendingCancel, setPendingCancel] = useState(null);
  const [cancelling, setCancelling] = useState(false);

  const load = async () => {
    setError(null);
    try {
      if (user.role === 'doctor') {
        const res = await doctorsApi.schedule(user.doctorId, scheduleDate);
        setRows(res.schedule);
      } else {
        const res = await appointmentsApi.list();
        setRows(res.appointments);
      }
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    if (user) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role, scheduleDate]);

  const act = async (id, fn) => {
    setBusyId(id);
    setError(null);
    try {
      await fn(id);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const setStatus = async (id, status) => {
    setBusyId(id);
    setError(null);
    try {
      await appointmentsApi.status(id, status);
      toast(TRANSITION_TOAST[status], 'success');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  // Open the reschedule panel and load that doctor's slots for the chosen date.
  const openReschedule = async (appt) => {
    setReschedId(appt.id);
    setPickedSlot(null);
    setError(null);
    await loadSlotsFor(appt.doctor?.id, reschedDate);
  };

  const loadSlotsFor = async (doctorId, date) => {
    if (!doctorId) return;
    setReschedSlots(null);
    try {
      const res = await doctorsApi.slots(doctorId, date);
      setReschedSlots(res.slots);
    } catch (err) {
      setError(err.message);
      setReschedSlots([]);
    }
  };

  const confirmReschedule = async () => {
    if (!reschedId || !pickedSlot) return;
    setReschedBusy(true);
    setError(null);
    try {
      await appointmentsApi.reschedule(reschedId, pickedSlot.startsAt);
      setReschedId(null);
      setPickedSlot(null);
      setReschedSlots(null);
      toast('Appointment rescheduled', 'success');
      await load();
    } catch (err) {
      if (err.status === 409) {
        setError('That slot was just taken — the grid has been refreshed.');
        await loadSlotsFor(rows.find((r) => r.id === reschedId)?.doctor?.id, reschedDate);
      } else {
        setError(err.message);
      }
    } finally {
      setReschedBusy(false);
    }
  };

  const closeReschedule = () => {
    setReschedId(null);
    setPickedSlot(null);
    setReschedSlots(null);
    setError(null);
  };

  const confirmCancel = async () => {
    if (!pendingCancel) return;
    setCancelling(true);
    setError(null);
    try {
      await appointmentsApi.cancel(pendingCancel);
      setPendingCancel(null);
      toast('Appointment cancelled', 'info');
      await load();
    } catch (err) {
      setError(err.message);
      setPendingCancel(null);
    } finally {
      setCancelling(false);
    }
  };

  if (error) return <ErrorBanner error={error} onDismiss={() => setError(null)} />;
  if (!rows) return <Spinner label="Loading…" />;

  const fmt = (iso) => dateTimeLabel(iso);
  const statusClass = (s) => `pill pill-${s}`;
  const reschedAppt = rows.find((r) => r.id === reschedId);

  return (
    <div className="page">
      <div className="page-head">
        <h1>
          {user.role === 'doctor' ? 'My schedule' : user.role === 'patient' ? 'My appointments' : 'All appointments'}
        </h1>
        {user.role === 'doctor' ? (
          <label className="filter">
            <span className="field-label">Date</span>
            <input type="date" value={scheduleDate} onChange={(e) => setScheduleDate(e.target.value)} />
          </label>
        ) : null}
      </div>

      <div className="page-banner banner-appointments">
        <h2>Stay on top of your visits</h2>
        <p className="muted">
          Review upcoming appointments, reschedule to a better time or free a slot you can't make.
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="muted">
          {user.role === 'doctor' ? 'Nothing scheduled for this day.' : 'No appointments yet.'}
        </p>
      ) : (
        <ul className="appt-list">
          {rows.map((a) => (
            <li key={a.id} className="card appt-row">
              <div className="appt-main">
                <span className={statusClass(a.status)}>{a.status}</span>
                <span className="appt-when">{fmt(a.startsAt)}</span>
              </div>
              <div className="appt-detail">
                <span>{a.doctor?.name}</span>
                {a.patient ? <span>{a.patient.name}</span> : null}
              </div>
              <div className="appt-actions">
                {a.status === 'booked' && (user.role === 'patient' || user.role === 'receptionist' || user.role === 'admin') ? (
                  <>
                    <button
                      className="btn btn-sm"
                      type="button"
                      disabled={busyId === a.id}
                      onClick={() => openReschedule(a)}
                    >
                      Reschedule
                    </button>
                    <button
                      className="btn btn-sm btn-danger"
                      type="button"
                      disabled={busyId === a.id}
                      onClick={() => setPendingCancel(a.id)}
                    >
                      Cancel
                    </button>
                  </>
                ) : null}
                {user.role === 'doctor' && a.status === 'booked' ? (
                  CLINICIAN_TRANSITIONS.map((transition) => (
                    <button
                      key={transition}
                      className={transition === 'no-show' ? 'btn btn-sm btn-ghost' : 'btn btn-sm'}
                      type="button"
                      disabled={busyId === a.id}
                      onClick={() => setStatus(a.id, transition)}
                    >
                      {TRANSITION_LABELS[transition]}
                    </button>
                  ))
                ) : null}
              </div>

              {reschedId === a.id ? (
                <div className="card resched-panel">
                  <div className="resched-head">
                    <strong>Reschedule {a.doctor?.name || 'appointment'}</strong>
                    <label className="filter resched-date">
                      <span className="field-label">New date</span>
                      <input
                        type="date"
                        value={reschedDate}
                        onChange={(e) => {
                          setReschedDate(e.target.value);
                          loadSlotsFor(a.doctor?.id, e.target.value);
                        }}
                      />
                    </label>
                  </div>

                  {reschedSlots === null ? (
                    <Spinner label="Loading availability…" />
                  ) : reschedSlots.length === 0 ? (
                    <p className="muted">No availability on this day.</p>
                  ) : (
                    <ul className="slot-grid resched-grid">
                      {reschedSlots.map((slot) => {
                        const taken = !slot.available;
                        const selected = pickedSlot?.startsAt === slot.startsAt;
                        return (
                          <li key={slot.startsAt}>
                            <button
                              type="button"
                              className={`slot${taken ? ' slot-taken' : ' slot-free'}${selected ? ' slot-selected' : ''}`}
                              disabled={taken}
                              onClick={() => setPickedSlot(slot)}
                            >
                              <span className="slot-time">{timeLabel(slot.startsAt)}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  <div className="row resched-actions">
                    <button
                      className="btn btn-primary"
                      type="button"
                      disabled={reschedBusy || !pickedSlot}
                      onClick={confirmReschedule}
                    >
                      {reschedBusy ? 'Saving…' : 'Confirm new time'}
                    </button>
                    <button className="btn" type="button" disabled={reschedBusy} onClick={closeReschedule}>
                      Cancel
                    </button>
                    {reschedAppt?.startsAt ? <span className="muted">Current: {fmt(reschedAppt.startsAt)}</span> : null}
                  </div>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={pendingCancel !== null}
        title="Cancel appointment?"
        message="This booking will be cancelled and its slot freed for others. This can't be undone."
        confirmLabel="Cancel appointment"
        busy={cancelling}
        onConfirm={confirmCancel}
        onCancel={() => setPendingCancel(null)}
      />
    </div>
  );
}
