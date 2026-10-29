import { Router, Request, Response } from 'express';
import { prisma } from '../utils/prisma';

export const healthRouter = Router();

/**
 * GET /health/live
 * Liveness only — no database query. Point uptime pingers here so they keep the
 * Render instance awake without also waking the Neon database every few minutes.
 */
healthRouter.get('/live', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', uptime: Math.floor(process.uptime()) });
});

/**
 * GET /health
 * Returns system health status including DB connectivity.
 * Used by monitoring tools and deployment checks.
 */
healthRouter.get('/', async (_req: Request, res: Response) => {
  const startTime = Date.now();

  let dbStatus: 'connected' | 'error' = 'error';
  let dbMessage = '';

  try {
    // Simple DB ping — counts users without loading data
    await prisma.$queryRaw`SELECT 1`;
    dbStatus = 'connected';
    dbMessage = 'PostgreSQL connection OK';
  } catch (err) {
    dbMessage = err instanceof Error ? err.message : 'Unknown DB error';
  }

  const responseTime = Date.now() - startTime;

  res.status(dbStatus === 'connected' ? 200 : 503).json({
    success: dbStatus === 'connected',
    status: dbStatus === 'connected' ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    responseTimeMs: responseTime,
    services: {
      database: {
        status: dbStatus,
        message: dbMessage,
      },
    },
    system: {
      nodeVersion: process.version,
      environment: process.env.NODE_ENV || 'development',
      uptime: Math.floor(process.uptime()),
    },
  });
});
