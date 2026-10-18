import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../utils/prisma';

export const operatorAuthRouter = Router();

const DEFAULT_OPERATORS = [
  { id: 'op-001', username: 'operator1', password: 'Op@12345' },
  { id: 'op-002', username: 'operator2', password: 'Op@12345' },
];

/**
 * POST /api/operator-auth/login
 * Authenticates parking operators and issues an operator JWT.
 */
operatorAuthRouter.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      res.status(400).json({ success: false, message: 'Username and password are required.' });
      return;
    }

    const op = DEFAULT_OPERATORS.find((o) => o.username === username && o.password === password);
    if (!op) {
      res.status(401).json({ success: false, message: 'Invalid operator credentials.' });
      return;
    }

    // Attempt to associate with an active facility in the database
    const facility = await prisma.parkingFacility.findFirst({
      select: { id: true, name: true },
    });

    const facilityId = facility?.id || 'default-facility';

    const secret = process.env.OPERATOR_JWT_SECRET;
    if (!secret) {
      throw new Error('OPERATOR_JWT_SECRET is not configured.');
    }

    const token = jwt.sign(
      {
        operatorId: op.id,
        username: op.username,
        facilityId,
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
        facilityId,
        facilityName: facility?.name || 'Main Parking Facility',
      },
    });
  } catch (error) {
    console.error('[Operator Login Error]', error);
    res.status(500).json({ success: false, message: 'Internal operator login error.' });
  }
});

export default operatorAuthRouter;
