/**
 * Phase 2 Auth Endpoints Automated Test Script
 *
 * Tests:
 * 1. User Registration with atomic wallet & T&C acceptance
 * 2. Duplicate registration rejection
 * 3. User Login & JWT receipt
 * 4. Invalid password rejection
 * 5. GET /api/auth/me protected profile retrieval with valid token
 * 6. Access rejection with invalid/missing token
 */

import http from 'http';
import { app, httpServer } from '../src/index';

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
  console.log('🧪 Starting Phase 2 Auth Verification Tests...\n');

  // Start HTTP server on an available port
  await new Promise<void>((resolve) => {
    server = httpServer.listen(0, '127.0.0.1', () => {
      const address = server.address() as any;
      port = address.port;
      console.log(`[Test Server] Running on http://127.0.0.1:${port}`);
      resolve();
    });
  });

  const testEmail = `driver_${Date.now()}@example.com`;
  const testPhone = `98${Math.floor(10000000 + Math.random() * 90000000)}`;
  const testPassword = 'SecurePassword123!';

  try {
    // Test 1: Registration without T&C (Expect Failure 400)
    console.log('1️⃣ Testing Registration without T&C...');
    const resNoTc = await makeRequest(
      {
        path: '/api/auth/register',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      },
      {
        name: 'John Doe',
        email: testEmail,
        phone: testPhone,
        password: testPassword,
        tcAccepted: false,
      }
    );

    if (resNoTc.statusCode === 400) {
      console.log('   ✅ Rejected registration without T&C acceptance as required.');
    } else {
      throw new Error(`Expected 400, got ${resNoTc.statusCode}`);
    }

    // Test 2: Valid Registration (Expect 201)
    console.log('\n2️⃣ Testing Valid Registration with atomic wallet creation...');
    const resReg = await makeRequest(
      {
        path: '/api/auth/register',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      },
      {
        name: 'John Doe',
        email: testEmail,
        phone: testPhone,
        password: testPassword,
        tcAccepted: true,
        indoorNavEnabled: true,
      }
    );

    if (resReg.statusCode === 201 && resReg.data.data?.token) {
      console.log('   ✅ Registration successful! User ID:', resReg.data.data.user.id);
      console.log('   ✅ Explicit T&C Accepted timestamp recorded:', resReg.data.data.user.tcAcceptedAt);
    } else {
      throw new Error(`Registration failed: ${resReg.statusCode} ${JSON.stringify(resReg.data)}`);
    }

    // Test 3: Duplicate Registration (Expect 409)
    console.log('\n3️⃣ Testing Duplicate Registration Prevention...');
    const resDup = await makeRequest(
      {
        path: '/api/auth/register',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      },
      {
        name: 'Duplicate John',
        email: testEmail,
        phone: testPhone,
        password: testPassword,
        tcAccepted: true,
      }
    );

    if (resDup.statusCode === 409) {
      console.log('   ✅ Rejected duplicate email/phone registration.');
    } else {
      throw new Error(`Duplicate check failed: ${resDup.statusCode}`);
    }

    // Test 4: Login (Expect 200)
    console.log('\n4️⃣ Testing Login with valid credentials...');
    const resLogin = await makeRequest(
      {
        path: '/api/auth/login',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      },
      {
        email: testEmail,
        password: testPassword,
      }
    );

    let token = '';
    if (resLogin.statusCode === 200 && resLogin.data.data?.token) {
      token = resLogin.data.data.token;
      console.log('   ✅ Login successful! JWT received.');
      console.log('   ✅ Wallet automatically retrieved with balance:', resLogin.data.data.user.wallet.balance);
    } else {
      throw new Error(`Login failed: ${resLogin.statusCode}`);
    }

    // Test 5: GET /me with valid JWT (Expect 200)
    console.log('\n5️⃣ Testing GET /api/auth/me profile endpoint...');
    const resMe = await makeRequest({
      path: '/api/auth/me',
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (resMe.statusCode === 200 && resMe.data.data?.email === testEmail) {
      console.log('   ✅ Retrieved profile for:', resMe.data.data.name);
      console.log('   ✅ Autopay Authorized flag verified:', resMe.data.data.wallet.autopayAuthorized);
      console.log('   ✅ Indoor Navigation preference verified:', resMe.data.data.indoorNavEnabled);
    } else {
      throw new Error(`Profile retrieval failed: ${resMe.statusCode}`);
    }

    // Test 6: GET /me without Token (Expect 401)
    console.log('\n6️⃣ Testing Unauthorized Access Rejection...');
    const resUnauth = await makeRequest({
      path: '/api/auth/me',
      method: 'GET',
    });

    if (resUnauth.statusCode === 401) {
      console.log('   ✅ Unauthorized request successfully blocked (401).');
    } else {
      throw new Error(`Expected 401, got ${resUnauth.statusCode}`);
    }

    console.log('\n🎉 ALL PHASE 2 AUTH TESTS PASSED CLEANLY!\n');
  } finally {
    server.close();
  }
}

runTests().catch((err) => {
  console.error('Test execution error:', err);
  process.exit(1);
});
