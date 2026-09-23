import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import NavBar from './components/NavBar.jsx';
import ProtectedRoute from './auth/ProtectedRoute.jsx';
import { useAuth } from './auth/useAuth.js';
import LoginPage from './pages/LoginPage.jsx';
import RegisterPage from './pages/RegisterPage.jsx';
import DoctorsPage from './pages/DoctorsPage.jsx';
import DoctorDetailPage from './pages/DoctorDetailPage.jsx';
import MyAppointmentsPage from './pages/MyAppointmentsPage.jsx';
import AdminDoctorsPage from './pages/AdminDoctorsPage.jsx';
import AdminPatientsPage from './pages/AdminPatientsPage.jsx';
import HolidaysPage from './pages/HolidaysPage.jsx';
import NotFoundPage from './pages/NotFoundPage.jsx';
import AccountPage from './pages/AccountPage.jsx';
import AuditPage from './pages/AuditPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';

export default function App() {
  const { user } = useAuth();
  const theme = user ? `theme-${user.role}` : 'theme-patient';

  return (
    <div className={`app ${theme}`}>
      <NavBar />
      <main className="main">
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <DashboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/doctors"
            element={
              <ProtectedRoute>
                <DoctorsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/doctors/:id"
            element={
              <ProtectedRoute>
                <DoctorDetailPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/appointments"
            element={
              <ProtectedRoute>
                <MyAppointmentsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/account"
            element={
              <ProtectedRoute>
                <AccountPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/patients"
            element={
              <ProtectedRoute roles={['admin', 'receptionist']}>
                <AdminPatientsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/doctors"
            element={
              <ProtectedRoute roles={['admin', 'receptionist']}>
                <AdminDoctorsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/holidays"
            element={
              <ProtectedRoute roles={['admin']}>
                <HolidaysPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/audit"
            element={
              <ProtectedRoute roles={['admin']}>
                <AuditPage />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
    </div>
  );
}