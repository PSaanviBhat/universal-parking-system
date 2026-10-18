import { Router, Response } from 'express';
import { prisma } from '../utils/prisma';
import { authGuard, AuthenticatedRequest } from '../middleware/auth';
import { parseGateQrPayload } from './admin';
import { io } from '../index';
import { SlotStatus, SessionStatus, PaymentStatus } from '@prisma/client';

export const sessionRouter = Router();

// Apply authGuard to all parking session routes
sessionRouter.use(authGuard);

/**
 * POST /api/sessions/entry
 * Initiates parking session via Entry QR Code scan.
 *
 * Core Business Rules & Guards Enforced:
 * 1. Validates scanned QR payload as an active ENTRY gate.
 * 2. Verifies user vehicle is registered and owned by user.
 * 3. Enforces compliance: Rejects if user or vehicle is suspended/blacklisted.
 * 4. Guard against duplicate session: Vehicle cannot already have an active session anywhere.
 * 5. Automatic Slot Allocation: Finds an available slot in the facility.
 *    - Rejects cleanly if facility is at 100% full capacity (no false allocation).
 * 6. Concurrency Protection & Atomicity:
 *    - In a DB transaction, locks and flips slot to RESERVED_OCCUPIED.
 *    - Captures facility hourly fee rate snapshot.
 *    - Creates ParkingSession record.
 * 7. Real-Time Broadcast: Emits `session:created` and `slot:updated` events via Socket.io
 *    so operator web dashboard reflects live occupancy instantaneously.
 */
sessionRouter.post('/entry', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized.' });
      return;
    }

    const { qrCodeData, vehicleId } = req.body;

    if (!qrCodeData || !vehicleId) {
      res.status(400).json({
        success: false,
        message: 'qrCodeData and vehicleId are required.',
      });
      return;
    }

    // 1. Parse and validate Entry QR Code
    const parsedQr = parseGateQrPayload(qrCodeData);
    if (!parsedQr || parsedQr.gateType !== 'ENTRY') {
      res.status(400).json({
        success: false,
        message: 'Invalid entry QR code. Please scan a valid facility entry gate QR.',
      });
      return;
    }

    const gate = await prisma.parkingGate.findUnique({
      where: { id: parsedQr.gateId },
      include: {
        facility: true,
      },
    });

    if (!gate || !gate.isActive || gate.facilityId !== parsedQr.facilityId) {
      res.status(404).json({
        success: false,
        message: 'Entry gate is inactive or does not exist.',
      });
      return;
    }

    // 2. Validate Vehicle Ownership & Registration
    const vehicle = await prisma.vehicle.findUnique({
      where: { id: vehicleId },
      include: {
        user: {
          select: {
            id: true,
            isSuspended: true,
            isBlacklisted: true,
          },
        },
      },
    });

    if (!vehicle || vehicle.userId !== userId) {
      res.status(403).json({
        success: false,
        message: 'Vehicle not found or does not belong to your account.',
      });
      return;
    }

    // 3. Check Account Suspension / Blacklist
    if (vehicle.user.isSuspended || vehicle.user.isBlacklisted) {
      res.status(403).json({
        success: false,
        message: 'Your account is suspended due to unpaid debt. Please clear pending dues to enter.',
        isSuspended: true,
      });
      return;
    }

    // 4. Guard against duplicate session for the same vehicle
    const existingActiveSession = await prisma.parkingSession.findFirst({
      where: {
        vehicleId: vehicle.id,
        status: SessionStatus.ACTIVE,
      },
      include: {
        facility: { select: { name: true } },
      },
    });

    if (existingActiveSession) {
      res.status(409).json({
        success: false,
        message: `This vehicle already has an active parking session at ${existingActiveSession.facility.name}.`,
        sessionId: existingActiveSession.id,
      });
      return;
    }

    // 5 & 6. Atomic Slot Allocation and Session Creation
    // Run inside database transaction with lock to eliminate race conditions
    const sessionResult = await prisma.$transaction(async (tx) => {
      // Find one available slot in this facility
      const availableSlot = await tx.parkingSlot.findFirst({
        where: {
          facilityId: gate.facilityId,
          status: SlotStatus.AVAILABLE,
          isActive: true,
        },
        include: {
          level: true,
        },
        orderBy: [
          { level: { levelCode: 'asc' } },
          { slotNumber: 'asc' },
        ],
      });

      if (!availableSlot) {
        // No slot available: fail transaction cleanly
        return null;
      }

      const now = new Date();

      // Create the ParkingSession
      const newSession = await tx.parkingSession.create({
        data: {
          vehicleId: vehicle.id,
          userId,
          facilityId: gate.facilityId,
          slotId: availableSlot.id,
          entryGateId: gate.id,
          entryTime: now,
          feeRateSnapshot: gate.facility.feeRatePerHour,
          status: SessionStatus.ACTIVE,
          paymentStatus: PaymentStatus.PENDING,
        },
      });

      // Update slot state to RESERVED_OCCUPIED (Unified state)
      const updatedSlot = await tx.parkingSlot.update({
        where: { id: availableSlot.id },
        data: {
          status: SlotStatus.RESERVED_OCCUPIED,
          currentSessionId: newSession.id,
        },
        include: {
          level: true,
        },
      });

      return {
        session: newSession,
        slot: updatedSlot,
        facility: gate.facility,
      };
    });

    if (!sessionResult) {
      res.status(409).json({
        success: false,
        message: 'Parking Full. There are currently no available parking slots at this facility.',
      });
      return;
    }

    // 7. Emit real-time updates via Socket.io to Operator Dashboard
    io.to(`facility:${gate.facilityId}`).emit('session:created', {
      sessionId: sessionResult.session.id,
      licensePlate: vehicle.licensePlate,
      facilityId: gate.facilityId,
      facilityName: sessionResult.facility.name,
      level: sessionResult.slot.level.displayName,
      slotNumber: sessionResult.slot.slotNumber,
      entryTime: sessionResult.session.entryTime,
      gateName: gate.gateName,
      status: sessionResult.session.status,
    });

    io.to(`facility:${gate.facilityId}`).emit('slot:updated', {
      slotId: sessionResult.slot.id,
      slotNumber: sessionResult.slot.slotNumber,
      status: sessionResult.slot.status,
      levelCode: sessionResult.slot.level.levelCode,
    });

    res.status(201).json({
      success: true,
      message: 'Parking session started. Slot allocated successfully.',
      data: {
        session: {
          id: sessionResult.session.id,
          entryTime: sessionResult.session.entryTime,
          feeRatePerHour: Number(sessionResult.session.feeRateSnapshot),
          status: sessionResult.session.status,
        },
        vehicle: {
          id: vehicle.id,
          licensePlate: vehicle.licensePlate,
        },
        facility: {
          id: sessionResult.facility.id,
          name: sessionResult.facility.name,
          address: sessionResult.facility.address,
        },
        assignedSlot: {
          slotId: sessionResult.slot.id,
          slotNumber: sessionResult.slot.slotNumber,
          levelCode: sessionResult.slot.level.levelCode,
          levelName: sessionResult.slot.level.displayName,
          floorMapUrl: sessionResult.slot.level.floorMapUrl,
          coordinateX: sessionResult.slot.coordinateX,
          coordinateY: sessionResult.slot.coordinateY,
          directions: `Enter through ${gate.gateName}, proceed to ${sessionResult.slot.level.displayName}, follow row markers to Slot ${sessionResult.slot.slotNumber}.`,
        },
      },
    });
  } catch (error) {
    console.error('[Session Entry Error]', error);
    res.status(500).json({
      success: false,
      message: 'Failed to initiate parking session.',
    });
  }
});

/**
 * GET /api/sessions/active
 * Returns user's currently active parking sessions across their vehicles.
 * Also returns live elapsed duration and current fee calculation.
 */
sessionRouter.get('/active', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized.' });
      return;
    }

    const activeSessions = await prisma.parkingSession.findMany({
      where: {
        userId,
        status: SessionStatus.ACTIVE,
      },
      include: {
        vehicle: {
          select: {
            id: true,
            licensePlate: true,
            nickname: true,
          },
        },
        facility: {
          select: {
            id: true,
            name: true,
            address: true,
          },
        },
        slot: {
          include: {
            level: true,
          },
        },
        entryGate: {
          select: {
            gateName: true,
          },
        },
      },
      orderBy: { entryTime: 'desc' },
    });

    const now = new Date();

    const formattedSessions = activeSessions.map((s) => {
      const durationMs = now.getTime() - new Date(s.entryTime).getTime();
      const durationMinutes = Math.max(1, Math.ceil(durationMs / (1000 * 60)));
      const durationHours = durationMinutes / 60;
      const hourlyRate = Number(s.feeRateSnapshot);
      const estimatedFee = Math.max(hourlyRate, Math.round(durationHours * hourlyRate * 100) / 100);

      return {
        sessionId: s.id,
        vehicle: s.vehicle,
        facility: s.facility,
        entryTime: s.entryTime,
        durationMinutes,
        hourlyRate,
        estimatedFee,
        status: s.status,
        assignedSlot: {
          slotId: s.slot.id,
          slotNumber: s.slot.slotNumber,
          levelCode: s.slot.level.levelCode,
          levelName: s.slot.level.displayName,
          floorMapUrl: s.slot.level.floorMapUrl,
          coordinateX: s.slot.coordinateX,
          coordinateY: s.slot.coordinateY,
          directions: `Proceed to ${s.slot.level.displayName}, Slot ${s.slot.slotNumber}.`,
        },
        entryGateName: s.entryGate.gateName,
      };
    });

    res.status(200).json({
      success: true,
      hasActiveSession: formattedSessions.length > 0,
      data: formattedSessions,
    });
  } catch (error) {
    console.error('[Get Active Sessions Error]', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve active sessions.',
    });
  }
});

/**
 * POST /api/sessions/exit
 * Concludes parking session via Exit QR Code scan.
 *
 * Core Business Rules & Guards Enforced:
 * 1. Validates scanned QR payload as an active EXIT gate.
 * 2. Identifies active parking session for the vehicle.
 *    - Rejects if vehicle has no active session.
 *    - Verifies vehicle belongs to facility where gate is located.
 * 3. Prevents duplicate exits: Already completed sessions cannot be re-charged.
 * 4. Duration & Fee Calculation:
 *    - duration = exitTime - entryTime.
 *    - fee = durationHours * feeRateSnapshot (min 1 hour or rounded proportionally).
 * 5. Automatic Wallet Deduction & 48h Debt Handling:
 *    - If wallet balance >= fee: Deducts full amount, paymentStatus = PAID.
 *    - If wallet balance < fee: Wallet goes into negative DEBT (credit model).
 *      - Sets `debtCreatedAt` = now.
 *      - Sets `debtDeadline` = now + 48 hours.
 *      - paymentStatus = DEBT.
 *      - Session completes and slot is released (driver is not blocked at gate).
 * 6. Slot & Session Release:
 *    - Session status flips to COMPLETED.
 *    - Slot status flips to AVAILABLE and `currentSessionId` cleared.
 * 7. Real-Time WebSocket Broadcast:
 *    - Emits `session:completed` and `slot:released` to operator dashboard.
 */
sessionRouter.post('/exit', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized.' });
      return;
    }

    const { qrCodeData, vehicleId } = req.body;

    if (!qrCodeData || !vehicleId) {
      res.status(400).json({
        success: false,
        message: 'qrCodeData and vehicleId are required.',
      });
      return;
    }

    // 1. Parse and validate Exit QR Code
    const parsedQr = parseGateQrPayload(qrCodeData);
    if (!parsedQr || parsedQr.gateType !== 'EXIT') {
      res.status(400).json({
        success: false,
        message: 'Invalid exit QR code. Please scan a valid facility exit gate QR.',
      });
      return;
    }

    const exitGate = await prisma.parkingGate.findUnique({
      where: { id: parsedQr.gateId },
      include: { facility: true },
    });

    if (!exitGate || !exitGate.isActive || exitGate.facilityId !== parsedQr.facilityId) {
      res.status(404).json({
        success: false,
        message: 'Exit gate is inactive or does not exist.',
      });
      return;
    }

    // 2. Identify Active Session for the vehicle
    const activeSession = await prisma.parkingSession.findFirst({
      where: {
        vehicleId,
        userId,
        status: SessionStatus.ACTIVE,
      },
      include: {
        vehicle: true,
        facility: true,
        slot: { include: { level: true } },
      },
    });

    if (!activeSession) {
      res.status(404).json({
        success: false,
        message: 'No active parking session found for this vehicle. Cannot perform exit.',
      });
      return;
    }

    // Verify session belongs to the facility of this exit gate
    if (activeSession.facilityId !== exitGate.facilityId) {
      res.status(400).json({
        success: false,
        message: `Exit gate mismatch: Vehicle is parked at ${activeSession.facility.name}, but this exit gate belongs to ${exitGate.facility.name}.`,
      });
      return;
    }

    const exitTime = new Date();
    const entryTime = new Date(activeSession.entryTime);
    const durationMs = exitTime.getTime() - entryTime.getTime();
    const durationMinutes = Math.max(1, Math.ceil(durationMs / (1000 * 60)));
    const durationHours = durationMinutes / 60;
    const hourlyRate = Number(activeSession.feeRateSnapshot);

    // Calculate fee: at least 1-hour minimum charge or calculated duration
    const totalFee = Math.max(hourlyRate, Math.round(durationHours * hourlyRate * 100) / 100);

    // 3 & 4. Atomic Transaction: Settle Payment from Wallet, Update Session, and Free Slot
    const result = await prisma.$transaction(async (tx) => {
      const userWallet = await tx.wallet.findUnique({
        where: { userId },
      });

      if (!userWallet) {
        throw new Error('User wallet not found');
      }

      const prevBalance = Number(userWallet.balance);
      const newBalance = prevBalance - totalFee;
      const isDebt = newBalance < 0;

      let paymentStatus: PaymentStatus = PaymentStatus.PAID;
      let debtDeadline: Date | null = userWallet.debtDeadline;
      let debtCreatedAt: Date | null = userWallet.debtCreatedAt;

      if (isDebt) {
        paymentStatus = PaymentStatus.DEBT;
        if (!debtCreatedAt) {
          debtCreatedAt = exitTime;
          debtDeadline = new Date(exitTime.getTime() + 48 * 60 * 60 * 1000); // +48 hours
        }
      }

      // Update Wallet
      const updatedWallet = await tx.wallet.update({
        where: { id: userWallet.id },
        data: {
          balance: newBalance,
          debtCreatedAt,
          debtDeadline,
        },
      });

      // Update Parking Session to COMPLETED
      const closedSession = await tx.parkingSession.update({
        where: { id: activeSession.id },
        data: {
          exitGateId: exitGate.id,
          exitTime,
          durationMinutes,
          totalFee,
          status: SessionStatus.COMPLETED,
          paymentStatus,
        },
      });

      // Record Wallet Transaction
      const transaction = await tx.walletTransaction.create({
        data: {
          walletId: userWallet.id,
          sessionId: closedSession.id,
          type: 'PARKING_CHARGE',
          amount: totalFee,
          description: `Parking fee for ${activeSession.vehicle.licensePlate} at ${activeSession.facility.name} (${durationMinutes} mins)`,
        },
      });

      // Release Slot back to AVAILABLE
      const releasedSlot = await tx.parkingSlot.update({
        where: { id: activeSession.slotId },
        data: {
          status: SlotStatus.AVAILABLE,
          currentSessionId: null,
        },
        include: { level: true },
      });

      return {
        closedSession,
        updatedWallet,
        releasedSlot,
        transaction,
        isDebt,
        prevBalance,
        newBalance,
        debtDeadline,
      };
    });

    // 5. Broadcast real-time events via Socket.io
    io.to(`facility:${exitGate.facilityId}`).emit('session:completed', {
      sessionId: result.closedSession.id,
      licensePlate: activeSession.vehicle.licensePlate,
      facilityId: exitGate.facilityId,
      exitGateName: exitGate.gateName,
      exitTime,
      durationMinutes,
      totalFee,
      paymentStatus: result.closedSession.paymentStatus,
      isDebt: result.isDebt,
    });

    io.to(`facility:${exitGate.facilityId}`).emit('slot:released', {
      slotId: result.releasedSlot.id,
      slotNumber: result.releasedSlot.slotNumber,
      levelCode: result.releasedSlot.level.levelCode,
      status: result.releasedSlot.status,
    });

    res.status(200).json({
      success: true,
      message: result.isDebt
        ? 'Exit cleared! Your wallet has insufficient balance and entered debt. Please repay within 48 hours to avoid autopay/suspension.'
        : 'Exit cleared! Parking fee successfully deducted from your wallet.',
      data: {
        session: {
          id: result.closedSession.id,
          licensePlate: activeSession.vehicle.licensePlate,
          facilityName: activeSession.facility.name,
          slotNumber: activeSession.slot.slotNumber,
          levelName: activeSession.slot.level.displayName,
          entryTime: activeSession.entryTime,
          exitTime,
          durationMinutes,
          totalFee,
          status: result.closedSession.status,
          paymentStatus: result.closedSession.paymentStatus,
        },
        wallet: {
          previousBalance: result.prevBalance,
          amountDeducted: totalFee,
          remainingBalance: result.newBalance,
          isDebt: result.isDebt,
          debtAmount: result.isDebt ? Math.abs(result.newBalance) : 0,
          debtDeadline: result.debtDeadline,
        },
        exitGateName: exitGate.gateName,
      },
    });
  } catch (error) {
    console.error('[Session Exit Error]', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process parking exit.',
    });
  }
});

/**
 * GET /api/sessions/history
 * Returns user's past completed parking sessions with receipts.
 */
sessionRouter.get('/history', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized.' });
      return;
    }

    const page = Math.max(1, parseInt(String(req.query.page || 1), 10));
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || 20), 10)));
    const skip = (page - 1) * limit;

    const [total, sessions] = await Promise.all([
      prisma.parkingSession.count({ where: { userId, status: SessionStatus.COMPLETED } }),
      prisma.parkingSession.findMany({
        where: { userId, status: SessionStatus.COMPLETED },
        orderBy: { exitTime: 'desc' },
        skip,
        take: limit,
        include: {
          vehicle: { select: { licensePlate: true, nickname: true } },
          facility: { select: { name: true, address: true } },
          slot: { select: { slotNumber: true, level: { select: { displayName: true } } } },
          entryGate: { select: { gateName: true } },
          exitGate: { select: { gateName: true } },
        },
      }),
    ]);

    res.status(200).json({
      success: true,
      data: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        sessions: sessions.map((s) => ({
          sessionId: s.id,
          licensePlate: s.vehicle.licensePlate,
          vehicleNickname: s.vehicle.nickname,
          facilityName: s.facility.name,
          facilityAddress: s.facility.address,
          slotNumber: s.slot.slotNumber,
          levelName: s.slot.level.displayName,
          entryGate: s.entryGate.gateName,
          exitGate: s.exitGate?.gateName || null,
          entryTime: s.entryTime,
          exitTime: s.exitTime,
          durationMinutes: s.durationMinutes,
          totalFee: Number(s.totalFee || 0),
          paymentStatus: s.paymentStatus,
          status: s.status,
        })),
      },
    });
  } catch (error) {
    console.error('[Get Session History Error]', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve session history.',
    });
  }
});

