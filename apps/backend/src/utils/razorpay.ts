import crypto from 'crypto';
import Razorpay from 'razorpay';

const looksLikePlaceholder = (value?: string) => !value || /x{6,}/i.test(value);

export const isRazorpayConfigured =
  !looksLikePlaceholder(process.env.RAZORPAY_KEY_ID) &&
  !looksLikePlaceholder(process.env.RAZORPAY_KEY_SECRET);

export const razorpayClient: Razorpay | null = isRazorpayConfigured
  ? new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID!,
      key_secret: process.env.RAZORPAY_KEY_SECRET!,
    })
  : null;

/**
 * Simulated payments (orders/tokens that never touch Razorpay) are a local-dev
 * convenience only. They are never allowed when NODE_ENV=production.
 */
export const simulatedPaymentsAllowed =
  process.env.ALLOW_SIMULATED_PAYMENTS === 'true' && process.env.NODE_ENV !== 'production';

/**
 * Validates Razorpay Payment Signature
 * HMAC SHA256 of `${orderId}|${paymentId}` generated with RAZORPAY_KEY_SECRET.
 */
export function verifyRazorpaySignature(
  orderId: string,
  paymentId: string,
  signature: string
): boolean {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) {
    return false;
  }
  const body = `${orderId}|${paymentId}`;
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');

  const expected = Buffer.from(expectedSignature, 'utf8');
  const received = Buffer.from(String(signature), 'utf8');
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}
