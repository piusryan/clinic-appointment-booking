import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../auth/useAuth.js';
import FormField from '../components/FormField.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import AuthLayout from '../components/AuthLayout.jsx';

const validators = {
  email: (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? null : 'Enter a valid email'),
  password: (v) => (/^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(v) ? null : '8+ chars with letters and a number'),
  phone: (v) => (/^\+?\d{7,15}$/.test(v) ? null : 'Enter a valid phone'),
  presence: (v) => (v ? null : 'Required'),
};

export default function RegisterPage() {
  const { register, login } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  const onSubmit = async (e) => {
    e.preventDefault();
    const bad =
      validators.email(form.email) ||
      validators.password(form.password) ||
      validators.phone(form.phone) ||
      validators.presence(form.name);
    if (bad) {
      setError('Please fix the highlighted fields');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await register(form);
      await login(form.email, form.password);
      navigate('/doctors', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <form className="card auth-card" onSubmit={onSubmit} noValidate>
        <h1>Register as a patient</h1>
        <ErrorBanner error={error} onDismiss={() => setError(null)} />
        <FormField label="Full name" name="name" value={form.name} onChange={set('name')} validate={validators.presence} required />
        <FormField label="Email" name="email" type="email" value={form.email} onChange={set('email')} validate={validators.email} required />
        <FormField label="Phone" name="phone" type="tel" value={form.phone} onChange={set('phone')} validate={validators.phone} required />
        <FormField label="Password" name="password" type="password" value={form.password} onChange={set('password')} validate={validators.password} required />
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Create account'}
        </button>
        <p className="muted">
          Already registered? <Link to="/login">Sign in</Link>
        </p>
      </form>
    </AuthLayout>
  );
}