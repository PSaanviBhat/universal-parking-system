/**
 * Phase 3 Vehicle Registration & Management Automated Test Suite
 *
 * Tests:
 * 1. Register a vehicle with license plate formatting/normalization
 * 2. Reject registering a duplicate vehicle under the same user
 * 3. Reject registering an already-registered plate under a different user
 * 4. List user's vehicles and confirm properties
 * 5. Delete a vehicle successfully
 * 6. Attempt deleting non-existent / unauthorized vehicle
 */

import http from 'http';
import { app, httpServer } from '../src/index';
import jwt from 'jsonwebtoken';

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
  console.log('🧪 Starting Phase 3 Vehicle Management Tests...\n');

  await new Promise<void>((resolve) => {
    server = httpServer.listen(0, '127.0.0.1', () => {
      const address = server.address() as any;
      port = address.port;
      console.log(`[Test Server] Running on http://127.0.0.1:${port}`);
      resolve();
    });
  });

  try {
    // 1. Setup User A
    const userAEmail = `owner_a_${Date.now()}@example.com`;
    const regResA = await makeRequest(
      { path: '/api/auth/register', method: 'POST', headers: { 'Content-Type': 'application/json' } },
      { name: 'Alice', email: userAEmail, phone: `97${Math.floor(10000000 + Math.random() * 90000000)}`, password: 'Password123!', tcAccepted: true }
    );
    const tokenA = regResA.data.data.token;

    // 2. Setup User B
    const userBEmail = `owner_b_${Date.now()}@example.com`;
    const regResB = await makeRequest(
      { path: '/api/auth/register', method: 'POST', headers: { 'Content-Type': 'application/json' } },
      { name: 'Bob', email: userBEmail, phone: `96${Math.floor(10000000 + Math.random() * 90000000)}`, password: 'Password123!', tcAccepted: true }
    );
    const tokenB = regResB.data.data.token;

    // Test 1: Register vehicle for User A with lowercase & spaces
    console.log('1️⃣ Registering vehicle for User A with normalization...');
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const rawPlate = `ka-05  xy ${randomSuffix}`;
    const expectedNormalized = `KA05XY${randomSuffix}`;

    const addVehicleRes = await makeRequest(
      {
        path: '/api/vehicles',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenA}`,
        },
      },
      {
        licensePlate: rawPlate,
        nickname: 'Alice SUV',
      }
    );

    if (addVehicleRes.statusCode === 201 && addVehicleRes.data.data?.licensePlate === expectedNormalized) {
      console.log(`   ✅ Vehicle registered and normalized: "${rawPlate}" -> "${expectedNormalized}"`);
    } else {
      throw new Error(`Vehicle registration failed: ${addVehicleRes.statusCode} ${JSON.stringify(addVehicleRes.data)}`);
    }

    const vehicleId = addVehicleRes.data.data.id;

    // Test 2: User A attempts to re-register the same plate (Expect 409)
    console.log('\n2️⃣ Testing duplicate plate registration under same user...');
    const dupResA = await makeRequest(
      {
        path: '/api/vehicles',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenA}`,
        },
      },
      {
        licensePlate: expectedNormalized,
      }
    );

    if (dupResA.statusCode === 409) {
      console.log('   ✅ Rejected duplicate plate for same user.');
    } else {
      throw new Error(`Expected 409 duplicate error, got ${dupResA.statusCode}`);
    }

    // Test 3: User B attempts to register User A's plate (Expect 409)
    console.log('\n3️⃣ Testing plate registration collision with another user...');
    const dupResB = await makeRequest(
      {
        path: '/api/vehicles',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenB}`,
        },
      },
      {
        licensePlate: expectedNormalized,
      }
    );

    if (dupResB.statusCode === 409) {
      console.log('   ✅ Rejected registration collision across different users.');
    } else {
      throw new Error(`Expected 409 cross-user collision, got ${dupResB.statusCode}`);
    }

    // Test 4: List vehicles for User A
    console.log('\n4️⃣ Listing vehicles for User A...');
    const listRes = await makeRequest({
      path: '/api/vehicles',
      method: 'GET',
      headers: { Authorization: `Bearer ${tokenA}` },
    });

    if (listRes.statusCode === 200 && Array.isArray(listRes.data.data) && listRes.data.data.length === 1) {
      console.log(`   ✅ Found 1 vehicle for Alice: ${listRes.data.data[0].licensePlate} (Nickname: ${listRes.data.data[0].nickname})`);
    } else {
      throw new Error(`Failed to list vehicles: ${listRes.statusCode}`);
    }

    // Test 5: User B attempts to delete User A's vehicle (Expect 403 Forbidden)
    console.log('\n5️⃣ Testing unauthorized vehicle deletion attempt by User B...');
    const delResB = await makeRequest({
      path: `/api/vehicles/${vehicleId}`,
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tokenB}` },
    });

    if (delResB.statusCode === 403) {
      console.log('   ✅ Unauthorized vehicle deletion successfully forbidden (403).');
    } else {
      throw new Error(`Expected 403, got ${delResB.statusCode}`);
    }

    // Test 6: User A deletes vehicle
    console.log('\n6️⃣ Testing authorized vehicle deletion by User A...');
    const delResA = await makeRequest({
      path: `/api/vehicles/${vehicleId}`,
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tokenA}` },
    });

    if (delResA.statusCode === 200) {
      console.log('   ✅ Vehicle deleted successfully.');
    } else {
      throw new Error(`Expected 200, got ${delResA.statusCode}`);
    }

    // Confirm list is now empty
    const listAfterRes = await makeRequest({
      path: '/api/vehicles',
      method: 'GET',
      headers: { Authorization: `Bearer ${tokenA}` },
    });

    if (listAfterRes.data.data?.length === 0) {
      console.log('   ✅ Vehicle list verified empty after deletion.');
    } else {
      throw new Error('Vehicle still appears in list after deletion.');
    }

    console.log('\n🎉 ALL PHASE 3 VEHICLE TESTS PASSED CLEANLY!\n');
  } finally {
    server.close();
  }
}

runTests().catch((err) => {
  console.error('Test execution error:', err);
  process.exit(1);
});
