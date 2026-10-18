import { Router, Response } from 'express';
import { prisma } from '../utils/prisma';
import { authGuard, AuthenticatedRequest } from '../middleware/auth';

export const paymentMethodsRouter = Router();

// Require user authentication for all payment method routes
paymentMethodsRouter.use(authGuard);

/**
 * GET /api/payment-methods
 * Lists all registered payment methods for the authenticated user.
 */
paymentMethodsRouter.get('/', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized.' });
      return;
    }

    const paymentMethods = await prisma.paymentMethod.findMany({
      where: { userId },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        type: true,
        isPrimary: true,
        createdAt: true,
        // Do not expose raw sensitive tokens in API response; return masked indication
        razorpayToken: true,
      },
    });

    const sanitized = paymentMethods.map((pm) => ({
      id: pm.id,
      type: pm.type,
      isPrimary: pm.isPrimary,
      hasToken: Boolean(pm.razorpayToken),
      createdAt: pm.createdAt,
    }));

    res.status(200).json({ success: true, data: sanitized });
  } catch (error) {
    console.error('[Get Payment Methods Error]', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve payment methods.' });
  }
});

/**
 * POST /api/payment-methods
 * Adds a new payment method (UPI, CARD, NETBANKING) for autopay / debt recovery.
 */
paymentMethodsRouter.post('/', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized.' });
      return;
    }

    const { type, razorpayToken, isPrimary } = req.body;

    const normalizedType = String(type || '').trim().toUpperCase();
    if (!['UPI', 'CARD', 'NETBANKING'].includes(normalizedType)) {
      res.status(400).json({
        success: false,
        message: 'Invalid payment method type. Allowed types are: UPI, CARD, NETBANKING.',
      });
      return;
    }

    const tokenStr = String(razorpayToken || `tok_sim_${Date.now()}`).trim();

    // Check existing methods count
    const existingCount = await prisma.paymentMethod.count({ where: { userId } });
    const shouldBePrimary = Boolean(isPrimary) || existingCount === 0;

    const result = await prisma.$transaction(async (tx) => {
      if (shouldBePrimary) {
        // Demote previous primary methods
        await tx.paymentMethod.updateMany({
          where: { userId, isPrimary: true },
          data: { isPrimary: false },
        });
      }

      const newMethod = await tx.paymentMethod.create({
        data: {
          userId,
          type: normalizedType,
          razorpayToken: tokenStr,
          isPrimary: shouldBePrimary,
        },
      });

      if (shouldBePrimary) {
        // Link to wallet as primary autopay fallback
        await tx.wallet.updateMany({
          where: { userId },
          data: {
            linkedPaymentMethodId: newMethod.id,
            autopayAuthorized: true,
          },
        });
      }

      return newMethod;
    });

    res.status(201).json({
      success: true,
      message: 'Payment method linked successfully.',
      data: {
        id: result.id,
        type: result.type,
        isPrimary: result.isPrimary,
        createdAt: result.createdAt,
      },
    });
  } catch (error) {
    console.error('[Add Payment Method Error]', error);
    res.status(500).json({ success: false, message: 'Failed to add payment method.' });
  }
});

/**
 * PATCH /api/payment-methods/:id/primary
 * Sets a specific payment method as the primary autopay method.
 */
paymentMethodsRouter.patch('/:id/primary', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const { id } = req.params;

    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized.' });
      return;
    }

    const method = await prisma.paymentMethod.findFirst({
      where: { id: String(id), userId },
    });

    if (!method) {
      res.status(404).json({ success: false, message: 'Payment method not found.' });
      return;
    }

    await prisma.$transaction(async (tx) => {
      // Demote all
      await tx.paymentMethod.updateMany({
        where: { userId, isPrimary: true },
        data: { isPrimary: false },
      });

      // Promote target
      await tx.paymentMethod.update({
        where: { id: method.id },
        data: { isPrimary: true },
      });

      // Update wallet linked method
      await tx.wallet.updateMany({
        where: { userId },
        data: { linkedPaymentMethodId: method.id },
      });
    });

    res.status(200).json({
      success: true,
      message: 'Primary payment method updated.',
    });
  } catch (error) {
    console.error('[Set Primary Payment Method Error]', error);
    res.status(500).json({ success: false, message: 'Failed to set primary payment method.' });
  }
});

/**
 * DELETE /api/payment-methods/:id
 * Removes a linked payment method.
 */
paymentMethodsRouter.delete('/:id', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const { id } = req.params;

    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized.' });
      return;
    }

    const method = await prisma.paymentMethod.findFirst({
      where: { id: String(id), userId },
    });

    if (!method) {
      res.status(404).json({ success: false, message: 'Payment method not found.' });
      return;
    }

    await prisma.$transaction(async (tx) => {
      // If deleting the linked payment method from wallet, clear reference
      await tx.wallet.updateMany({
        where: { userId, linkedPaymentMethodId: method.id },
        data: { linkedPaymentMethodId: null },
      });

      await tx.paymentMethod.delete({
        where: { id: method.id },
      });

      // If deleted was primary, promote the most recently added remaining method
      if (method.isPrimary) {
        const remaining = await tx.paymentMethod.findFirst({
          where: { userId },
          orderBy: { createdAt: 'desc' },
        });

        if (remaining) {
          await tx.paymentMethod.update({
            where: { id: remaining.id },
            data: { isPrimary: true },
          });

          await tx.wallet.updateMany({
            where: { userId },
            data: { linkedPaymentMethodId: remaining.id },
          });
        }
      }
    });

    res.status(200).json({ success: true, message: 'Payment method deleted successfully.' });
  } catch (error) {
    console.error('[Delete Payment Method Error]', error);
    res.status(500).json({ success: false, message: 'Failed to delete payment method.' });
  }
});

export default paymentMethodsRouter;
