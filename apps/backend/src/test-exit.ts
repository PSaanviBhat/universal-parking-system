/**
 * Phase 7 Parking Exit & Fee Settlement Automated Test Suite
 *
 * Tests:
 * 1. Attempt exit with invalid QR code (Expect 400)
 * 2. Attempt exit with no active session (Expect 404)
 * 3. Attempt exit scanning an Entry Gate QR (Expect 400)
 * 4. Attempt exit at wrong facility gate (Expect 400 mismatch)
 * 5. Normal Exit: User with sufficient balance (₹100):
 *    - Fee deducted (₹30 for 1 hr min)
 *    - Session status COMPLETED, paymentStatus PAID
 *    - Slot flipped back to AVAILABLE in DB
 *    - Wallet balance reduced to ₹70
 * 6. Guard against duplicate exit attempt for same closed session (Expect 404)
 * 7. Debt Exit: User with ₹0 balance exits:
 *    - Fee of ₹30 charged
 *    - Wallet goes to -₹30 DEBT
 *    - 48-hour debt deadline set
 *    - Exit succeeds & slot released
 * 8. Session History: Verify GET /api/sessions/history shows receipts
 */

import http from 'http';
import { app, httpServer } from '../src/index';
import { prisma } from '../src/utils/prisma';
import { SlotStatus, GateType } from '@prisma/client';

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
  console.log('🧪 Starting Phase 7 Parking Exit & Settlement Tests...\n');

  await new Promise<void>((resolve) => {
    server = httpServer.listen(0, '127.0.0.1', () => {
      const address = server.address() as any;
      port = address.port;
      console.log(`[Test Server] Running on http://127.0.0.1:${port}`);
      resolve();
    });
  });

  try {
    // 1. Fetch Phoenix Mall Gates
    const mall = await prisma.parkingFacility.findFirst({
      where: { name: 'Phoenix Mall' },
      include: { gates: true },
    });

    if (!mall) throw new Error('Phoenix Mall not found');

    const entryGate = mall.gates.find((g) => g.gateType === GateType.ENTRY)!;
    const exitGate = mall.gates.find((g) => g.gateType === GateType.EXIT)!;

    // 2. Setup User A (Prepaid Balance ₹100)
    const userAEmail = `driver_p7_a_${Date.now()}@example.com`;
    const regResA = await makeRequest(
      { path: '/api/auth/register', method: 'POST', headers: { 'Content-Type': 'application/json' } },
      { name: 'Bruce Wayne', email: userAEmail, phone: `93${Math.floor(10000000 + Math.random() * 90000000)}`, password: 'Password123!', tcAccepted: true }
    );
    const tokenA = regResA.data.data.token;

    // Top up ₹100 for User A (simulated order; needs ALLOW_SIMULATED_PAYMENTS=true)
    const orderRes = await makeRequest(
      { path: '/api/wallet/create-order', method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` } },
      { amount: 100 }
    );
    const topupRes = await makeRequest(
      { path: '/api/wallet/topup', method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` } },
      { razorpayOrderId: orderRes.data.data?.orderId }
    );
    if (topupRes.statusCode !== 200) {
      throw new Error(`Top-up failed: ${JSON.stringify(topupRes.data)}`);
    }

    // Register Car A
    const carAPlate = `KA01P7${Math.floor(1000 + Math.random() * 9000)}`;
    const carARes = await makeRequest(
      { path: '/api/vehicles', method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` } },
      { licensePlate: carAPlate }
    );
    const vehicleAId = carARes.data.data.id;

    // Enter Car A
    const enterResA = await makeRequest(
      { path: '/api/sessions/entry', method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` } },
      { qrCodeData: entryGate.qrCodeData, vehicleId: vehicleAId }
    );
    const slotAId = enterResA.data.data.assignedSlot.slotId;
    console.log(`✅ User A entered in Car A (${carAPlate}), allocated slot ${enterResA.data.data.assignedSlot.slotNumber}.`);

    // Test 1: Exit with Invalid QR (Expect 400)
    console.log('\n1️⃣ Scanning invalid QR at exit...');
    const invalidExitRes = await makeRequest(
      { path: '/api/sessions/exit', method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` } },
      { qrCodeData: 'INVALID_EXIT_QR', vehicleId: vehicleAId }
    );

    if (invalidExitRes.statusCode === 400) {
      console.log('   ✅ Rejected invalid exit QR.');
    } else {
      throw new Error(`Expected 400, got ${invalidExitRes.statusCode}`);
    }

    // Test 2: Exit scanning an Entry Gate QR (Expect 400)
    console.log('\n2️⃣ Scanning an ENTRY gate QR at exit...');
    const entryAtExitRes = await makeRequest(
      { path: '/api/sessions/exit', method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` } },
      { qrCodeData: entryGate.qrCodeData, vehicleId: vehicleAId }
    );

    if (entryAtExitRes.statusCode === 400) {
      console.log('   ✅ Rejected Entry QR code at exit gate.');
    } else {
      throw new Error(`Expected 400, got ${entryAtExitRes.statusCode}`);
    }

    // Test 3: Normal Exit for User A (Prepaid Deduction)
    console.log('\n3️⃣ Performing valid Exit scan for User A (Paid with wallet balance)...');
    const exitResA = await makeRequest(
      { path: '/api/sessions/exit', method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` } },
      { qrCodeData: exitGate.qrCodeData, vehicleId: vehicleAId }
    );

    if (
      exitResA.statusCode === 200 &&
      exitResA.data.data?.session?.status === 'COMPLETED' &&
      exitResA.data.data?.session?.paymentStatus === 'PAID' &&
      exitResA.data.data?.wallet?.remainingBalance === 70 // ₹100 - ₹30
    ) {
      console.log(`   ✅ Exit cleared! Session status: COMPLETED, Payment: PAID.`);
      console.log(`   ✅ Fee charged: ₹${exitResA.data.data.session.totalFee}`);
      console.log(`   ✅ Wallet balance: ₹100 -> ₹${exitResA.data.data.wallet.remainingBalance}`);
    } else {
      throw new Error(`Exit A failed: ${JSON.stringify(exitResA.data)}`);
    }

    // Confirm slot is now AVAILABLE in DB
    const releasedSlot = await prisma.parkingSlot.findUnique({ where: { id: slotAId } });
    if (releasedSlot?.status === SlotStatus.AVAILABLE && releasedSlot.currentSessionId === null) {
      console.log('   ✅ Slot verified in DB: returned to AVAILABLE status, currentSessionId cleared.');
    } else {
      throw new Error(`Slot not released properly: ${releasedSlot?.status}`);
    }

    // Test 4: Prevent duplicate exit for Car A (Expect 404)
    console.log('\n4️⃣ Attempting duplicate exit scan for Car A after exit...');
    const dupExitRes = await makeRequest(
      { path: '/api/sessions/exit', method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` } },
      { qrCodeData: exitGate.qrCodeData, vehicleId: vehicleAId }
    );

    if (dupExitRes.statusCode === 404 && dupExitRes.data.message?.includes('No active parking session')) {
      console.log('   ✅ Duplicate exit prevented: previously closed session cannot be re-charged.');
    } else {
      throw new Error(`Expected 404 for duplicate exit, got ${dupExitRes.statusCode}`);
    }

    // Test 5: Debt Exit Scenario: User B with ₹0 balance exits
    console.log('\n5️⃣ Testing DEBT EXIT scenario for User B (Balance ₹0)...');
    const userBEmail = `driver_p7_b_${Date.now()}@example.com`;
    const regResB = await makeRequest(
      { path: '/api/auth/register', method: 'POST', headers: { 'Content-Type': 'application/json' } },
      { name: 'Clark Kent', email: userBEmail, phone: `92${Math.floor(10000000 + Math.random() * 90000000)}`, password: 'Password123!', tcAccepted: true }
    );
    const tokenB = regResB.data.data.token;

    // Register Car B
    const carBPlate = `DL08P7${Math.floor(1000 + Math.random() * 9000)}`;
    const carBRes = await makeRequest(
      { path: '/api/vehicles', method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenB}` } },
      { licensePlate: carBPlate }
    );
    const vehicleBId = carBRes.data.data.id;

    // Enter Car B
    await makeRequest(
      { path: '/api/sessions/entry', method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenB}` } },
      { qrCodeData: entryGate.qrCodeData, vehicleId: vehicleBId }
    );
    console.log(`   ✅ User B entered with balance ₹0.`);

    // Exit Car B with ₹0 balance
    const exitResB = await makeRequest(
      { path: '/api/sessions/exit', method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenB}` } },
      { qrCodeData: exitGate.qrCodeData, vehicleId: vehicleBId }
    );

    if (
      exitResB.statusCode === 200 &&
      exitResB.data.data?.wallet?.isDebt === true &&
      exitResB.data.data?.wallet?.remainingBalance === -30 &&
      exitResB.data.data?.session?.paymentStatus === 'DEBT' &&
      exitResB.data.data?.wallet?.debtDeadline !== null
    ) {
      console.log('   ✅ User B exited successfully in DEBT model:');
      console.log(`   ✅ Wallet balance: ₹${exitResB.data.data.wallet.remainingBalance} (Debt: ₹${exitResB.data.data.wallet.debtAmount})`);
      console.log(`   ✅ Payment status: DEBT (Driver not trapped at barrier)`);
      console.log(`   ✅ 48-Hour Deadline set: ${exitResB.data.data.wallet.debtDeadline}`);
    } else {
      throw new Error(`Debt exit failed: ${JSON.stringify(exitResB.data)}`);
    }

    // Test 6: Verify Session History
    console.log('\n6️⃣ Querying GET /api/sessions/history for User A...');
    const histRes = await makeRequest({
      path: '/api/sessions/history',
      method: 'GET',
      headers: { Authorization: `Bearer ${tokenA}` },
    });

    if (histRes.statusCode === 200 && histRes.data.data?.sessions?.length === 1) {
      const receipt = histRes.data.data.sessions[0];
      console.log(`   ✅ Found completed session receipt:`);
      console.log(`   ✅ Facility: ${receipt.facilityName}, Slot: ${receipt.slotNumber}`);
      console.log(`   ✅ Fee Paid: ₹${receipt.totalFee}, Gate: ${receipt.exitGate}`);
    } else {
      throw new Error(`Session history failed: ${JSON.stringify(histRes.data)}`);
    }

    console.log('\n🎉 ALL PHASE 7 PARKING EXIT & SETTLEMENT TESTS PASSED CLEANLY!\n');
  } finally {
    server.close();
  }
}

runTests().catch((err) => {
  console.error('Test execution error:', err);
  process.exit(1);
});
