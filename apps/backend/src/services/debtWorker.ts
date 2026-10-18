import { prisma } from '../utils/prisma';
import { TransactionType } from '@prisma/client';

export interface DebtProcessResult {
  walletsChecked: number;
  autopaySucceeded: number;
  autopayFailed: number;
  suspendedUsers: string[];
}

/**
 * Service to process expired wallet debts:
 * Finds all wallets where:
 * - balance < 0 (in debt)
 * - debtDeadline is past due (< now)
 * - User is not already suspended/blacklisted
 *
 * For each expired debt:
 * - Attempts simulated Autopay deduction from linked payment method.
 * - If user has a valid payment method with token:
 *     -> Autopay succeeds, credits wallet, clears debt, records AUTOPAY transaction.
 * - If user has no payment method or autopay payment fails:
 *     -> Enforces strict policy:
 *         1. User account is suspended (isSuspended = true).
 *         2. All user vehicles are blacklisted (isBlacklisted = true).
 *         3. Creates SuspensionRecord with fine (default ₹100 fine).
 *         4. Records FINE audit transaction.
 */
export async function processExpiredDebts(mockAutopaySuccessRate = 0.5): Promise<DebtProcessResult> {
  const now = new Date();
  const expiredWallets = await prisma.wallet.findMany({
    where: {
      balance: { lt: 0 },
      debtDeadline: { lte: now },
      user: {
        isSuspended: false,
      },
    },
    include: {
      user: {
        include: {
          vehicles: true,
          paymentMethods: true,
        },
      },
      linkedPaymentMethod: true,
    },
  });

  const result: DebtProcessResult = {
    walletsChecked: expiredWallets.length,
    autopaySucceeded: 0,
    autopayFailed: 0,
    suspendedUsers: [],
  };

  const DEFAULT_AUTOPAY_FINE = 100.00; // ₹100 fine for default

  for (const wallet of expiredWallets) {
    const debtAmount = Math.abs(Number(wallet.balance));
    const user = wallet.user;
    const paymentMethod = wallet.linkedPaymentMethod || user.paymentMethods[0] || null;

    // Simulate autopay trigger: fails if no payment method or failure triggered
    const isAutopaySuccess = Boolean(paymentMethod?.razorpayToken) && Math.random() < mockAutopaySuccessRate;

    if (isAutopaySuccess && paymentMethod) {
      // ─── AUTOPAY SUCCESS ───────────────────────────────────────────────────
      await prisma.$transaction(async (tx) => {
        // Clear debt and restore zero balance
        await tx.wallet.update({
          where: { id: wallet.id },
          data: {
            balance: 0,
            debtCreatedAt: null,
            debtDeadline: null,
          },
        });

        // Record autopay transaction
        await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            type: TransactionType.AUTOPAY,
            amount: debtAmount,
            description: `Autopay recovery of ₹${debtAmount.toFixed(2)} via ${paymentMethod.type}`,
          },
        });
      });

      result.autopaySucceeded++;
    } else {
      // ─── AUTOPAY FAILED -> SUSPEND + BLACKLIST + FINE ────────────────────────
      await prisma.$transaction(async (tx) => {
        // 1. Suspend User & Blacklist
        await tx.user.update({
          where: { id: user.id },
          data: {
            isSuspended: true,
            isBlacklisted: true,
          },
        });

        // 2. Create Suspension Record for each registered vehicle
        for (const vehicle of user.vehicles) {
          await tx.suspensionRecord.create({
            data: {
              userId: user.id,
              vehicleId: vehicle.id,
              reason: 'AUTOPAY_FAILURE_UNPAID_DEBT',
              fineAmount: DEFAULT_AUTOPAY_FINE,
              isPaid: false,
              isResolved: false,
            },
          });
        }

        // 3. Add fine to wallet debt
        const newBalanceWithFine = Number(wallet.balance) - DEFAULT_AUTOPAY_FINE;
        await tx.wallet.update({
          where: { id: wallet.id },
          data: {
            balance: newBalanceWithFine,
          },
        });

        // 4. Record Fine transaction
        await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            type: TransactionType.FINE,
            amount: DEFAULT_AUTOPAY_FINE,
            description: `Non-repayment penalty fine of ₹${DEFAULT_AUTOPAY_FINE.toFixed(2)} applied due to autopay failure.`,
          },
        });
      });

      result.autopayFailed++;
      result.suspendedUsers.push(user.id);
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
