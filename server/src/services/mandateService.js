import { randomUUID } from 'node:crypto';
import { ApiError } from '../middleware/errors.js';
import { validateMandate } from '../domain/mandate/validateMandate.js';

export function createMandateService(repositories) {
  async function saveMandate({ principal, body } = {}) {
    if (principal?.role !== 'buyer') {
      throw new ApiError(403, 'ROLE_NOT_PERMITTED', 'Only an authenticated buyer may save a mandate.');
    }
    const input = body?.mandate ?? body;
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new ApiError(400, 'MANDATE_REQUIRED', 'A mandate object is required.');
    }

    const mandate = { ...input, mandateId: `mandate_${randomUUID()}` };
    const validation = validateMandate(mandate);
    if (!validation.valid) {
      throw new ApiError(400, 'INVALID_MANDATE', validation.errors.join(' '));
    }

    if (mandate.guardianId === principal.userId) {
      throw new ApiError(409, 'GUARDIAN_NOT_ELIGIBLE', 'Choose an accepted guardian relationship for this mandate.');
    }
    const relationship = await repositories.guardianRelationships.findAccepted(principal.userId, mandate.guardianId);
    const guardian = await repositories.users.findByUserId(mandate.guardianId);
    if (!relationship || guardian?.role !== 'guardian' || guardian?.accountStatus !== 'ACTIVE') {
      throw new ApiError(409, 'GUARDIAN_NOT_ELIGIBLE', 'The selected guardian must have an accepted relationship and an active guardian account.');
    }

    await repositories.mandates.insert({
      mandateId: mandate.mandateId,
      buyerId: principal.userId,
      currency: mandate.currency,
      expiresAt: mandate.expiresAt,
      payload: structuredClone(mandate),
    });

    return mandate;
  }

  async function getCurrentMandate({ principal } = {}) {
    if (principal?.role !== 'buyer') {
      throw new ApiError(403, 'ROLE_NOT_PERMITTED', 'Only an authenticated buyer may read a mandate.');
    }
    const record = await repositories.mandates.findCurrentForBuyer(principal.userId);
    if (!record) {
      throw new ApiError(404, 'MANDATE_NOT_FOUND', 'No mandate is stored for this buyer.');
    }
    return record.payload;
  }

  return Object.freeze({ saveMandate, getCurrentMandate });
}
