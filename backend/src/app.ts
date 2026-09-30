import express, { type Application, type Request, type Response } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import mongoose from 'mongoose';
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

  // Custom response headers. The default Express `X-Powered-By` is replaced
  // rather than leaked, so the stack is not advertised.
  app.use((_req: Request, res: Response, next: () => void) => {
    res.setHeader('X-API-Version', config.apiVersion);
    res.setHeader('X-Powered-By', 'clinic-appointment-booking');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });

  /**
   * Liveness + readiness in one probe. The DB check is a real round-trip, not
   * a flag read: reporting 200 while Mongo is unreachable turns a load
   * balancer's health check into a lie, and this build runs on a replica set
   * where every write needs the primary. 200 = serving, 503 = not yet.
   */
  app.get('/health', async (_req: Request, res: Response) => {
    const dbUp = mongoose.connection.readyState === 1;
    let pinged = false;
    if (dbUp) {
      try {
        await mongoose.connection.db?.admin().ping();
        pinged = true;
      } catch {
        pinged = false;
      }
    }
    const ready = dbUp && pinged;
    res.status(ready ? 200 : 503).json({
      status: ready ? 'ok' : 'degraded',
      db: { connected: dbUp, pinged },
      uptime: process.uptime(),
      ts: new Date().toISOString(),
    });
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
