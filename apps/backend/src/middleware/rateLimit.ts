import rateLimit from 'express-rate-limit';

/**
 * Brute-force protection for a login endpoint: 10 failed attempts per 15 minutes
 * per client IP (successful logins are not counted). Each login route gets its own
 * limiter so user, operator and admin logins from one network don't share a budget.
 * Requires `app.set('trust proxy', 1)` behind Render's proxy so req.ip is the real client.
 */
export function createLoginLimiter() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    skipSuccessfulRequests: true,
    message: {
      success: false,
      message: 'Too many failed login attempts. Try again in 15 minutes.',
      error: 'Too many failed login attempts. Try again in 15 minutes.',
    },
    standardHeaders: true,
    legacyHeaders: false,
  });
}
