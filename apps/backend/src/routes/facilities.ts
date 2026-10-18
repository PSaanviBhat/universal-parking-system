import { Router, Request, Response } from 'express';
import { prisma } from '../utils/prisma';
import { SlotStatus } from '@prisma/client';

export const facilitiesRouter = Router();

/**
 * GET /api/facilities
 * Public endpoint to list all parking facilities with live availability counts.
 */
facilitiesRouter.get('/', async (_req: Request, res: Response): Promise<void> => {
  try {
    const facilities = await prisma.parkingFacility.findMany({
      include: {
        levels: {
          select: {
            id: true,
            levelCode: true,
            displayName: true,
            totalSlots: true,
          },
        },
        gates: {
          where: { isActive: true },
          select: {
            id: true,
            gateName: true,
            gateType: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    const facilityIds = facilities.map((f) => f.id);

    // Compute slot counts across all facilities in bulk
    const [totalSlotCounts, occupiedSlotCounts] = await Promise.all([
      prisma.parkingSlot.groupBy({
        by: ['facilityId'],
        where: { facilityId: { in: facilityIds }, isActive: true },
        _count: { id: true },
      }),
      prisma.parkingSlot.groupBy({
        by: ['facilityId'],
        where: {
          facilityId: { in: facilityIds },
          status: SlotStatus.RESERVED_OCCUPIED,
          isActive: true,
        },
        _count: { id: true },
      }),
    ]);

    const totalMap = new Map(totalSlotCounts.map((c) => [c.facilityId, c._count.id]));
    const occupiedMap = new Map(occupiedSlotCounts.map((c) => [c.facilityId, c._count.id]));

    const result = facilities.map((f) => {
      const total = totalMap.get(f.id) || 0;
      const occupied = occupiedMap.get(f.id) || 0;
      const available = Math.max(0, total - occupied);

      return {
        id: f.id,
        name: f.name,
        type: f.type,
        address: f.address,
        feeRatePerHour: Number(f.feeRatePerHour),
        totalSlots: total,
        occupiedSlots: occupied,
        availableSlots: available,
        levelsCount: f.levels.length,
        entryGatesCount: f.gates.filter((g) => g.gateType === 'ENTRY').length,
        exitGatesCount: f.gates.filter((g) => g.gateType === 'EXIT').length,
      };
    });

    res.status(200).json({ success: true, data: result });
  } catch (error) {
    console.error('[Get Facilities Error]', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve parking facilities.' });
  }
});

/**
 * GET /api/facilities/:id
 * Retrieves full facility overview with levels, gates, and hourly rates.
 */
facilitiesRouter.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const facility = await prisma.parkingFacility.findUnique({
      where: { id: String(id) },
      include: {
        levels: {
          include: {
            _count: {
              select: { slots: true },
            },
          },
          orderBy: { levelCode: 'asc' },
        },
        gates: {
          where: { isActive: true },
          select: {
            id: true,
            gateName: true,
            gateType: true,
            qrCodeData: true,
          },
        },
      },
    });

    if (!facility) {
      res.status(404).json({ success: false, message: 'Facility not found.' });
      return;
    }

    const [totalSlots, occupiedSlots] = await Promise.all([
      prisma.parkingSlot.count({
        where: { facilityId: facility.id, isActive: true },
      }),
      prisma.parkingSlot.count({
        where: { facilityId: facility.id, status: SlotStatus.RESERVED_OCCUPIED, isActive: true },
      }),
    ]);

    const availableSlots = Math.max(0, totalSlots - occupiedSlots);

    res.status(200).json({
      success: true,
      data: {
        ...facility,
        feeRatePerHour: Number(facility.feeRatePerHour),
        totalSlots,
        occupiedSlots,
        availableSlots,
      },
    });
  } catch (error) {
    console.error('[Get Facility Details Error]', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve facility details.' });
  }
});

/**
 * GET /api/facilities/:id/map
 * Returns layout map and slot coordinates for indoor navigation.
 */
facilitiesRouter.get('/:id/map', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const levels = await prisma.parkingLevel.findMany({
      where: { facilityId: String(id) },
      include: {
        slots: {
          where: { isActive: true },
          select: {
            id: true,
            slotNumber: true,
            status: true,
            coordinateX: true,
            coordinateY: true,
          },
          orderBy: { slotNumber: 'asc' },
        },
      },
      orderBy: { levelCode: 'asc' },
    });

    res.status(200).json({ success: true, data: levels });
  } catch (error) {
    console.error('[Get Facility Map Error]', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve facility map layout.' });
  }
});

export default facilitiesRouter;
