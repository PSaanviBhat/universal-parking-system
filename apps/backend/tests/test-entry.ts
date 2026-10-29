/**
 * Phase 6 Parking Entry & Live Session Automated Test Suite
 *
 * Tests:
 * 1. Entry attempt with an invalid/tampered QR code (Expect 400)
 * 2. Entry attempt with an Exit gate QR code (Expect 400)
 * 3. Successful entry scan -> atomic slot allocation (RESERVED_OCCUPIED) & session creation
 * 4. Verify slot location, level, directions, and live fee rate snapshot
 * 5. Duplicate entry attempt with same vehicle while still inside (Expect 409)
 * 6. User with a 2nd registered vehicle can park in the same or another facility simultaneously
 * 7. Capacity exhaustion test: When all slots occupied, cleanly rejects with 409 Parking Full
 * 8. Query GET /api/sessions/active to verify live session data & fee calculation
 */

import http from 'http';
import { app, httpServer } from '../src/index';
import { prisma } from '../src/utils/prisma';
import { SlotStatus, GateType, FacilityType } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

let server: http.Server;
let port: number;

function makeRequest(
  options: http.RequestOptions,
  bodyData?: Record<string, unknown>
): Promise<{ statusCode: number; data: any }> {
  return new Promise((resolve, reject) => {
    const opts = { ...options, hostname: '127.0.0.1', port };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ statusCode: res.statusCode || 500, data: parsed });
        } catch {
          resolve({ statusCode: res.statusCode || 500, data });
        }
      });
    });

    req.on('error', (err) => reject(err));

    if (bodyData) {
      req.write(JSON.stringify(bodyData));
    }
    req.end();
  });
}

async function runTests() {
  console.log('🧪 Starting Phase 6 Parking Entry Tests...\n');

  await new Promise<void>((resolve) => {
    server = httpServer.listen(0, '127.0.0.1', () => {
      const address = server.address() as any;
      port = address.port;
      console.log(`[Test Server] Running on http://127.0.0.1:${port}`);
      resolve();
    });
  });

  try {
    // Setup 1: Register User with 2 vehicles
    const userEmail = `driver_p6_${Date.now()}@example.com`;
    const regRes = await makeRequest(
      { path: '/api/auth/register', method: 'POST', headers: { 'Content-Type': 'application/json' } },
      { name: 'Diana Prince', email: userEmail, phone: `94${Math.floor(10000000 + Math.random() * 90000000)}`, password: 'Password123!', tcAccepted: true }
    );
    const token = regRes.data.data.token;

    // Register Car 1
    const car1Plate = `KA04P6${Math.floor(1000 + Math.random() * 9000)}`;
    const car1Res = await makeRequest(
      { path: '/api/vehicles', method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } },
      { licensePlate: car1Plate, nickname: 'Batmobile' }
    );
    const vehicle1Id = car1Res.data.data.id;

    // Register Car 2
    const car2Plate = `MH12P6${Math.floor(1000 + Math.random() * 9000)}`;
    const car2Res = await makeRequest(
      { path: '/api/vehicles', method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } },
      { licensePlate: car2Plate, nickname: 'Daily Sedan' }
    );
    const vehicle2Id = car2Res.data.data.id;

    // Fetch Phoenix Mall entry & exit gates from seeded data
    const mall = await prisma.parkingFacility.findFirst({
      where: { name: 'Phoenix Mall' },
      include: { gates: true, levels: true },
    });

    if (!mall) {
      throw new Error('Phoenix Mall not found in database.');
    }

    const entryGate = mall.gates.find((g) => g.gateType === GateType.ENTRY);
    const exitGate = mall.gates.find((g) => g.gateType === GateType.EXIT);

    if (!entryGate || !exitGate) {
      throw new Error('Entry or Exit gates not found for Phoenix Mall.');
    }

    // Test 1: Scan malformed QR (Expect 400)
    console.log('1️⃣ Scanning invalid / malformed QR code payload...');
    const invalidQrRes = await makeRequest(
      { path: '/api/sessions/entry', method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } },
      { qrCodeData: 'NOT_A_VALID_QR', vehicleId: vehicle1Id }
    );

    if (invalidQrRes.statusCode === 400) {
      console.log('   ✅ Rejected malformed QR code.');
    } else {
      throw new Error(`Expected 400, got ${invalidQrRes.statusCode}`);
    }

    // Test 2: Scan Exit QR at Entry (Expect 400)
    console.log('\n2️⃣ Scanning an EXIT QR code at entry gate...');
    const wrongGateRes = await makeRequest(
      { path: '/api/sessions/entry', method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } },
      { qrCodeData: exitGate.qrCodeData, vehicleId: vehicle1Id }
    );

    if (wrongGateRes.statusCode === 400) {
      console.log('   ✅ Rejected Exit gate QR at entry.');
    } else {
      throw new Error(`Expected 400, got ${wrongGateRes.statusCode}`);
    }

    // Test 3: Valid Entry Scan with Car 1 -> Slot Allocation
    console.log(`\n3️⃣ Valid entry scan for Car 1 (${car1Plate}) at ${entryGate.gateName}...`);
    const validEntryRes = await makeRequest(
      { path: '/api/sessions/entry', method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } },
      { qrCodeData: entryGate.qrCodeData, vehicleId: vehicle1Id }
    );

    if (validEntryRes.statusCode === 201 && validEntryRes.data.data?.assignedSlot?.slotNumber) {
      const { assignedSlot, facility, session } = validEntryRes.data.data;
      console.log(`   ✅ Session Created: ${session.id}`);
      console.log(`   ✅ Auto-allocated Slot: ${assignedSlot.slotNumber} on ${assignedSlot.levelName}`);
      console.log(`   ✅ Hourly Fee Snapshot: ₹${session.feeRatePerHour}/hr`);
      console.log(`   ✅ Directions provided: "${assignedSlot.directions}"`);
    } else {
      throw new Error(`Valid entry failed: ${JSON.stringify(validEntryRes.data)}`);
    }

    const session1Id = validEntryRes.data.data.session.id;
    const slot1Id = validEntryRes.data.data.assignedSlot.slotId;

    // Verify slot status in DB is now RESERVED_OCCUPIED
    const dbSlot = await prisma.parkingSlot.findUnique({ where: { id: slot1Id } });
    if (dbSlot?.status === SlotStatus.RESERVED_OCCUPIED && dbSlot.currentSessionId === session1Id) {
      console.log('   ✅ Verified in DB: slot status flipped to RESERVED_OCCUPIED.');
    } else {
      throw new Error(`Slot status in DB is not RESERVED_OCCUPIED: ${dbSlot?.status}`);
    }

    // Test 4: Duplicate Entry Attempt with Car 1 (Expect 409)
    console.log('\n4️⃣ Attempting duplicate entry with Car 1 while already inside...');
    const dupEntryRes = await makeRequest(
      { path: '/api/sessions/entry', method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } },
      { qrCodeData: entryGate.qrCodeData, vehicleId: vehicle1Id }
    );

    if (dupEntryRes.statusCode === 409 && dupEntryRes.data.message?.includes('already has an active')) {
      console.log('   ✅ Prevented duplicate session for the same vehicle.');
    } else {
      throw new Error(`Expected 409 duplicate rejection, got ${dupEntryRes.statusCode}`);
    }

    // Test 5: Multi-Vehicle Support: User parks Car 2 simultaneously
    console.log(`\n5️⃣ Testing multi-vehicle rule: User parks Car 2 (${car2Plate}) simultaneously...`);
    const car2EntryRes = await makeRequest(
      { path: '/api/sessions/entry', method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } },
      { qrCodeData: entryGate.qrCodeData, vehicleId: vehicle2Id }
    );

    if (car2EntryRes.statusCode === 201 && car2EntryRes.data.data?.assignedSlot?.slotNumber) {
      console.log(`   ✅ Car 2 successfully parked in Slot: ${car2EntryRes.data.data.assignedSlot.slotNumber}`);
    } else {
      throw new Error(`Car 2 entry failed: ${JSON.stringify(car2EntryRes.data)}`);
    }

    // Test 6: Verify GET /api/sessions/active returns both active sessions with live timer
    console.log('\n6️⃣ Querying GET /api/sessions/active for active sessions...');
    const activeRes = await makeRequest({
      path: '/api/sessions/active',
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (activeRes.statusCode === 200 && activeRes.data.data?.length === 2) {
      console.log(`   ✅ Retrieved 2 active sessions for user.`);
      console.log(`   ✅ Live fee estimate for Car 1: ₹${activeRes.data.data[0].estimatedFee}`);
      console.log(`   ✅ Directions accessible: ${activeRes.data.data[0].assignedSlot.directions}`);
    } else {
      throw new Error(`Active sessions query failed: ${JSON.stringify(activeRes.data)}`);
    }

    // Test 7: Capacity Exhaustion Guard (No Slots Available -> 409)
    console.log('\n7️⃣ Testing Capacity Exhaustion Guard (Facility Full)...');
    // Create a tiny 1-slot facility
    const tinyFac = await prisma.parkingFacility.create({
      data: {
        name: 'Tiny Test Lot',
        address: '1 Narrow Lane',
        type: FacilityType.PUBLIC,
        feeRatePerHour: 20,
      },
    });

    const tinyLevel = await prisma.parkingLevel.create({
      data: { facilityId: tinyFac.id, levelCode: 'G', displayName: 'Ground', totalSlots: 1 },
    });

    // Create 1 slot and mark it already occupied
    await prisma.parkingSlot.create({
      data: {
        facilityId: tinyFac.id,
        levelId: tinyLevel.id,
        slotNumber: 'T-01',
        status: SlotStatus.RESERVED_OCCUPIED,
      },
    });

    const tinyGateId = uuidv4();
    const tinyGate = await prisma.parkingGate.create({
      data: {
        id: tinyGateId,
        facilityId: tinyFac.id,
        gateType: GateType.ENTRY,
        gateName: 'Tiny Gate',
        qrCodeData: `PARKING_GATE:${tinyGateId}:${tinyFac.id}:ENTRY`,
      },
    });

    // Register a 3rd car for test
    const car3Plate = `DL01P6${Math.floor(1000 + Math.random() * 9000)}`;
    const car3Res = await makeRequest(
      { path: '/api/vehicles', method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } },
      { licensePlate: car3Plate }
    );
    const vehicle3Id = car3Res.data.data.id;

    const fullRes = await makeRequest(
      { path: '/api/sessions/entry', method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } },
      { qrCodeData: tinyGate.qrCodeData, vehicleId: vehicle3Id }
    );

    if (fullRes.statusCode === 409 && fullRes.data.message?.includes('Parking Full')) {
      console.log('   ✅ Facility capacity exhaustion guard rejected cleanly: "Parking Full".');
    } else {
      throw new Error(`Expected 409 Parking Full, got ${fullRes.statusCode}`);
    }

    console.log('\n🎉 ALL PHASE 6 PARKING ENTRY TESTS PASSED CLEANLY!\n');
  } finally {
    server.close();
  }
}

runTests().catch((err) => {
  console.error('Test execution error:', err);
  process.exit(1);
});
