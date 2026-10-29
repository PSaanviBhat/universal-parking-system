/**
 * Debt, Autopay & Enforcement Worker Automated Test Suite
 *
 * Each user builds real debt (enter + exit with ₹0), then the 48h deadline is backdated.
 * 1. Autopay success: saved payment method + autopay authorised
 *    -> AUTOPAY credit, wallet back to ₹0, debt window closed, DEBT session -> PAID.
 * 2. Autopay failure: no payment method
 *    -> suspended + blacklisted, ONE account-level SuspensionRecord, ONE ₹DEBT_FINE_AMOUNT
 *       FINE transaction, DEBT session -> FINED.
 * 3. Re-running the worker does not fine again.
 * 4. Two overlapping worker runs process a wallet exactly once (row lock).
 * 5. Suspended user is refused at the entry gate (403).
 * 6. Wallet API exposes the fine amount and suspension state.
 * 7. Topping up the full debt + fine reinstates the account and marks sessions PAID.
 * 8. Reinstated user can enter again.
 *
 * Needs ALLOW_SIMULATED_PAYMENTS=true (simulated top-up orders).
 */

import http from 'http';
import { httpServer } from '../src/index';
import { prisma } from '../src/utils/prisma';
import { processExpiredDebts, DEBT_FINE_AMOUNT } from '../src/services/debtWorker';
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
          resolve({ statusCode: res.statusCode || 500, data: JSON.parse(data) });
        } catch {
          resolve({ statusCode: res.statusCode || 500, data });
        }
      });
    });
    req.on('error', (err) => reject(err));
    if (bodyData) req.write(JSON.stringify(bodyData));
    req.end();
  });
}

const authed = (token: string, path: string, method = 'GET') => ({
  path,
  method,
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
});

function assert(cond: unknown, message: string, detail?: unknown): void {
  if (!cond) throw new Error(`${message}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ''}`);
  console.log(`   ✅ ${message}`);
}

let seq = 0;
async function driverWithDebt(entryQr: string, exitQr: string, tag: string) {
  const n = `${Date.now().toString().slice(-6)}${++seq}`;
  const reg = await makeRequest(
    { path: '/api/auth/register', method: 'POST', headers: { 'Content-Type': 'application/json' } },
    { name: `Debt ${tag}`, email: `debt_${tag}_${n}@example.test`, phone: `8${n}000`.slice(0, 10), password: 'Password123!', tcAccepted: true }
  );
  const token: string = reg.data.data.token;
  const userId: string = reg.data.data.user.id;
  const car = await makeRequest(authed(token, '/api/vehicles', 'POST'), { licensePlate: `DB${tag}${n}`.slice(0, 12) });
  const vehicleId: string = car.data.data.id;

  await makeRequest(authed(token, '/api/sessions/entry', 'POST'), { qrCodeData: entryQr, vehicleId });
  const exit = await makeRequest(authed(token, '/api/sessions/exit', 'POST'), { qrCodeData: exitQr, vehicleId });
  const sessionId: string = exit.data.data.session.id;
  const fee: number = exit.data.data.session.totalFee;

  // Expire the 48h window
  await prisma.wallet.update({
    where: { userId },
    data: {
      debtCreatedAt: new Date(Date.now() - 50 * 60 * 60 * 1000),
      debtDeadline: new Date(Date.now() - 2 * 60 * 60 * 1000),
    },
  });
  return { token, userId, vehicleId, sessionId, fee };
}

async function runTests() {
  console.log('🧪 Starting Debt, Autopay & Enforcement Tests...\n');

  await new Promise<void>((resolve) => {
    server = httpServer.listen(0, '127.0.0.1', () => {
      port = (server.address() as any).port;
      resolve();
    });
  });

  try {
    const mall = await prisma.parkingFacility.findFirst({ where: { name: 'Phoenix Mall' }, include: { gates: true } });
    if (!mall) throw new Error('Phoenix Mall not found.');
    const entryQr = mall.gates.find((g) => g.gateType === GateType.ENTRY)!.qrCodeData;
    const exitQr = mall.gates.find((g) => g.gateType === GateType.EXIT)!.qrCodeData;

    // 1. Autopay success
    console.log('1️⃣ Autopay success (saved card, autopay authorised)...');
    const a = await driverWithDebt(entryQr, exitQr, 'A');
    await prisma.paymentMethod.create({
      data: { userId: a.userId, type: 'CARD', razorpayToken: 'token_card_success_123', isPrimary: true },
    });
    await processExpiredDebts();
    const walletA = await prisma.wallet.findUnique({ where: { userId: a.userId } });
    assert(walletA?.balance.toNumber() === 0 && walletA.debtDeadline === null, 'Debt recovered, balance ₹0, window closed', walletA);
    const autopayTxns = await prisma.walletTransaction.count({ where: { walletId: walletA!.id, type: 'AUTOPAY' } });
    assert(autopayTxns === 1, 'Exactly one AUTOPAY transaction', autopayTxns);
    const sessionA = await prisma.parkingSession.findUnique({ where: { id: a.sessionId } });
    assert(sessionA?.paymentStatus === 'PAID', 'DEBT session marked PAID', sessionA?.paymentStatus);
    const userA = await prisma.user.findUnique({ where: { id: a.userId } });
    assert(!userA?.isSuspended, 'User A not suspended');

    // 2. Autopay failure
    console.log('\n2️⃣ Autopay failure (no payment method)...');
    const b = await driverWithDebt(entryQr, exitQr, 'B');
    await processExpiredDebts();
    const userB = await prisma.user.findUnique({
      where: { id: b.userId },
      include: { wallet: true, suspensionRecords: true },
    });
    const expectedBalance = -(b.fee + DEBT_FINE_AMOUNT);
    assert(userB?.isSuspended && userB.isBlacklisted, 'Account suspended and blacklisted');
    assert(
      userB!.suspensionRecords.length === 1 &&
        userB!.suspensionRecords[0].vehicleId === null &&
        userB!.suspensionRecords[0].fineAmount.toNumber() === DEBT_FINE_AMOUNT,
      `One account-level SuspensionRecord with ₹${DEBT_FINE_AMOUNT} fine`,
      userB!.suspensionRecords
    );
    assert(userB!.wallet!.balance.toNumber() === expectedBalance, `Balance is -(fee + fine) = ₹${expectedBalance}`, userB!.wallet!.balance);
    const sessionB = await prisma.parkingSession.findUnique({ where: { id: b.sessionId } });
    assert(sessionB?.paymentStatus === 'FINED', 'DEBT session marked FINED', sessionB?.paymentStatus);

    // 3. No double fine
    console.log('\n3️⃣ Re-running the worker...');
    await processExpiredDebts();
    const fines = await prisma.walletTransaction.count({ where: { walletId: userB!.wallet!.id, type: 'FINE' } });
    assert(fines === 1, 'Still exactly one FINE transaction', fines);

    // 4. Overlapping runs
    console.log('\n4️⃣ Two overlapping worker runs...');
    const c = await driverWithDebt(entryQr, exitQr, 'C');
    await Promise.all([processExpiredDebts(), processExpiredDebts()]);
    const walletC = await prisma.wallet.findUnique({ where: { userId: c.userId } });
    const finesC = await prisma.walletTransaction.count({ where: { walletId: walletC!.id, type: 'FINE' } });
    const recordsC = await prisma.suspensionRecord.count({ where: { userId: c.userId } });
    assert(finesC === 1 && recordsC === 1, 'Wallet fined and suspended exactly once', { finesC, recordsC });

    // 5. Entry blocked
    console.log('\n5️⃣ Suspended user at the entry gate...');
    const blocked = await makeRequest(authed(b.token, '/api/sessions/entry', 'POST'), { qrCodeData: entryQr, vehicleId: b.vehicleId });
    assert(blocked.statusCode === 403 && blocked.data.isSuspended === true, 'Entry refused with 403', blocked);

    // 6. Wallet API
    const walletApi = await makeRequest(authed(b.token, '/api/wallet'));
    assert(
      walletApi.data.data.rules.fineAmount === DEBT_FINE_AMOUNT && walletApi.data.data.isSuspended === true,
      'Wallet API shows fine amount and suspension',
      walletApi.data.data
    );

    // 7. Reinstatement
    console.log('\n6️⃣ Repaying debt + fine...');
    const owed = Math.abs(expectedBalance);
    const order = await makeRequest(authed(b.token, '/api/wallet/create-order', 'POST'), { amount: owed + 10 });
    const repay = await makeRequest(authed(b.token, '/api/wallet/topup', 'POST'), { razorpayOrderId: order.data.data?.orderId });
    assert(repay.statusCode === 200 && repay.data.data.isReinstated === true && repay.data.data.newBalance === 10, 'Top-up reinstates account, balance ₹10', repay.data);
    const userBAfter = await prisma.user.findUnique({
      where: { id: b.userId },
      include: { suspensionRecords: { where: { isResolved: false } } },
    });
    assert(!userBAfter?.isSuspended && !userBAfter?.isBlacklisted && userBAfter?.suspensionRecords.length === 0, 'Flags cleared, record resolved');
    const sessionBAfter = await prisma.parkingSession.findUnique({ where: { id: b.sessionId } });
    assert(sessionBAfter?.paymentStatus === 'PAID', 'FINED session marked PAID after repayment', sessionBAfter?.paymentStatus);

    // 8. Re-entry
    console.log('\n7️⃣ Reinstated user enters again...');
    const reEntry = await makeRequest(authed(b.token, '/api/sessions/entry', 'POST'), { qrCodeData: entryQr, vehicleId: b.vehicleId });
    assert(reEntry.statusCode === 201, 'Re-entry permitted', reEntry.data);
    await makeRequest(authed(b.token, '/api/sessions/exit', 'POST'), { qrCodeData: exitQr, vehicleId: b.vehicleId });

    console.log('\n🎉 ALL DEBT, AUTOPAY & ENFORCEMENT TESTS PASSED CLEANLY!\n');
  } finally {
    server.close();
    await prisma.$disconnect();
  }
}

runTests().catch((err) => {
  console.error('Test execution error:', err);
  process.exit(1);
});
