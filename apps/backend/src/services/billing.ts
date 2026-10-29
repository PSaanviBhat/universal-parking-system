import { Prisma, TransactionType } from '@prisma/client';

type Tx = Prisma.TransactionClient;

export interface CreditWalletArgs {
  walletId: string;
  amount: number;
  description: string;
  /** Defaults to DEBT_REPAYMENT when the wallet was negative before the credit, else TOP_UP. */
  type?: TransactionType;
  sessionId?: string;
}

/**
 * Credits a wallet atomically (balance increment in SQL, never read-modify-write),
 * clears the debt window once the balance is back to >= 0, and records the transaction.
 * Must be called inside a Prisma transaction.
 */
export async function creditWallet(tx: Tx, args: CreditWalletArgs) {
  const { walletId, amount, description, sessionId } = args;

  const credited = await tx.wallet.update({
    where: { id: walletId },
    data: { balance: { increment: amount } },
  });

  const newBalance = Number(credited.balance);
  const prevBalance = Math.round((newBalance - amount) * 100) / 100;
  const wasInDebt = prevBalance < 0;
  const isCleared = newBalance >= 0;

  const wallet =
    isCleared && (credited.debtCreatedAt || credited.debtDeadline)
      ? await tx.wallet.update({
          where: { id: walletId },
          data: { debtCreatedAt: null, debtDeadline: null },
        })
      : credited;

  const transaction = await tx.walletTransaction.create({
    data: {
      walletId,
      sessionId,
      type: args.type ?? (wasInDebt ? TransactionType.DEBT_REPAYMENT : TransactionType.TOP_UP),
      amount,
      description,
    },
  });

  return { wallet, transaction, prevBalance, newBalance, wasInDebt, isCleared };
}
