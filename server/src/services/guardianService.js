import { randomUUID } from 'node:crypto';
import { ApiError } from '../middleware/errors.js';

export function createGuardianService(repositories) {
  async function invite({ principal, body }) {
    if (principal?.role !== 'buyer') throw new ApiError(403, 'ROLE_NOT_PERMITTED', 'Only a buyer may invite a guardian.');
    const email = typeof body?.guardianEmail === 'string' ? body.guardianEmail.trim().toLowerCase() : '';
    const invitee = email ? await repositories.users.findByEmail(email) : null;
    if (!invitee || invitee.accountStatus !== 'ACTIVE') throw new ApiError(404, 'INVITEE_NOT_FOUND', 'An active account is required for a guardian invitation.');
    if (invitee.userId === principal.userId) throw new ApiError(400, 'SELF_GUARDIAN', 'A buyer cannot be their own guardian.');
    const relationship = {
      relationshipId: `guardian_rel_${randomUUID()}`,
      buyerId: principal.userId,
      guardianId: invitee.userId,
      guardianEmail: invitee.email,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
      respondedAt: null,
    };
    try { await repositories.guardianRelationships.insert(relationship); }
    catch (error) {
      if (error?.name === 'DuplicateKeyError') throw new ApiError(409, 'RELATIONSHIP_EXISTS', 'A guardian relationship already exists.');
      throw error;
    }
    return relationship;
  }

  async function accept({ principal, relationshipId }) {
    const relationship = await repositories.guardianRelationships.findById(relationshipId);
    if (!relationship || relationship.guardianId !== principal?.userId || relationship.guardianEmail !== principal.email) {
      throw new ApiError(404, 'RELATIONSHIP_NOT_FOUND', 'Guardian invitation not found.');
    }
    if (relationship.status !== 'PENDING' && relationship.status !== 'ACCEPTED') {
      throw new ApiError(409, 'RELATIONSHIP_CLOSED', 'This guardian invitation is no longer available.');
    }
    const respondedAt = relationship.respondedAt ?? new Date().toISOString();
    if (relationship.status === 'PENDING') {
      const accepted = await repositories.guardianRelationships.accept({ relationshipId, guardianId: principal.userId, respondedAt });
      if (!accepted) throw new ApiError(409, 'RELATIONSHIP_CHANGED', 'The guardian invitation changed; reload and retry.');
    }
    // This is an in-app designation, not an identity or legal guardianship check.
    await repositories.users.setRole(principal.userId, 'guardian');
    await repositories.sessions.updateRoleByUserId(principal.userId, 'guardian');
    return { ...relationship, status: 'ACCEPTED', respondedAt };
  }

  async function list({ principal }) {
    if (principal?.role !== 'buyer') throw new ApiError(403, 'ROLE_NOT_PERMITTED', 'Only a buyer may view guardian invitations.');
    return repositories.guardianRelationships.listForBuyer(principal.userId);
  }

  async function assertAccepted({ buyerId, guardianId }) {
    if (!guardianId || guardianId === buyerId) throw new ApiError(403, 'GUARDIAN_NOT_ELIGIBLE', 'This transaction has no eligible guardian.');
    const relationship = await repositories.guardianRelationships.findAccepted(buyerId, guardianId);
    if (!relationship) throw new ApiError(403, 'GUARDIAN_NOT_ACCEPTED', 'The designated guardian relationship is not accepted.');
    return relationship;
  }

  return Object.freeze({ invite, accept, list, assertAccepted });
}
