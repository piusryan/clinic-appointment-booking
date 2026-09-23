import React, { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../auth/useAuth.js';
import FormField from '../components/FormField.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import AuthLayout from '../components/AuthLayout.jsx';

const validators = {
  email: (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? null : 'Enter a valid email'),
  password: (v) => (v.length >= 8 ? null : 'At least 8 characters'),
  presence: (v) => (v ? null : 'Required'),
};

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from ?? '/doctors';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    if (validators.email(email) || validators.password(password)) {
      setError('Please fix the highlighted fields');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <form className="card auth-card" onSubmit={onSubmit} noValidate>
        <h1>Welcome back</h1>
        <ErrorBanner error={error} onDismiss={() => setError(null)} />
        <FormField
          label="Email"
          name="email"
          type="email"
          value={email}
          onChange={setEmail}
          validate={validators.email}
          required
        />
        <FormField
          label="Password"
          name="password"
          type="password"
          value={password}
          onChange={setPassword}
          validate={validators.password}
          required
        />
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="muted">
          New patient? <Link to="/register">Register</Link>
        </p>
      </form>
    </AuthLayout>
  );
}