import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { getConfig } from '../src/config/env.js';
import { inspectMongoUri } from '../src/config/mongoUri.js';
import { createVerificationDatabaseName, isValidVerificationDatabaseName } from '../src/config/verificationDatabaseName.js';
import { hashSessionToken } from '../src/auth/sessionToken.js';
import { connectDatabase, disconnectDatabase, isDatabaseConnected } from '../src/db/mongoose.js';
import { CheckInEvent } from '../src/models/CheckInEvent.js';
import { HandoffConfirmation } from '../src/models/HandoffConfirmation.js';
import { GuardianRelationship } from '../src/models/GuardianRelationship.js';
import { Mandate } from '../src/models/Mandate.js';
import { PaypalProviderReference } from '../src/models/PaypalProviderReference.js';
import { PaymentOperation } from '../src/models/PaymentOperation.js';
import { AiAssessmentAudit } from '../src/models/AiAssessmentAudit.js';
import { Session } from '../src/models/Session.js';
import { Transaction } from '../src/models/Transaction.js';
import { TransactionAuditEvent } from '../src/models/TransactionAuditEvent.js';
import { User } from '../src/models/User.js';
import { createMongoRepositories } from '../src/persistence/mongoRepositories.js';
import { createAuthService } from '../src/services/authService.js';
import { createMandateService } from '../src/services/mandateService.js';
import { createGuardianService } from '../src/services/guardianService.js';
import { createTransactionService } from '../src/services/transactionService.js';

const envPath = fileURLToPath(new URL('../.env', import.meta.url));
const envFileExists = existsSync(envPath);
let envFileLoaded = false;
if (envFileExists) {
  try {
    process.loadEnvFile(envPath);
    envFileLoaded = true;
  } catch {
    // Keep environment-loader details and any parser context out of logs.
  }
}

if (!process.env.MONGODB_URI) {
  console.error(JSON.stringify({
    status: 'not_attempted',
    reason: 'mongodb_uri_missing',
    envFileExists,
    envFileLoaded,
    mongodbUriPresent: false,
  }));
  process.exitCode = 2;
} else {
  await run({ envFileExists, envFileLoaded });
}

async function run({ envFileExists, envFileLoaded }) {
  let config;
  const verificationDatabase = createVerificationDatabaseName();
  let connected = false;
  let cleaned = true;
  let verified = false;
  let failureCategory = null;
  let failureStage = 'configuration';
  let failureDiagnostics = null;
  const userIds = [];
  const userEmails = [];
  const mandateIds = [];
  const transactionIds = [];
  const aiAssessmentIds = [];
  const runId = verificationDatabase.slice('smv_'.length);

  try {
    config = getConfig({ ...process.env, NODE_ENV: 'production' });
    const configured = inspectMongoUri(config.mongodbUri);
    if (!configured?.isAtlas) {
      throw Object.assign(new Error('Atlas URI required.'), { safeCode: 'ATLAS_URI_REQUIRED' });
    }
    // The MongoDB Node driver defaults an omitted database path to `test`.
    const configuredDatabase = configured.databaseName || 'test';

    if (!isValidVerificationDatabaseName(verificationDatabase)) {
      throw Object.assign(new Error('Verification database name is invalid.'), { safeCode: 'DATABASE_NAME_INVALID' });
    }
    if (verificationDatabase === configuredDatabase) {
      throw Object.assign(new Error('Verification database must be isolated.'), { safeCode: 'DATABASE_ISOLATION_FAILED' });
    }

    failureStage = 'atlas_connect';
    await connectDatabase(config.mongodbUri, {
      dbName: verificationDatabase,
      serverSelectionTimeoutMS: config.mongoServerSelectionTimeoutMs,
    });
    connected = true;
    if (mongoose.connection.db.databaseName !== verificationDatabase) {
      throw Object.assign(new Error('Connected database did not match isolated target.'), { safeCode: 'DATABASE_ISOLATION_FAILED' });
    }

    failureStage = 'persistence_write';
    const repositories = createMongoRepositories();
    const auth = createAuthService(repositories, {
      sessionTtlMinutes: 60,
    });
    const suffix = `${runId}@example.test`;
    const buyerEmail = `verify-buyer-${suffix}`;
    userEmails.push(buyerEmail);
    const buyer = await auth.register({ email: buyerEmail, password: 'verification-password-2026', role: 'buyer' });
    userIds.push(buyer.user.userId);
    cleaned = false;
    const sellerEmail = `verify-seller-${suffix}`;
    userEmails.push(sellerEmail);
    const seller = await auth.register({ email: sellerEmail, password: 'verification-password-2026', role: 'seller' });
    userIds.push(seller.user.userId);
    const guardianEmail = `verify-guardian-${suffix}`;
    userEmails.push(guardianEmail);
    const guardian = await auth.register({ email: guardianEmail, password: 'verification-password-2026', role: 'seller' });
    userIds.push(guardian.user.userId);

    const buyerPrincipal = { userId: buyer.user.userId, role: 'buyer' };
    const sellerPrincipal = { userId: seller.user.userId, role: 'seller' };
    const guardianService = createGuardianService(repositories);
    const relationship = await guardianService.invite({ principal: buyerPrincipal, body: { guardianEmail } });
    await guardianService.accept({ principal: { ...guardian.user, role: 'seller' }, relationshipId: relationship.relationshipId });
    const buyerTokenHash = hashSessionToken(buyer.token);
    const sellerTokenHash = hashSessionToken(seller.token);
    const guardianTokenHash = hashSessionToken(guardian.token);
    const mandateService = createMandateService(repositories);
    const mandate = await mandateService.saveMandate({ principal: buyerPrincipal, body: {
      maxAmountMinor: 1500000,
      currency: 'INR',
      allowedCategories: ['electronics'],
      meetupRules: { requirePublicPlace: true, daytimeStart: '09:00', daytimeEnd: '18:00', timeZone: 'Asia/Kolkata' },
      expiresAt: '2099-12-31T23:59:59Z',
      guardianId: guardian.user.userId,
      riskThreshold: 40,
    } });
    mandateIds.push(mandate.mandateId);

    const transactionService = createTransactionService(repositories);
    const transaction = await transactionService.createTransaction({
      principal: buyerPrincipal,
      body: {
        sellerId: seller.user.userId,
        proposal: {
          itemName: 'Persistence verification item',
          description: 'Isolated Atlas persistence verification record',
          category: 'electronics',
          amountMinor: 1000000,
          currency: 'INR',
          meetupLocation: 'Verification test location',
          locationIsPublic: true,
          proposedLocalMeetupTime: '12:30',
          timeZone: 'Asia/Kolkata',
        },
      },
    });
    transactionIds.push(transaction.transactionId);
    const evaluated = await transactionService.evaluateTransaction({ principal: buyerPrincipal, transactionId: transaction.transactionId });

    const checkIn = {
      checkInId: `verify_checkin_${runId}`,
      transactionId: transaction.transactionId,
      buyerId: buyer.user.userId,
      type: 'ARRIVAL',
      stateAtCheckIn: 'MEETUP_ACTIVE',
      note: 'Isolated persistence verification.',
      createdAt: new Date().toISOString(),
    };
    await repositories.checkIns.insert(checkIn);
    await repositories.handoffConfirmations.upsert({
      transactionId: transaction.transactionId,
      party: 'buyer',
      actorId: buyer.user.userId,
      confirmationId: `verify_handoff_buyer_${runId}`,
      confirmedAt: new Date().toISOString(),
    });
    await repositories.handoffConfirmations.upsert({
      transactionId: transaction.transactionId,
      party: 'seller',
      actorId: seller.user.userId,
      confirmationId: `verify_handoff_seller_${runId}`,
      confirmedAt: new Date().toISOString(),
    });
    await repositories.paypalReferences.upsert({
      transactionId: transaction.transactionId,
      environment: 'sandbox',
      orderId: `VERIFY_ORDER_${runId}`,
      authorizationId: null,
      captureId: null,
      voidId: null,
      lastEventType: 'PERSISTENCE_VERIFICATION',
      transactionState: evaluated.state,
      updatedAt: new Date().toISOString(),
    });
    await repositories.paymentOperations.reserve({
      operationId: `verify_payop_${runId}`,
      transactionId: transaction.transactionId,
      kind: 'CREATE_ORDER',
      status: 'PENDING',
      requestId: `verify_req_${runId}`,
      amountMinor: transaction.proposal.amountMinor,
      currency: transaction.proposal.currency,
      providerResourceId: null,
      providerStatus: null,
      providerTimestamp: null,
      approvalUrl: null,
      providerErrorCode: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const aiAssessmentId = `verify_ai_${runId}`;
    aiAssessmentIds.push(aiAssessmentId);
    await repositories.aiAssessmentAudits.insert({
      assessmentId: aiAssessmentId,
      buyerId: buyer.user.userId,
      transactionId: transaction.transactionId,
      provider: 'openai-compatible',
      model: 'verification-model',
      promptVersion: 'purchase-copilot-v1',
      inputDigest: 'a'.repeat(64),
      riskLevel: 'LOW',
      recommendation: 'ASK_SELLER',
      policyDecision: 'READY_FOR_PAYMENT',
      createdAt: new Date().toISOString(),
    });

    failureStage = 'persistence_read';
    const beforeReconnect = await readBack(repositories, {
      buyerId: buyer.user.userId,
      sellerId: seller.user.userId,
      buyerTokenHash,
      sellerTokenHash,
      guardianTokenHash,
      guardianId: guardian.user.userId,
      mandateId: mandate.mandateId,
      transactionId: transaction.transactionId,
      paymentOperationId: `verify_payop_${runId}`,
      aiAssessmentId,
    });
    assertVerification(beforeReconnect, buyer.user.userId, seller.user.userId, guardian.user.userId);

    failureStage = 'reconnect';
    await disconnectDatabase();
    connected = false;
    await connectDatabase(config.mongodbUri, {
      dbName: verificationDatabase,
      serverSelectionTimeoutMS: config.mongoServerSelectionTimeoutMs,
    });
    connected = true;
    if (mongoose.connection.db.databaseName !== verificationDatabase) {
      throw Object.assign(new Error('Reconnect selected an unexpected database.'), { safeCode: 'DATABASE_ISOLATION_FAILED' });
    }
    failureStage = 'reconnect_read';
    const afterReconnect = await readBack(createMongoRepositories(), {
      buyerId: buyer.user.userId,
      sellerId: seller.user.userId,
      buyerTokenHash,
      sellerTokenHash,
      guardianTokenHash,
      guardianId: guardian.user.userId,
      mandateId: mandate.mandateId,
      transactionId: transaction.transactionId,
      paymentOperationId: `verify_payop_${runId}`,
      aiAssessmentId,
    });
    assertVerification(afterReconnect, buyer.user.userId, seller.user.userId, guardian.user.userId);

    verified = true;
  } catch (error) {
    failureCategory = error?.safeCode ?? error?.name ?? 'UNKNOWN_ERROR';
    failureDiagnostics = collectSafeDiagnostics(error, config?.mongodbUri ?? process.env.MONGODB_URI);
    const causeCode = failureDiagnostics?.chain?.find((item) => item.code)?.code;
    if (causeCode) failureCategory = `${failureCategory}:${causeCode}`;
  } finally {
    if (!cleaned && verificationDatabase && (connected || isDatabaseConnected())) {
      try {
        await cleanupVerificationRecords({ userIds, userEmails, mandateIds, transactionIds, aiAssessmentIds });
        cleaned = true;
      } catch {
        // Leave only uniquely identified records in the isolated verification database.
      }
    }
    await disconnectDatabase().catch(() => {});
  }

  if (verified && !failureCategory) {
    console.log(JSON.stringify({
      status: 'verified',
      provider: 'MongoDB Atlas',
      envFileExists,
      envFileLoaded,
      mongodbUriPresent: true,
      verificationDatabase,
      applicationDatabaseIsolated: true,
      reconnected: true,
      persistence: {
        users: true,
        sessions: true,
        mandates: true,
        transactions: true,
        auditEvents: true,
        checkIns: true,
        handoffConfirmations: true,
        guardianRelationships: true,
        paypalProviderReferences: true,
        paymentOperations: true,
        aiAssessmentAudits: true,
      },
      verificationRecordsCleaned: cleaned,
    }));
  } else {
    console.error(JSON.stringify({
      status: 'failed',
      provider: verificationDatabase ? 'MongoDB Atlas' : 'unverified',
      envFileExists,
      envFileLoaded,
      mongodbUriPresent: Boolean(process.env.MONGODB_URI),
      verificationDatabase: verificationDatabase ?? null,
      errorCategory: failureCategory ?? 'UNKNOWN_ERROR',
      failureStage,
      failureDiagnostics,
      verificationRecordsCleaned: cleaned,
    }));
    process.exitCode = 1;
  }
}

function collectSafeDiagnostics(error, mongoUri) {
  const chain = [];
  const seen = new Set();
  function add(candidate, depth = 0) {
    if (!candidate || seen.has(candidate) || depth > 3) return null;
    seen.add(candidate);
    const name = typeof candidate.name === 'string' && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(candidate.name) ? candidate.name : 'UnknownError';
    const code = typeof candidate.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(candidate.code)
      ? candidate.code
      : typeof candidate.code === 'number' ? candidate.code : null;
    const summary = {
      name,
      code,
      message: sanitizeDiagnosticText(candidate.message ?? '', mongoUri),
      stackFrames: safeStackFrames(candidate.stack, mongoUri),
      mongoErrorLabels: safeMongoLabels(candidate.errorLabels),
    };
    chain.push(summary);
    if (candidate.cause) summary.cause = add(candidate.cause, depth + 1);
    if (candidate.reason?.servers instanceof Map) {
      for (const server of candidate.reason.servers.values()) {
        if (server.error && !seen.has(server.error)) add(server.error, depth + 1);
      }
    }
    return summary;
  }
  add(error);
  return { chain: chain.slice(0, 8), mongoErrorLabels: safeMongoLabels(error?.errorLabels) };
}

function safeMongoLabels(labels) {
  return Array.isArray(labels)
    ? [...new Set(labels.filter((label) => typeof label === 'string' && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(label)))].slice(0, 12)
    : [];
}

function safeStackFrames(stack, mongoUri) {
  if (typeof stack !== 'string') return [];
  const repoRootNative = fileURLToPath(new URL('../../', import.meta.url));
  const repoRootPosix = repoRootNative.replaceAll('\\', '/');
  return stack.split(/\r?\n/).slice(1)
    .map((line) => line.trim())
    .filter((line) => /^at\s/.test(line))
    .slice(0, 6)
    .map((line) => sanitizeDiagnosticText(
      line.replaceAll(repoRootNative, '<repo>').replaceAll(repoRootPosix, '<repo>'),
      mongoUri,
    ));
}

function sanitizeDiagnosticText(value, mongoUri) {
  let text = String(value ?? '');
  const secrets = new Set();
  if (typeof mongoUri === 'string' && mongoUri) {
    secrets.add(mongoUri);
    const match = mongoUri.match(/^mongodb(?:\+srv)?:\/\/([^/?#]*)/i);
    const authority = match?.[1] ?? '';
    const at = authority.lastIndexOf('@');
    if (at >= 0) {
      const auth = authority.slice(0, at);
      const colon = auth.indexOf(':');
      if (colon >= 0) {
        for (const credentialPart of [auth.slice(0, colon), auth.slice(colon + 1)]) {
          if (credentialPart) secrets.add(credentialPart);
          try { const decoded = decodeURIComponent(credentialPart); if (decoded) secrets.add(decoded); } catch { /* preserve only the encoded form */ }
        }
      }
    }
  }
  for (const [key, envValue] of Object.entries(process.env)) {
    if (/(URI|URL|SECRET|PASSWORD|TOKEN|KEY|USER|USERNAME|CLIENT_ID)/i.test(key) && typeof envValue === 'string' && envValue.length >= 3) {
      secrets.add(envValue);
    }
  }
  for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
    if (secret) text = text.replaceAll(secret, '[REDACTED]');
  }
  return text
    .replace(/mongodb(?:\+srv)?:\/\/[^\s"'<>]+/gi, '[REDACTED_MONGODB_URI]')
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(access_token|refresh_token|client_secret|password|passwd|username|user)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]');
}

async function readBack(repositories, { buyerId, sellerId, guardianId, buyerTokenHash, sellerTokenHash, guardianTokenHash, mandateId, transactionId, paymentOperationId, aiAssessmentId }) {
  return {
    buyer: await repositories.users.findByUserId(buyerId),
    seller: await repositories.users.findByUserId(sellerId),
    guardian: await repositories.users.findByUserId(guardianId),
    buyerSession: await repositories.sessions.findByTokenHash(buyerTokenHash),
    sellerSession: await repositories.sessions.findByTokenHash(sellerTokenHash),
    guardianSession: await repositories.sessions.findByTokenHash(guardianTokenHash),
    guardianRelationship: await repositories.guardianRelationships.findAccepted(buyerId, guardianId),
    mandate: await repositories.mandates.findByMandateId(mandateId),
    transaction: await repositories.transactions.findById(transactionId),
    auditEvents: await repositories.auditEvents.listByTransaction(transactionId),
    checkIns: await repositories.checkIns.listByTransaction(transactionId),
    handoffs: await repositories.handoffConfirmations.listByTransaction(transactionId),
    providerReference: await repositories.paypalReferences.findByTransactionId(transactionId),
    paymentOperation: (await repositories.paymentOperations.listByTransaction(transactionId)).find((entry) => entry.operationId === paymentOperationId),
    aiAssessment: await repositories.aiAssessmentAudits.findById(aiAssessmentId),
  };
}

function assertVerification(records, buyerId, sellerId, guardianId) {
  if (records.buyer?.userId !== buyerId || records.seller?.userId !== sellerId || records.guardian?.userId !== guardianId || records.guardian.role !== 'guardian') throw new Error('Identity persistence failed.');
  if (records.buyerSession?.userId !== buyerId || records.sellerSession?.userId !== sellerId || records.guardianSession?.role !== 'guardian') throw new Error('Session persistence failed.');
  if (records.guardianRelationship?.status !== 'ACCEPTED' || records.guardianRelationship?.guardianId !== guardianId) throw new Error('Guardian relationship persistence failed.');
  if (!records.mandate?.mandateId) throw new Error('Mandate persistence failed.');
  if (records.transaction?.state !== 'READY_FOR_PAYMENT' || records.transaction?.version !== 1) throw new Error('Transaction state persistence failed.');
  if (records.auditEvents.length !== 1 || records.auditEvents[0].eventType !== 'POLICY_EVALUATED') throw new Error('Audit persistence failed.');
  if (records.checkIns.length !== 1 || records.checkIns[0].buyerId !== buyerId) throw new Error('Check-in persistence failed.');
  const parties = new Set(records.handoffs.map((record) => `${record.party}:${record.actorId}`));
  if (!parties.has(`buyer:${buyerId}`) || !parties.has(`seller:${sellerId}`)) throw new Error('Handoff persistence failed.');
  if (records.providerReference?.transactionState !== 'READY_FOR_PAYMENT') throw new Error('Provider-reference persistence failed.');
  if (records.paymentOperation?.status !== 'PENDING' || !records.paymentOperation.requestId) throw new Error('Payment-operation persistence failed.');
  if (records.aiAssessment?.promptVersion !== 'purchase-copilot-v1' || records.aiAssessment?.inputDigest?.length !== 64) throw new Error('AI assessment audit persistence failed.');
}

async function cleanupVerificationRecords({ userIds, userEmails, mandateIds, transactionIds, aiAssessmentIds }) {
  if (!isDatabaseConnected()) return false;
  const insertedUsers = userEmails.length
    ? await User.find({ email: { $in: userEmails } }).select('userId').lean()
    : [];
  const allUserIds = [...new Set([...userIds, ...insertedUsers.map((user) => user.userId)])];
  await Promise.all([
    Session.deleteMany({ userId: { $in: allUserIds } }),
    User.deleteMany({ $or: [{ userId: { $in: allUserIds } }, { email: { $in: userEmails } }] }),
    GuardianRelationship.deleteMany({ $or: [{ buyerId: { $in: allUserIds } }, { guardianId: { $in: allUserIds } }] }),
    Mandate.deleteMany({ mandateId: { $in: mandateIds } }),
    Transaction.deleteMany({ transactionId: { $in: transactionIds } }),
    TransactionAuditEvent.deleteMany({ transactionId: { $in: transactionIds } }),
    CheckInEvent.deleteMany({ transactionId: { $in: transactionIds } }),
    HandoffConfirmation.deleteMany({ transactionId: { $in: transactionIds } }),
    PaypalProviderReference.deleteMany({ transactionId: { $in: transactionIds } }),
    PaymentOperation.deleteMany({ transactionId: { $in: transactionIds } }),
    AiAssessmentAudit.deleteMany({ assessmentId: { $in: aiAssessmentIds } }),
  ]);
  return true;
}
