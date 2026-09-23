import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './useAuth.js';

/**
 * Server-side authorization is the real control; this wrapper is only the
 * UX nicety layer: anonymous users are redirected to /login (remembering
 * where they were heading), and optionally a role gate for the nav UI.
 * A 403 from the API still applies server-side regardless of this.
 */
export default function ProtectedRoute({ children, roles }) {
  const { user, ready } = useAuth();
  const location = useLocation();

  if (!ready) {
    return (
      <div className="page">
        <div className="spinner" aria-label="loading" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/doctors" replace />;
  return children;
}