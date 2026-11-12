import { ApiError } from './errors.js';
import { hashSessionToken, looksLikeSessionToken } from '../auth/sessionToken.js';

/**
 * Resolves the caller's identity from a bearer session token on the server.
 * Client-supplied user IDs or roles are never read.
 */
export function createAuthMiddleware(repositories) {
  return async function authenticate(req, res, next) {
    const header = req.get('authorization') ?? '';
    const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
    const token = match?.[1];
    if (!token || !looksLikeSessionToken(token)) {
      throw new ApiError(401, 'AUTH_REQUIRED', 'A valid bearer session token is required.');
    }

    const session = await repositories.sessions.findByTokenHash(hashSessionToken(token));
    if (!session || session.revokedAt) {
      throw new ApiError(401, 'SESSION_INVALID', 'The session is invalid or has expired.');
    }
    if (new Date(session.expiresAt).getTime() <= Date.now()) {
      throw new ApiError(401, 'SESSION_INVALID', 'The session is invalid or has expired.');
    }

    const user = await repositories.users.findByUserId(session.userId);
    if (!user || (user.accountStatus ?? 'ACTIVE') !== 'ACTIVE' || user.role !== session.role) {
      throw new ApiError(401, 'SESSION_INVALID', 'The session is invalid or has expired.');
    }

    req.principal = Object.freeze({
      userId: user.userId,
      role: user.role,
      email: user.email,
      displayName: user.displayName,
      sessionTokenHash: session.tokenHash,
    });
    res.set('Cache-Control', 'no-store');
    return next();
  };
}

export function requireRole(...roles) {
  const allowed = new Set(roles);
  return function authorize(req, res, next) {
    if (!req.principal) {
      throw new ApiError(401, 'AUTH_REQUIRED', 'A valid bearer session token is required.');
    }
    if (!allowed.has(req.principal.role)) {
      throw new ApiError(403, 'ROLE_NOT_PERMITTED', 'This action is not permitted for the authenticated role.');
    }
    return next();
  };
}
