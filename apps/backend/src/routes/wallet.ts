import { Router, Response } from 'express';
import { prisma } from '../utils/prisma';
import { authGuard, AuthenticatedRequest } from '../middleware/auth';
import { PaymentOrderStatus, Prisma } from '@prisma/client';
import { razorpayClient, simulatedPaymentsAllowed, verifyRazorpaySignature } from '../utils/razorpay';
import { creditWallet } from '../services/billing';
import { DEBT_FINE_AMOUNT } from '../services/debtWorker';

export const walletRouter = Router();

// Apply authGuard to all wallet routes
walletRouter.use(authGuard);

const MINIMUM_WALLET_TOPUP = Number(process.env.MINIMUM_WALLET_TOPUP || 35);
const MAXIMUM_WALLET_TOPUP = Number(process.env.MAXIMUM_WALLET_TOPUP || 10000);
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
        user: { select: { isSuspended: true } },
      },
    });

    if (!wallet) {
      res.status(404).json({ success: false, message: 'Wallet not found.' });
      return;
    }

    const savedPaymentMethods = await prisma.paymentMethod.count({ where: { userId } });

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
        isSuspended: wallet.user.isSuspended,
        autopayAuthorized: wallet.autopayAuthorized,
        // Autopay can only recover debt when the user has authorised it AND saved a payment method
        autopayReady: wallet.autopayAuthorized && savedPaymentMethods > 0,
        linkedPaymentMethod: wallet.linkedPaymentMethod,
        rules: {
          minimumTopUp: MINIMUM_WALLET_TOPUP,
          maximumTopUp: MAXIMUM_WALLET_TOPUP,
          debtWindowHours: DEBT_REPAYMENT_WINDOW_HOURS,
          fineAmount: DEBT_FINE_AMOUNT,
        },
      },
    });
  } catch (error) {
    console.error('[Get Wallet Error]', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve wallet information.' });
  }
});

/**
 * POST /api/wallet/create-order
 * Creates a Razorpay order for a wallet top-up and records it as a PaymentOrder.
 * The top-up endpoint only credits wallets against orders created here.
 * Without Razorpay keys, a simulated order is issued only in local dev
 * (ALLOW_SIMULATED_PAYMENTS=true and NODE_ENV != production).
 */
walletRouter.post('/create-order', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized.' });
      return;
    }

    const amountNum = Number(req.body.amount);
    if (!Number.isFinite(amountNum) || amountNum < MINIMUM_WALLET_TOPUP) {
      res.status(400).json({
        success: false,
        message: `Minimum wallet top-up amount is ₹${MINIMUM_WALLET_TOPUP}.`,
      });
      return;
    }
    if (amountNum > MAXIMUM_WALLET_TOPUP) {
      res.status(400).json({
        success: false,
        message: `Maximum wallet top-up amount is ₹${MAXIMUM_WALLET_TOPUP}.`,
      });
      return;
    }

    const amountInPaise = Math.round(amountNum * 100);

    if (razorpayClient) {
      const order = await razorpayClient.orders.create({
        amount: amountInPaise,
        currency: 'INR',
        receipt: `topup_${userId.slice(0, 8)}_${Date.now()}`,
      });

      await prisma.paymentOrder.create({
        data: { userId, razorpayOrderId: order.id, amountPaise: amountInPaise, isSimulated: false },
      });

      res.status(200).json({
        success: true,
        data: {
          orderId: order.id,
          amount: amountInPaise / 100,
          amountInPaise,
          currency: 'INR',
          keyId: process.env.RAZORPAY_KEY_ID,
          isMock: false,
        },
      });
      return;
    }

    if (!simulatedPaymentsAllowed) {
      res.status(503).json({
        success: false,
        message: 'Online payments are not available right now. Please try again later.',
      });
      return;
    }

    const mockOrderId = `order_sim_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await prisma.paymentOrder.create({
      data: { userId, razorpayOrderId: mockOrderId, amountPaise: amountInPaise, isSimulated: true },
    });

    res.status(200).json({
      success: true,
      data: {
        orderId: mockOrderId,
        amount: amountInPaise / 100,
        amountInPaise,
        currency: 'INR',
        keyId: 'rzp_test_simulated',
        isMock: true,
      },
    });
  } catch (error) {
    console.error('[Create Order Error]', error);
    res.status(500).json({ success: false, message: 'Failed to create payment order.' });
  }
});

/**
 * POST /api/wallet/topup
 * Credits the wallet for a paid order created by /create-order.
 *
 * - The order must belong to the caller and still be CREATED.
 * - Real orders: the Razorpay signature is verified, and the payment is fetched
 *   from Razorpay to confirm it belongs to this order, has the same amount and is captured.
 * - The credited amount always comes from the stored order, never the request body.
 * - The CREATED -> PAID flip is conditional, so a replayed request cannot credit twice.
 * - If the user was in debt, the credit repays it; a suspended user whose
 *   balance is back to >= 0 is reinstated.
 */
walletRouter.post('/topup', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized.' });
      return;
    }

    const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;

    if (!razorpayOrderId) {
      res.status(400).json({
        success: false,
        message: 'razorpayOrderId is required. Create an order with /api/wallet/create-order first.',
      });
      return;
    }

    const order = await prisma.paymentOrder.findUnique({
      where: { razorpayOrderId: String(razorpayOrderId) },
    });

    if (!order || order.userId !== userId) {
      res.status(404).json({ success: false, message: 'Payment order not found.' });
      return;
    }

    if (order.status !== PaymentOrderStatus.CREATED) {
      res.status(409).json({
        success: false,
        message: 'This payment has already been processed. Funds were not credited again.',
      });
      return;
    }

    let paymentId: string;

    if (order.isSimulated) {
      if (!simulatedPaymentsAllowed) {
        res.status(403).json({ success: false, message: 'Simulated payments are disabled.' });
        return;
      }
      paymentId = `pay_sim_${order.id}`;
    } else {
      if (!razorpayPaymentId || !razorpaySignature) {
        res.status(400).json({
          success: false,
          message: 'Razorpay payment ID and signature are required for payment verification.',
        });
        return;
      }
      if (!razorpayClient) {
        res.status(503).json({ success: false, message: 'Payment verification is unavailable.' });
        return;
      }

      if (!verifyRazorpaySignature(order.razorpayOrderId, String(razorpayPaymentId), String(razorpaySignature))) {
        res.status(400).json({
          success: false,
          message: 'Payment verification failed: invalid signature. Funds were not credited.',
        });
        return;
      }

      let payment = await razorpayClient.payments.fetch(String(razorpayPaymentId));
      if (payment.order_id !== order.razorpayOrderId || payment.amount !== order.amountPaise) {
        res.status(400).json({
          success: false,
          message: 'Payment does not match this order. Funds were not credited.',
        });
        return;
      }
      if (payment.status === 'authorized') {
        payment = await razorpayClient.payments.capture(payment.id, order.amountPaise, 'INR');
      }
      if (payment.status !== 'captured') {
        res.status(402).json({
          success: false,
          message: `Payment not completed (status: ${payment.status}). Funds were not credited.`,
        });
        return;
      }
      paymentId = payment.id;
    }

    const amountNum = order.amountPaise / 100;

    const result = await prisma.$transaction(async (tx) => {
      const marked = await tx.paymentOrder.updateMany({
        where: { id: order.id, status: PaymentOrderStatus.CREATED },
        data: { status: PaymentOrderStatus.PAID, razorpayPaymentId: paymentId, paidAt: new Date() },
      });
      if (marked.count === 0) {
        throw new Error('ORDER_ALREADY_PROCESSED');
      }

      const wallet = await tx.wallet.findUnique({ where: { userId }, select: { id: true } });
      if (!wallet) {
        throw new Error('Wallet not found');
      }

      return creditWallet(tx, {
        walletId: wallet.id,
        amount: amountNum,
        description: `Wallet top-up: ₹${amountNum.toFixed(2)} (Txn: ${paymentId})`,
      });
    });

    // If user was suspended and now cleared balance (>= 0), automatically reinstate
    let reinstated = false;
    if (result.isCleared) {
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { isSuspended: true } });
      if (user?.isSuspended) {
        const { reinstateSuspendedAccount } = await import('../services/debtWorker');
        reinstated = await reinstateSuspendedAccount(userId);
      }
    }

    res.status(200).json({
      success: true,
      message: reinstated
        ? 'Dues fully cleared! Your account suspension has been lifted and vehicles un-blacklisted.'
        : result.wasInDebt && result.isCleared
        ? 'Top-up successful! Your debt has been fully cleared.'
        : 'Top-up successful!',
      data: {
        walletId: result.wallet.id,
        amountCredited: amountNum,
        previousBalance: result.prevBalance,
        newBalance: result.newBalance,
        isDebt: result.newBalance < 0,
        isReinstated: reinstated,
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
    if (
      (error instanceof Error && error.message === 'ORDER_ALREADY_PROCESSED') ||
      (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
    ) {
      res.status(409).json({
        success: false,
        message: 'This payment has already been processed. Funds were not credited again.',
      });
      return;
    }
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
