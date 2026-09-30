import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/useAuth.js';
import { appointmentsApi, doctorsApi } from '../api/client.js';
import { localDateKey } from '../lib/dates';
import Spinner from '../components/Spinner.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';

const HERO = {
  patient: {
    title: 'Welcome back',
    subtitle: 'Find a doctor and book your next visit in seconds.',
    cta: { to: '/doctors', label: 'Find a doctor' },
  },
  doctor: {
    title: 'Your practice',
    subtitle: 'See today’s appointments and manage your schedule.',
    cta: { to: '/appointments', label: 'Open my schedule' },
  },
  receptionist: {
    title: 'Reception desk',
    subtitle: 'Manage the day ahead and keep the clinic running smoothly.',
    cta: { to: '/appointments', label: 'View day schedule' },
  },
  admin: {
    title: 'Clinic control room',
    subtitle: 'Oversee doctors, patients, closures and bookings from one place.',
    cta: { to: '/admin/doctors', label: 'Manage doctors' },
  },
};

const STAT_LABELS = {
  booked: 'Booked',
  completed: 'Completed',
  cancelled: 'Cancelled',
  'no-show': 'No-show',
};

function ApptCard({ a }) {
  const when = new Date(a.startsAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <Link to="/appointments" className="dash-appt">
      <span className="pill pill-booked">{a.status}</span>
      <span className="dash-appt-when">{when}</span>
      <span className="dash-appt-name">{a.doctor?.name}</span>
    </Link>
  );
}

function QuickLink({ to, label, desc }) {
  return (
    <Link to={to} className="card dash-quick">
      <strong>{label}</strong>
      <span className="muted small">{desc}</span>
    </Link>
  );
}

function Stats({ counts }) {
  return (
    <div className="dash-stats">
      {Object.entries(counts).map(([k, v]) => (
        <div key={k} className="card dash-stat">
          <span className="dash-stat-num">{v}</span>
          <span className="dash-stat-label">{STAT_LABELS[k] ?? k}</span>
        </div>
      ))}
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [appts, setAppts] = useState(null);
  // Local "today" — see lib/dates.js. toISOString() would be UTC and could be
  // the wrong calendar day for a viewer east of Greenwich.
  const [date, setDate] = useState(() => localDateKey());
  const [error, setError] = useState(null);

  const isPatient = user.role === 'patient';
  const isDoctor = user.role === 'doctor';
  const isStaff = user.role === 'admin' || user.role === 'receptionist';

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setError(null);
      try {
        if (isDoctor) {
          const res = await doctorsApi.schedule(user.doctorId, date);
          if (!cancelled) setAppts(res.schedule);
        } else {
          const res = await appointmentsApi.list();
          if (!cancelled) setAppts(res.appointments);
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [isDoctor, isPatient, user.doctorId, date]);

  const hero = HERO[user.role];

  const stats = useMemo(() => {
    if (!appts) return null;
    if (isPatient) {
      const upcoming = appts.filter((a) => a.status === 'booked');
      return { booked: upcoming.length };
    }
    const counts = {};
    for (const a of appts) counts[a.status] = (counts[a.status] ?? 0) + 1;
    return counts;
  }, [appts, isPatient]);

  if (!appts) return <Spinner label="Loading dashboard…" />;

  const list = appts.slice(0, 6);

  return (
    <div className="dash">
      <div className="dash-hero">
        <div>
          <p className="dash-eyebrow">{user.role}</p>
          <h1>
            {hero.title}, {user.email.split('@')[0]}
          </h1>
          <p className="dash-sub">{hero.subtitle}</p>
        </div>
        <Link to={hero.cta.to} className="btn btn-hero">
          {hero.cta.label}
        </Link>
      </div>

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      {stats ? <Stats counts={stats} /> : null}

      <div className="dash-body">
        <section className="card dash-section">
          <div className="dash-section-head">
            <h2>{isPatient ? 'Your upcoming appointments' : isDoctor ? `Schedule — ${date}` : 'Recent appointments'}</h2>
            {isDoctor ? (
              <label className="filter">
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </label>
            ) : null}
          </div>

          {list.length === 0 ? (
            <p className="muted">
              Nothing here yet.{' '}
              {isPatient ? (
                <Link to="/doctors">Find a doctor to book your first appointment.</Link>
              ) : null}
            </p>
          ) : (
            <div className="dash-appts">
              {list.map((a) => (
                <ApptCard key={a.id} a={a} />
              ))}
            </div>
          )}
        </section>

        {isStaff || isDoctor ? (
          <aside className="dash-side">
            <h2 className="dash-side-title">Quick actions</h2>
            <div className="dash-quicks">
              {isAdminQuickLinks(user.role).map((q) => (
                <QuickLink key={q.to} {...q} />
              ))}
            </div>
          </aside>
        ) : (
          <aside className="dash-side">
            <h2 className="dash-side-title">Browse</h2>
            <div className="dash-quicks">
              <QuickLink to="/doctors" label="All doctors" desc="See the full team and their hours" />
              <QuickLink to="/appointments" label="My appointments" desc="Manage or reschedule your visits" />
              <QuickLink to="/account" label="My account" desc="Update your password" />
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

function isAdminQuickLinks(role) {
  if (role === 'admin') {
    return [
      { to: '/admin/doctors', label: 'Manage doctors', desc: 'Create & edit doctor profiles' },
      { to: '/patients', label: 'Patients', desc: 'Browse the patient directory' },
      { to: '/holidays', label: 'Clinic closures', desc: 'Block days clinic-wide or per doctor' },
      { to: '/appointments', label: 'All appointments', desc: 'Review every booking' },
    ];
  }
  return [
    { to: '/admin/doctors', label: 'Manage doctors', desc: 'Create & edit doctor profiles' },
    { to: '/patients', label: 'Patients', desc: 'Browse the patient directory' },
    { to: '/appointments', label: 'Day schedule', desc: 'Manage the day’s bookings' },
  ];
}
