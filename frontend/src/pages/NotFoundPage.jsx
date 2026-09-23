import React from 'react';
import { Link, useLocation } from 'react-router-dom';

export default function NotFoundPage() {
  const { pathname } = useLocation();
  return (
    <div className="page page-center">
      <div className="card notfound">
        <p className="notfound-code">404</p>
        <h1>Page not found</h1>
        <p className="muted">
          We couldn't find anything at <code>{pathname}</code>.
        </p>
        <Link className="btn btn-primary" to="/doctors">
          Back to doctors
        </Link>
      </div>
    </div>
  );
}
