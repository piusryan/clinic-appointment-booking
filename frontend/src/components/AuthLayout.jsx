import React from 'react';

export default function AuthLayout({ children }) {
  return (
    <div className="auth-shell">
      <div className="auth-media">
        <div className="auth-media-inner">
          <p className="auth-media-eyebrow">Clinic Booking</p>
          <h1>Care that fits around your schedule</h1>
          <p className="auth-media-sub">
            Browse doctors, check live availability and book your next appointment
            in seconds — no phone calls required.
          </p>
        </div>
      </div>
      <div className="auth-main">{children}</div>
    </div>
  );
}