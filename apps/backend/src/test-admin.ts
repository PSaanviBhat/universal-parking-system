/**
 * Phase 5 QR Code System & Facility Administration Automated Test Suite
 *
 * Tests:
 * 1. Create a new Parking Facility (e.g. Orion Mall)
 * 2. Add Levels and bulk generate parking slots
 * 3. Create Entry & Exit Gates with unique QR code strings
 * 4. Generate printable QR code image (PNG buffer) & JSON Data URI
 * 5. Validate scanned QR code payload format & gate lookup
 * 6. Reject invalid QR code formats
 */

import http from 'http';
import { app, httpServer } from '../src/index';

let server: http.Server;
let port: number;

function makeRequest(
  options: http.RequestOptions,
  bodyData?: Record<string, unknown>
): Promise<{ statusCode: number; data: any; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const opts = { ...options, hostname: '127.0.0.1', port };
    const req = http.request(opts, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      res.on('end', () => {
        const fullBuffer = Buffer.concat(chunks);
        const contentType = res.headers['content-type'] || '';
        if (contentType.includes('application/json')) {
          try {
            resolve({ statusCode: res.statusCode || 500, data: JSON.parse(fullBuffer.toString('utf8')), headers: res.headers });
          } catch {
            resolve({ statusCode: res.statusCode || 500, data: fullBuffer.toString('utf8'), headers: res.headers });
          }
        } else {
          // Binary data like PNG
          resolve({ statusCode: res.statusCode || 500, data: fullBuffer, headers: res.headers });
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
  console.log('🧪 Starting Phase 5 QR Code & Facility Admin Tests...\n');

  await new Promise<void>((resolve) => {
    server = httpServer.listen(0, '127.0.0.1', () => {
      const address = server.address() as any;
      port = address.port;
      console.log(`[Test Server] Running on http://127.0.0.1:${port}`);
      resolve();
    });
  });

  try {
    // Test 1: Create Facility
    console.log('1️⃣ Creating a new parking facility...');
    const facRes = await makeRequest(
      { path: '/api/admin/facilities', method: 'POST', headers: { 'Content-Type': 'application/json' } },
      {
        name: 'Nexus Grand Mall',
        type: 'MALL',
        address: '500 Tech Boulevard',
        feeRatePerHour: 40,
      }
    );

    if (facRes.statusCode === 201 && facRes.data.data?.id) {
      console.log(`   ✅ Facility created: ${facRes.data.data.name} (Rate: ₹${facRes.data.data.feeRatePerHour}/hr)`);
    } else {
      throw new Error(`Facility creation failed: ${JSON.stringify(facRes.data)}`);
    }

    const facilityId = facRes.data.data.id;

    // Test 2: Add Level
    console.log('\n2️⃣ Adding Level Basement 1 (B1)...');
    const levelRes = await makeRequest(
      { path: `/api/admin/facilities/${facilityId}/levels`, method: 'POST', headers: { 'Content-Type': 'application/json' } },
      { levelCode: 'B1', displayName: 'Basement 1', totalSlots: 15 }
    );

    if (levelRes.statusCode === 201 && levelRes.data.data?.id) {
      console.log(`   ✅ Level created: ${levelRes.data.data.displayName} (${levelRes.data.data.levelCode})`);
    } else {
      throw new Error(`Level creation failed: ${JSON.stringify(levelRes.data)}`);
    }

    const levelId = levelRes.data.data.id;

    // Test 3: Bulk create slots
    console.log('\n3️⃣ Bulk provisioning 10 slots on Level B1...');
    const slotRes = await makeRequest(
      { path: `/api/admin/levels/${levelId}/slots`, method: 'POST', headers: { 'Content-Type': 'application/json' } },
      { count: 10, prefix: 'B1', startingNumber: 1 }
    );

    if (slotRes.statusCode === 201 && slotRes.data.totalSlotsOnLevel >= 10) {
      console.log(`   ✅ Successfully provisioned ${slotRes.data.totalSlotsOnLevel} slots (B1-01 to B1-10)`);
    } else {
      throw new Error(`Slot provisioning failed: ${JSON.stringify(slotRes.data)}`);
    }

    // Test 4: Create Entry Gate with QR payload
    console.log('\n4️⃣ Creating Entry Gate with unique QR code payload...');
    const gateRes = await makeRequest(
      { path: `/api/admin/facilities/${facilityId}/gates`, method: 'POST', headers: { 'Content-Type': 'application/json' } },
      { gateName: 'East Gate Entry', gateType: 'ENTRY' }
    );

    if (gateRes.statusCode === 201 && gateRes.data.data?.qrCodeData) {
      console.log(`   ✅ Gate created: ${gateRes.data.data.gateName}`);
      console.log(`   ✅ Standardized QR Payload: "${gateRes.data.data.qrCodeData}"`);
    } else {
      throw new Error(`Gate creation failed: ${JSON.stringify(gateRes.data)}`);
    }

    const entryGate = gateRes.data.data;

    // Test 5: Fetch printable QR code PNG image
    console.log('\n5️⃣ Fetching printable QR code image (PNG buffer)...');
    const qrImageRes = await makeRequest({
      path: `/api/admin/gates/${entryGate.id}/qr?format=image`,
      method: 'GET',
    });

    if (
      qrImageRes.statusCode === 200 &&
      qrImageRes.headers['content-type'] === 'image/png' &&
      Buffer.isBuffer(qrImageRes.data) &&
      qrImageRes.data.length > 500
    ) {
      console.log(`   ✅ Successfully rendered PNG QR Code stream (${qrImageRes.data.length} bytes)`);
    } else {
      throw new Error(`Failed to render PNG QR: ${qrImageRes.statusCode}`);
    }

    // Test 6: Validate scanned QR code payload
    console.log('\n6️⃣ Validating scanned QR payload for entry gate...');
    const validQrRes = await makeRequest(
      { path: '/api/admin/gates/validate-qr', method: 'POST', headers: { 'Content-Type': 'application/json' } },
      { qrCodeData: entryGate.qrCodeData }
    );

    if (
      validQrRes.statusCode === 200 &&
      validQrRes.data.data?.gateId === entryGate.id &&
      validQrRes.data.data?.gateType === 'ENTRY' &&
      validQrRes.data.data?.facility?.name === 'Nexus Grand Mall'
    ) {
      console.log('   ✅ Scanned QR code successfully validated with facility & gate details!');
    } else {
      throw new Error(`QR validation failed: ${JSON.stringify(validQrRes.data)}`);
    }

    // Test 7: Reject invalid QR code format
    console.log('\n7️⃣ Testing rejection of malformed / tampered QR payload...');
    const invalidQrRes = await makeRequest(
      { path: '/api/admin/gates/validate-qr', method: 'POST', headers: { 'Content-Type': 'application/json' } },
      { qrCodeData: 'INVALID_RANDOM_BARCODE_STRING' }
    );

    if (invalidQrRes.statusCode === 400) {
      console.log('   ✅ Malformed QR code payload rejected with 400 Bad Request.');
    } else {
      throw new Error(`Expected 400, got ${invalidQrRes.statusCode}`);
    }

    console.log('\n🎉 ALL PHASE 5 QR & ADMIN TESTS PASSED CLEANLY!\n');
  } finally {
    server.close();
  }
}

runTests().catch((err) => {
  console.error('Test execution error:', err);
  process.exit(1);
});
