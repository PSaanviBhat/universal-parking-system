import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../utils/prisma';
import { createLoginLimiter } from '../middleware/rateLimit';

export const adminAuthRouter = Router();

const loginLimiter = createLoginLimiter();

// Compared against when the username does not exist, so response time does not reveal valid usernames.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

/**
 * POST /api/admin-auth/login
 * Authenticates a platform administrator against the Admin table and issues an admin JWT.
 */
adminAuthRouter.post('/login', loginLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      res.status(400).json({ success: false, message: 'Username and password are required.' });
      return;
    }

    const admin = await prisma.admin.findUnique({
      where: { username: String(username).trim().toLowerCase() },
    });

    const passwordOk = await bcrypt.compare(String(password), admin?.passwordHash ?? DUMMY_HASH);
    if (!admin || !passwordOk) {
      res.status(401).json({ success: false, message: 'Invalid admin credentials.' });
      return;
    }

    const secret = process.env.ADMIN_JWT_SECRET;
    if (!secret) {
      throw new Error('ADMIN_JWT_SECRET is not configured.');
    }

    const token = jwt.sign(
      {
        adminId: admin.id,
        username: admin.username,
        role: 'admin',
      },
      secret,
      { expiresIn: '12h' }
    );

    res.status(200).json({
      success: true,
      token,
      admin: {
        id: admin.id,
        username: admin.username,
        role: 'admin',
      },
    });
  } catch (error) {
    console.error('[Admin Login Error]', error);
    res.status(500).json({ success: false, message: 'Internal admin login error.' });
  }
});

export default adminAuthRouter;
