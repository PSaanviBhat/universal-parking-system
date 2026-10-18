import { Router, Response } from 'express';
import { prisma } from '../utils/prisma';
import { authGuard, AuthenticatedRequest } from '../middleware/auth';

export const vehicleRouter = Router();

// Apply authGuard to all vehicle management endpoints
vehicleRouter.use(authGuard);

/**
 * Normalizes license plate:
 * Removes spaces, dashes, dots, and converts to uppercase.
 * Example: "ka-01  ab 1234" -> "KA01AB1234"
 */
function normalizePlate(plate: string): string {
  return plate.replace(/[\s\-_.]/g, '').toUpperCase();
}

/**
 * POST /api/vehicles
 * Registers a new vehicle associated with the authenticated user.
 * Requirement:
 * - License plate is the sole unique identifier.
 * - System ensures license plate uniqueness globally.
 * - Normalizes plate formatting.
 */
vehicleRouter.post('/', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized.' });
      return;
    }

    const { licensePlate, nickname } = req.body;

    if (!licensePlate || typeof licensePlate !== 'string' || licensePlate.trim().length === 0) {
      res.status(400).json({
        success: false,
        message: 'A valid license plate number is required.',
      });
      return;
    }

    const cleanedPlate = normalizePlate(licensePlate);

    if (cleanedPlate.length < 4 || cleanedPlate.length > 15) {
      res.status(400).json({
        success: false,
        message: 'License plate must be between 4 and 15 alphanumeric characters.',
      });
      return;
    }

    // Check if plate already registered globally
    const existingVehicle = await prisma.vehicle.findUnique({
      where: { licensePlate: cleanedPlate },
      include: { user: { select: { id: true, name: true } } },
    });

    if (existingVehicle) {
      if (existingVehicle.userId === userId) {
        res.status(409).json({
          success: false,
          message: 'You have already registered this vehicle.',
        });
        return;
      }
      res.status(409).json({
        success: false,
        message: 'This license plate is already registered to another user account.',
      });
      return;
    }

    const vehicle = await prisma.vehicle.create({
      data: {
        userId,
        licensePlate: cleanedPlate,
        nickname: nickname ? String(nickname).trim() : null,
      },
    });

    res.status(201).json({
      success: true,
      message: 'Vehicle registered successfully.',
      data: vehicle,
    });
  } catch (error) {
    console.error('[Register Vehicle Error]', error);
    res.status(500).json({
      success: false,
      message: 'Failed to register vehicle.',
    });
  }
});

/**
 * GET /api/vehicles
 * Lists all registered vehicles for the authenticated user,
 * along with their current parking session status (if any).
 */
vehicleRouter.get('/', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized.' });
      return;
    }

    const vehicles = await prisma.vehicle.findMany({
      where: { userId },
      include: {
        parkingSessions: {
          where: { status: 'ACTIVE' },
          select: {
            id: true,
            status: true,
            entryTime: true,
            facility: {
              select: {
                id: true,
                name: true,
              },
            },
            slot: {
              select: {
                slotNumber: true,
                level: {
                  select: {
                    levelCode: true,
                    displayName: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const formatted = vehicles.map((v) => {
      const activeSession = v.parkingSessions[0] || null;
      return {
        id: v.id,
        licensePlate: v.licensePlate,
        nickname: v.nickname,
        createdAt: v.createdAt,
        isParked: Boolean(activeSession),
        activeSession: activeSession
          ? {
              sessionId: activeSession.id,
              facilityName: activeSession.facility.name,
              level: activeSession.slot.level.displayName,
              slotNumber: activeSession.slot.slotNumber,
              entryTime: activeSession.entryTime,
            }
          : null,
      };
    });

    res.status(200).json({
      success: true,
      data: formatted,
    });
  } catch (error) {
    console.error('[List Vehicles Error]', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve registered vehicles.',
    });
  }
});

/**
 * DELETE /api/vehicles/:id
 * Removes a vehicle profile.
 * Guard: Cannot delete a vehicle while it has an ACTIVE parking session.
 */
vehicleRouter.delete('/:id', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const vehicleId = String(req.params.id);

    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized.' });
      return;
    }

    const vehicle = await prisma.vehicle.findUnique({
      where: { id: vehicleId },
      include: {
        parkingSessions: {
          where: { status: 'ACTIVE' },
        },
      },
    });

    if (!vehicle) {
      res.status(404).json({
        success: false,
        message: 'Vehicle not found.',
      });
      return;
    }

    if (vehicle.userId !== userId) {
      res.status(403).json({
        success: false,
        message: 'Forbidden. You do not own this vehicle profile.',
      });
      return;
    }

    // Check if vehicle has an ongoing active parking session
    if (vehicle.parkingSessions.length > 0) {
      res.status(400).json({
        success: false,
        message: 'Cannot delete vehicle while it has an active parking session inside a facility.',
      });
      return;
    }

    await prisma.vehicle.delete({
      where: { id: vehicleId },
    });

    res.status(200).json({
      success: true,
      message: 'Vehicle removed successfully.',
    });
  } catch (error) {
    console.error('[Delete Vehicle Error]', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete vehicle.',
    });
  }
});
