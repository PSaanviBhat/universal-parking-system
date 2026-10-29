import { PaymentMethod } from '@prisma/client';

export type AutopayResult =
  | { status: 'succeeded'; reference: string }
  | { status: 'pending'; reference: string }
  | { status: 'failed'; reason: string };

/**
 * Charges a user's saved payment method to recover unpaid parking debt.
 *
 * Current implementation is a deterministic simulation: it succeeds when the user
 * authorised autopay at registration and has a saved payment method with a token;
 * otherwise it fails. Swap this function for a real Razorpay recurring charge
 * (Customers + Tokens + recurring payment, idempotency key = walletId + debt deadline)
 * once Razorpay enables recurring payments on the account. Return 'pending' when the
 * charge is asynchronous; the debt worker then marks sessions AUTOPAY_PENDING and
 * retries on its next run.
 */
export async function chargeAutopay(args: {
  paymentMethod: PaymentMethod | null;
  autopayAuthorized: boolean;
  amountRupees: number;
  walletId: string;
}): Promise<AutopayResult> {
  if (!args.autopayAuthorized) {
    return { status: 'failed', reason: 'AUTOPAY_NOT_AUTHORIZED' };
  }
  if (!args.paymentMethod?.razorpayToken) {
    return { status: 'failed', reason: 'NO_PAYMENT_METHOD' };
  }
  if (!(args.amountRupees > 0)) {
    return { status: 'failed', reason: 'INVALID_AMOUNT' };
  }
  return {
    status: 'succeeded',
    reference: `autopay_sim_${args.walletId.slice(0, 8)}_${Date.now()}`,
  };
}
