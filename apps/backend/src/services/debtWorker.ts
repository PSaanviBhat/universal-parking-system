import { prisma } from '../utils/prisma';
import { PaymentStatus, Prisma, TransactionType } from '@prisma/client';
import { chargeAutopay } from './autopay';
import { creditWallet, debitWallet } from './billing';

export const DEBT_FINE_AMOUNT = Number(process.env.DEBT_FINE_AMOUNT || 500);

export interface DebtProcessResult {
  walletsChecked: number;
  autopaySucceeded: number;
  autopayPending: number;
  autopayFailed: number;
  suspendedUsers: string[];
}

const expiredDebtWhere = (now: Date): Prisma.WalletWhereInput => ({
  balance: { lt: 0 },
  debtDeadline: { lte: now },
  user: { isSuspended: false },
});

/**
 * Processes wallets whose 48h debt window has expired (balance < 0, deadline passed,
 * user not already suspended):
 *
 * - Autopay succeeds -> the debt is credited back (AUTOPAY transaction), the wallet
 *   returns to 0, the debt window closes and the user's DEBT sessions become PAID.
 * - Autopay pending  -> DEBT sessions become AUTOPAY_PENDING; retried next run.
 * - Autopay fails    -> the account is suspended and blacklisted (all vehicles are
 *   blocked at entry), ONE fine of DEBT_FINE_AMOUNT (default ₹500) is added to the
 *   wallet debt with a FINE transaction and an account-level SuspensionRecord,
 *   and the DEBT sessions become FINED.
 *
 * Each wallet is handled in its own transaction that first locks the wallet row
 * (SELECT ... FOR UPDATE) and re-checks the conditions, so two overlapping runs
 * (e.g. two server instances during a Render deploy) can never charge or fine twice.
 */
export async function processExpiredDebts(now = new Date()): Promise<DebtProcessResult> {
  const result: DebtProcessResult = {
    walletsChecked: 0,
    autopaySucceeded: 0,
    autopayPending: 0,
    autopayFailed: 0,
    suspendedUsers: [],
  };

  // Cheap early exit: most runs find nothing, so avoid loading relations.
  const candidates = await prisma.wallet.findMany({
    where: expiredDebtWhere(now),
    select: { id: true },
  });
  result.walletsChecked = candidates.length;

  for (const { id: walletId } of candidates) {
    try {
      const outcome = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Wallet" WHERE id = ${walletId} FOR UPDATE`;

        const wallet = await tx.wallet.findFirst({
          where: { id: walletId, ...expiredDebtWhere(now) },
          include: {
            linkedPaymentMethod: true,
            user: {
              include: {
                paymentMethods: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] },
              },
            },
          },
        });
        if (!wallet) return 'skipped' as const; // repaid or processed by another run meanwhile

        const debtAmount = Math.abs(Number(wallet.balance));
        const paymentMethod = wallet.linkedPaymentMethod || wallet.user.paymentMethods[0] || null;

        const charge = await chargeAutopay({
          paymentMethod,
          autopayAuthorized: wallet.autopayAuthorized,
          amountRupees: debtAmount,
          walletId: wallet.id,
        });

        if (charge.status === 'succeeded') {
          await creditWallet(tx, {
            walletId: wallet.id,
            amount: debtAmount,
            type: TransactionType.AUTOPAY,
            description: `Autopay recovery of ₹${debtAmount.toFixed(2)} via ${paymentMethod!.type} (Ref: ${charge.reference})`,
          });
          return 'succeeded' as const;
        }

        if (charge.status === 'pending') {
          await tx.parkingSession.updateMany({
            where: { userId: wallet.userId, paymentStatus: PaymentStatus.DEBT },
            data: { paymentStatus: PaymentStatus.AUTOPAY_PENDING },
          });
          return 'pending' as const;
        }

        // ─── Autopay failed: suspend + blacklist + single fine ────────────────
        await tx.user.update({
          where: { id: wallet.userId },
          data: { isSuspended: true, isBlacklisted: true },
        });

        await tx.suspensionRecord.create({
          data: {
            userId: wallet.userId,
            vehicleId: null,
            reason: `AUTOPAY_FAILURE_UNPAID_DEBT (${charge.reason})`,
            fineAmount: DEBT_FINE_AMOUNT,
          },
        });

        await debitWallet(tx, {
          userId: wallet.userId,
          amount: DEBT_FINE_AMOUNT,
          type: TransactionType.FINE,
          at: now,
          description: `Non-repayment penalty fine of ₹${DEBT_FINE_AMOUNT.toFixed(2)} (debt of ₹${debtAmount.toFixed(2)} unpaid after deadline; ${charge.reason}).`,
        });

        await tx.parkingSession.updateMany({
          where: {
            userId: wallet.userId,
            paymentStatus: { in: [PaymentStatus.DEBT, PaymentStatus.AUTOPAY_PENDING] },
          },
          data: { paymentStatus: PaymentStatus.FINED },
        });

        return 'failed' as const;
      }, { timeout: 15_000 });

      if (outcome === 'succeeded') result.autopaySucceeded++;
      if (outcome === 'pending') result.autopayPending++;
      if (outcome === 'failed') {
        result.autopayFailed++;
        const wallet = await prisma.wallet.findUnique({ where: { id: walletId }, select: { userId: true } });
        if (wallet) result.suspendedUsers.push(wallet.userId);
      }
    } catch (err) {
      console.error(`[DebtWorker] Failed to process wallet ${walletId}:`, err);
    }
  }

  return result;
}

/**
 * Service to resolve suspension & clear blacklist:
 * When a suspended user clears their full debt + fines:
 * - Marks suspension records as paid & resolved.
 * - Restores user account: isSuspended = false, isBlacklisted = false.
 */
export async function reinstateSuspendedAccount(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      wallet: true,
      suspensionRecords: { where: { isResolved: false } },
    },
  });

  if (!user || !user.wallet) return false;

  const currentBalance = Number(user.wallet.balance);
  if (currentBalance < 0) {
    // Cannot reinstate if still in negative balance
    return false;
  }

  await prisma.$transaction(async (tx) => {
    // 1. Mark suspension records resolved
    await tx.suspensionRecord.updateMany({
      where: { userId, isResolved: false },
      data: { isPaid: true, isResolved: true },
    });

    // 2. Reinstate user flags
    await tx.user.update({
      where: { id: userId },
      data: {
        isSuspended: false,
        isBlacklisted: false,
      },
    });

    // 3. Clear any remaining debt dates in wallet
    await tx.wallet.update({
      where: { userId },
      data: {
        debtCreatedAt: null,
        debtDeadline: null,
      },
    });
  });

  return true;
}
