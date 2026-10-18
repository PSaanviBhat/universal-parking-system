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
