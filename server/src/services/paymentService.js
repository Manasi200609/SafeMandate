import { randomUUID } from 'node:crypto';
import { isMandateActive } from '../domain/mandate/validateMandate.js';
import { CURRENCY_MINOR_UNITS } from '../domain/mandate/currencies.js';
import { formatMinorUnitsAsDecimal } from '../integrations/paypal/providerBoundary.js';
import { PayPalApiError } from '../integrations/paypal/paypalTransport.js';
import { PayPalConfigurationError } from '../integrations/paypal/configuredAdapter.js';
import { ApiError } from '../middleware/errors.js';

const KINDS = Object.freeze(['CREATE_ORDER', 'AUTHORIZE', 'CAPTURE', 'VOID']);
const nowIso = () => new Date().toISOString();
const isFutureInstant = (value, now = Date.now()) => Number.isFinite(Date.parse(value)) && Date.parse(value) > now;

function responseData(response) {
  return response?.data ?? response;
}

function toMinorUnits(value, currency) {
  const places = CURRENCY_MINOR_UNITS[currency];
  if (!Number.isInteger(places) || typeof value !== 'string') return null;
  const pattern = places === 0 ? /^\d+$/ : new RegExp(`^\\d+\\.\\d{${places}}$`);
  if (!pattern.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const minor = BigInt(whole) * (10n ** BigInt(places)) + BigInt((fraction || '0').padEnd(places, '0'));
  return minor <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(minor) : null;
}

function safeOperation(operation) {
  return {
    operationId: operation.operationId,
    kind: operation.kind,
    status: operation.status,
    providerResourceId: operation.providerResourceId,
    providerStatus: operation.providerStatus,
    providerTimestamp: operation.providerTimestamp,
    // Provider error codes are normalized enums; raw provider messages and
    // response bodies remain private so payment status is safe to expose.
    providerErrorCode: /^[A-Z0-9_]{1,64}$/.test(operation.providerErrorCode ?? '') ? operation.providerErrorCode : null,
    providerErrorField: typeof operation.providerErrorField === 'string' && /^\/?[A-Za-z0-9_~/-]{1,160}$/.test(operation.providerErrorField) ? operation.providerErrorField : null,
    providerDebugId: /^[A-Za-z0-9-]{1,80}$/.test(operation.providerDebugId ?? '') ? operation.providerDebugId : null,
    approvalUrl: operation.approvalUrl,
    amountMinor: operation.amountMinor,
    currency: operation.currency,
    createdAt: operation.createdAt,
    updatedAt: operation.updatedAt,
  };
}

function findApprovalUrl(links) {
  if (!Array.isArray(links)) return null;
  const link = links.find((item) => ['approve', 'payer-action'].includes(item?.rel));
  if (typeof link?.href !== 'string') return null;
  try {
    const url = new URL(link.href);
    return url.protocol === 'https:' && (url.hostname === 'paypal.com' || url.hostname.endsWith('.paypal.com'))
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export function createPaymentService({ repositories, transactionService, paypalAdapterFactory }) {
  async function getContext(transactionId, principal) {
    if (principal?.role !== 'buyer') throw new ApiError(403, 'ROLE_NOT_PERMITTED', 'Only the authenticated buyer may manage this payment.');
    const context = await transactionService.getPaymentContext(transactionId);
    if (context.record.buyerId !== principal.userId) throw new ApiError(404, 'TRANSACTION_NOT_FOUND', 'Transaction not found.');
    return context;
  }

  function adapterConfig() {
    try { return paypalAdapterFactory(); }
    catch (error) {
      if (error instanceof PayPalConfigurationError) throw new ApiError(503, 'PAYPAL_NOT_CONFIGURED', 'PayPal Sandbox payment configuration is incomplete.');
      throw error;
    }
  }

  async function readProvider(read) {
    try {
      return await read();
    } catch (error) {
      if (error instanceof PayPalApiError) {
        throw new ApiError(502, 'PAYPAL_STATUS_UNAVAILABLE', 'PayPal Sandbox status could not be verified.');
      }
      throw error;
    }
  }

  function validatePaymentRequestBody(body) {
    if (!body || !Number.isInteger(body.expectedVersion)) throw new ApiError(400, 'EXPECTED_VERSION_REQUIRED', 'expectedVersion is required.');
    const acceptedKeys = new Set(['expectedVersion']);
    if (Object.keys(body).some((key) => !acceptedKeys.has(key))) {
      throw new ApiError(400, 'PAYMENT_INPUT_NOT_ALLOWED', 'Payment amount, currency, provider IDs, and state are server controlled.');
    }
  }

  function requireExpectedVersion(body, record) {
    validatePaymentRequestBody(body);
    if (body.expectedVersion !== record.version) throw new ApiError(409, 'STALE_TRANSACTION', 'Reload the transaction and retry with its current version.');
  }

  function assertPaymentEligible(record) {
    if (!isMandateActive(record.mandate, nowIso())) throw new ApiError(409, 'MANDATE_EXPIRED', 'The transaction mandate is expired.');
    const evidence = record.policyEvidence;
    const bound = evidence?.transactionId === record.transactionId
      && evidence?.mandateId === record.mandateId
      && evidence?.proposalId === record.proposal?.proposalId
      && evidence?.proposalVersion === record.proposalVersion
      && evidence?.proposalFingerprint === record.proposalFingerprint;
    if (!bound || !['READY_FOR_PAYMENT', 'NEEDS_GUARDIAN'].includes(evidence.decision)) {
      throw new ApiError(409, 'POLICY_EVIDENCE_REQUIRED', 'Current deterministic policy evidence is required.');
    }
    if (record.proposal.currency !== record.mandate.currency) throw new ApiError(409, 'CURRENCY_MISMATCH', 'Persisted transaction currency does not match its mandate.');
    if (!Number.isSafeInteger(record.proposal.amountMinor) || record.proposal.amountMinor <= 0) throw new ApiError(409, 'AMOUNT_INVALID', 'Persisted transaction amount is invalid.');
    if (evidence.decision === 'READY_FOR_PAYMENT' && record.proposal.amountMinor > record.mandate.maxAmountMinor) {
      throw new ApiError(409, 'MANDATE_LIMIT_EXCEEDED', 'The transaction exceeds the deterministic mandate limit.');
    }
    if (evidence.decision === 'NEEDS_GUARDIAN') {
      const approval = record.guardianApproval;
      if (approval?.decision !== 'approve'
        || approval.transactionId !== record.transactionId || approval.mandateId !== record.mandateId
        || approval.proposalId !== record.proposal.proposalId || approval.proposalVersion !== record.proposalVersion
        || approval.proposalFingerprint !== record.proposalFingerprint || approval.guardianId !== record.mandate.guardianId
        || approval.revokedAt || !isFutureInstant(approval.expiresAt)) {
        throw new ApiError(409, 'GUARDIAN_APPROVAL_REQUIRED', 'A current persisted guardian approval is required.');
      }
    }
  }

  async function reserve(record, kind) {
    const createdAt = nowIso();
    const operationId = `payop_${randomUUID()}`;
    const operation = {
      operationId,
      transactionId: record.transactionId,
      kind,
      status: 'PENDING',
      requestId: `sm_${randomUUID().replaceAll('-', '')}`,
      amountMinor: record.proposal.amountMinor,
      currency: record.proposal.currency,
      providerResourceId: null,
      providerStatus: null,
      providerTimestamp: null,
      approvalUrl: null,
      providerErrorCode: null,
      createdAt,
      updatedAt: createdAt,
    };
    return repositories.paymentOperations.reserve(operation);
  }

  async function updateOperation(operation, expectedStatus, updates) {
    const changed = await repositories.paymentOperations.update({
      operationId: operation.operationId,
      expectedStatus,
      updates: { ...updates, updatedAt: nowIso() },
    });
    if (changed) return changed;
    return repositories.paymentOperations.findByTransactionAndKind(operation.transactionId, operation.kind);
  }

  function existingOperation(operation) {
    if (operation.status === 'COMPLETED') return { statusCode: 200, operation: safeOperation(operation), replayed: true };
    if (['PENDING', 'UNKNOWN'].includes(operation.status)) return { statusCode: 202, operation: safeOperation(operation), replayed: true };
    throw new ApiError(409, 'PAYMENT_OPERATION_FAILED', 'This payment attempt failed and cannot be repeated. Reconcile provider status first.');
  }

  function providerErrorIsUnknown(error) {
    return error?.issue === 'REQUEST_OUTCOME_UNKNOWN' || (error instanceof PayPalApiError && error.status !== null && error.status >= 500);
  }

  async function failOperation(operation, error, resourceId = null) {
    const unknown = Boolean(resourceId) || providerErrorIsUnknown(error);
    await updateOperation(operation, 'PENDING', {
      status: unknown ? 'UNKNOWN' : 'FAILED',
      providerResourceId: resourceId,
      providerErrorCode: /^[A-Z0-9_]{1,64}$/.test(error?.issue ?? '') ? error.issue : 'PROVIDER_ERROR',
      providerErrorField: typeof error?.field === 'string' && /^\/?[A-Za-z0-9_~/-]{1,160}$/.test(error.field) ? error.field : null,
      providerDebugId: /^[A-Za-z0-9-]{1,80}$/.test(error?.debugId ?? '') ? error.debugId : null,
    });
    if (unknown) throw new ApiError(202, 'PAYMENT_OUTCOME_UNKNOWN', 'PayPal may have processed this operation. Reconcile before retrying.');
    if (error instanceof PayPalApiError) throw new ApiError(502, 'PAYPAL_OPERATION_FAILED', 'PayPal Sandbox could not complete the payment operation.');
    throw error;
  }

  function verifyPayeeAndOrder(order, record, merchantId, allowedStatuses) {
    if (!order || (record.provider?.orderId && order.id !== record.provider.orderId)
      || order.intent !== 'AUTHORIZE' || !allowedStatuses.includes(order.status)
      || !Array.isArray(order.purchase_units) || order.purchase_units.length !== 1) return false;
    const unit = order.purchase_units[0];
    return unit.reference_id === record.transactionId
      && unit.amount?.currency_code === record.proposal.currency
      && toMinorUnits(unit.amount?.value, record.proposal.currency) === record.proposal.amountMinor
      && unit.payee?.merchant_id === merchantId;
  }

  function verifyAuthorization(authorization, record, expectedId, allowedStatuses) {
    return authorization?.id === expectedId
      && allowedStatuses.includes(authorization.status)
      && authorization.amount?.currency_code === record.proposal.currency
      && toMinorUnits(authorization.amount?.value, record.proposal.currency) === record.proposal.amountMinor;
  }

  async function createOrder({ principal, transactionId, body }) {
    let { record } = await getContext(transactionId, principal);
    validatePaymentRequestBody(body);
    const previous = await repositories.paymentOperations.findByTransactionAndKind(transactionId, 'CREATE_ORDER');
    if (previous) return existingOperation(previous);
    requireExpectedVersion(body, record);
    const configured = adapterConfig();
    if (record.state === 'GUARDIAN_APPROVED') {
      await transactionService.applyPaymentEvent({ transactionId, type: 'GUARDIAN_APPROVAL_READY' });
      ({ record } = await getContext(transactionId, principal));
    }
    assertPaymentEligible(record);
    if (record.state !== 'READY_FOR_PAYMENT') throw new ApiError(409, 'PAYMENT_NOT_ELIGIBLE', 'Transaction is not ready for payment order creation.');
    const draft = configured.adapter.buildOrderDraft({
      transaction: { transactionId, proposal: record.proposal },
      returnUrl: configured.returnUrl,
      cancelUrl: configured.cancelUrl,
      merchantId: configured.merchantId,
    });
    const reservation = await reserve(record, 'CREATE_ORDER');
    if (!reservation.created) return existingOperation(reservation.operation);
    const operation = reservation.operation;
    let createdOrderId = null;
    try {
      const response = responseData(await configured.adapter.createOrder(draft, { requestId: operation.requestId }));
      createdOrderId = response?.id ?? null;
      if (typeof createdOrderId !== 'string' || !/^[A-Z0-9-]{1,36}$/.test(createdOrderId)) {
        const invalidResponse = Object.assign(new Error('PayPal order response is incomplete.'), { issue: 'INVALID_PROVIDER_RESPONSE' });
        await updateOperation(operation, 'PENDING', { status: 'UNKNOWN', providerErrorCode: invalidResponse.issue });
        throw new ApiError(202, 'PAYMENT_OUTCOME_UNKNOWN', 'PayPal returned an incomplete order result; reconcile before retrying.');
      }
      const fullOrder = responseData(await readProvider(() => configured.adapter.getOrder(createdOrderId)));
      if (!verifyPayeeAndOrder(fullOrder, { ...record, provider: { ...record.provider, orderId: createdOrderId } }, configured.merchantId, ['CREATED', 'APPROVED'])) {
        await updateOperation(operation, 'PENDING', { status: 'UNKNOWN', providerResourceId: createdOrderId, providerStatus: fullOrder?.status ?? null, providerErrorCode: 'ORDER_VALIDATION_FAILED' });
        throw new ApiError(202, 'PAYMENT_OUTCOME_UNKNOWN', 'The created order did not match the persisted transaction. Reconcile before retrying.');
      }
      const approvalUrl = findApprovalUrl(response?.links);
      if (!approvalUrl) {
        await updateOperation(operation, 'PENDING', { status: 'UNKNOWN', providerResourceId: createdOrderId, providerStatus: fullOrder.status, providerErrorCode: 'APPROVAL_LINK_MISSING' });
        throw new ApiError(202, 'PAYMENT_OUTCOME_UNKNOWN', 'PayPal created an order without a usable approval link. Reconcile before retrying.');
      }
      await transactionService.applyPaymentEvent({
        transactionId,
        type: 'PAYMENT_ORDER_CREATED',
        extra: { orderId: createdOrderId, providerStatus: fullOrder.status, amountMinor: record.proposal.amountMinor, currency: record.proposal.currency },
      });
      const completed = await updateOperation(operation, 'PENDING', {
        status: 'COMPLETED', providerResourceId: createdOrderId, providerStatus: fullOrder.status,
        providerTimestamp: fullOrder.create_time ?? nowIso(), approvalUrl,
      });
      return { statusCode: 201, operation: safeOperation(completed), replayed: false };
    } catch (error) {
      if (error instanceof ApiError && error.code === 'PAYMENT_OUTCOME_UNKNOWN') throw error;
      await failOperation(operation, error, createdOrderId);
    }
  }

  async function authorize({ principal, transactionId, body }) {
    const { record } = await getContext(transactionId, principal);
    validatePaymentRequestBody(body);
    const previous = await repositories.paymentOperations.findByTransactionAndKind(transactionId, 'AUTHORIZE');
    if (previous) return existingOperation(previous);
    requireExpectedVersion(body, record);
    const configured = adapterConfig();
    assertPaymentEligible(record);
    if (record.state !== 'PAYMENT_PENDING' || !record.provider?.orderId || record.provider?.authorizationId) {
      throw new ApiError(409, 'AUTHORIZATION_NOT_APPLICABLE', 'The transaction has no unconsumed pending PayPal order.');
    }
    const order = responseData(await readProvider(() => configured.adapter.getOrder(record.provider.orderId)));
    if (!verifyPayeeAndOrder(order, record, configured.merchantId, ['APPROVED'])) {
      throw new ApiError(409, 'PAYPAL_ORDER_NOT_APPROVED', 'PayPal has not confirmed approval for the expected order.');
    }
    const reservation = await reserve(record, 'AUTHORIZE');
    if (!reservation.created) return existingOperation(reservation.operation);
    const operation = reservation.operation;
    let resourceId = null;
    try {
      const result = responseData(await configured.adapter.authorizeOrder(record.provider.orderId, { requestId: operation.requestId }));
      resourceId = result?.purchase_units?.[0]?.payments?.authorizations?.[0]?.id ?? null;
      const authorization = result?.purchase_units?.[0]?.payments?.authorizations?.[0];
      if (result?.id !== record.provider.orderId || result?.intent !== 'AUTHORIZE' || result?.status !== 'COMPLETED'
        || result?.purchase_units?.length !== 1 || result.purchase_units[0].reference_id !== transactionId
        || result.purchase_units[0].payee?.merchant_id !== configured.merchantId
        || result.purchase_units[0].amount?.currency_code !== record.proposal.currency
        || toMinorUnits(result.purchase_units[0].amount?.value, record.proposal.currency) !== record.proposal.amountMinor
        || !verifyAuthorization(authorization, record, resourceId, ['CREATED'])) {
        await updateOperation(operation, 'PENDING', { status: 'UNKNOWN', providerResourceId: resourceId, providerStatus: authorization?.status ?? result?.status ?? null, providerErrorCode: 'AUTHORIZATION_VALIDATION_FAILED' });
        throw new ApiError(202, 'PAYMENT_OUTCOME_UNKNOWN', 'PayPal authorization requires reconciliation.');
      }
      await transactionService.applyPaymentEvent({
        transactionId, type: 'PAYMENT_AUTHORIZED',
        extra: { orderId: record.provider.orderId, authorizationId: resourceId },
      });
      const completed = await updateOperation(operation, 'PENDING', {
        status: 'COMPLETED', providerResourceId: resourceId, providerStatus: authorization.status,
        providerTimestamp: authorization.create_time ?? nowIso(),
      });
      return { statusCode: 200, operation: safeOperation(completed), replayed: false };
    } catch (error) {
      if (error instanceof ApiError && error.code === 'PAYMENT_OUTCOME_UNKNOWN') throw error;
      await failOperation(operation, error, resourceId);
    }
  }

  async function assertCaptureGate(record, configured) {
    if (record.state !== 'MEETUP_ACTIVE' || !record.provider?.authorizationId || !record.provider?.orderId) {
      throw new ApiError(409, 'CAPTURE_NOT_APPLICABLE', 'Capture requires an authorized active meetup.');
    }
    assertPaymentEligible(record);
    if (record.policyEvidence?.decision === 'NEEDS_GUARDIAN') {
      const relation = await repositories.guardianRelationships.findAccepted(record.buyerId, record.guardianApproval?.guardianId);
      if (!relation || relation.guardianId !== record.mandate.guardianId) throw new ApiError(409, 'GUARDIAN_APPROVAL_REQUIRED', 'Accepted guardian approval evidence is required.');
    }
    const authOperation = await repositories.paymentOperations.findByTransactionAndKind(record.transactionId, 'AUTHORIZE');
    if (!authOperation || authOperation.status !== 'COMPLETED' || authOperation.providerResourceId !== record.provider.authorizationId) {
      throw new ApiError(409, 'AUTHORIZATION_NOT_CONFIRMED', 'A provider-confirmed authorization is required.');
    }
    const checkIns = await repositories.checkIns.listByTransaction(record.transactionId);
    const now = Date.now();
    const validCheckIn = checkIns.some((entry) => entry.transactionId === record.transactionId
      && entry.buyerId === record.buyerId && entry.type === 'ARRIVAL'
      && ['AUTHORIZED', 'MEETUP_ACTIVE'].includes(entry.stateAtCheckIn)
      && !entry.revokedAt && Number.isFinite(Date.parse(entry.expiresAt)) && Date.parse(entry.expiresAt) > now
      && Date.parse(entry.createdAt) >= Date.parse(authOperation.providerTimestamp));
    if (!validCheckIn) throw new ApiError(409, 'BUYER_CHECK_IN_REQUIRED', 'A current persisted buyer arrival check-in is required.');
    const confirmations = await repositories.handoffConfirmations.listByTransaction(record.transactionId);
    for (const party of ['buyer', 'seller']) {
      const expectedActor = party === 'buyer' ? record.buyerId : record.sellerId;
      const confirmation = confirmations.find((item) => item.transactionId === record.transactionId && item.party === party);
      const aggregateConfirmed = record.handoffConfirmations?.[`${party}Confirmed`]
        && record.handoffConfirmations?.[`${party}ActorId`] === expectedActor;
      if (!aggregateConfirmed || !confirmation || confirmation.actorId !== expectedActor || !confirmation.confirmationId
        || confirmation.revokedAt || !Number.isFinite(Date.parse(confirmation.expiresAt)) || Date.parse(confirmation.expiresAt) <= now
        || Date.parse(confirmation.confirmedAt) < Date.parse(authOperation.providerTimestamp)) {
        throw new ApiError(409, party === 'buyer' ? 'BUYER_HANDOFF_REQUIRED' : 'SELLER_HANDOFF_REQUIRED', `A current authenticated ${party} handoff confirmation is required.`);
      }
    }
    const authorization = responseData(await readProvider(() => configured.adapter.getAuthorization(record.provider.authorizationId)));
    if (!verifyAuthorization(authorization, record, record.provider.authorizationId, ['CREATED'])) {
      throw new ApiError(409, 'PAYPAL_AUTHORIZATION_NOT_CAPTUREABLE', 'PayPal does not report an active uncaptured authorization.');
    }
    if (!isFutureInstant(authorization.expiration_time, now)) {
      throw new ApiError(409, 'PAYPAL_AUTHORIZATION_EXPIRED', 'The PayPal authorization has expired.');
    }
    const order = responseData(await readProvider(() => configured.adapter.getOrder(record.provider.orderId)));
    if (!verifyPayeeAndOrder(order, record, configured.merchantId, ['COMPLETED'])) {
      throw new ApiError(409, 'PAYPAL_ORDER_MISMATCH', 'PayPal order details do not match the persisted transaction.');
    }
    const linkedAuthorization = order.purchase_units[0].payments?.authorizations?.find((item) => item.id === record.provider.authorizationId);
    if (!linkedAuthorization || linkedAuthorization.status !== 'CREATED'
      || linkedAuthorization.amount?.currency_code !== record.proposal.currency
      || toMinorUnits(linkedAuthorization.amount?.value, record.proposal.currency) !== record.proposal.amountMinor) {
      throw new ApiError(409, 'PAYPAL_AUTHORIZATION_MISMATCH', 'The authorization is not linked to this order and amount.');
    }
    const [captureOperation, voidOperation] = await Promise.all([
      repositories.paymentOperations.findByTransactionAndKind(record.transactionId, 'CAPTURE'),
      repositories.paymentOperations.findByTransactionAndKind(record.transactionId, 'VOID'),
    ]);
    if (captureOperation || voidOperation) throw new ApiError(409, 'PAYMENT_OPERATION_EXISTS', 'A capture or void operation already exists for this transaction.');
  }

  async function capture({ principal, transactionId, body }) {
    const { record } = await getContext(transactionId, principal);
    validatePaymentRequestBody(body);
    const previous = await repositories.paymentOperations.findByTransactionAndKind(transactionId, 'CAPTURE');
    if (previous) return existingOperation(previous);
    requireExpectedVersion(body, record);
    const configured = adapterConfig();
    await assertCaptureGate(record, configured);
    const reservation = await reserve(record, 'CAPTURE');
    if (!reservation.created) return existingOperation(reservation.operation);
    const operation = reservation.operation;
    try {
      await transactionService.applyPaymentEvent({ transactionId, type: 'CAPTURE_REQUESTED' });
    } catch (error) {
      await updateOperation(operation, 'PENDING', { status: 'FAILED', providerErrorCode: 'LOCAL_STATE_CHANGED' });
      throw error;
    }
    let captureId = null;
    try {
      const result = responseData(await configured.adapter.captureAuthorization(record.provider.authorizationId, { requestId: operation.requestId }));
      captureId = result?.id ?? null;
      if (typeof captureId !== 'string' || !/^[A-Z0-9-]{1,36}$/.test(captureId)
        || result.status !== 'COMPLETED' || result.amount?.currency_code !== record.proposal.currency
        || toMinorUnits(result.amount?.value, record.proposal.currency) !== record.proposal.amountMinor) {
        await updateOperation(operation, 'PENDING', { status: 'UNKNOWN', providerResourceId: captureId, providerStatus: result?.status ?? null, providerErrorCode: 'CAPTURE_VALIDATION_FAILED' });
        throw new ApiError(202, 'PAYMENT_OUTCOME_UNKNOWN', 'PayPal capture requires reconciliation.');
      }
      await transactionService.applyPaymentEvent({
        transactionId, type: 'PAYPAL_CAPTURE_CONFIRMED',
        extra: { captureId },
      });
      const completed = await updateOperation(operation, 'PENDING', {
        status: 'COMPLETED', providerResourceId: captureId, providerStatus: result.status,
        providerTimestamp: result.create_time ?? nowIso(),
      });
      return { statusCode: 200, operation: safeOperation(completed), replayed: false };
    } catch (error) {
      if (error instanceof ApiError && error.code === 'PAYMENT_OUTCOME_UNKNOWN') throw error;
      await failOperation(operation, error, captureId);
    }
  }

  async function voidAuthorization({ principal, transactionId, body }) {
    const { record } = await getContext(transactionId, principal);
    validatePaymentRequestBody(body);
    const previous = await repositories.paymentOperations.findByTransactionAndKind(transactionId, 'VOID');
    if (previous) return existingOperation(previous);
    requireExpectedVersion(body, record);
    const configured = adapterConfig();
    if (!['AUTHORIZED', 'MEETUP_ACTIVE'].includes(record.state) || !record.provider?.authorizationId || !record.provider?.orderId) {
      throw new ApiError(409, 'VOID_NOT_APPLICABLE', 'Void requires an eligible uncaptured authorization.');
    }
    const captureOp = await repositories.paymentOperations.findByTransactionAndKind(transactionId, 'CAPTURE');
    if (captureOp) throw new ApiError(409, 'CAPTURE_OPERATION_EXISTS', 'A capture operation exists; reconcile it before considering a void.');
    const authorization = responseData(await readProvider(() => configured.adapter.getAuthorization(record.provider.authorizationId)));
    if (!verifyAuthorization(authorization, record, record.provider.authorizationId, ['CREATED'])) {
      throw new ApiError(409, 'PAYPAL_AUTHORIZATION_NOT_VOIDABLE', 'PayPal does not report an active uncaptured authorization.');
    }
    if (!isFutureInstant(authorization.expiration_time)) {
      throw new ApiError(409, 'PAYPAL_AUTHORIZATION_EXPIRED', 'The PayPal authorization has expired.');
    }
    const order = responseData(await readProvider(() => configured.adapter.getOrder(record.provider.orderId)));
    if (!verifyPayeeAndOrder(order, record, configured.merchantId, ['COMPLETED'])) {
      throw new ApiError(409, 'PAYPAL_ORDER_MISMATCH', 'PayPal order details do not match the persisted transaction.');
    }
    const linkedAuthorization = order.purchase_units[0].payments?.authorizations?.find((item) => item.id === record.provider.authorizationId);
    if (!linkedAuthorization || linkedAuthorization.status !== 'CREATED'
      || linkedAuthorization.amount?.currency_code !== record.proposal.currency
      || toMinorUnits(linkedAuthorization.amount?.value, record.proposal.currency) !== record.proposal.amountMinor) {
      throw new ApiError(409, 'PAYPAL_AUTHORIZATION_MISMATCH', 'The authorization is not linked to this order and amount.');
    }
    const reservation = await reserve(record, 'VOID');
    if (!reservation.created) return existingOperation(reservation.operation);
    const operation = reservation.operation;
    try {
      await transactionService.applyPaymentEvent({ transactionId, type: 'VOID_REQUESTED', extra: { reason: 'Buyer requested cancellation of the authorized purchase.' } });
    } catch (error) {
      await updateOperation(operation, 'PENDING', { status: 'FAILED', providerErrorCode: 'LOCAL_STATE_CHANGED' });
      throw error;
    }
    try {
      const response = await configured.adapter.voidAuthorization(record.provider.authorizationId, { requestId: operation.requestId });
      const finalAuth = response?.status === 204
        ? responseData(await readProvider(() => configured.adapter.getAuthorization(record.provider.authorizationId)))
        : responseData(response);
      if (finalAuth?.id !== record.provider.authorizationId || finalAuth.status !== 'VOIDED') {
        await updateOperation(operation, 'PENDING', { status: 'UNKNOWN', providerResourceId: record.provider.authorizationId, providerStatus: finalAuth?.status ?? null, providerErrorCode: 'VOID_VALIDATION_FAILED' });
        throw new ApiError(202, 'PAYMENT_OUTCOME_UNKNOWN', 'PayPal void requires reconciliation.');
      }
      await transactionService.applyPaymentEvent({ transactionId, type: 'PAYPAL_VOID_CONFIRMED', extra: { voidId: record.provider.authorizationId } });
      const completed = await updateOperation(operation, 'PENDING', {
        status: 'COMPLETED', providerResourceId: record.provider.authorizationId,
        providerStatus: 'VOIDED', providerTimestamp: finalAuth.update_time ?? nowIso(),
      });
      return { statusCode: 200, operation: safeOperation(completed), replayed: false };
    } catch (error) {
      if (error instanceof ApiError && error.code === 'PAYMENT_OUTCOME_UNKNOWN') throw error;
      await failOperation(operation, error, record.provider.authorizationId);
    }
  }

  async function reconcile({ principal, transactionId }) {
    const { record } = await getContext(transactionId, principal);
    const configured = adapterConfig();
    const operations = await repositories.paymentOperations.listByTransaction(transactionId);
    const unresolved = operations.find((item) => ['PENDING', 'UNKNOWN'].includes(item.status));
    if (!unresolved) return { transactionId, state: record.state, operations: operations.map(safeOperation), reconciled: false };
    let providerStatus = null;
    let resourceId = unresolved.providerResourceId;
    try {
      if (unresolved.kind === 'CREATE_ORDER' || unresolved.kind === 'AUTHORIZE') {
        if (!record.provider?.orderId && !resourceId) throw new ApiError(409, 'RECONCILIATION_UNRESOLVED', 'The provider order ID is not known; this operation requires manual Sandbox review.');
        const orderId = record.provider?.orderId ?? resourceId;
        const order = responseData(await configured.adapter.getOrder(orderId));
        if (!verifyPayeeAndOrder(order, { ...record, provider: { ...record.provider, orderId } }, configured.merchantId, ['CREATED', 'APPROVED', 'COMPLETED'])) {
          throw new ApiError(409, 'PROVIDER_STATE_MISMATCH', 'PayPal order does not match this transaction.');
        }
        providerStatus = order.status;
        if (unresolved.kind === 'CREATE_ORDER') {
          const approvalUrl = unresolved.approvalUrl ?? findApprovalUrl(order.links);
          if (order.status === 'CREATED' && !approvalUrl) return unresolvedResponse(transactionId, record, operations);
          if (!record.provider?.orderId) await transactionService.applyPaymentEvent({ transactionId, type: 'PAYMENT_ORDER_CREATED', extra: { orderId, providerStatus: order.status, amountMinor: record.proposal.amountMinor, currency: record.proposal.currency } });
          await updateOperation(unresolved, unresolved.status, { status: 'COMPLETED', providerResourceId: orderId, providerStatus: order.status, providerTimestamp: order.create_time ?? nowIso(), approvalUrl });
        } else {
          const auth = order.purchase_units[0].payments?.authorizations?.find((item) => !unresolved.providerResourceId || item.id === unresolved.providerResourceId);
          if (!auth || order.status !== 'COMPLETED' || auth.status !== 'CREATED' || auth.amount?.currency_code !== record.proposal.currency
            || toMinorUnits(auth.amount?.value, record.proposal.currency) !== record.proposal.amountMinor) {
            return unresolvedResponse(transactionId, record, operations);
          }
          providerStatus = auth.status;
          if (record.state === 'PAYMENT_PENDING') await transactionService.applyPaymentEvent({ transactionId, type: 'PAYMENT_AUTHORIZED', extra: { orderId, authorizationId: auth.id } });
          await updateOperation(unresolved, unresolved.status, { status: 'COMPLETED', providerResourceId: auth.id, providerStatus: auth.status, providerTimestamp: auth.create_time ?? nowIso() });
        }
      } else if (unresolved.kind === 'CAPTURE') {
        const order = responseData(await configured.adapter.getOrder(record.provider.orderId));
        if (!verifyPayeeAndOrder(order, record, configured.merchantId, ['COMPLETED'])) throw new ApiError(409, 'PROVIDER_STATE_MISMATCH', 'PayPal order does not match this transaction.');
        const capture = order.purchase_units[0].payments?.captures?.find((item) => !resourceId || item.id === resourceId);
        if (!capture) return unresolvedResponse(transactionId, record, operations);
        resourceId = capture.id;
        const fullCapture = responseData(await configured.adapter.getCapture(capture.id));
        if (fullCapture.status !== 'COMPLETED' || fullCapture.amount?.currency_code !== record.proposal.currency
          || toMinorUnits(fullCapture.amount?.value, record.proposal.currency) !== record.proposal.amountMinor) return unresolvedResponse(transactionId, record, operations);
        if (record.state === 'CAPTURE_PENDING') await transactionService.applyPaymentEvent({ transactionId, type: 'PAYPAL_CAPTURE_CONFIRMED', extra: { captureId: fullCapture.id } });
        await updateOperation(unresolved, unresolved.status, { status: 'COMPLETED', providerResourceId: fullCapture.id, providerStatus: fullCapture.status, providerTimestamp: fullCapture.create_time ?? nowIso() });
        providerStatus = fullCapture.status;
      } else if (unresolved.kind === 'VOID') {
        const auth = responseData(await configured.adapter.getAuthorization(record.provider.authorizationId));
        if (!verifyAuthorization(auth, record, record.provider.authorizationId, ['VOIDED'])) return unresolvedResponse(transactionId, record, operations);
        const order = responseData(await configured.adapter.getOrder(record.provider.orderId));
        if (!verifyPayeeAndOrder(order, record, configured.merchantId, ['COMPLETED'])) {
          throw new ApiError(409, 'PROVIDER_STATE_MISMATCH', 'PayPal order does not match this transaction.');
        }
        const linkedAuthorization = order.purchase_units[0].payments?.authorizations?.find((item) => item.id === auth.id);
        if (!linkedAuthorization || linkedAuthorization.status !== 'VOIDED'
          || linkedAuthorization.amount?.currency_code !== record.proposal.currency
          || toMinorUnits(linkedAuthorization.amount?.value, record.proposal.currency) !== record.proposal.amountMinor) {
          throw new ApiError(409, 'PROVIDER_STATE_MISMATCH', 'PayPal authorization is not linked to this transaction order.');
        }
        if (record.state === 'VOID_PENDING') await transactionService.applyPaymentEvent({ transactionId, type: 'PAYPAL_VOID_CONFIRMED', extra: { voidId: auth.id } });
        await updateOperation(unresolved, unresolved.status, { status: 'COMPLETED', providerResourceId: auth.id, providerStatus: auth.status, providerTimestamp: auth.update_time ?? nowIso() });
        providerStatus = auth.status;
      }
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error instanceof PayPalApiError) throw new ApiError(502, 'PAYPAL_RECONCILIATION_FAILED', 'PayPal status could not be confirmed. The operation remains unresolved.');
      throw error;
    }
    await transactionService.applyPaymentEvent({
      transactionId,
      type: 'PAYMENT_RECONCILED',
      extra: {
        operationId: unresolved.operationId,
        operationKind: unresolved.kind,
        providerStatus,
        providerResourceId: resourceId,
      },
    });
    const fresh = await transactionService.getPaymentContext(transactionId);
    return {
      transactionId,
      state: fresh.record.state,
      operations: (await repositories.paymentOperations.listByTransaction(transactionId)).map(safeOperation),
      reconciled: true,
      providerStatus,
    };
  }

  async function getStatus({ principal, transactionId }) {
    const { record } = await getContext(transactionId, principal);
    const [reference, operations] = await Promise.all([
      repositories.paypalReferences.findByTransactionId(transactionId),
      repositories.paymentOperations.listByTransaction(transactionId),
    ]);
    return { transactionId, state: record.state, provider: record.provider, reference, operations: operations.map(safeOperation) };
  }

  async function unresolvedResponse(transactionId, record, operations) {
    return { transactionId, state: record.state, operations: operations.map(safeOperation), reconciled: false, unresolved: true };
  }

  return Object.freeze({ createOrder, authorize, capture, voidAuthorization, reconcile, getStatus });
}

export { KINDS };
