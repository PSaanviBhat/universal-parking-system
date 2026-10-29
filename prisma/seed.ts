/**
 * Prisma Seed Script — Phase 1
 *
 * Seeds the database with:
 * - 1 Parking Facility (Phoenix Mall)
 * - 2 Parking Levels (Ground Floor + Level 1)
 * - 20 Parking Slots (10 per level)
 * - 2 Entry Gates + 2 Exit Gates (with unique QR codes)
 *
 * Run with: npm run db:seed (from apps/backend)
 */

import { PrismaClient, FacilityType, GateType, SlotStatus } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seed...\n');

  // ─── Clean existing seed data ───────────────────────────────────────────────
  console.log('🧹 Cleaning existing data...');
  await prisma.walletTransaction.deleteMany();
  await prisma.parkingSession.deleteMany();
  await prisma.parkingSlot.deleteMany();
  await prisma.parkingLevel.deleteMany();
  await prisma.parkingGate.deleteMany();
  await prisma.parkingFacility.deleteMany();
  await prisma.suspensionRecord.deleteMany();
  await prisma.wallet.deleteMany();
  await prisma.paymentMethod.deleteMany();
  await prisma.paymentOrder.deleteMany();
  await prisma.vehicle.deleteMany();
  await prisma.user.deleteMany();
  console.log('✅ Clean complete.\n');

  // ─── Create Parking Facility ────────────────────────────────────────────────
  console.log('🏢 Creating parking facility...');
  const facility = await prisma.parkingFacility.create({
    data: {
      id: uuidv4(),
      name: 'Phoenix Mall',
      type: FacilityType.MALL,
      address: '123 Main Street, City Center',
      feeRatePerHour: 30.00, // ₹30/hour (product decision)
    },
  });
  console.log(`   ✅ Facility created: ${facility.name} (${facility.id})\n`);

  // ─── Create Parking Levels ──────────────────────────────────────────────────
  console.log('🏗️  Creating parking levels...');

  const levelGround = await prisma.parkingLevel.create({
    data: {
      id: uuidv4(),
      facilityId: facility.id,
      levelCode: 'G',
      displayName: 'Ground Floor',
      totalSlots: 10,
    },
  });

  const levelOne = await prisma.parkingLevel.create({
    data: {
      id: uuidv4(),
      facilityId: facility.id,
      levelCode: 'L1',
      displayName: 'Level 1',
      totalSlots: 10,
    },
  });

  console.log(`   ✅ Level created: ${levelGround.displayName} (${levelGround.levelCode})`);
  console.log(`   ✅ Level created: ${levelOne.displayName} (${levelOne.levelCode})\n`);

  // ─── Create Parking Slots ───────────────────────────────────────────────────
  console.log('🅿️  Creating parking slots...');

  const groundSlots = [];
  for (let i = 1; i <= 10; i++) {
    groundSlots.push({
      id: uuidv4(),
      levelId: levelGround.id,
      facilityId: facility.id,
      slotNumber: `G-${String(i).padStart(2, '0')}`, // G-01 to G-10
      status: SlotStatus.AVAILABLE,
      coordinateX: ((i - 1) % 5) * 20 + 10, // Simple 5-column grid (%)
      coordinateY: Math.floor((i - 1) / 5) * 50 + 25,
      isActive: true,
    });
  }

  const level1Slots = [];
  for (let i = 1; i <= 10; i++) {
    level1Slots.push({
      id: uuidv4(),
      levelId: levelOne.id,
      facilityId: facility.id,
      slotNumber: `L1-${String(i).padStart(2, '0')}`, // L1-01 to L1-10
      status: SlotStatus.AVAILABLE,
      coordinateX: ((i - 1) % 5) * 20 + 10,
      coordinateY: Math.floor((i - 1) / 5) * 50 + 25,
      isActive: true,
    });
  }

  await prisma.parkingSlot.createMany({ data: [...groundSlots, ...level1Slots] });
  console.log(`   ✅ Created 10 slots on Ground Floor (G-01 to G-10)`);
  console.log(`   ✅ Created 10 slots on Level 1 (L1-01 to L1-10)\n`);

  // ─── Create Parking Gates ───────────────────────────────────────────────────
  console.log('🚧 Creating parking gates...');

  // Each gate gets a unique QR string: "PARKING_GATE:<gateId>:<facilityId>:<type>"
  const entryGate1Id = uuidv4();
  const entryGate2Id = uuidv4();
  const exitGate1Id = uuidv4();
  const exitGate2Id = uuidv4();

  const entryGate1 = await prisma.parkingGate.create({
    data: {
      id: entryGate1Id,
      facilityId: facility.id,
      gateType: GateType.ENTRY,
      gateName: 'North Entry Gate',
      qrCodeData: `PARKING_GATE:${entryGate1Id}:${facility.id}:ENTRY`,
      isActive: true,
    },
  });

  const entryGate2 = await prisma.parkingGate.create({
    data: {
      id: entryGate2Id,
      facilityId: facility.id,
      gateType: GateType.ENTRY,
      gateName: 'South Entry Gate',
      qrCodeData: `PARKING_GATE:${entryGate2Id}:${facility.id}:ENTRY`,
      isActive: true,
    },
  });

  const exitGate1 = await prisma.parkingGate.create({
    data: {
      id: exitGate1Id,
      facilityId: facility.id,
      gateType: GateType.EXIT,
      gateName: 'North Exit Gate',
      qrCodeData: `PARKING_GATE:${exitGate1Id}:${facility.id}:EXIT`,
      isActive: true,
    },
  });

  const exitGate2 = await prisma.parkingGate.create({
    data: {
      id: exitGate2Id,
      facilityId: facility.id,
      gateType: GateType.EXIT,
      gateName: 'South Exit Gate',
      qrCodeData: `PARKING_GATE:${exitGate2Id}:${facility.id}:EXIT`,
      isActive: true,
    },
  });

  console.log(`   ✅ Entry Gate: ${entryGate1.gateName}`);
  console.log(`      QR: ${entryGate1.qrCodeData}`);
  console.log(`   ✅ Entry Gate: ${entryGate2.gateName}`);
  console.log(`      QR: ${entryGate2.qrCodeData}`);
  console.log(`   ✅ Exit Gate:  ${exitGate1.gateName}`);
  console.log(`      QR: ${exitGate1.qrCodeData}`);
  console.log(`   ✅ Exit Gate:  ${exitGate2.gateName}`);
  console.log(`      QR: ${exitGate2.qrCodeData}\n`);

  // ─── Summary ─────────────────────────────────────────────────────────────────
  console.log('─────────────────────────────────────────────');
  console.log('✅ Seed complete! Summary:');
  console.log(`   Facility : ${facility.name}`);
  console.log(`   Levels   : 2 (Ground Floor + Level 1)`);
  console.log(`   Slots    : 20 total (10 per level)`);
  console.log(`   Gates    : 4 (2 entry + 2 exit)`);
  console.log('─────────────────────────────────────────────\n');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
