import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../utils/prisma';
import { authGuard, AuthenticatedRequest } from '../middleware/auth';

export const authRouter = Router();

/**
 * POST /api/auth/register
 * Registers a new user, hashes password, records T&C timestamp,
 * and atomically provisions a default wallet.
 */
authRouter.post('/register', async (req, res): Promise<void> => {
  try {
    const { name, email, phone, password, tcAccepted, indoorNavEnabled } = req.body;

    if (!name || !email || !phone || !password) {
      res.status(400).json({
        success: false,
        message: 'Name, email, phone, and password are required.',
      });
      return;
    }

    if (!tcAccepted) {
      res.status(400).json({
        success: false,
        message: 'You must accept the Terms & Conditions and Autopay Debit authorization to register.',
      });
      return;
    }

    if (password.length < 6) {
      res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long.',
      });
      return;
    }

    // Check if user with same email or phone exists
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [{ email: email.toLowerCase().trim() }, { phone: phone.trim() }],
      },
    });

    if (existingUser) {
      res.status(409).json({
        success: false,
        message: existingUser.email === email.toLowerCase().trim()
          ? 'An account with this email already exists.'
          : 'An account with this phone number already exists.',
      });
      return;
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Atomically create user and provision an initial wallet
    const user = await prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          name: name.trim(),
          email: email.toLowerCase().trim(),
          phone: phone.trim(),
          passwordHash,
          tcAcceptedAt: new Date(),
          indoorNavEnabled: Boolean(indoorNavEnabled),
        },
      });

      await tx.wallet.create({
        data: {
          userId: newUser.id,
          balance: 0,
          autopayAuthorized: true, // User agreed during registration
        },
      });

      return newUser;
    });

    // Sign JWT
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new Error('JWT_SECRET is not configured on the server.');
    }
    const token = jwt.sign(
      { userId: user.id, email: user.email, phone: user.phone },
      secret,
      { expiresIn: (process.env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn']) || '7d' }
    );

    res.status(201).json({
      success: true,
      message: 'Account registered successfully.',
      data: {
        token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          isSuspended: user.isSuspended,
          isBlacklisted: user.isBlacklisted,
          indoorNavEnabled: user.indoorNavEnabled,
          tcAcceptedAt: user.tcAcceptedAt,
        },
      },
    });
  } catch (error) {
    console.error('[Register Error]', error);
    res.status(500).json({
      success: false,
      message: 'Registration failed due to an unexpected error.',
    });
  }
});

/**
 * POST /api/auth/login
 * Validates email/password, checks suspension/blacklist status, returns token.
 */
authRouter.post('/login', async (req, res): Promise<void> => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({
        success: false,
        message: 'Email and password are required.',
      });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      include: {
        wallet: true,
      },
    });

    if (!user) {
      res.status(401).json({
        success: false,
        message: 'Invalid email or password.',
      });
      return;
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      res.status(401).json({
        success: false,
        message: 'Invalid email or password.',
      });
      return;
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new Error('JWT_SECRET is not configured on the server.');
    }
    const token = jwt.sign(
      { userId: user.id, email: user.email, phone: user.phone },
      secret,
      { expiresIn: (process.env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn']) || '7d' }
    );

    res.status(200).json({
      success: true,
      message: 'Login successful.',
      data: {
        token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          isSuspended: user.isSuspended,
          isBlacklisted: user.isBlacklisted,
          indoorNavEnabled: user.indoorNavEnabled,
          wallet: user.wallet
            ? {
                balance: Number(user.wallet.balance),
                debtCreatedAt: user.wallet.debtCreatedAt,
                debtDeadline: user.wallet.debtDeadline,
                isDebt: Number(user.wallet.balance) < 0,
              }
            : null,
        },
      },
    });
  } catch (error) {
    console.error('[Login Error]', error);
    res.status(500).json({
      success: false,
      message: 'Login failed due to an unexpected error.',
    });
  }
});

/**
 * GET /api/auth/me
 * Returns current authenticated user profile, wallet snapshot, and active vehicles.
 */
authRouter.get('/me', authGuard, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized.' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        isSuspended: true,
        isBlacklisted: true,
        indoorNavEnabled: true,
        tcAcceptedAt: true,
        createdAt: true,
        wallet: {
          select: {
            id: true,
            balance: true,
            debtCreatedAt: true,
            debtDeadline: true,
            autopayAuthorized: true,
          },
        },
        vehicles: {
          select: {
            id: true,
            licensePlate: true,
            nickname: true,
          },
        },
        suspensionRecords: {
          where: { isResolved: false },
          select: {
            id: true,
            reason: true,
            fineAmount: true,
            createdAt: true,
          },
        },
      },
    });

    if (!user) {
      res.status(404).json({ success: false, message: 'User not found.' });
      return;
    }

    const walletBalance = user.wallet ? Number(user.wallet.balance) : 0;
    const isDebt = walletBalance < 0;

    res.status(200).json({
      success: true,
      data: {
        ...user,
        wallet: user.wallet
          ? {
              ...user.wallet,
              balance: walletBalance,
              isDebt,
            }
          : null,
      },
    });
  } catch (error) {
    console.error('[Get Profile Error]', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve profile.',
    });
  }
});
