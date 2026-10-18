import { Router, Request, Response } from 'express';
import { prisma } from '../utils/prisma';
import QRCode from 'qrcode';
import { v4 as uuidv4 } from 'uuid';
import { FacilityType, GateType, SlotStatus } from '@prisma/client';

export const adminRouter = Router();

/**
 * QR Code Format Standard:
 * PARKING_GATE:<gateId>:<facilityId>:<gateType>
 * Example: PARKING_GATE:3b29c1...:80092d...:ENTRY
 */

/**
 * Helper to generate QR code payload
 */
export function generateGateQrPayload(gateId: string, facilityId: string, gateType: GateType): string {
  return `PARKING_GATE:${gateId}:${facilityId}:${gateType}`;
}

/**
 * Helper to parse and validate gate QR code string
 */
export function parseGateQrPayload(qrData: string): { gateId: string; facilityId: string; gateType: GateType } | null {
  if (!qrData || typeof qrData !== 'string') return null;
  const parts = qrData.split(':');
  if (parts.length !== 4 || parts[0] !== 'PARKING_GATE') return null;

  const [, gateId, facilityId, gateTypeStr] = parts;
  if (gateTypeStr !== 'ENTRY' && gateTypeStr !== 'EXIT') return null;

  return {
    gateId,
    facilityId,
    gateType: gateTypeStr as GateType,
  };
}

// ─── FACILITY MANAGEMENT ──────────────────────────────────────────────────────

/**
 * POST /api/admin/facilities
 * Creates a parking facility with address, type, and hourly fee rate.
 */
adminRouter.post('/facilities', async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, type, address, feeRatePerHour } = req.body;

    if (!name || !address) {
      res.status(400).json({ success: false, message: 'Facility name and address are required.' });
      return;
    }

    const facilityType = (type && Object.values(FacilityType).includes(type)) ? type : FacilityType.MALL;
    const rate = Number(feeRatePerHour || process.env.DEFAULT_FEE_RATE_PER_HOUR || 30.00);

    const facility = await prisma.parkingFacility.create({
      data: {
        name: name.trim(),
        type: facilityType,
        address: address.trim(),
        feeRatePerHour: rate,
      },
    });

    res.status(201).json({
      success: true,
      message: 'Facility created successfully.',
      data: facility,
    });
  } catch (error) {
    console.error('[Create Facility Error]', error);
    res.status(500).json({ success: false, message: 'Failed to create facility.' });
  }
});

/**
 * GET /api/admin/facilities
 * Lists all registered facilities with counts of levels, gates, and slots.
 */
adminRouter.get('/facilities', async (_req: Request, res: Response): Promise<void> => {
  try {
    const facilities = await prisma.parkingFacility.findMany({
      include: {
        levels: {
          select: {
            id: true,
            levelCode: true,
            displayName: true,
            totalSlots: true,
            _count: { select: { slots: true } },
          },
        },
        gates: {
          select: {
            id: true,
            gateName: true,
            gateType: true,
            qrCodeData: true,
            isActive: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.status(200).json({ success: true, data: facilities });
  } catch (error) {
    console.error('[List Facilities Error]', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve facilities.' });
  }
});

/**
 * GET /api/admin/facilities/:id
 * Retrieves full facility hierarchy: levels, slots, and gates.
 */
adminRouter.get('/facilities/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const facilityId = String(req.params.id);

    const facility = await prisma.parkingFacility.findUnique({
      where: { id: facilityId },
      include: {
        levels: {
          include: {
            slots: {
              orderBy: { slotNumber: 'asc' },
            },
          },
        },
        gates: true,
      },
    });

    if (!facility) {
      res.status(404).json({ success: false, message: 'Facility not found.' });
      return;
    }

    res.status(200).json({ success: true, data: facility });
  } catch (error) {
    console.error('[Get Facility Error]', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve facility details.' });
  }
});

// ─── LEVELS & SLOTS MANAGEMENT ────────────────────────────────────────────────

/**
 * POST /api/admin/facilities/:id/levels
 * Adds a parking level to a facility.
 */
adminRouter.post('/facilities/:id/levels', async (req: Request, res: Response): Promise<void> => {
  try {
    const facilityId = String(req.params.id);
    const { levelCode, displayName, totalSlots, floorMapUrl } = req.body;

    if (!levelCode || !displayName) {
      res.status(400).json({ success: false, message: 'levelCode and displayName are required.' });
      return;
    }

    const level = await prisma.parkingLevel.create({
      data: {
        facilityId,
        levelCode: String(levelCode).trim().toUpperCase(),
        displayName: String(displayName).trim(),
        totalSlots: Number(totalSlots || 0),
        floorMapUrl: floorMapUrl ? String(floorMapUrl).trim() : null,
      },
    });

    res.status(201).json({ success: true, message: 'Level created successfully.', data: level });
  } catch (error) {
    console.error('[Create Level Error]', error);
    res.status(500).json({ success: false, message: 'Failed to create level.' });
  }
});

/**
 * POST /api/admin/levels/:levelId/slots
 * Adds individual or bulk slots to a level.
 */
adminRouter.post('/levels/:levelId/slots', async (req: Request, res: Response): Promise<void> => {
  try {
    const levelId = String(req.params.levelId);
    const { count, prefix, startingNumber } = req.body;

    const level = await prisma.parkingLevel.findUnique({
      where: { id: levelId },
    });

    if (!level) {
      res.status(404).json({ success: false, message: 'Level not found.' });
      return;
    }

    const slotCount = Math.max(1, Math.min(100, Number(count || 1)));
    const slotPrefix = prefix ? String(prefix).trim().toUpperCase() : level.levelCode;
    const startNum = Number(startingNumber || 1);

    const slotsToCreate = [];
    for (let i = 0; i < slotCount; i++) {
      const num = startNum + i;
      const slotNumStr = `${slotPrefix}-${String(num).padStart(2, '0')}`;
      slotsToCreate.push({
        levelId: level.id,
        facilityId: level.facilityId,
        slotNumber: slotNumStr,
        status: SlotStatus.AVAILABLE,
        coordinateX: ((i % 5) * 20) + 10,
        coordinateY: Math.floor(i / 5) * 30 + 15,
        isActive: true,
      });
    }

    await prisma.parkingSlot.createMany({
      data: slotsToCreate,
      skipDuplicates: true,
    });

    // Update level totalSlots count
    const totalNow = await prisma.parkingSlot.count({ where: { levelId: level.id } });
    await prisma.parkingLevel.update({
      where: { id: level.id },
      data: { totalSlots: totalNow },
    });

    res.status(201).json({
      success: true,
      message: `Created ${slotCount} slots on level ${level.displayName}.`,
      totalSlotsOnLevel: totalNow,
    });
  } catch (error) {
    console.error('[Create Slots Error]', error);
    res.status(500).json({ success: false, message: 'Failed to create slots.' });
  }
});

// ─── GATE & QR CODE SYSTEM ────────────────────────────────────────────────────

/**
 * POST /api/admin/facilities/:id/gates
 * Adds an Entry or Exit gate to a facility with an auto-generated unique QR string.
 */
adminRouter.post('/facilities/:id/gates', async (req: Request, res: Response): Promise<void> => {
  try {
    const facilityId = String(req.params.id);
    const { gateName, gateType } = req.body;

    if (!gateName || !gateType || (gateType !== 'ENTRY' && gateType !== 'EXIT')) {
      res.status(400).json({
        success: false,
        message: 'gateName and valid gateType (ENTRY or EXIT) are required.',
      });
      return;
    }

    const gateId = uuidv4();
    const qrCodeData = generateGateQrPayload(gateId, facilityId, gateType as GateType);

    const gate = await prisma.parkingGate.create({
      data: {
        id: gateId,
        facilityId,
        gateName: String(gateName).trim(),
        gateType: gateType as GateType,
        qrCodeData,
        isActive: true,
      },
    });

    res.status(201).json({
      success: true,
      message: 'Gate created successfully with unique QR code payload.',
      data: gate,
    });
  } catch (error) {
    console.error('[Create Gate Error]', error);
    res.status(500).json({ success: false, message: 'Failed to create gate.' });
  }
});

/**
 * GET /api/admin/gates/:id/qr
 * Generates and returns a printable QR code image (PNG) or Data URI for a gate.
 * Query param: ?format=image (default returns PNG image) or ?format=json (Data URI)
 */
adminRouter.get('/gates/:id/qr', async (req: Request, res: Response): Promise<void> => {
  try {
    const gateId = String(req.params.id);
    const format = String(req.query.format || 'image').toLowerCase();

    const gate = await prisma.parkingGate.findUnique({
      where: { id: gateId },
      include: { facility: { select: { name: true } } },
    });

    if (!gate) {
      res.status(404).json({ success: false, message: 'Gate not found.' });
      return;
    }

    if (format === 'json') {
      const dataUri = await QRCode.toDataURL(gate.qrCodeData, {
        errorCorrectionLevel: 'H',
        margin: 2,
        width: 400,
      });

      res.status(200).json({
        success: true,
        data: {
          gateId: gate.id,
          gateName: gate.gateName,
          gateType: gate.gateType,
          facilityName: gate.facility.name,
          qrCodeData: gate.qrCodeData,
          dataUri,
        },
      });
      return;
    }

    // Default: stream raw PNG image buffer
    res.setHeader('Content-Type', 'image/png');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="qr-${gate.gateType.toLowerCase()}-${gate.gateName.replace(/\s+/g, '_')}.png"`
    );

    const pngBuffer = await QRCode.toBuffer(gate.qrCodeData, {
      type: 'png',
      errorCorrectionLevel: 'H',
      margin: 2,
      width: 400,
    });

    res.status(200).send(pngBuffer);
  } catch (error) {
    console.error('[Generate QR Image Error]', error);
    res.status(500).json({ success: false, message: 'Failed to render gate QR code.' });
  }
});

/**
 * POST /api/admin/gates/validate-qr
 * Validates a scanned QR code payload and returns gate & facility status.
 * Used by mobile scanners to verify gate authenticity before initiating entry or exit.
 */
adminRouter.post('/gates/validate-qr', async (req: Request, res: Response): Promise<void> => {
  try {
    const { qrCodeData } = req.body;

    const parsed = parseGateQrPayload(qrCodeData);
    if (!parsed) {
      res.status(400).json({
        success: false,
        message: 'Invalid parking gate QR code format.',
      });
      return;
    }

    const gate = await prisma.parkingGate.findUnique({
      where: { id: parsed.gateId },
      include: {
        facility: {
          select: {
            id: true,
            name: true,
            address: true,
            feeRatePerHour: true,
          },
        },
      },
    });

    if (!gate || !gate.isActive) {
      res.status(404).json({
        success: false,
        message: 'Gate not found or inactive.',
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: 'Valid parking gate QR code.',
      data: {
        gateId: gate.id,
        gateName: gate.gateName,
        gateType: gate.gateType,
        facility: gate.facility,
      },
    });
  } catch (error) {
    console.error('[Validate QR Error]', error);
    res.status(500).json({ success: false, message: 'Failed to validate QR code.' });
  }
});
