/**
 * Phase 9 Debt, Autopay & Enforcement Worker Automated Test Suite
 *
 * Tests:
 * 1. Setup a user whose 48-hour debt window has expired (debtDeadline in the past)
 * 2. Autopay Success scenario:
 *    - Linked payment method present
 *    - Autopay triggers, clears debt, marks transaction, user remains active
 * 3. Autopay Failure scenario:
 *    - No payment method / payment declined
 *    - User account marked suspended (isSuspended = true)
 *    - License plate blacklisted (isBlacklisted = true)
 *    - Penalty fine assessed (SuspensionRecord created + ₹100 fine added to debt)
 * 4. Re-entry enforcement guard:
 *    - Suspended/blacklisted user attempts entry at facility -> strictly rejected (403 Forbidden)
 * 5. Reinstatement workflow:
 *    - User tops up wallet to clear debt + fines
 *    - Account suspension lifted, blacklisted vehicle cleared
 *    - User successfully re-enters facility
 */

import http from 'http';
import { app, httpServer } from '../src/index';
import { prisma } from '../src/utils/prisma';
import { processExpiredDebts, reinstateSuspendedAccount } from '../src/services/debtWorker';
import { GateType } from '@prisma/client';

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
  console.log('🧪 Starting Phase 9 Debt & Autopay Worker Tests...\n');

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
    if (!mall) throw new Error('Phoenix Mall not found.');

    const entryGate = mall.gates.find((g) => g.gateType === GateType.ENTRY)!;

    // ─────────────────────────────────────────────────────────────────────────
    // TEST CASE A: AUTOPAY SUCCESS
    // ─────────────────────────────────────────────────────────────────────────
    console.log('1️⃣ Setting up User A with an expired debt (-₹60) and linked card token...');
    const userAEmail = `autopay_success_${Date.now()}@example.com`;
    const regResA = await makeRequest(
      { path: '/api/auth/register', method: 'POST', headers: { 'Content-Type': 'application/json' } },
      { name: 'Bruce Wayne', email: userAEmail, phone: `91${Math.floor(10000000 + Math.random() * 90000000)}`, password: 'Password123!', tcAccepted: true }
    );
    const userAId = regResA.data.data.user.id;

    // Link a simulated payment method
    const pmA = await prisma.paymentMethod.create({
      data: {
        userId: userAId,
        type: 'CARD',
        razorpayToken: 'token_card_success_123',
        isPrimary: true,
      },
    });

    // Put User A in expired debt (deadline set 2 hours ago)
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const fiftyHoursAgo = new Date(Date.now() - 50 * 60 * 60 * 1000);

    await prisma.wallet.update({
      where: { userId: userAId },
      data: {
        balance: -60,
        debtCreatedAt: fiftyHoursAgo,
        debtDeadline: twoHoursAgo,
        linkedPaymentMethodId: pmA.id,
      },
    });

    console.log('   ✅ Triggering debt worker (rate 1.0 = 100% success for card holders)...');
    const workerResultA = await processExpiredDebts(1.0);

    const walletAfterA = await prisma.wallet.findUnique({ where: { userId: userAId } });
    if (walletAfterA?.balance.toNumber() === 0 && walletAfterA.debtDeadline === null) {
      console.log('   ✅ Autopay recovered ₹60 from linked card. Debt cleared, balance restored to ₹0.');
    } else {
      throw new Error(`Autopay success test failed: balance is ${walletAfterA?.balance}`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TEST CASE B: AUTOPAY FAILURE -> SUSPENSION, BLACKLIST & FINE
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n2️⃣ Setting up User B with expired debt (-₹45) and NO payment method (Autopay Fails)...');
    const userBEmail = `autopay_fail_${Date.now()}@example.com`;
    const regResB = await makeRequest(
      { path: '/api/auth/register', method: 'POST', headers: { 'Content-Type': 'application/json' } },
      { name: 'Joker', email: userBEmail, phone: `90${Math.floor(10000000 + Math.random() * 90000000)}`, password: 'Password123!', tcAccepted: true }
    );
    const tokenB = regResB.data.data.token;
    const userBId = regResB.data.data.user.id;

    // Register Car B
    const carBPlate = `DL09P9${Math.floor(1000 + Math.random() * 9000)}`;
    const carBRes = await makeRequest(
      { path: '/api/vehicles', method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenB}` } },
      { licensePlate: carBPlate }
    );
    const vehicleBId = carBRes.data.data.id;

    // Put User B in expired debt
    await prisma.wallet.update({
      where: { userId: userBId },
      data: {
        balance: -45,
        debtCreatedAt: fiftyHoursAgo,
        debtDeadline: twoHoursAgo,
      },
    });

    console.log('   ✅ Triggering debt worker (expect failure and enforcement)...');
    const workerResultB = await processExpiredDebts(0.0); // 0% success force failure

    const userBCheck = await prisma.user.findUnique({
      where: { id: userBId },
      include: {
        wallet: true,
        suspensionRecords: true,
      },
    });

    if (
      userBCheck?.isSuspended === true &&
      userBCheck.isBlacklisted === true &&
      userBCheck.suspensionRecords.length > 0 &&
      userBCheck.wallet?.balance.toNumber() === -145 // -45 original debt - 100 fine
    ) {
      console.log('   ✅ Enforcement Policy Applied:');
      console.log(`   ✅ isSuspended = true, isBlacklisted = true`);
      console.log(`   ✅ Fine assessed: ₹100. Total debt updated: ₹${userBCheck.wallet.balance}`);
      console.log(`   ✅ SuspensionRecord logged: "${userBCheck.suspensionRecords[0].reason}"`);
    } else {
      throw new Error(`Enforcement test failed: ${JSON.stringify(userBCheck)}`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TEST CASE C: SUSPENDED USER ATTEMPTS RE-ENTRY (Strict 403 Forbidden)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n3️⃣ Suspended user attempts entering facility with blacklisted car...');
    const reEntryRes = await makeRequest(
      { path: '/api/sessions/entry', method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenB}` } },
      { qrCodeData: entryGate.qrCodeData, vehicleId: vehicleBId }
    );

    if (reEntryRes.statusCode === 403 && reEntryRes.data.isSuspended === true) {
      console.log('   ✅ Re-entry blocked at gate with 403 Forbidden: "Account suspended due to unpaid debt".');
    } else {
      throw new Error(`Expected 403 Forbidden on suspended user entry, got ${reEntryRes.statusCode}`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TEST CASE D: REINSTATEMENT (User repays full debt + fine via Top-up)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n4️⃣ User B repays full debt + fine (Tops up ₹150 against -₹145 balance)...');
    const repayRes = await makeRequest(
      { path: '/api/wallet/topup', method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenB}` } },
      { amount: 150 }
    );

    if (repayRes.statusCode === 200 && repayRes.data.data?.isReinstated === true && repayRes.data.data?.newBalance === 5) {
      console.log('   ✅ Top-up successful! New positive balance: ₹5.00.');
      console.log('   ✅ Automatic Reinstatement triggered: isReinstated = true.');
    } else {
      throw new Error(`Reinstatement topup failed: ${JSON.stringify(repayRes.data)}`);
    }

    // Verify DB flags cleared
    const userBReinstated = await prisma.user.findUnique({
      where: { id: userBId },
      include: { suspensionRecords: { where: { isResolved: false } } },
    });

    if (!userBReinstated?.isSuspended && !userBReinstated?.isBlacklisted && userBReinstated?.suspensionRecords.length === 0) {
      console.log('   ✅ Verified in DB: user is no longer suspended or blacklisted.');
    } else {
      throw new Error('User still has suspension flags active.');
    }

    // User B enters facility successfully now!
    console.log('\n5️⃣ Reinstated User B enters facility again...');
    const reEntryAllowedRes = await makeRequest(
      { path: '/api/sessions/entry', method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenB}` } },
      { qrCodeData: entryGate.qrCodeData, vehicleId: vehicleBId }
    );

    if (reEntryAllowedRes.statusCode === 201 && reEntryAllowedRes.data.data?.assignedSlot?.slotNumber) {
      console.log(`   ✅ Re-entry permitted! Slot allocated: ${reEntryAllowedRes.data.data.assignedSlot.slotNumber}.`);
    } else {
      throw new Error(`Re-entry after reinstatement failed: ${JSON.stringify(reEntryAllowedRes.data)}`);
    }

    console.log('\n🎉 ALL PHASE 9 DEBT, AUTOPAY & ENFORCEMENT TESTS PASSED CLEANLY!\n');
  } finally {
    server.close();
  }
}

runTests().catch((err) => {
  console.error('Test execution error:', err);
  process.exit(1);
});
