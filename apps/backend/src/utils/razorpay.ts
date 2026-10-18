import crypto from 'crypto';

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
  return expectedSignature === signature;
}
