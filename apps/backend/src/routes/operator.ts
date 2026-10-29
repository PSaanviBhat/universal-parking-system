import { Router, Request, Response } from 'express';
import { prisma } from '../utils/prisma';
import { io } from '../index';
import { Prisma, SessionStatus, PaymentStatus, SlotStatus, TransactionType } from '@prisma/client';
import { operatorAuthGuard } from '../middleware/auth';
import {
  calculateFee,
  creditWallet,
  debitWallet,
  isStaleSession,
  releaseSlotForSession,
  settleSessionCharge,
  staleCutoff,
  startOfToday,
  SESSION_ALREADY_CLOSED,
} from '../services/billing';

export const operatorRouter = Router();

// Apply operator auth guard to all operator endpoints
operatorRouter.use(operatorAuthGuard);

const SESSION_STATUSES = Object.values(SessionStatus) as string[];

/** Parses ?status=, defaulting to ACTIVE. Returns null for unknown values. */
function parseStatusQuery(status: unknown): SessionStatus | null {
  if (status === undefined || status === '') return SessionStatus.ACTIVE;
  const value = String(status).toUpperCase();
  return SESSION_STATUSES.includes(value) ? (value as SessionStatus) : null;
}

function parseLimit(limit: unknown, fallback?: number): number | undefined {
  const n = parseInt(String(limit ?? ''), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, 200);
}

const operatorSessionInclude = {
  vehicle: { select: { licensePlate: true, nickname: true } },
  user: { select: { id: true, name: true, phone: true } },
  slot: { select: { slotNumber: true, level: { select: { displayName: true, levelCode: true } } } },
  entryGate: { select: { gateName: true } },
  exitGate: { select: { gateName: true } },
} satisfies Prisma.ParkingSessionInclude;

type OperatorSession = Prisma.ParkingSessionGetPayload<{ include: typeof operatorSessionInclude }>;

function formatOperatorSession(s: OperatorSession, now: Date) {
  const endTime = s.exitTime ? new Date(s.exitTime) : now;
  const live = calculateFee(s.entryTime, endTime, Number(s.feeRateSnapshot));
  const finalFee = s.totalFee !== null && s.totalFee !== undefined ? Number(s.totalFee) : live.fee;

  return {
    id: s.id,
    sessionId: s.id,
    licensePlate: s.vehicle.licensePlate,
    vehicleNickname: s.vehicle.nickname,
    vehicle: { licensePlate: s.vehicle.licensePlate, nickname: s.vehicle.nickname },
    userName: s.user.name,
    userPhone: s.user.phone,
    slotNumber: s.slot.slotNumber,
    parkingSlot: { slotNumber: s.slot.slotNumber },
    levelName: s.slot.level.displayName,
    levelCode: s.slot.level.levelCode,
    entryGate: s.entryGate.gateName,
    exitGate: s.exitGate?.gateName || null,
    entryTime: s.entryTime,
    exitTime: s.exitTime,
    durationMinutes: s.durationMinutes ?? live.durationMinutes,
    duration: live.durationMs,
    hourlyRate: Number(s.feeRateSnapshot),
    runningFee: finalFee,
    fee: finalFee,
    totalFee: finalFee,
    status: s.status,
    paymentStatus: s.paymentStatus,
    resolutionNote: s.resolutionNote,
    isStale: s.status === SessionStatus.ACTIVE && isStaleSession(s.entryTime, now),
  };
}

/**
 * GET /api/operator/stats/:facilityId
 * Retrieves real-time KPI overview for a facility:
 * - Total capacity, currently occupied, available slots
 * - Active and stale sessions
 * - Today's entries, exits, and revenue (facility time zone)
 */
operatorRouter.get('/stats/:facilityId', async (req: Request, res: Response): Promise<void> => {
  try {
    const facilityId = String(req.params.facilityId);
    const today = startOfToday();

    const [facility, totalSlots, occupiedSlots, activeSessions, staleSessions, todayEntries, completedSessions] =
      await Promise.all([
        prisma.parkingFacility.findUnique({
          where: { id: facilityId },
          select: { id: true, name: true, feeRatePerHour: true },
        }),
        prisma.parkingSlot.count({
          where: { facilityId, isActive: true },
        }),
        prisma.parkingSlot.count({
          where: { facilityId, status: SlotStatus.RESERVED_OCCUPIED, isActive: true },
        }),
        prisma.parkingSession.count({
          where: { facilityId, status: SessionStatus.ACTIVE },
        }),
        prisma.parkingSession.count({
          where: { facilityId, status: SessionStatus.ACTIVE, entryTime: { lt: staleCutoff() } },
        }),
        prisma.parkingSession.count({
          where: { facilityId, entryTime: { gte: today } },
        }),
        prisma.parkingSession.findMany({
          where: {
            facilityId,
            status: SessionStatus.COMPLETED,
            exitTime: { gte: today },
          },
          select: { totalFee: true },
        }),
      ]);

    if (!facility) {
      res.status(404).json({ success: false, message: 'Facility not found.' });
      return;
    }

    const availableSlots = Math.max(0, totalSlots - occupiedSlots);
    const occupancyPercentage = totalSlots > 0 ? Math.round((occupiedSlots / totalSlots) * 100) : 0;
    const todayRevenue = completedSessions.reduce((acc, curr) => acc + Number(curr.totalFee || 0), 0);

    res.status(200).json({
      success: true,
      data: {
        facility,
        totalSlots,
        occupiedSlots,
        availableSlots,
        occupancyPercentage,
        activeSessions,
        staleSessions,
        todayEntries,
        todayExits: completedSessions.length,
        todayRevenue,
      },
    });
  } catch (error) {
    console.error('[Operator Stats Error]', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve operator stats.' });
  }
});

/**
 * GET /api/operator/sessions
 * Query params: ?status=COMPLETED&limit=20&facilityId=xyz
 * Returns completed or filtered sessions list across facility or globally.
 */
operatorRouter.get('/sessions', async (req: Request, res: Response): Promise<void> => {
  try {
    const status = parseStatusQuery(req.query.status);
    if (!status) {
      res.status(400).json({ success: false, message: `status must be one of ${SESSION_STATUSES.join(', ')}.` });
      return;
    }

    const where: Prisma.ParkingSessionWhereInput = { status };
    if (req.query.facilityId) where.facilityId = String(req.query.facilityId);

    const sessions = await prisma.parkingSession.findMany({
      where,
      include: operatorSessionInclude,
      orderBy: status === SessionStatus.ACTIVE ? { entryTime: 'desc' } : { exitTime: 'desc' },
      take: parseLimit(req.query.limit, 20),
    });

    const now = new Date();
    res.status(200).json(sessions.map((s) => formatOperatorSession(s, now)));
  } catch (error) {
    console.error('[Operator Sessions Query Error]', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve sessions.' });
  }
});

/**
 * GET /api/operator/sessions/:facilityId
 * Lists active sessions in real-time with vehicle license plate,
 * entry time, slot, level, and dynamic running fee.
 * Also supports optional query ?status=COMPLETED|DISPUTED&limit=20
 */
operatorRouter.get('/sessions/:facilityId', async (req: Request, res: Response): Promise<void> => {
  try {
    const facilityId = String(req.params.facilityId);
    const status = parseStatusQuery(req.query.status);
    if (!status) {
      res.status(400).json({ success: false, message: `status must be one of ${SESSION_STATUSES.join(', ')}.` });
      return;
    }

    const sessions = await prisma.parkingSession.findMany({
      where: { facilityId, status },
      include: operatorSessionInclude,
      orderBy: status === SessionStatus.ACTIVE ? { entryTime: 'desc' } : { exitTime: 'desc' },
      take: parseLimit(req.query.limit),
    });

    const now = new Date();
    res.status(200).json({ success: true, data: sessions.map((s) => formatOperatorSession(s, now)) });
  } catch (error) {
    console.error('[Operator Facility Sessions Error]', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve sessions.' });
  }
});

/**
 * GET /api/operator/slots/:facilityId
 * Returns slot occupancy visual grid grouped by parking levels.
 */
operatorRouter.get('/slots/:facilityId', async (req: Request, res: Response): Promise<void> => {
  try {
    const facilityId = String(req.params.facilityId);

    const levels = await prisma.parkingLevel.findMany({
      where: { facilityId },
      include: {
        slots: {
          select: {
            id: true,
            slotNumber: true,
            status: true,
            coordinateX: true,
            coordinateY: true,
            isActive: true,
            currentSession: {
              select: {
                id: true,
                entryTime: true,
                vehicle: { select: { licensePlate: true } },
              },
            },
          },
          orderBy: { slotNumber: 'asc' },
        },
      },
      orderBy: { levelCode: 'asc' },
    });

    res.status(200).json({ success: true, data: levels });
  } catch (error) {
    console.error('[Operator Slots Error]', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve slot occupancy.' });
  }
});

const SETTLE_OUTCOMES = ['CHARGE', 'WAIVE', 'REFUND'] as const;
type SettleOutcome = (typeof SETTLE_OUTCOMES)[number];

/**
 * PATCH /api/operator/sessions/:id/resolve
 * Body: { action, outcome?, resolutionNote? }
 *
 * - FORCE_CLOSE (ACTIVE only): closes the session as an exit would (lost phone,
 *   barrier override), charges the wallet and releases the slot.
 * - DISPUTE:
 *     ACTIVE    -> clock stops, fee is frozen but NOT charged, slot released.
 *     COMPLETED -> flagged for review; the existing charge stands until settled.
 * - SETTLE_DISPUTE (DISPUTED only), outcome:
 *     CHARGE -> charge the frozen fee (uncharged disputes) or keep the existing charge.
 *     WAIVE  -> close an uncharged dispute with a ₹0 fee.
 *     REFUND -> credit an already-charged fee back to the wallet.
 *   Every outcome ends the session as COMPLETED.
 *
 * Each transition is a conditional status update, so repeated or concurrent
 * requests can never charge, refund or release twice.
 */
operatorRouter.patch('/sessions/:id/resolve', async (req: Request, res: Response): Promise<void> => {
  try {
    const sessionId = String(req.params.id);
    const { action, resolutionNote } = req.body;
    const note: string | undefined = resolutionNote ? String(resolutionNote).slice(0, 500) : undefined;

    if (!['FORCE_CLOSE', 'DISPUTE', 'SETTLE_DISPUTE'].includes(action)) {
      res.status(400).json({
        success: false,
        message: 'Valid action (FORCE_CLOSE, DISPUTE or SETTLE_DISPUTE) is required.',
      });
      return;
    }

    const session = await prisma.parkingSession.findUnique({
      where: { id: sessionId },
      include: {
        slot: { include: { level: true } },
        vehicle: true,
      },
    });

    if (!session) {
      res.status(404).json({ success: false, message: 'Parking session not found.' });
      return;
    }

    const room = `facility:${session.facilityId}`;

    // ─── FORCE_CLOSE ──────────────────────────────────────────────────────────
    if (action === 'FORCE_CLOSE') {
      if (session.status !== SessionStatus.ACTIVE) {
        res.status(409).json({
          success: false,
          message: `Only ACTIVE sessions can be force-closed (this one is ${session.status}). No charge was made.`,
        });
        return;
      }

      const result = await prisma.$transaction((tx) =>
        settleSessionCharge(tx, {
          session,
          exitTime: new Date(),
          resolutionNote: note ?? 'Force-closed by operator',
          description: (mins) =>
            `Force-closed by operator: Parking fee for ${session.vehicle.licensePlate} (${mins} mins)${note ? ` - Note: ${note}` : ''}`,
        })
      );

      io.to(room).emit('session:completed', {
        sessionId: session.id,
        licensePlate: session.vehicle.licensePlate,
        facilityId: session.facilityId,
        exitTime: result.closedSession.exitTime,
        durationMinutes: result.durationMinutes,
        totalFee: result.totalFee,
        paymentStatus: result.paymentStatus,
        isDebt: result.isDebt,
      });
      io.to(room).emit('session:resolved', {
        sessionId: session.id,
        licensePlate: session.vehicle.licensePlate,
        action: 'FORCE_CLOSE',
        resolutionNote: note || 'Manual resolution by operator',
      });
      io.to(room).emit('slot:released', {
        slotId: result.releasedSlot.id,
        slotNumber: result.releasedSlot.slotNumber,
        levelCode: result.releasedSlot.level.levelCode,
        status: result.releasedSlot.status,
      });

      res.status(200).json({
        success: true,
        message: 'Session force-closed, fee charged and slot released.',
        data: {
          session: result.closedSession,
          totalFee: result.totalFee,
          paymentStatus: result.paymentStatus,
          newBalance: result.newBalance,
          isDebt: result.isDebt,
        },
      });
      return;
    }

    // ─── DISPUTE ──────────────────────────────────────────────────────────────
    if (action === 'DISPUTE') {
      if (session.status === SessionStatus.DISPUTED) {
        res.status(409).json({ success: false, message: 'Session is already disputed.' });
        return;
      }

      if (session.status === SessionStatus.ACTIVE) {
        const exitTime = new Date();
        const { durationMinutes, fee } = calculateFee(session.entryTime, exitTime, Number(session.feeRateSnapshot));

        const result = await prisma.$transaction(async (tx) => {
          const claimed = await tx.parkingSession.updateMany({
            where: { id: session.id, status: SessionStatus.ACTIVE },
            data: {
              status: SessionStatus.DISPUTED,
              paymentStatus: PaymentStatus.PENDING,
              exitTime,
              durationMinutes,
              totalFee: fee,
              resolutionNote: note,
            },
          });
          if (claimed.count === 0) throw new Error(SESSION_ALREADY_CLOSED);
          const releasedSlot = await releaseSlotForSession(tx, session.slotId, session.id);
          const updated = await tx.parkingSession.findUniqueOrThrow({ where: { id: session.id } });
          return { updated, releasedSlot };
        });

        io.to(room).emit('session:resolved', {
          sessionId: session.id,
          licensePlate: session.vehicle.licensePlate,
          action: 'DISPUTE',
          resolutionNote: note || 'Disputed by operator',
        });
        io.to(room).emit('slot:released', {
          slotId: result.releasedSlot.id,
          slotNumber: result.releasedSlot.slotNumber,
          levelCode: result.releasedSlot.level.levelCode,
          status: result.releasedSlot.status,
        });

        res.status(200).json({
          success: true,
          message: `Session disputed. Clock stopped at ₹${fee.toFixed(2)} (not charged) and slot released.`,
          data: result.updated,
        });
        return;
      }

      // COMPLETED -> flag for review, existing charge stands
      const flagged = await prisma.parkingSession.updateMany({
        where: { id: session.id, status: SessionStatus.COMPLETED },
        data: { status: SessionStatus.DISPUTED, resolutionNote: note },
      });
      if (flagged.count === 0) {
        res.status(409).json({ success: false, message: 'Session state changed. Please refresh and retry.' });
        return;
      }

      io.to(room).emit('session:resolved', {
        sessionId: session.id,
        licensePlate: session.vehicle.licensePlate,
        action: 'DISPUTE',
        resolutionNote: note || 'Disputed by operator',
      });

      res.status(200).json({
        success: true,
        message: 'Completed session flagged as DISPUTED for review.',
        data: await prisma.parkingSession.findUnique({ where: { id: session.id } }),
      });
      return;
    }

    // ─── SETTLE_DISPUTE ───────────────────────────────────────────────────────
    const outcome = String(req.body.outcome || '').toUpperCase() as SettleOutcome;
    if (!SETTLE_OUTCOMES.includes(outcome)) {
      res.status(400).json({ success: false, message: 'outcome must be CHARGE, WAIVE or REFUND.' });
      return;
    }
    if (session.status !== SessionStatus.DISPUTED) {
      res.status(409).json({ success: false, message: 'Only DISPUTED sessions can be settled.' });
      return;
    }

    // A dispute raised while the session was active has a frozen fee that was never charged.
    const isUncharged = session.paymentStatus === PaymentStatus.PENDING;
    const frozenFee = Number(session.totalFee ?? 0);

    if (outcome === 'WAIVE' && !isUncharged) {
      res.status(400).json({ success: false, message: 'This session was already charged. Use REFUND instead.' });
      return;
    }
    if (outcome === 'REFUND' && isUncharged) {
      res.status(400).json({ success: false, message: 'This session was never charged. Use WAIVE instead.' });
      return;
    }

    const settled = await prisma.$transaction(async (tx) => {
      const claimed = await tx.parkingSession.updateMany({
        where: { id: session.id, status: SessionStatus.DISPUTED, paymentStatus: session.paymentStatus },
        data: { status: SessionStatus.COMPLETED, resolutionNote: note ?? session.resolutionNote },
      });
      if (claimed.count === 0) throw new Error(SESSION_ALREADY_CLOSED);

      let walletBalance: number | null = null;
      let paymentStatus: PaymentStatus = session.paymentStatus;
      let totalFee = frozenFee;

      if (outcome === 'CHARGE' && isUncharged) {
        const debit = await debitWallet(tx, {
          userId: session.userId,
          amount: frozenFee,
          sessionId: session.id,
          description: `Disputed session settled (charged): ${session.vehicle.licensePlate}${note ? ` - Note: ${note}` : ''}`,
        });
        paymentStatus = debit.paymentStatus;
        walletBalance = debit.newBalance;
      } else if (outcome === 'WAIVE') {
        paymentStatus = PaymentStatus.PAID;
        totalFee = 0;
      } else if (outcome === 'REFUND') {
        const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId: session.userId }, select: { id: true } });
        const credit = await creditWallet(tx, {
          walletId: wallet.id,
          amount: frozenFee,
          type: TransactionType.REFUND,
          sessionId: session.id,
          description: `Refund for disputed session: ${session.vehicle.licensePlate}${note ? ` - Note: ${note}` : ''}`,
        });
        paymentStatus = PaymentStatus.PAID;
        totalFee = 0;
        walletBalance = credit.newBalance;
      }

      const updated = await tx.parkingSession.update({
        where: { id: session.id },
        data: { paymentStatus, totalFee },
      });
      return { updated, walletBalance };
    });

    io.to(room).emit('session:resolved', {
      sessionId: session.id,
      licensePlate: session.vehicle.licensePlate,
      action: 'SETTLE_DISPUTE',
      outcome,
      resolutionNote: note || `Dispute settled: ${outcome}`,
    });

    res.status(200).json({
      success: true,
      message: `Dispute settled (${outcome}).`,
      data: { session: settled.updated, walletBalance: settled.walletBalance },
    });
  } catch (error) {
    if (error instanceof Error && error.message === SESSION_ALREADY_CLOSED) {
      res.status(409).json({
        success: false,
        message: 'Session was already resolved by another request. Nothing was charged or released again.',
      });
      return;
    }
    console.error('[Operator Resolve Error]', error);
    res.status(500).json({ success: false, message: 'Failed to resolve session.' });
  }
});
