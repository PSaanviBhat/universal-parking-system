import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';

import { healthRouter } from './routes/health';
import { authRouter } from './routes/auth';
import { vehicleRouter } from './routes/vehicles';

dotenv.config();

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
app.use('/api/vehicles', vehicleRouter);
app.use('/api/wallet', (_req, res) => res.json({ message: 'Wallet routes — Phase 4' }));
app.use('/api/sessions', (_req, res) => res.json({ message: 'Session routes — Phase 6/7' }));
app.use('/api/operator', (_req, res) => res.json({ message: 'Operator routes — Phase 8' }));
app.use('/api/admin', (_req, res) => res.json({ message: 'Admin routes — Phase 5' }));

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

// ─── Start Server ─────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '4000', 10);

if (process.env.NODE_ENV !== 'test') {
  httpServer.listen(PORT, () => {
    console.log(`\n🚗 Parking System Backend running on http://localhost:${PORT}`);
    console.log(`📋 Health check: http://localhost:${PORT}/health`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}\n`);
  });
}

export { app, httpServer };
export default app;
