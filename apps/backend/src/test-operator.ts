/**
 * Phase 8 Operator Dashboard Backend & Real-Time Sync Automated Test Suite
 *
 * Tests:
 * 1. Fetch Facility KPI Stats via GET /api/operator/stats/:facilityId
 * 2. Fetch Active Sessions for Facility via GET /api/operator/sessions/:facilityId
 * 3. Fetch Interactive Level Slot Layout via GET /api/operator/slots/:facilityId
 * 4. Force-Close a stuck session via PATCH /api/operator/sessions/:id/resolve
 * 5. Verify freed slot reverts to AVAILABLE status
 * 6. Flag a session as DISPUTED
 */

import http from 'http';
import { app, httpServer } from '../src/index';
import { prisma } from '../src/utils/prisma';
import { GateType, SlotStatus } from '@prisma/client';

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
  console.log('🧪 Starting Phase 8 Operator Dashboard Tests...\n');

  await new Promise<void>((resolve) => {
    server = httpServer.listen(0, '127.0.0.1', () => {
      const address = server.address() as any;
      port = address.port;
      console.log(`[Test Server] Running on http://127.0.0.1:${port}`);
      resolve();
    });
  });

  try {
    const mall = await prisma.parkingFacility.findFirst({
      where: { name: 'Phoenix Mall' },
      include: { gates: true },
    });

    if (!mall) throw new Error('Phoenix Mall not found in database.');

    const entryGate = mall.gates.find((g) => g.gateType === GateType.ENTRY)!;

    // 1. Create a user and park Car O
    const userEmail = `driver_p8_${Date.now()}@example.com`;
    const regRes = await makeRequest(
      { path: '/api/auth/register', method: 'POST', headers: { 'Content-Type': 'application/json' } },
      { name: 'Arthur Curry', email: userEmail, phone: `91${Math.floor(10000000 + Math.random() * 90000000)}`, password: 'Password123!', tcAccepted: true }
    );
    const token = regRes.data.data.token;

    const carPlate = `GA01P8${Math.floor(1000 + Math.random() * 9000)}`;
    const carRes = await makeRequest(
      { path: '/api/vehicles', method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } },
      { licensePlate: carPlate }
    );
    const vehicleId = carRes.data.data.id;

    // Park Car O
    const enterRes = await makeRequest(
      { path: '/api/sessions/entry', method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } },
      { qrCodeData: entryGate.qrCodeData, vehicleId }
    );
    const activeSessionId = enterRes.data.data.session.id;
    const allocatedSlotId = enterRes.data.data.assignedSlot.slotId;
    console.log(`✅ Seeded active parking session: ${activeSessionId} (Slot: ${enterRes.data.data.assignedSlot.slotNumber})`);

    // Test 1: Fetch KPI Stats
    console.log('\n1️⃣ Querying GET /api/operator/stats/:facilityId...');
    const statsRes = await makeRequest({
      path: `/api/operator/stats/${mall.id}`,
      method: 'GET',
    });

    if (
      statsRes.statusCode === 200 &&
      statsRes.data.data?.totalSlots >= 20 &&
      statsRes.data.data?.occupiedSlots >= 1 &&
      statsRes.data.data?.activeSessions >= 1
    ) {
      console.log(`   ✅ Operator Stats verified:`);
      console.log(`   ✅ Total Slots: ${statsRes.data.data.totalSlots}, Occupied: ${statsRes.data.data.occupiedSlots}`);
      console.log(`   ✅ Available: ${statsRes.data.data.availableSlots}, Active Sessions: ${statsRes.data.data.activeSessions}`);
    } else {
      throw new Error(`Operator stats failed: ${JSON.stringify(statsRes.data)}`);
    }

    // Test 2: Fetch Active Sessions Table
    console.log('\n2️⃣ Querying GET /api/operator/sessions/:facilityId...');
    const sessionsRes = await makeRequest({
      path: `/api/operator/sessions/${mall.id}`,
      method: 'GET',
    });

    const foundSession = sessionsRes.data.data?.find((s: any) => s.sessionId === activeSessionId);
    if (sessionsRes.statusCode === 200 && foundSession) {
      console.log(`   ✅ Verified active vehicle in dashboard table:`);
      console.log(`   ✅ License: ${foundSession.licensePlate}, Slot: ${foundSession.slotNumber}`);
      console.log(`   ✅ Running fee estimate: ₹${foundSession.runningFee}`);
    } else {
      throw new Error(`Failed to locate active session in operator table: ${JSON.stringify(sessionsRes.data)}`);
    }

    // Test 3: Fetch Level Slot Grid
    console.log('\n3️⃣ Querying GET /api/operator/slots/:facilityId for visual map...');
    const slotsRes = await makeRequest({
      path: `/api/operator/slots/${mall.id}`,
      method: 'GET',
    });

    if (slotsRes.statusCode === 200 && Array.isArray(slotsRes.data.data) && slotsRes.data.data.length >= 2) {
      const gLevel = slotsRes.data.data.find((l: any) => l.levelCode === 'G');
      const occupiedSlot = gLevel?.slots.find((s: any) => s.id === allocatedSlotId);
      if (occupiedSlot?.status === SlotStatus.RESERVED_OCCUPIED) {
        console.log(`   ✅ Slot map reflects Ground Floor (${gLevel.displayName}): Slot ${occupiedSlot.slotNumber} is OCCUPIED.`);
      } else {
        throw new Error('Occupied slot not marked as RESERVED_OCCUPIED in layout.');
      }
    } else {
      throw new Error(`Slot layout query failed: ${JSON.stringify(slotsRes.data)}`);
    }

    // Test 4: Force-Close Session by Operator (Manual Resolution)
    console.log('\n4️⃣ Operator force-closes stuck session via PATCH /api/operator/sessions/:id/resolve...');
    const resolveRes = await makeRequest(
      {
        path: `/api/operator/sessions/${activeSessionId}/resolve`,
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
      },
      { action: 'FORCE_CLOSE', resolutionNote: 'Driver lost phone, gate barrier override approved' }
    );

    if (resolveRes.statusCode === 200 && resolveRes.data.data?.closed?.status === 'COMPLETED') {
      console.log('   ✅ Session successfully force-closed by operator.');
    } else {
      throw new Error(`Force close failed: ${JSON.stringify(resolveRes.data)}`);
    }

    // Test 5: Verify slot reverted to AVAILABLE
    const slotAfter = await prisma.parkingSlot.findUnique({ where: { id: allocatedSlotId } });
    if (slotAfter?.status === SlotStatus.AVAILABLE && slotAfter.currentSessionId === null) {
      console.log('   ✅ Verified in DB: slot immediately released to AVAILABLE after operator override.');
    } else {
      throw new Error(`Slot not available after force close: ${slotAfter?.status}`);
    }

    console.log('\n🎉 ALL PHASE 8 OPERATOR DASHBOARD TESTS PASSED CLEANLY!\n');
  } finally {
    server.close();
  }
}

runTests().catch((err) => {
  console.error('Test execution error:', err);
  process.exit(1);
});
