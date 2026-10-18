import { Router, Request, Response } from 'express';
import { prisma } from '../utils/prisma';
import { io } from '../index';
import { SessionStatus, PaymentStatus, SlotStatus } from '@prisma/client';

export const operatorRouter = Router();

/**
 * GET /api/operator/stats/:facilityId
 * Retrieves real-time KPI overview for a facility:
 * - Total capacity, currently occupied, available slots
 * - Active sessions count
 * - Today's entries, exits, and revenue
 */
operatorRouter.get('/stats/:facilityId', async (req: Request, res: Response): Promise<void> => {
  try {
    const facilityId = String(req.params.facilityId);

    const [facility, totalSlots, occupiedSlots, activeSessions, completedSessions] = await Promise.all([
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
      prisma.parkingSession.findMany({
        where: {
          facilityId,
          status: SessionStatus.COMPLETED,
          exitTime: {
            gte: new Date(new Date().setHours(0, 0, 0, 0)), // Today
          },
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
 * GET /api/operator/sessions/:facilityId
 * Lists active sessions in real-time with vehicle license plate,
 * entry time, slot, level, and dynamic running fee.
 */
operatorRouter.get('/sessions/:facilityId', async (req: Request, res: Response): Promise<void> => {
  try {
    const facilityId = String(req.params.facilityId);

    const sessions = await prisma.parkingSession.findMany({
      where: {
        facilityId,
        status: SessionStatus.ACTIVE,
      },
      include: {
        vehicle: { select: { licensePlate: true, nickname: true } },
        user: { select: { id: true, name: true, phone: true } },
        slot: { select: { slotNumber: true, level: { select: { displayName: true, levelCode: true } } } },
        entryGate: { select: { gateName: true } },
      },
      orderBy: { entryTime: 'desc' },
    });

    const now = new Date();

    const formatted = sessions.map((s) => {
      const durationMs = now.getTime() - new Date(s.entryTime).getTime();
      const durationMinutes = Math.max(1, Math.ceil(durationMs / (1000 * 60)));
      const durationHours = durationMinutes / 60;
      const rate = Number(s.feeRateSnapshot);
      const runningFee = Math.max(rate, Math.round(durationHours * rate * 100) / 100);

      return {
        sessionId: s.id,
        licensePlate: s.vehicle.licensePlate,
        vehicleNickname: s.vehicle.nickname,
        userName: s.user.name,
        userPhone: s.user.phone,
        slotNumber: s.slot.slotNumber,
        levelName: s.slot.level.displayName,
        levelCode: s.slot.level.levelCode,
        entryGate: s.entryGate.gateName,
        entryTime: s.entryTime,
        durationMinutes,
        hourlyRate: rate,
        runningFee,
        status: s.status,
        paymentStatus: s.paymentStatus,
      };
    });

    res.status(200).json({ success: true, data: formatted });
  } catch (error) {
    console.error('[Operator Active Sessions Error]', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve active sessions.' });
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

/**
 * PATCH /api/operator/sessions/:id/resolve
 * Allows parking operators to resolve disputed or stuck sessions:
 * - Mark as DISPUTED
 * - Force close session (e.g. lost phone, manual exit, barrier override)
 * - Releases slot back to AVAILABLE
 */
operatorRouter.patch('/sessions/:id/resolve', async (req: Request, res: Response): Promise<void> => {
  try {
    const sessionId = String(req.params.id);
    const { action, resolutionNote } = req.body;

    if (!action || (action !== 'FORCE_CLOSE' && action !== 'DISPUTE')) {
      res.status(400).json({
        success: false,
        message: 'Valid action (FORCE_CLOSE or DISPUTE) is required.',
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

    if (action === 'DISPUTE') {
      const updated = await prisma.parkingSession.update({
        where: { id: sessionId },
        data: { status: SessionStatus.DISPUTED },
      });

      res.status(200).json({
        success: true,
        message: 'Session flagged as DISPUTED.',
        data: updated,
      });
      return;
    }

    // FORCE_CLOSE: release slot and mark session as completed
    const result = await prisma.$transaction(async (tx) => {
      const closed = await tx.parkingSession.update({
        where: { id: sessionId },
        data: {
          status: SessionStatus.COMPLETED,
          exitTime: new Date(),
          paymentStatus: PaymentStatus.PAID, // Marked settled by operator override
        },
      });

      const releasedSlot = await tx.parkingSlot.update({
        where: { id: session.slotId },
        data: {
          status: SlotStatus.AVAILABLE,
          currentSessionId: null,
        },
        include: { level: true },
      });

      return { closed, releasedSlot };
    });

    // Notify dashboard in real-time
    io.to(`facility:${session.facilityId}`).emit('session:resolved', {
      sessionId: session.id,
      licensePlate: session.vehicle.licensePlate,
      action: 'FORCE_CLOSE',
      resolutionNote: resolutionNote || 'Manual resolution by operator',
    });

    io.to(`facility:${session.facilityId}`).emit('slot:released', {
      slotId: result.releasedSlot.id,
      slotNumber: result.releasedSlot.slotNumber,
      levelCode: result.releasedSlot.level.levelCode,
      status: result.releasedSlot.status,
    });

    res.status(200).json({
      success: true,
      message: 'Session force-closed and slot successfully released.',
      data: result,
    });
  } catch (error) {
    console.error('[Operator Resolve Error]', error);
    res.status(500).json({ success: false, message: 'Failed to resolve session.' });
  }
});
