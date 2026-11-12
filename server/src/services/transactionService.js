import { randomUUID } from 'node:crypto';
import {
  createTransaction as createDomainTransaction,
  hydrateTransaction,
  serializeTransaction,
  transitionTransaction,
  TransitionError,
} from '../domain/transactions/transitionTransaction.js';
import { validateProposal } from '../domain/mandate/evaluateProposal.js';
import { ApiError } from '../middleware/errors.js';

const POLICY_ACTOR = Object.freeze({ id: 'safe-mandate-policy-engine', role: 'system' });
const PARTICIPANT_ROLES = Object.freeze(['buyer', 'seller']);
const CHECK_IN_STATES = Object.freeze(['AUTHORIZED', 'MEETUP_ACTIVE']);
const CONFLICT_CODES = new Set([
  'STALE_VERSION',
  'DUPLICATE_EVENT_ID',
  'EVENT_ID_REUSED',
  'EVENT_ID_COLLISION',
  'DUPLICATE_HANDOFF',
  'DUPLICATE_APPROVAL',
]);

function toApiError(error) {
  if (!(error instanceof TransitionError)) return error;
  const status = CONFLICT_CODES.has(error.code) ? 409 : 422;
  return new ApiError(status, error.code ?? 'TRANSITION_REJECTED', error.message);
}

function nowIso() {
  return new Date().toISOString();
}

/** Public view of a stored transaction: no internal event digests or session data. */
export function toTransactionView(record) {
  return {
    transactionId: record.transactionId,
    mandateId: record.mandateId,
    buyerId: record.buyerId,
    sellerId: record.sellerId,
    state: record.state,
    version: record.version,
    proposal: record.proposal,
    proposalVersion: record.proposalVersion,
    proposalFingerprint: record.proposalFingerprint,
    policyEvidence: record.policyEvidence,
    guardianApproval: record.guardianApproval,
    handoffConfirmations: record.handoffConfirmations,
    provider: record.provider,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    auditLog: record.auditLog,
  };
}

function toTransactionSummary(record) {
  return {
    transactionId: record.transactionId,
    state: record.state,
    version: record.version,
    buyerId: record.buyerId,
    sellerId: record.sellerId,
    proposalId: record.proposal?.proposalId ?? null,
    itemName: record.proposal?.itemName ?? null,
    amountMinor: record.proposal?.amountMinor ?? null,
    currency: record.proposal?.currency ?? null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function createTransactionService(repositories, { assertGuardianAccepted = async () => null } = {}) {
  async function load(transactionId) {
    const record = await repositories.transactions.findById(transactionId);
    if (!record) throw new ApiError(404, 'TRANSACTION_NOT_FOUND', 'Transaction not found.');
    try {
      return { record, aggregate: hydrateTransaction(record) };
    } catch {
      throw new ApiError(500, 'TRANSACTION_STATE_UNAVAILABLE', 'The stored transaction could not be loaded.');
    }
  }

  function assertParticipant(record, principal) {
    if (record.buyerId !== principal?.userId && record.sellerId !== principal?.userId) {
      // Hide existence from non-participants.
      throw new ApiError(404, 'TRANSACTION_NOT_FOUND', 'Transaction not found.');
    }
  }

  async function mirrorProjections(record) {
    const tasks = [
      repositories.auditEvents.appendMany(record.transactionId, record.auditLog ?? []),
      repositories.paypalReferences.upsert({
        transactionId: record.transactionId,
        environment: 'sandbox',
        orderId: record.provider?.orderId ?? null,
        authorizationId: record.provider?.authorizationId ?? null,
        captureId: record.provider?.captureId ?? null,
        voidId: record.provider?.voidId ?? null,
        lastEventType: record.auditLog?.at(-1)?.eventType ?? null,
        transactionState: record.state,
        updatedAt: record.updatedAt,
      }),
    ];

    for (const party of ['buyer', 'seller']) {
      if (!record.handoffConfirmations?.[`${party}Confirmed`]) continue;
      const event = [...(record.auditLog ?? [])]
        .reverse()
        .find((entry) => entry.eventType === 'HANDOFF_CONFIRMED' && entry.metadata?.party === party);
      tasks.push(
        repositories.handoffConfirmations.upsert({
          transactionId: record.transactionId,
          party,
          actorId: record.handoffConfirmations[`${party}ActorId`],
          confirmationId: event?.metadata?.confirmationId ?? null,
          confirmedAt: event?.timestamp ?? record.updatedAt,
          expiresAt: record.mandate?.expiresAt ?? null,
          revokedAt: null,
        }),
      );
    }

    // Authoritative state is the single transaction document; these are
    // queryable projections, so a mirror failure is reported without hiding
    // the committed transition.
    const results = await Promise.allSettled(tasks);
    if (results.some((result) => result.status === 'rejected')) {
      console.warn(`Safe Mandate projection mirror incomplete for transaction ${record.transactionId}.`);
    }
  }

  async function persistTransition(previousRecord, nextSnapshot) {
    const record = serializeTransaction(nextSnapshot);
    const updated = await repositories.transactions.updateWithVersion({
      transactionId: record.transactionId,
      expectedVersion: previousRecord.version,
      record,
    });
    if (!updated) {
      throw new ApiError(409, 'STALE_TRANSACTION', 'The transaction changed; reload and retry.');
    }
    await mirrorProjections(record);
    return record;
  }

  function applyEvent(aggregate, record, { type, actor, extra = {} }) {
    try {
      return transitionTransaction(
        aggregate,
        { eventId: `evt_${randomUUID()}`, expectedVersion: record.version, type, actor, ...extra },
        { now: nowIso() },
      );
    } catch (error) {
      throw toApiError(error);
    }
  }

  async function getPaymentContext(transactionId) {
    return load(transactionId);
  }

  async function applyPaymentEvent({ transactionId, type, extra = {} }) {
    const { record, aggregate } = await load(transactionId);
    const paypalEvent = ['PAYMENT_AUTHORIZED', 'PAYPAL_CAPTURE_CONFIRMED', 'PAYPAL_VOID_CONFIRMED', 'PAYMENT_RECONCILED'].includes(type);
    const actor = paypalEvent
      ? { id: 'paypal-sandbox-adapter', role: 'paypal' }
      : { id: POLICY_ACTOR.id, role: 'system' };
    const next = applyEvent(aggregate, record, { type, actor, extra });
    return persistTransition(record, next);
  }

  async function createTransaction({ principal, body } = {}) {
    if (principal?.role !== 'buyer') {
      throw new ApiError(403, 'ROLE_NOT_PERMITTED', 'Only an authenticated buyer may create a transaction.');
    }

    const mandateRecord = await repositories.mandates.findCurrentForBuyer(principal.userId);
    if (!mandateRecord) {
      throw new ApiError(409, 'MANDATE_REQUIRED', 'Save an active mandate before creating a transaction.');
    }

    const sellerId = typeof body?.sellerId === 'string' ? body.sellerId.trim() : '';
    if (!sellerId) throw new ApiError(400, 'SELLER_REQUIRED', 'sellerId is required.');
    const seller = await repositories.users.findByUserId(sellerId);
    if (!seller || seller.role !== 'seller') {
      throw new ApiError(400, 'SELLER_NOT_FOUND', 'sellerId must reference an existing seller account.');
    }
    if (seller.userId === principal.userId) {
      throw new ApiError(400, 'IDENTITY_COLLISION', 'Buyer and seller must be distinct identities.');
    }

    const input = body?.proposal;
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new ApiError(400, 'PROPOSAL_REQUIRED', 'proposal must be an object.');
    }

    const createdAt = nowIso();
    // Server-owned fields: the seller binding, proposal ID, and creation time
    // come from authoritative records, never from caller-supplied identifiers.
    const {
      aiRiskScore: _untrustedRiskScore,
      riskSignals: _untrustedRiskSignals,
      supportingEvidence: _untrustedSupportingEvidence,
      ...clientProposalFields
    } = input;
    const proposal = {
      ...clientProposalFields,
      proposalId: `proposal_${randomUUID()}`,
      sellerId: seller.userId,
      sellerName: seller.displayName,
      createdAt,
    };

    const validation = validateProposal(proposal);
    if (!validation.valid) {
      throw new ApiError(400, 'INVALID_PROPOSAL', validation.errors.join(' '));
    }
    if (proposal.currency !== mandateRecord.payload.currency) {
      throw new ApiError(400, 'CURRENCY_MISMATCH', 'Proposal currency must match the stored mandate currency.');
    }

    let snapshot;
    try {
      snapshot = createDomainTransaction({
        transactionId: `tx_${randomUUID()}`,
        mandate: mandateRecord.payload,
        proposal,
        buyerId: principal.userId,
        createdAt,
      });
    } catch (error) {
      throw toApiError(error);
    }

    const record = serializeTransaction(snapshot);
    await repositories.transactions.insert(record);
    await mirrorProjections(record);
    return toTransactionView(record);
  }

  async function evaluateTransaction({ principal, transactionId } = {}) {
    const { record, aggregate } = await load(transactionId);
    if (record.buyerId !== principal?.userId) {
      throw new ApiError(403, 'ROLE_NOT_PERMITTED', 'Only the transaction buyer may request policy evaluation.');
    }
    const next = applyEvent(aggregate, record, { type: 'POLICY_EVALUATED', actor: POLICY_ACTOR });
    return toTransactionView(await persistTransition(record, next));
  }

  async function guardianDecision({ principal, transactionId, body } = {}) {
    if (principal?.role !== 'guardian') throw new ApiError(403, 'ROLE_NOT_PERMITTED', 'Only an authenticated guardian may decide an exception.');
    const { record, aggregate } = await load(transactionId);
    if (record.buyerId === principal.userId) throw new ApiError(403, 'SELF_GUARDIAN', 'A buyer cannot approve their own transaction.');
    await assertGuardianAccepted({ buyerId: record.buyerId, guardianId: principal.userId });
    if (record.mandate?.guardianId !== principal.userId) throw new ApiError(403, 'GUARDIAN_NOT_DESIGNATED', 'This guardian is not designated by the transaction mandate.');
    if (!Number.isInteger(body?.expectedVersion) || body.expectedVersion !== record.version) {
      throw new ApiError(409, 'STALE_TRANSACTION', 'The transaction changed; reload and retry with its current version.');
    }
    const next = applyEvent(aggregate, record, {
      type: 'GUARDIAN_DECISION',
      actor: { id: principal.userId, role: 'guardian' },
      extra: {
        transactionId: record.transactionId,
        proposalId: record.proposal.proposalId,
        mandateId: record.mandate.mandateId,
        proposalVersion: record.proposalVersion,
        proposalFingerprint: record.proposalFingerprint,
        decision: body?.decision,
        reason: typeof body?.reason === 'string' ? body.reason.trim().slice(0, 500) : '',
      },
    });
    return toTransactionView(await persistTransition(record, next));
  }

  async function confirmHandoff({ principal, transactionId } = {}) {
    const party = principal?.role;
    if (!PARTICIPANT_ROLES.includes(party)) {
      throw new ApiError(403, 'ROLE_NOT_PERMITTED', 'Only a buyer or seller participant may confirm a handoff.');
    }
    const { record, aggregate } = await load(transactionId);
    assertParticipant(record, principal);

    // The party is derived from the authenticated role; request bodies cannot
    // choose the other participant's confirmation.
    const next = applyEvent(aggregate, record, {
      type: 'HANDOFF_CONFIRMED',
      actor: { id: principal.userId, role: party },
      extra: { party, confirmationId: `handoff_${randomUUID()}` },
    });
    return toTransactionView(await persistTransition(record, next));
  }

  async function startMeetup({ principal, transactionId, body } = {}) {
    if (principal?.role !== 'buyer') {
      throw new ApiError(403, 'ROLE_NOT_PERMITTED', 'Only the transaction buyer may start the meetup.');
    }
    const { record, aggregate } = await load(transactionId);
    if (record.buyerId !== principal.userId) {
      throw new ApiError(404, 'TRANSACTION_NOT_FOUND', 'Transaction not found.');
    }
    if (!Number.isInteger(body?.expectedVersion) || body.expectedVersion !== record.version) {
      throw new ApiError(409, 'STALE_TRANSACTION', 'The transaction changed; reload and retry with its current version.');
    }
    const next = applyEvent(aggregate, record, {
      type: 'MEETUP_STARTED',
      actor: POLICY_ACTOR,
      extra: { reason: 'Buyer started the authorized transaction meetup.' },
    });
    return toTransactionView(await persistTransition(record, next));
  }

  async function recordCheckIn({ principal, transactionId, body } = {}) {
    const { record } = await load(transactionId);
    if (record.buyerId !== principal?.userId) {
      throw new ApiError(403, 'ROLE_NOT_PERMITTED', 'Only the transaction buyer may record a check-in.');
    }
    if (!CHECK_IN_STATES.includes(record.state)) {
      throw new ApiError(409, 'CHECK_IN_NOT_APPLICABLE', `A buyer check-in is not applicable in state ${record.state}.`);
    }
    const note = typeof body?.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 500) : null;
    const checkIn = {
      checkInId: `checkin_${randomUUID()}`,
      transactionId: record.transactionId,
      buyerId: principal.userId,
      type: 'ARRIVAL',
      stateAtCheckIn: record.state,
      expiresAt: record.mandate?.expiresAt ?? null,
      revokedAt: null,
      note,
      createdAt: nowIso(),
    };
    await repositories.checkIns.insert(checkIn);
    return checkIn;
  }

  async function getTransaction({ principal, transactionId } = {}) {
    const { record } = await load(transactionId);
    assertParticipant(record, principal);
    return toTransactionView(record);
  }

  async function listTransactions({ principal } = {}) {
    const records = await repositories.transactions.listForParticipant(principal?.userId);
    return records.map(toTransactionSummary);
  }

  async function getAuditLog({ principal, transactionId } = {}) {
    const { record } = await load(transactionId);
    assertParticipant(record, principal);
    const events = await repositories.auditEvents.listByTransaction(transactionId);
    return {
      transactionId,
      version: record.version,
      state: record.state,
      // The embedded chain is authoritative; the projection is normally identical.
      auditLog: record.auditLog,
      projectedEventCount: events.length,
    };
  }

  async function getCheckIns({ principal, transactionId } = {}) {
    const { record } = await load(transactionId);
    assertParticipant(record, principal);
    return repositories.checkIns.listByTransaction(transactionId);
  }

  async function getPaymentReference({ principal, transactionId } = {}) {
    const { record } = await load(transactionId);
    assertParticipant(record, principal);
    const reference = await repositories.paypalReferences.findByTransactionId(transactionId);
    return {
      transactionId,
      state: record.state,
      provider: record.provider,
      reference,
    };
  }

  return Object.freeze({
    createTransaction,
    evaluateTransaction,
    guardianDecision,
    getPaymentContext,
    applyPaymentEvent,
    confirmHandoff,
    startMeetup,
    recordCheckIn,
    getTransaction,
    listTransactions,
    getAuditLog,
    getCheckIns,
    getPaymentReference,
  });
}
