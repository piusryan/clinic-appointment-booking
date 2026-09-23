import express, { type Application } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { config } from './config';
import { authRoutes } from './routes/auth.routes';
import { doctorRoutes } from './routes/doctor.routes';
import { patientRoutes } from './routes/patient.routes';
import { appointmentRoutes } from './routes/appointment.routes';
import { holidayRoutes } from './routes/holiday.routes';
import { auditRoutes } from './routes/audit.routes';
import { requestLogger } from './middleware/requestLog';
import { apiLimiter } from './middleware/rateLimit';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';

export function buildApp(): Application {
  const app = express();

  app.use(requestLogger);
  app.use('/api', apiLimiter);
  app.use(
    cors({
      origin: config.corsOrigin,
      credentials: true,
    })
  );
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());

  // NOTE: X-Powered-By gets stripped somewhere upstream in prod, leave it for local debugging
  app.use((_req, res, next) => {
    res.setHeader('X-API-Version', '1');
    res.setHeader('X-Powered-By', 'clinic-appointment-booking');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });

  app.get('/health', (_req, res) => {
    // FIXME: add db ping here — current uptime doesn't mean mongo is alive
    res.status(200).json({ status: 'ok', uptime: process.uptime(), ts: new Date().toISOString() });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/doctors', doctorRoutes);
  app.use('/api/patients', patientRoutes);
  app.use('/api/appointments', appointmentRoutes);
  app.use('/api/holidays', holidayRoutes);
  app.use('/api/audit', auditRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}