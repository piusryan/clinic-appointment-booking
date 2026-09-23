import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth.js';

const NAV = {
  patient: [
    { to: '/dashboard', label: 'Dashboard' },
    { to: '/doctors', label: 'Find a Doctor' },
    { to: '/appointments', label: 'My Appointments' },
    { to: '/account', label: 'My Account' },
  ],
  doctor: [
    { to: '/dashboard', label: 'Dashboard' },
    { to: '/doctors', label: 'Browse Doctors' },
    { to: '/appointments', label: 'My Schedule' },
    { to: '/account', label: 'My Account' },
  ],
  receptionist: [
    { to: '/dashboard', label: 'Dashboard' },
    { to: '/doctors', label: 'Doctors' },
    { to: '/appointments', label: 'Day Schedule' },
    { to: '/admin/doctors', label: 'Manage Doctors' },
    { to: '/patients', label: 'Patients' },
  ],
  admin: [
    { to: '/dashboard', label: 'Dashboard' },
    { to: '/doctors', label: 'Doctors' },
    { to: '/appointments', label: 'Appointments' },
    { to: '/admin/doctors', label: 'Manage Doctors' },
    { to: '/patients', label: 'Patients' },
    { to: '/holidays', label: 'Holidays' },
    { to: '/audit', label: 'Audit Trail' },
    { to: '/account', label: 'My Account' },
  ],
};

export default function NavBar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  if (!user) return null;
  const links = NAV[user.role] ?? [];

  const onLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <header className="nav">
      <div className="nav-brand">
        <span className="nav-dot">
          <img src="/images/logo.png" alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
        </span>
        Clinic Booking
      </div>
      <nav className="nav-links">
        {links.map((l) => (
          <NavLink key={l.to} to={l.to} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
            {l.label}
          </NavLink>
        ))}
      </nav>
      <div className="nav-user">
        <span className="nav-role">{user.role}</span>
        <span className="nav-email">{user.email}</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onLogout}>
          Log out
        </button>
      </div>
    </header>
  );
}