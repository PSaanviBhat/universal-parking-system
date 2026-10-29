/**
 * Prisma Seed Script
 *
 * Idempotent — safe to run against production:
 * - Creates the "Phoenix Mall" facility (2 levels, 20 slots, 2 entry + 2 exit gates)
 *   only if it does not already exist.
 * - Upserts one admin and one operator (for Phoenix Mall) with bcrypt-hashed passwords.
 *     SEED_ADMIN_USERNAME / SEED_ADMIN_PASSWORD        (default username: superadmin)
 *     SEED_OPERATOR_USERNAME / SEED_OPERATOR_PASSWORD  (default username: operator1)
 *   When a password env var is missing and the account is new, a random password is
 *   generated and printed ONCE. Existing passwords are only changed when the env var is set.
 *
 * SEED_RESET=true wipes all data first (local dev only; refused when NODE_ENV=production).
 *
 * Run with: npm run db:seed (from apps/backend)
 */

import { PrismaClient, FacilityType, GateType, SlotStatus } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const prisma = new PrismaClient();

const FACILITY_NAME = 'Phoenix Mall';

async function resetAll() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SEED_RESET is not allowed when NODE_ENV=production.');
  }
  console.log('🧹 SEED_RESET=true — wiping all data...');
  await prisma.walletTransaction.deleteMany();
  await prisma.parkingSlot.updateMany({ data: { currentSessionId: null } });
  await prisma.parkingSession.deleteMany();
  await prisma.parkingSlot.deleteMany();
  await prisma.parkingLevel.deleteMany();
  await prisma.parkingGate.deleteMany();
  await prisma.operator.deleteMany();
  await prisma.parkingFacility.deleteMany();
  await prisma.suspensionRecord.deleteMany();
  await prisma.wallet.deleteMany();
  await prisma.paymentMethod.deleteMany();
  await prisma.paymentOrder.deleteMany();
  await prisma.vehicle.deleteMany();
  await prisma.user.deleteMany();
  await prisma.admin.deleteMany();
  console.log('✅ Clean complete.\n');
}

async function ensureFacility() {
  const existing = await prisma.parkingFacility.findFirst({
    where: { name: FACILITY_NAME },
    include: { gates: true },
  });
  if (existing) {
    console.log(`🏢 Facility already exists: ${existing.name} (${existing.id}) — skipping creation.\n`);
    return existing;
  }

  console.log('🏢 Creating parking facility...');
  const facility = await prisma.parkingFacility.create({
    data: {
      id: uuidv4(),
      name: FACILITY_NAME,
      type: FacilityType.MALL,
      address: '123 Main Street, City Center',
      feeRatePerHour: 30.0, // ₹30/hour (product decision)
    },
  });

  const levels = [
    { code: 'G', name: 'Ground Floor', prefix: 'G' },
    { code: 'L1', name: 'Level 1', prefix: 'L1' },
  ];
  for (const lvl of levels) {
    const level = await prisma.parkingLevel.create({
      data: { id: uuidv4(), facilityId: facility.id, levelCode: lvl.code, displayName: lvl.name, totalSlots: 10 },
    });
    await prisma.parkingSlot.createMany({
      data: Array.from({ length: 10 }, (_, idx) => {
        const i = idx + 1;
        return {
          id: uuidv4(),
          levelId: level.id,
          facilityId: facility.id,
          slotNumber: `${lvl.prefix}-${String(i).padStart(2, '0')}`,
          status: SlotStatus.AVAILABLE,
          coordinateX: ((i - 1) % 5) * 20 + 10, // Simple 5-column grid (%)
          coordinateY: Math.floor((i - 1) / 5) * 50 + 25,
          isActive: true,
        };
      }),
    });
    console.log(`   ✅ ${lvl.name}: 10 slots (${lvl.prefix}-01 to ${lvl.prefix}-10)`);
  }

  // Each gate gets a unique QR string: "PARKING_GATE:<gateId>:<facilityId>:<type>"
  const gates: { name: string; type: GateType }[] = [
    { name: 'North Entry Gate', type: GateType.ENTRY },
    { name: 'South Entry Gate', type: GateType.ENTRY },
    { name: 'North Exit Gate', type: GateType.EXIT },
    { name: 'South Exit Gate', type: GateType.EXIT },
  ];
  for (const g of gates) {
    const id = uuidv4();
    await prisma.parkingGate.create({
      data: {
        id,
        facilityId: facility.id,
        gateType: g.type,
        gateName: g.name,
        qrCodeData: `PARKING_GATE:${id}:${facility.id}:${g.type}`,
        isActive: true,
      },
    });
  }
  console.log(`   ✅ Facility created: ${facility.name} (${facility.id})\n`);

  return prisma.parkingFacility.findUniqueOrThrow({ where: { id: facility.id }, include: { gates: true } });
}

/** Returns the password to set, or null to keep an existing account's password. */
function resolvePassword(envVar: string, exists: boolean): { password: string | null; generated: boolean } {
  const fromEnv = process.env[envVar];
  if (fromEnv) {
    if (fromEnv.length < 10) throw new Error(`${envVar} must be at least 10 characters.`);
    return { password: fromEnv, generated: false };
  }
  if (exists) return { password: null, generated: false };
  return { password: crypto.randomBytes(12).toString('base64url'), generated: true };
}

async function upsertAdmin() {
  const username = (process.env.SEED_ADMIN_USERNAME || 'superadmin').toLowerCase();
  const existing = await prisma.admin.findUnique({ where: { username } });
  const { password, generated } = resolvePassword('SEED_ADMIN_PASSWORD', Boolean(existing));

  if (existing && !password) {
    console.log(`👤 Admin "${username}" exists — password unchanged.`);
    return;
  }
  const passwordHash = await bcrypt.hash(password!, 10);
  await prisma.admin.upsert({ where: { username }, update: { passwordHash }, create: { username, passwordHash } });
  console.log(`👤 Admin "${username}" ${existing ? 'password updated' : 'created'}.`);
  if (generated) console.log(`   🔑 Generated password (shown once): ${password}`);
}

async function upsertOperator(facilityId: string) {
  const username = (process.env.SEED_OPERATOR_USERNAME || 'operator1').toLowerCase();
  const existing = await prisma.operator.findUnique({ where: { username } });
  const { password, generated } = resolvePassword('SEED_OPERATOR_PASSWORD', Boolean(existing));

  if (existing && !password) {
    console.log(`👷 Operator "${username}" exists — password unchanged.`);
    return;
  }
  const passwordHash = await bcrypt.hash(password!, 10);
  await prisma.operator.upsert({
    where: { username },
    update: { passwordHash },
    create: { username, passwordHash, facilityId },
  });
  console.log(`👷 Operator "${username}" (${FACILITY_NAME}) ${existing ? 'password updated' : 'created'}.`);
  if (generated) console.log(`   🔑 Generated password (shown once): ${password}`);
}

async function main() {
  console.log('🌱 Starting database seed...\n');

  if (process.env.SEED_RESET === 'true') {
    await resetAll();
  }

  const facility = await ensureFacility();
  await upsertAdmin();
  await upsertOperator(facility.id);

  console.log('\n🚧 Gate QR codes:');
  for (const gate of facility.gates) {
    console.log(`   ${gate.gateType.padEnd(5)} ${gate.gateName}: ${gate.qrCodeData}`);
  }
  console.log('\n✅ Seed complete.\n');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
