import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../utils/prisma';
import { createLoginLimiter } from '../middleware/rateLimit';

export const operatorAuthRouter = Router();

const loginLimiter = createLoginLimiter();

// Compared against when the username does not exist, so response time does not reveal valid usernames.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

/**
 * POST /api/operator-auth/login
 * Authenticates a parking operator against the Operator table and issues an
 * operator JWT scoped to the operator's own facility.
 */
operatorAuthRouter.post('/login', loginLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      res.status(400).json({ success: false, message: 'Username and password are required.' });
      return;
    }

    const op = await prisma.operator.findUnique({
      where: { username: String(username).trim().toLowerCase() },
      include: { facility: { select: { id: true, name: true } } },
    });

    const passwordOk = await bcrypt.compare(String(password), op?.passwordHash ?? DUMMY_HASH);
    if (!op || !passwordOk || !op.isActive) {
      res.status(401).json({ success: false, message: 'Invalid operator credentials.' });
      return;
    }

    const secret = process.env.OPERATOR_JWT_SECRET;
    if (!secret) {
      throw new Error('OPERATOR_JWT_SECRET is not configured.');
    }

    const token = jwt.sign(
      {
        operatorId: op.id,
        username: op.username,
        facilityId: op.facilityId,
        role: 'operator',
      },
      secret,
      { expiresIn: '8h' }
    );

    res.status(200).json({
      success: true,
      token,
      operator: {
        id: op.id,
        username: op.username,
        facilityId: op.facilityId,
        facilityName: op.facility.name,
      },
    });
  } catch (error) {
    console.error('[Operator Login Error]', error);
    res.status(500).json({ success: false, message: 'Internal operator login error.' });
  }
});

export default operatorAuthRouter;
