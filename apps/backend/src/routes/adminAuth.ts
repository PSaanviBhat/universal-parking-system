import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';

export const adminAuthRouter = Router();

const DEFAULT_ADMINS = [
  { id: 'admin-001', username: 'superadmin', password: 'Admin@12345', role: 'admin' },
];

/**
 * POST /api/admin-auth/login
 * Authenticates facility/system administrators and issues an admin JWT.
 */
adminAuthRouter.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      res.status(400).json({ success: false, message: 'Username and password are required.' });
      return;
    }

    const admin = DEFAULT_ADMINS.find((a) => a.username === username && a.password === password);
    if (!admin) {
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
        role: admin.role,
      },
      secret,
      { expiresIn: '24h' }
    );

    res.status(200).json({
      success: true,
      token,
      admin: {
        id: admin.id,
        username: admin.username,
        role: admin.role,
      },
    });
  } catch (error) {
    console.error('[Admin Login Error]', error);
    res.status(500).json({ success: false, message: 'Internal admin login error.' });
  }
});

export default adminAuthRouter;
