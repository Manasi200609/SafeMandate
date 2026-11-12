import { ApiError } from '../middleware/errors.js';
import { hashPassword, validatePassword, verifyPassword } from '../auth/password.js';
import { createUserId, normalizeDisplayName, normalizeEmail, USER_ROLES } from '../auth/roles.js';
import { issueSessionToken } from '../auth/sessionToken.js';

let dummyPasswordHash;

/**
 * Minimal server-side authentication for buyer and seller demonstration
 * accounts. Roles are assigned at registration from the allowlist; no endpoint
 * accepts a caller-supplied role for an existing session or transaction actor.
 */
export function createAuthService(repositories, { sessionTtlMinutes = 480 } = {}) {
  async function baselineHash() {
    dummyPasswordHash ??= await hashPassword('safe-mandate-timing-baseline-password');
    return dummyPasswordHash;
  }

  async function issueSession(user) {
    const { token, tokenHash } = issueSessionToken();
    const expiresAt = new Date(Date.now() + sessionTtlMinutes * 60_000).toISOString();
    await repositories.sessions.insert({ tokenHash, userId: user.userId, role: user.role, expiresAt, revokedAt: null });
    return { token, expiresAt };
  }

  async function register({ email, password, role, displayName } = {}) {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) {
      throw new ApiError(400, 'INVALID_EMAIL', 'A valid email address is required.');
    }
    // Guardian status is assigned only by accepting a buyer-originated
    // relationship invitation, never through public self-registration.
    if (!['buyer', 'seller'].includes(role) || !USER_ROLES.includes(role)) {
      throw new ApiError(400, 'INVALID_ROLE', "role must be 'buyer' or 'seller'.");
    }
    const passwordCheck = validatePassword(password);
    if (!passwordCheck.valid) {
      throw new ApiError(400, 'INVALID_PASSWORD', passwordCheck.errors.join(' '));
    }
    if (await repositories.users.findByEmail(normalizedEmail)) {
      throw new ApiError(409, 'EMAIL_IN_USE', 'An account with this email already exists.');
    }

    const user = {
      userId: createUserId(),
      email: normalizedEmail,
      displayName: normalizeDisplayName(displayName, normalizedEmail),
      role,
      accountStatus: 'ACTIVE',
      passwordHash: await hashPassword(password),
    };

    try {
      await repositories.users.insert(user);
    } catch (error) {
      if (error?.name === 'DuplicateKeyError') {
        throw new ApiError(409, 'EMAIL_IN_USE', 'An account with this email already exists.');
      }
      throw error;
    }

    const session = await issueSession(user);
    return { user: publicUser(user), ...session };
  }

  async function login({ email, password } = {}) {
    const normalizedEmail = normalizeEmail(email);
    const candidatePassword = typeof password === 'string' ? password : '';
    const user = normalizedEmail ? await repositories.users.findByEmail(normalizedEmail) : null;
    const storedHash = user?.passwordHash ?? (await baselineHash());
    const passwordValid = await verifyPassword(candidatePassword, storedHash);

    if (!user || (user.accountStatus ?? 'ACTIVE') !== 'ACTIVE' || !passwordValid || !normalizedEmail) {
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    }

    const session = await issueSession(user);
    return { user: publicUser(user), ...session };
  }

  async function logout(principal) {
    if (!principal?.sessionTokenHash) {
      throw new ApiError(401, 'AUTH_REQUIRED', 'A valid bearer session token is required.');
    }
    await repositories.sessions.revokeByTokenHash(principal.sessionTokenHash, new Date().toISOString());
    return { revoked: true };
  }

  return Object.freeze({ register, login, logout });
}

export function publicUser(user) {
  return Object.freeze({
    userId: user.userId,
    email: user.email,
    role: user.role,
    displayName: user.displayName,
  });
}
