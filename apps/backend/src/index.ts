import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';

dotenv.config();

// Validate critical environment variables at startup
const REQUIRED_ENV = ['JWT_SECRET', 'DATABASE_URL', 'OPERATOR_JWT_SECRET', 'ADMIN_JWT_SECRET'];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`FATAL: Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

import { healthRouter } from './routes/health';
import { authRouter } from './routes/auth';
import { vehicleRouter } from './routes/vehicles';
import { walletRouter } from './routes/wallet';
import { adminRouter } from './routes/admin';
import { sessionRouter } from './routes/sessions';
import { operatorRouter } from './routes/operator';
import { operatorAuthRouter } from './routes/operatorAuth';
import { adminAuthRouter } from './routes/adminAuth';
import { paymentMethodsRouter } from './routes/paymentMethods';
import { facilitiesRouter } from './routes/facilities';
import { processExpiredDebts } from './services/debtWorker';

const app = express();

const httpServer = createServer(app);

// ─── Socket.io (real-time operator dashboard) ────────────────────────────────
export const io = new Server(httpServer, {
  cors: {
    origin: process.env.DASHBOARD_URL || 'http://localhost:3000',
    methods: ['GET', 'POST'],
  },
});

io.on('connection', (socket) => {
  console.log(`[Socket.io] Client connected: ${socket.id}`);

  socket.on('join:facility', (facilityId: string) => {
    socket.join(`facility:${facilityId}`);
    console.log(`[Socket.io] ${socket.id} joined facility room: ${facilityId}`);
  });

  socket.on('disconnect', () => {
    console.log(`[Socket.io] Client disconnected: ${socket.id}`);
  });
});

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/health', healthRouter);
app.use('/api/auth', authRouter);
app.use('/api/operator-auth', operatorAuthRouter);
app.use('/api/admin-auth', adminAuthRouter);
app.use('/api/vehicles', vehicleRouter);
app.use('/api/wallet', walletRouter);
app.use('/api/admin', adminRouter);
app.use('/api/sessions', sessionRouter);
app.use('/api/operator', operatorRouter);
app.use('/api/payment-methods', paymentMethodsRouter);
app.use('/api/facilities', facilitiesRouter);


// ─── 404 Handler ─────────────────────────────────────────────────────────────
app.use((_req: Request, res: Response) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

// ─── Global Error Handler ─────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[Error]', err.message);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

// ─── Debt Worker Scheduler ────────────────────────────────────────────────────
let debtWorkerRunning = false;

export async function runDebtWorkerSafe(): Promise<void> {
  if (debtWorkerRunning) {
    console.log('[DebtWorker] Skipping — previous run still in progress');
    return;
  }
  debtWorkerRunning = true;
  try {
    const result = await processExpiredDebts();
    if (result.walletsChecked > 0) {
      console.log(
        `[DebtWorker] Processed ${result.walletsChecked} expired wallets: ` +
        `${result.autopaySucceeded} autopay recovered, ${result.autopayFailed} failed/suspended.`
      );
    }
  } catch (err) {
    console.error('[DebtWorker] Background job error:', err);
  } finally {
    debtWorkerRunning = false;
  }
}

// ─── Start Server ─────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '4000', 10);

if (process.env.NODE_ENV !== 'test') {
  httpServer.listen(PORT, () => {
    console.log(`\n🚗 Parking System Backend running on http://localhost:${PORT}`);
    console.log(`📋 Health check: http://localhost:${PORT}/health`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}\n`);
  });

  // Delay initial debt worker run by 60s to let DB pool initialize, then repeat every 15 mins
  setTimeout(() => {
    runDebtWorkerSafe();
    setInterval(runDebtWorkerSafe, 15 * 60 * 1000);
  }, 60_000);
}


export { app, httpServer };
export default app;
