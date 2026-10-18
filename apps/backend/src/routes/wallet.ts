import { Router, Response } from 'express';
import { prisma } from '../utils/prisma';
import { authGuard, AuthenticatedRequest } from '../middleware/auth';
import { TransactionType } from '@prisma/client';

export const walletRouter = Router();

// Apply authGuard to all wallet routes
walletRouter.use(authGuard);

const MINIMUM_WALLET_TOPUP = Number(process.env.MINIMUM_WALLET_TOPUP || 35);
const DEBT_REPAYMENT_WINDOW_HOURS = Number(process.env.DEBT_REPAYMENT_WINDOW_HOURS || 48);

/**
 * GET /api/wallet
 * Returns user's wallet balance, active debt status,
 * remaining debt countdown, and linked payment method status.
 */
walletRouter.get('/', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized.' });
      return;
    }

    const wallet = await prisma.wallet.findUnique({
      where: { userId },
      include: {
        linkedPaymentMethod: {
          select: {
            id: true,
            type: true,
            isPrimary: true,
          },
        },
      },
    });

    if (!wallet) {
      res.status(404).json({ success: false, message: 'Wallet not found.' });
      return;
    }

    const balanceNum = Number(wallet.balance);
    const isDebt = balanceNum < 0;

    let debtHoursRemaining: number | null = null;
    let isDebtExpired = false;

    if (isDebt && wallet.debtDeadline) {
      const msRemaining = new Date(wallet.debtDeadline).getTime() - Date.now();
      debtHoursRemaining = Math.max(0, Math.round((msRemaining / (1000 * 60 * 60)) * 10) / 10);
      isDebtExpired = msRemaining <= 0;
    }

    res.status(200).json({
      success: true,
      data: {
        walletId: wallet.id,
        balance: balanceNum,
        isDebt,
        debtAmount: isDebt ? Math.abs(balanceNum) : 0,
        debtCreatedAt: wallet.debtCreatedAt,
        debtDeadline: wallet.debtDeadline,
        debtHoursRemaining,
        isDebtExpired,
        autopayAuthorized: wallet.autopayAuthorized,
        linkedPaymentMethod: wallet.linkedPaymentMethod,
        rules: {
          minimumTopUp: MINIMUM_WALLET_TOPUP,
          debtWindowHours: DEBT_REPAYMENT_WINDOW_HOURS,
        },
      },
    });
  } catch (error) {
    console.error('[Get Wallet Error]', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve wallet information.' });
  }
});

/**
 * POST /api/wallet/topup
 * Adds funds to user's prepaid wallet (minimum ₹35 per product decision).
 * If user was in debt:
 * - Checks if the top-up repays or reduces the debt.
 * - If new balance >= 0, clears debt timestamps.
 * Records transaction with proper type (TOP_UP or DEBT_REPAYMENT).
 */
walletRouter.post('/topup', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized.' });
      return;
    }

    const { amount, paymentMethodType, razorpayPaymentId } = req.body;

    const amountNum = Number(amount);
    if (!amount || isNaN(amountNum) || amountNum <= 0) {
      res.status(400).json({
        success: false,
        message: 'A valid positive amount is required for wallet top-up.',
      });
      return;
    }

    if (amountNum < MINIMUM_WALLET_TOPUP) {
      res.status(400).json({
        success: false,
        message: `Minimum wallet top-up amount is ₹${MINIMUM_WALLET_TOPUP}.`,
      });
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      const currentWallet = await tx.wallet.findUnique({
        where: { userId },
      });

      if (!currentWallet) {
        throw new Error('Wallet not found');
      }

      const prevBalance = Number(currentWallet.balance);
      const newBalance = prevBalance + amountNum;
      const wasInDebt = prevBalance < 0;
      const isCleared = newBalance >= 0;

      // Determine transaction type and description
      const txType = wasInDebt ? TransactionType.DEBT_REPAYMENT : TransactionType.TOP_UP;
      const description = wasInDebt
        ? `Debt repayment / Top-up: ₹${amountNum.toFixed(2)}`
        : `Wallet top-up: ₹${amountNum.toFixed(2)}`;

      // Update wallet balance and conditionally clear debt dates if cleared
      const updatedWallet = await tx.wallet.update({
        where: { id: currentWallet.id },
        data: {
          balance: newBalance,
          debtCreatedAt: isCleared ? null : currentWallet.debtCreatedAt,
          debtDeadline: isCleared ? null : currentWallet.debtDeadline,
        },
      });

      // Record transaction
      const transaction = await tx.walletTransaction.create({
        data: {
          walletId: currentWallet.id,
          type: txType,
          amount: amountNum,
          description: razorpayPaymentId
            ? `${description} (Txn: ${razorpayPaymentId})`
            : description,
        },
      });

      return { updatedWallet, transaction, prevBalance, newBalance, wasInDebt, isCleared };
    });

    res.status(200).json({
      success: true,
      message: result.wasInDebt && result.isCleared
        ? 'Top-up successful! Your debt has been fully cleared.'
        : 'Top-up successful!',
      data: {
        walletId: result.updatedWallet.id,
        previousBalance: result.prevBalance,
        newBalance: result.newBalance,
        isDebt: result.newBalance < 0,
        transaction: {
          id: result.transaction.id,
          type: result.transaction.type,
          amount: Number(result.transaction.amount),
          description: result.transaction.description,
          createdAt: result.transaction.createdAt,
        },
      },
    });
  } catch (error) {
    console.error('[Top-up Error]', error);
    res.status(500).json({ success: false, message: 'Failed to process wallet top-up.' });
  }
});

/**
 * GET /api/wallet/transactions
 * Returns paginated transaction history with chronological order.
 */
walletRouter.get('/transactions', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized.' });
      return;
    }

    const page = Math.max(1, parseInt(String(req.query.page || 1), 10));
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || 20), 10)));
    const skip = (page - 1) * limit;

    const wallet = await prisma.wallet.findUnique({
      where: { userId },
      select: { id: true },
    });

    if (!wallet) {
      res.status(404).json({ success: false, message: 'Wallet not found.' });
      return;
    }

    const [total, transactions] = await Promise.all([
      prisma.walletTransaction.count({ where: { walletId: wallet.id } }),
      prisma.walletTransaction.findMany({
        where: { walletId: wallet.id },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          session: {
            select: {
              id: true,
              facility: { select: { name: true } },
              slot: { select: { slotNumber: true } },
            },
          },
        },
      }),
    ]);

    res.status(200).json({
      success: true,
      data: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        transactions: transactions.map((t) => ({
          id: t.id,
          type: t.type,
          amount: Number(t.amount),
          description: t.description,
          sessionId: t.sessionId,
          facilityName: t.session?.facility.name || null,
          slotNumber: t.session?.slot.slotNumber || null,
          createdAt: t.createdAt,
        })),
      },
    });
  } catch (error) {
    console.error('[Get Transactions Error]', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve transactions.' });
  }
});
