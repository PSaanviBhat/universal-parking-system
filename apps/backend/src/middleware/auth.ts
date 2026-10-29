import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface JwtPayload {
  userId: string;
  email: string;
  phone: string;
}

export interface OperatorJwtPayload {
  operatorId: string;
  username: string;
  facilityId: string;
  role: string;
}

export interface AdminJwtPayload {
  adminId: string;
  username: string;
  role: string;
}

export interface AuthenticatedRequest extends Request {
  user?: JwtPayload;
  operator?: OperatorJwtPayload;
  admin?: AdminJwtPayload;
}

export const authGuard = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      success: false,
      message: 'Access denied. Missing or invalid Authorization header.',
    });
    return;
  }

  const token = authHeader.split(' ')[1];

  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new Error('JWT_SECRET is not configured');
    }
    const decoded = jwt.verify(token, secret) as JwtPayload;
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({
      success: false,
      message: 'Invalid or expired authentication token.',
    });
  }
};

export const operatorAuthGuard = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      success: false,
      message: 'Access denied. Missing or invalid operator token.',
    });
    return;
  }

  const token = authHeader.split(' ')[1];

  try {
    const secret = process.env.OPERATOR_JWT_SECRET;
    if (!secret) {
      throw new Error('OPERATOR_JWT_SECRET is not configured');
    }
    const decoded = jwt.verify(token, secret) as OperatorJwtPayload;
    req.operator = decoded;
    next();
  } catch (error) {
    res.status(401).json({
      success: false,
      message: 'Invalid or expired operator authentication token.',
    });
  }
};

function bearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  return authHeader.split(' ')[1] || null;
}

/** Verifies a staff token: an operator token first, then an admin token. */
export function verifyStaffToken(
  token: string
): { operator: OperatorJwtPayload } | { admin: AdminJwtPayload } | null {
  const operatorSecret = process.env.OPERATOR_JWT_SECRET;
  const adminSecret = process.env.ADMIN_JWT_SECRET;
  try {
    if (operatorSecret) {
      const decoded = jwt.verify(token, operatorSecret) as OperatorJwtPayload;
      if (decoded.role === 'operator' && decoded.facilityId) return { operator: decoded };
    }
  } catch {
    /* not an operator token */
  }
  try {
    if (adminSecret) {
      const decoded = jwt.verify(token, adminSecret) as AdminJwtPayload;
      if (decoded.role === 'admin') return { admin: decoded };
    }
  } catch {
    /* not an admin token */
  }
  return null;
}

/**
 * Accepts an operator OR an admin token. Operators are limited to their own
 * facility (see requireFacilityAccess / canAccessFacility); admins see every facility.
 */
export const staffAuthGuard = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  const token = bearerToken(req);
  const staff = token ? verifyStaffToken(token) : null;
  if (!staff) {
    res.status(401).json({
      success: false,
      message: 'Invalid or expired operator authentication token.',
    });
    return;
  }
  if ('operator' in staff) req.operator = staff.operator;
  else req.admin = staff.admin;
  next();
};

export function canAccessFacility(req: AuthenticatedRequest, facilityId: string): boolean {
  if (req.admin) return true;
  return Boolean(req.operator && req.operator.facilityId === facilityId);
}

/** Rejects requests whose :facilityId route param is not the operator's own facility. */
export const requireFacilityAccess = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void => {
  if (!canAccessFacility(req, String(req.params.facilityId))) {
    res.status(403).json({ success: false, message: 'You do not have access to this facility.' });
    return;
  }
  next();
};

export const adminAuthGuard = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      success: false,
      message: 'Access denied. Missing or invalid admin token.',
    });
    return;
  }

  const token = authHeader.split(' ')[1];

  try {
    const secret = process.env.ADMIN_JWT_SECRET;
    if (!secret) {
      throw new Error('ADMIN_JWT_SECRET is not configured');
    }
    const decoded = jwt.verify(token, secret) as AdminJwtPayload;
    if (decoded.role !== 'admin') {
      res.status(403).json({
        success: false,
        message: 'Forbidden. Admin privileges required.',
      });
      return;
    }
    req.admin = decoded;
    next();
  } catch (error) {
    res.status(401).json({
      success: false,
      message: 'Invalid or expired admin authentication token.',
    });
  }
};
