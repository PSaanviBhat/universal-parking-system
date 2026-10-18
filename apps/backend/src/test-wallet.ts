/**
 * Phase 4 Wallet System Automated Test Suite
 *
 * Tests:
 * 1. Fetch initial wallet (balance 0, no debt)
 * 2. Reject top-up below minimum limit (< ₹35)
 * 3. Successful top-up (>= ₹35) & balance update
 * 4. Verify transaction record in transaction history
 * 5. Simulate wallet going into debt & verify 48h deadline calculation
 * 6. Repay debt with top-up & verify debt status is cleared
 */

import http from 'http';
import { app, httpServer } from '../src/index';
import { prisma } from '../src/utils/prisma';

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
  console.log('🧪 Starting Phase 4 Wallet System Tests...\n');

  await new Promise<void>((resolve) => {
    server = httpServer.listen(0, '127.0.0.1', () => {
      const address = server.address() as any;
      port = address.port;
      console.log(`[Test Server] Running on http://127.0.0.1:${port}`);
      resolve();
    });
  });

  try {
    // 1. Create test user
    const userEmail = `wallet_user_${Date.now()}@example.com`;
    const regRes = await makeRequest(
      { path: '/api/auth/register', method: 'POST', headers: { 'Content-Type': 'application/json' } },
      { name: 'Wallet Tester', email: userEmail, phone: `95${Math.floor(10000000 + Math.random() * 90000000)}`, password: 'Password123!', tcAccepted: true }
    );
    const token = regRes.data.data.token;
    const userId = regRes.data.data.user.id;

    // Test 1: Query initial wallet info
    console.log('1️⃣ Fetching initial wallet info...');
    const walletRes = await makeRequest({
      path: '/api/wallet',
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (walletRes.statusCode === 200 && walletRes.data.data?.balance === 0 && !walletRes.data.data?.isDebt) {
      console.log('   ✅ Initial wallet verified: balance ₹0.00, isDebt = false.');
    } else {
      throw new Error(`Failed initial wallet check: ${walletRes.statusCode}`);
    }

    // Test 2: Top-up below ₹35 (Expect 400)
    console.log('\n2️⃣ Testing top-up below minimum limit (e.g. ₹20)...');
    const topupBelowRes = await makeRequest(
      {
        path: '/api/wallet/topup',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      },
      { amount: 20 }
    );

    if (topupBelowRes.statusCode === 400 && topupBelowRes.data.message?.includes('₹35')) {
      console.log('   ✅ Rejected top-up below ₹35 minimum floor.');
    } else {
      throw new Error(`Expected 400 rejection for ₹20 top-up, got ${topupBelowRes.statusCode}`);
    }

    // Test 3: Valid Top-up (₹100)
    console.log('\n3️⃣ Testing valid top-up of ₹100...');
    const topupValidRes = await makeRequest(
      {
        path: '/api/wallet/topup',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      },
      { amount: 100, razorpayPaymentId: 'pay_test_12345' }
    );

    if (topupValidRes.statusCode === 200 && topupValidRes.data.data?.newBalance === 100) {
      console.log('   ✅ Wallet balance successfully updated to ₹100.00.');
    } else {
      throw new Error(`Top-up failed: ${topupValidRes.statusCode} ${JSON.stringify(topupValidRes.data)}`);
    }

    // Test 4: Verify transactions list
    console.log('\n4️⃣ Checking transaction history log...');
    const txRes = await makeRequest({
      path: '/api/wallet/transactions',
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (txRes.statusCode === 200 && txRes.data.data?.transactions?.length === 1) {
      const tx = txRes.data.data.transactions[0];
      console.log(`   ✅ Transaction recorded: ${tx.type} for ₹${tx.amount} (${tx.description})`);
    } else {
      throw new Error(`Transaction history verification failed: ${txRes.statusCode}`);
    }

    // Test 5: Simulate wallet going into Debt (e.g. balance -₹60)
    console.log('\n5️⃣ Simulating exit charge resulting in -₹60 debt & 48h deadline...');
    const debtTime = new Date();
    const deadlineTime = new Date(debtTime.getTime() + 48 * 60 * 60 * 1000);

    await prisma.wallet.update({
      where: { userId },
      data: {
        balance: -60,
        debtCreatedAt: debtTime,
        debtDeadline: deadlineTime,
      },
    });

    const debtWalletRes = await makeRequest({
      path: '/api/wallet',
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (
      debtWalletRes.statusCode === 200 &&
      debtWalletRes.data.data?.isDebt === true &&
      debtWalletRes.data.data?.debtAmount === 60 &&
      debtWalletRes.data.data?.debtHoursRemaining > 47
    ) {
      console.log(`   ✅ Wallet in DEBT verified: Amount ₹${debtWalletRes.data.data.debtAmount}`);
      console.log(`   ✅ 48h countdown active: ~${debtWalletRes.data.data.debtHoursRemaining} hours remaining`);
    } else {
      throw new Error(`Debt check failed: ${JSON.stringify(debtWalletRes.data)}`);
    }

    // Test 6: Repay Debt with Top-up (₹100 topup against ₹60 debt -> +₹40 balance)
    console.log('\n6️⃣ Repaying debt with ₹100 top-up...');
    const repayRes = await makeRequest(
      {
        path: '/api/wallet/topup',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      },
      { amount: 100, razorpayPaymentId: 'pay_repay_9999' }
    );

    if (repayRes.statusCode === 200 && repayRes.data.data?.newBalance === 40 && !repayRes.data.data?.isDebt) {
      console.log('   ✅ Debt cleared! New positive balance: ₹40.00.');
    } else {
      throw new Error(`Debt repayment failed: ${JSON.stringify(repayRes.data)}`);
    }

    // Confirm wallet reflects cleared debt state
    const clearedWalletRes = await makeRequest({
      path: '/api/wallet',
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (clearedWalletRes.data.data?.debtDeadline === null && !clearedWalletRes.data.data?.isDebt) {
      console.log('   ✅ Wallet verified clean with null debt deadline.');
    } else {
      throw new Error('Wallet still has debt fields set.');
    }

    console.log('\n🎉 ALL PHASE 4 WALLET TESTS PASSED CLEANLY!\n');
  } finally {
    server.close();
  }
}

runTests().catch((err) => {
  console.error('Test execution error:', err);
  process.exit(1);
});
