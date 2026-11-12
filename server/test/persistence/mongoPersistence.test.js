import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../../src/db/mongoose.js';
import { createMongoRepositories } from '../../src/persistence/mongoRepositories.js';
import { User } from '../../src/models/User.js';
import { Mandate } from '../../src/models/Mandate.js';
import { Transaction } from '../../src/models/Transaction.js';
import { TransactionAuditEvent } from '../../src/models/TransactionAuditEvent.js';
import { PaypalProviderReference } from '../../src/models/PaypalProviderReference.js';
import { Session } from '../../src/models/Session.js';
import { CheckInEvent } from '../../src/models/CheckInEvent.js';
import { HandoffConfirmation } from '../../src/models/HandoffConfirmation.js';
import { PaymentOperation } from '../../src/models/PaymentOperation.js';
import { AiAssessmentAudit } from '../../src/models/AiAssessmentAudit.js';
import { isSafeLocalTestDatabaseUri } from '../helpers/testDatabaseSafety.js';
import { BUYER, MANDATE_BODY, PROPOSAL_BODY, SELLER, createAcceptedGuardian, request, startTestServer } from '../helpers/httpHarness.js';

const TEST_URI = process.env.MONGODB_URI_TEST ?? '';

test('MongoDB persists identities, mandates, transactions, audits, sessions, and provider references across a reconnect', async (t) => {
  if (!TEST_URI || !isSafeLocalTestDatabaseUri(TEST_URI)) {
    t.skip('MongoDB integration test requires an explicit, unique, local test database URI; Atlas and application databases are rejected.');
    return;
  }
  try {
    const [firstConnection, concurrentConnection] = await Promise.all([
      connectDatabase(TEST_URI, { serverSelectionTimeoutMS: 2000 }),
      connectDatabase(TEST_URI, { serverSelectionTimeoutMS: 2000 }),
    ]);
    assert.equal(firstConnection, concurrentConnection);
  } catch {
    t.skip('The explicitly configured local test MongoDB database is unavailable.');
    return;
  }

  let buyerToken;
  let transactionId;
  let first;
  let second;

  try {
    await mongoose.connection.dropDatabase();

    first = await startTestServer(createMongoRepositories());
    const buyer = (await request(first.baseUrl, 'POST', '/api/auth/register', { body: BUYER })).body;
    const seller = (await request(first.baseUrl, 'POST', '/api/auth/register', { body: SELLER })).body;
    buyerToken = buyer.token;
    const guardian = await createAcceptedGuardian(first.baseUrl, buyer.token, 'guardian@persistence.test');
    await request(first.baseUrl, 'PUT', '/api/mandates/current', { token: buyer.token, body: { mandate: { ...MANDATE_BODY, guardianId: guardian.user.userId } } });
    const created = await request(first.baseUrl, 'POST', '/api/transactions', {
      token: buyer.token,
      body: { sellerId: seller.user.userId, proposal: PROPOSAL_BODY },
    });
    assert.equal(created.status, 201);
    transactionId = created.body.transaction.transactionId;

    const evaluated = await request(first.baseUrl, 'POST', `/api/transactions/${transactionId}/evaluate`, { token: buyer.token });
    assert.equal(evaluated.status, 200);
    assert.equal(evaluated.body.transaction.state, 'READY_FOR_PAYMENT');

    const repositories = createMongoRepositories();
    await repositories.checkIns.insert({
      checkInId: `checkin_${transactionId}`,
      transactionId,
      buyerId: buyer.user.userId,
      type: 'ARRIVAL',
      stateAtCheckIn: 'MEETUP_ACTIVE',
      note: 'Persistence-only fixture.',
      createdAt: new Date().toISOString(),
    });
    await repositories.handoffConfirmations.upsert({
      transactionId,
      party: 'buyer',
      actorId: buyer.user.userId,
      confirmationId: `handoff_buyer_${transactionId}`,
      confirmedAt: new Date().toISOString(),
    });

    const assessmentId = `assessment_${transactionId}`;
    await repositories.aiAssessmentAudits.insert({
      assessmentId,
      buyerId: buyer.user.userId,
      transactionId,
      provider: 'openai-compatible',
      model: 'persistence-test-model',
      promptVersion: 'purchase-copilot-v1',
      inputDigest: 'b'.repeat(64),
      riskLevel: 'LOW',
      recommendation: 'ASK_SELLER',
      policyDecision: 'READY_FOR_PAYMENT',
      createdAt: new Date().toISOString(),
    });
    const operationId = `payop_${transactionId}`;
    await repositories.paymentOperations.reserve({
      operationId,
      transactionId,
      kind: 'CREATE_ORDER',
      status: 'PENDING',
      requestId: `request_${transactionId}`,
      amountMinor: PROPOSAL_BODY.amountMinor,
      currency: PROPOSAL_BODY.currency,
      providerResourceId: null,
      providerStatus: null,
      providerTimestamp: null,
      approvalUrl: null,
      providerErrorCode: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await repositories.handoffConfirmations.upsert({
      transactionId,
      party: 'seller',
      actorId: seller.user.userId,
      confirmationId: `handoff_seller_${transactionId}`,
      confirmedAt: new Date().toISOString(),
    });

    assert.equal(await User.countDocuments({}), 2);
    assert.equal(await Session.countDocuments({}), 2);
    assert.equal(await Mandate.countDocuments({ buyerId: buyer.user.userId }), 1);
    assert.equal(await Transaction.countDocuments({ transactionId }), 1);
    assert.equal(await TransactionAuditEvent.countDocuments({ transactionId }), 1);
    assert.equal(await CheckInEvent.countDocuments({ transactionId }), 1);
    assert.equal(await HandoffConfirmation.countDocuments({ transactionId }), 2);
    assert.equal(await PaypalProviderReference.countDocuments({ transactionId }), 1);
    assert.equal(await PaymentOperation.countDocuments({ transactionId }), 1);
    assert.equal(await AiAssessmentAudit.countDocuments({ assessmentId }), 1);

    const storedTransaction = await Transaction.findOne({ transactionId }).lean();
    assert.equal(storedTransaction.version, 1);
    assert.equal(storedTransaction.state, 'READY_FOR_PAYMENT');
    assert.equal(storedTransaction.auditLog.length, 1);

    await first.close();
    first = null;
    await disconnectDatabase();

    // Simulate a server restart: new connection and a fresh repository/app instance.
    await connectDatabase(TEST_URI, { serverSelectionTimeoutMS: 2000 });
    second = await startTestServer(createMongoRepositories());

    const reloaded = await request(second.baseUrl, 'GET', `/api/transactions/${transactionId}`, { token: buyerToken });
    assert.equal(reloaded.status, 200);
    assert.equal(reloaded.body.transaction.state, 'READY_FOR_PAYMENT');
    assert.equal(reloaded.body.transaction.version, 1);
    assert.equal(reloaded.body.transaction.auditLog[0].eventType, 'POLICY_EVALUATED');

    const relogin = await request(second.baseUrl, 'POST', '/api/auth/login', {
      body: { email: BUYER.email, password: BUYER.password },
    });
    assert.equal(relogin.status, 200);
    assert.equal(relogin.body.user.role, 'buyer');

    const audit = await request(second.baseUrl, 'GET', `/api/transactions/${transactionId}/audit`, { token: buyerToken });
    assert.equal(audit.status, 200);
    assert.equal(audit.body.projectedEventCount, 1);
    assert.equal((await CheckInEvent.find({ transactionId }).lean()).length, 1);
    assert.equal((await HandoffConfirmation.find({ transactionId }).lean()).length, 2);
    assert.equal((await PaypalProviderReference.findOne({ transactionId }).lean()).transactionState, 'READY_FOR_PAYMENT');
    assert.equal((await createMongoRepositories().paymentOperations.findByTransactionAndKind(transactionId, 'CREATE_ORDER')).operationId, operationId);
    const savedAssessment = await createMongoRepositories().aiAssessmentAudits.findById(assessmentId);
    assert.equal(savedAssessment.model, 'persistence-test-model');
    assert.equal(savedAssessment.inputDigest, 'b'.repeat(64));
    assert.equal(JSON.stringify(savedAssessment).includes('listing'), false);
  } finally {
    if (first) await first.close();
    if (second) await second.close();
    try {
      await mongoose.connection.dropDatabase();
    } catch {
      // The connection may already be closed if startup failed.
    }
    await disconnectDatabase();
  }
});
