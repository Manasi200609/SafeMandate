import { randomUUID } from 'node:crypto';
import { evaluateProposal, proposalFingerprint } from '../mandate/evaluateProposal.js';
import { createAuditEvent, deepFreeze } from '../audit/createAuditEvent.js';
import { validateMandate, isMandateActive } from '../mandate/validateMandate.js';
import { parseIsoInstant, isPlainData } from '../mandate/validationPrimitives.js';
import { ALLOWED_TRANSITIONS, STATES } from './transitionRules.js';

export class TransitionError extends Error { constructor(message, code = 'INVALID_TRANSITION') { super(message); this.name = 'TransitionError'; this.code = code; } }
const aggregates = new Map();
const eventOwners = new Map();
const snapshots = new WeakMap();
const ACTOR_ROLES = new Set(['buyer','seller','agent','guardian','system','paypal']);
function fail(message, code) { throw new TransitionError(message, code); }
function requireString(value, label) { if (typeof value !== 'string' || !value.trim()) fail(`${label} must be a non-empty string.`); }
function makeSnapshot(r) {
  const snapshot = deepFreeze({ transactionId:r.transactionId, mandateId:r.mandate.mandateId, mandate:r.mandate, proposal:r.proposal, proposalVersion:r.proposalVersion, proposalFingerprint:r.proposalFingerprint, buyerId:r.buyerId, sellerId:r.sellerId, version:r.version, state:r.state, createdAt:r.createdAt, updatedAt:r.updatedAt, policyEvidence:r.policyEvidence, guardianApproval:r.guardianApproval, handoffConfirmations:r.handoffConfirmations, provider:r.provider, auditLog:r.auditLog });
  snapshots.set(snapshot, r);
  return snapshot;
}

/** Factory-issued snapshots are deeply frozen and backed by a private in-process aggregate. */
export function createTransaction({ transactionId = randomUUID(), mandate, proposal, buyerId, createdAt = proposal?.createdAt }) {
  const mv = validateMandate(mandate);
  if (!mv.valid) fail(`Invalid mandate: ${mv.errors.join(' ')}`, 'INVALID_MANDATE');
  requireString(transactionId, 'transactionId'); requireString(buyerId, 'buyerId');
  if (parseIsoInstant(createdAt) === null) fail('createdAt must be a valid ISO timestamp.', 'INVALID_TIMESTAMP');
  const ownedMandate = structuredClone(mandate), ownedProposal = structuredClone(proposal);
  if (!isPlainData(ownedProposal)) fail("Proposal must be plain JSON-compatible data.", "INVALID_PROPOSAL");
  const sellerId = typeof ownedProposal?.sellerId === 'string' && ownedProposal.sellerId.trim() ? ownedProposal.sellerId : null;
  if (sellerId && sellerId === buyerId) fail('Buyer and seller must be distinct identities.', 'IDENTITY_COLLISION');
  if (aggregates.has(transactionId)) fail('transactionId already exists.', 'DUPLICATE_TRANSACTION');
  const r = { transactionId, mandate:deepFreeze(ownedMandate), proposal:deepFreeze(ownedProposal), proposalVersion:1, proposalFingerprint:proposalFingerprint(ownedProposal), buyerId, sellerId, version:0, state:'PROPOSED', createdAt, updatedAt:createdAt, policyEvidence:null, guardianApproval:null, handoffConfirmations:deepFreeze({buyerConfirmed:false,sellerConfirmed:false,buyerActorId:null,sellerActorId:null}), provider:deepFreeze({orderId:null,authorizationId:null,captureId:null,voidId:null}), auditLog:deepFreeze([]), eventDigests:new Map(), currentSnapshot:null };
  r.currentSnapshot = makeSnapshot(r); aggregates.set(transactionId,r);
  return r.currentSnapshot;
}

/** Every domain event is committed synchronously against a factory-owned current version. */
export function transitionTransaction(transaction, event, context = {}) {
  const issued = transaction && snapshots.get(transaction);
  if (!issued) fail("Transaction was not created by createTransaction.", "UNTRUSTED_TRANSACTION");
  const r = aggregates.get(issued.transactionId);
  if (!r || r.currentSnapshot !== transaction) fail("Transaction snapshot is stale; reload the current aggregate.", "STALE_VERSION");
  if (!event || typeof event !== "object" || Array.isArray(event) || !isPlainData(event)) fail("Event must be plain JSON-compatible data.", "INVALID_EVENT");
  let e;
  try { e = structuredClone(event); } catch { fail("Event must contain cloneable domain data.", "INVALID_EVENT"); }
  requireString(e.eventId, "eventId");
  const digest = proposalFingerprint(e);
  if (eventOwners.has(e.eventId)) {
    const owner = eventOwners.get(e.eventId);
    if (owner !== r.transactionId) fail("Event ID is already assigned to another transaction.", "EVENT_ID_COLLISION");
    fail(r.eventDigests.get(e.eventId) === digest ? "Duplicate event ID." : "Event ID was reused with different data.", r.eventDigests.get(e.eventId) === digest ? "DUPLICATE_EVENT_ID" : "EVENT_ID_REUSED");
  }
  if (e.expectedVersion !== r.version) fail("Stale transaction version.", "STALE_VERSION");
  const actor = e.actor, now = context.now ?? new Date().toISOString();
  if (parseIsoInstant(now) === null) fail("Context now must be a valid ISO timestamp.", "INVALID_TIMESTAMP");
  if (!actor || typeof actor.id !== "string" || !actor.id.trim() || !ACTOR_ROLES.has(actor.role)) fail("A valid actor id and role are required.", "INVALID_ACTOR");
  if (e.type === 'HANDOFF_CONFIRMED') {
    if (e.party === 'buyer' && (actor.role !== 'buyer' || actor.id !== r.buyerId)) fail('Buyer confirmation must come from the transaction buyer.', 'INVALID_ACTOR');
    if (e.party === 'seller' && (actor.role !== 'seller' || !r.sellerId || actor.id !== r.sellerId)) fail('Seller confirmation must come from the proposal seller.', 'INVALID_ACTOR');
    if (!['buyer','seller'].includes(e.party)) fail('Handoff party must be buyer or seller.');
  }
  if (e.type === 'GUARDIAN_DECISION' && (actor.role !== 'guardian' || actor.id !== r.mandate.guardianId)) fail('Only the nominated guardian may decide this exception.', 'INVALID_ACTOR');
  const roleByEvent = { POLICY_EVALUATED:['agent','system'], GUARDIAN_APPROVAL_READY:['system'], PAYMENT_ORDER_CREATED:['system'], PAYMENT_AUTHORIZED:['paypal'], MEETUP_STARTED:['system'], CAPTURE_REQUESTED:['system'], PAYPAL_CAPTURE_CONFIRMED:['paypal'], MISSED_CHECK_IN:['system'], VOID_REQUESTED:['system'], PAYPAL_VOID_CONFIRMED:['paypal'], EXPIRE:['system'], BLOCK:['system'] };
  if (roleByEvent[e.type] && !roleByEvent[e.type].includes(actor.role)) fail(`Actor role is not permitted for ${e.type}.`, 'INVALID_ACTOR');
  if (!STATES.includes(r.state)) fail('Internal transaction state is invalid.', 'INVALID_STATE');
  const oldState = r.state;
  let nextState = oldState, reason = e.reason, metadata = {}, policyEvidence = r.policyEvidence, approval = r.guardianApproval;
  let handoff = r.handoffConfirmations, provider = r.provider;
  const move = (s) => { if (!ALLOWED_TRANSITIONS[oldState].includes(s)) fail(`Transition ${oldState} → ${s} is not allowed.`); nextState=s; };
  const explain = (text) => { reason=text; };
  const requireReason = () => { requireString(reason, 'reason'); };

  switch (e.type) {
    case 'POLICY_EVALUATED': {
      if (oldState !== 'PROPOSED') fail('Policy can only evaluate a proposed transaction.');
      const evaluation = evaluateProposal(r.mandate,r.proposal,now);
      if (e.decision !== undefined && e.decision !== evaluation.decision) fail('Supplied decision differs from deterministic policy output.');
      move(evaluation.decision); explain(evaluation.explanation);
      policyEvidence = deepFreeze({ transactionId:r.transactionId, mandateId:r.mandate.mandateId, proposalId:r.proposal.proposalId, proposalVersion:r.proposalVersion, proposalFingerprint:r.proposalFingerprint, decision:evaluation.decision, reasonCodes:evaluation.reasonCodes, evaluatedAt:now });
      metadata = { policyEvidence, paymentEligible:evaluation.paymentEligible };
      break;
    }
    case 'GUARDIAN_DECISION': {
      if (oldState !== 'NEEDS_GUARDIAN' || !policyEvidence || policyEvidence.decision !== 'NEEDS_GUARDIAN') fail('A valid policy exception is required before guardian review.');
      if (approval) fail('Guardian decision was already recorded.', 'DUPLICATE_APPROVAL');
      if (e.transactionId !== r.transactionId || e.proposalId !== r.proposal.proposalId || e.mandateId !== r.mandate.mandateId || e.proposalVersion !== r.proposalVersion || e.proposalFingerprint !== r.proposalFingerprint) fail('Guardian decision does not bind to the current transaction, mandate, and proposal version.', 'APPROVAL_BINDING_MISMATCH');
      if (!['approve','reject'].includes(e.decision)) fail('Guardian decision must be approve or reject.');
      requireReason();
      approval = deepFreeze({ transactionId:r.transactionId, proposalId:r.proposal.proposalId, mandateId:r.mandate.mandateId, proposalVersion:r.proposalVersion, proposalFingerprint:r.proposalFingerprint, guardianId:actor.id, decision:e.decision, timestamp:now, originalExceptionReasons:[...policyEvidence.reasonCodes], reason });
      metadata = { guardianApproval:approval };
      move(e.decision === 'approve' ? 'GUARDIAN_APPROVED' : 'BLOCKED');
      break;
    }
    case 'GUARDIAN_APPROVAL_READY':
      if (oldState !== 'GUARDIAN_APPROVED' || !policyEvidence || policyEvidence.decision !== 'NEEDS_GUARDIAN' || !approval || approval.decision !== 'approve' || approval.transactionId !== r.transactionId || approval.mandateId !== r.mandate.mandateId || approval.proposalId !== r.proposal.proposalId || approval.proposalVersion !== r.proposalVersion || approval.proposalFingerprint !== r.proposalFingerprint) fail('A current, valid guardian approval is required.');
      move('READY_FOR_PAYMENT'); explain('Guardian-approved exception is ready for payment.'); metadata={guardianApproval:approval,policyEvidence}; break;
    case 'PAYMENT_ORDER_CREATED': {
      if (oldState !== 'READY_FOR_PAYMENT' || actor.role !== 'system') fail('A payment order requires READY_FOR_PAYMENT.');
      if (!policyEvidence || policyEvidence.transactionId !== r.transactionId || policyEvidence.mandateId !== r.mandate.mandateId || policyEvidence.proposalId !== r.proposal.proposalId || policyEvidence.proposalVersion !== r.proposalVersion || policyEvidence.proposalFingerprint !== r.proposalFingerprint) fail('Current policy evidence is required before payment.', 'MISSING_POLICY_EVIDENCE');
      const direct = policyEvidence.decision === 'READY_FOR_PAYMENT' && !approval;
      const excepted = policyEvidence.decision === 'NEEDS_GUARDIAN' && approval?.decision === 'approve' && oldState === 'READY_FOR_PAYMENT';
      if (!direct && !excepted) fail('Neither a ready policy result nor a valid guardian exception exists.', 'MISSING_POLICY_EVIDENCE');
      if (!isMandateActive(r.mandate,now)) fail('Mandate expired before payment order creation.', 'MANDATE_EXPIRED');
      requireString(e.orderId,'orderId'); move('PAYMENT_PENDING'); explain('Payment order created; buyer authorization is pending.');
      provider=deepFreeze({...provider,orderId:e.orderId}); metadata={orderId:e.orderId,policyEvidence,guardianApproval:approval}; break;
    }
    case 'PAYMENT_AUTHORIZED':
      if (oldState !== 'PAYMENT_PENDING' || !provider.orderId || e.orderId !== provider.orderId) fail('Authorization must reference the recorded payment order.');
      if (!isMandateActive(r.mandate,now)) fail('Mandate expired before authorization; do not advance to AUTHORIZED.', 'MANDATE_EXPIRED');
      requireString(e.authorizationId,'authorizationId'); move('AUTHORIZED'); explain('Payment provider authorization was reported by the trusted adapter.'); provider=deepFreeze({...provider,authorizationId:e.authorizationId}); metadata={orderId:e.orderId,authorizationId:e.authorizationId}; break;
    case 'MEETUP_STARTED':
      if (oldState !== 'AUTHORIZED' || !provider.authorizationId) fail('Meetup can start only after recorded authorization.');
      requireReason(); move('MEETUP_ACTIVE'); break;
    case 'HANDOFF_CONFIRMED': {
      if (oldState !== 'MEETUP_ACTIVE') fail('Handoff confirmation requires an active meetup.');
      requireString(e.confirmationId,'confirmationId');
      const key=e.party==='buyer'?'buyerConfirmed':'sellerConfirmed', actorKey=e.party==='buyer'?'buyerActorId':'sellerActorId';
      if (handoff[key]) fail(`${e.party} handoff was already confirmed.`, 'DUPLICATE_HANDOFF');
      if ((e.party==='buyer'?r.buyerId:r.sellerId) === (e.party==='buyer'?r.sellerId:r.buyerId)) fail('Buyer and seller identities must be distinct.', 'IDENTITY_COLLISION');
      handoff=deepFreeze({...handoff,[key]:true,[actorKey]:actor.id}); explain(`${e.party} confirmed handoff.`); metadata={party:e.party,confirmationId:e.confirmationId}; break;
    }
    case 'CAPTURE_REQUESTED':
      if (oldState!=='MEETUP_ACTIVE'||!provider.authorizationId||!handoff.buyerConfirmed||!handoff.sellerConfirmed||handoff.buyerActorId!==r.buyerId||handoff.sellerActorId!==r.sellerId||handoff.buyerActorId===handoff.sellerActorId) fail('Capture requires authorization and independent buyer and seller confirmations.');
      move('CAPTURE_PENDING'); explain('Both handoff confirmations received; capture awaits provider confirmation.'); break;
    case 'PAYPAL_CAPTURE_CONFIRMED':
      if (oldState!=='CAPTURE_PENDING'||!provider.authorizationId) fail('Capture confirmation requires a pending capture and authorization.');
      requireString(e.captureId,'captureId'); move('CAPTURED'); explain('Payment provider capture was reported by the trusted adapter.'); provider=deepFreeze({...provider,captureId:e.captureId}); metadata={captureId:e.captureId}; break;
    case 'MISSED_CHECK_IN':
      if (oldState!=='AUTHORIZED'||!provider.authorizationId) fail('Missed check-in requires an authorized payment.');
      requireReason(); move('VOID_PENDING'); break;
    case 'VOID_REQUESTED':
      if (oldState!=='MEETUP_ACTIVE'||!provider.authorizationId) fail('Void request requires an active authorized meetup.');
      requireReason(); move('VOID_PENDING'); break;
    case 'PAYPAL_VOID_CONFIRMED':
      if (oldState!=='VOID_PENDING'||!provider.authorizationId) fail('Void confirmation requires a pending void and authorization.');
      requireString(e.voidId,'voidId'); move('VOIDED'); explain('Payment provider void was reported by the trusted adapter.'); provider=deepFreeze({...provider,voidId:e.voidId}); metadata={voidId:e.voidId}; break;
    case 'EXPIRE':
      if (!['PROPOSED','NEEDS_GUARDIAN','GUARDIAN_APPROVED','READY_FOR_PAYMENT','PAYMENT_PENDING'].includes(oldState)||isMandateActive(r.mandate,now)) fail('Mandate expiration is not applicable.');
      move('EXPIRED'); explain('Mandate expired before authorization.'); break;
    case 'BLOCK':
      if (!['PROPOSED','NEEDS_GUARDIAN','GUARDIAN_APPROVED'].includes(oldState)) fail('Transaction cannot be blocked in this state.');
      requireReason(); move('BLOCKED'); break;
    default: fail(`Unsupported event type: ${e.type}`);
  }
  requireString(reason,'reason');
  const audit=createAuditEvent({eventId:e.eventId,transactionId:r.transactionId,previousState:oldState,newState:nextState,eventType:e.type,actor,timestamp:now,reason,metadata});
  const updated={...r,version:r.version+1,state:nextState,updatedAt:now,policyEvidence,guardianApproval:approval,handoffConfirmations:handoff,provider,auditLog:deepFreeze([...r.auditLog,audit])};
  updated.eventDigests=new Map(r.eventDigests); updated.eventDigests.set(e.eventId,digest);
  const next=makeSnapshot(updated);
  updated.currentSnapshot=next;
  eventOwners.set(e.eventId,r.transactionId);
  aggregates.set(r.transactionId,updated);
  return next;
}





