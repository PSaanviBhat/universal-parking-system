/**
 * Shared helpers for the src/test-*.ts suites: sign short-lived staff/user tokens
 * with the same secrets the server uses, so suites can call guarded endpoints
 * without depending on seeded staff passwords.
 */
import jwt from 'jsonwebtoken';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export function operatorHeaders(facilityId: string) {
  const token = jwt.sign(
    { operatorId: 'test-operator', username: 'test-operator', facilityId, role: 'operator' },
    process.env.OPERATOR_JWT_SECRET!,
    { expiresIn: '10m' }
  );
  return { ...JSON_HEADERS, Authorization: `Bearer ${token}` };
}

export function adminHeaders() {
  const token = jwt.sign(
    { adminId: 'test-admin', username: 'test-admin', role: 'admin' },
    process.env.ADMIN_JWT_SECRET!,
    { expiresIn: '10m' }
  );
  return { ...JSON_HEADERS, Authorization: `Bearer ${token}` };
}

export function userHeaders(userId = 'test-user') {
  const token = jwt.sign({ userId, email: 'test@example.test', phone: '0000000000' }, process.env.JWT_SECRET!, {
    expiresIn: '10m',
  });
  return { ...JSON_HEADERS, Authorization: `Bearer ${token}` };
}
