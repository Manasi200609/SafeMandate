import { Router } from 'express';
import { getConfig } from '../config/env.js';
import { getHealth } from '../controllers/healthController.js';
import { postValidateMandate } from '../controllers/mandateController.js';
import { postEvaluateProposal } from '../controllers/policyController.js';
import { createAuthController } from '../controllers/authController.js';
import { createMandateStoreController } from '../controllers/mandateStoreController.js';
import { createTransactionController } from '../controllers/transactionController.js';
import { createGuardianController } from '../controllers/guardianController.js';
import { createAuthMiddleware, requireRole } from '../middleware/auth.js';
import { createAuthService } from '../services/authService.js';
import { createMandateService } from '../services/mandateService.js';
import { createTransactionService } from '../services/transactionService.js';
import { createRateLimitMiddleware } from '../middleware/rateLimit.js';
import { createGuardianService } from '../services/guardianService.js';
import { createPaymentService } from '../services/paymentService.js';
import { createPaymentController } from '../controllers/paymentController.js';
import { createConfiguredPayPalAdapterFactory } from '../integrations/paypal/configuredAdapter.js';
import { createAiAssessmentService } from '../services/aiAssessmentService.js';
import { createAiAssessmentController } from '../controllers/aiAssessmentController.js';
import { createOpenAiCompatibleProviderFactory } from '../integrations/ai/openAiCompatibleProvider.js';

export function createApiRoutes({ repositories, config = getConfig(), paypalAdapterFactory = createConfiguredPayPalAdapterFactory(), aiProviderFactory = createOpenAiCompatibleProviderFactory() }) {
  const router = Router();
  const authService = createAuthService(repositories, { sessionTtlMinutes: config.sessionTtlMinutes });
  const mandateService = createMandateService(repositories);
  const guardianService = createGuardianService(repositories);
  const transactionService = createTransactionService(repositories, { assertGuardianAccepted: guardianService.assertAccepted });
  const authController = createAuthController(authService);
  const mandateController = createMandateStoreController(mandateService);
  const transactionController = createTransactionController(transactionService);
  const guardianController = createGuardianController(guardianService);
  const paymentService = createPaymentService({ repositories, transactionService, paypalAdapterFactory });
  const paymentController = createPaymentController(paymentService);
  const aiAssessmentService = createAiAssessmentService({ repositories, transactionService, providerFactory: aiProviderFactory });
  const aiAssessmentController = createAiAssessmentController(aiAssessmentService);
  const authenticate = createAuthMiddleware(repositories);
  const registerLimit = createRateLimitMiddleware({ maxRequests: config.authRegisterLimit ?? 5, windowMs: config.authRateWindowMs ?? 900000 });
  const loginLimit = createRateLimitMiddleware({ maxRequests: config.authLoginLimit ?? 10, windowMs: config.authRateWindowMs ?? 900000 });
  const aiAssessmentLimit = createRateLimitMiddleware({ maxRequests: 8, windowMs: 60_000 });
  const buyerOnly = requireRole('buyer');
  const participantOnly = requireRole('buyer', 'seller');
  const guardianOnly = requireRole('guardian');

  router.get('/health', getHealth);

  router.post('/auth/register', registerLimit, authController.register);
  router.post('/auth/login', loginLimit, authController.login);
  router.post('/auth/logout', authenticate, authController.logout);
  router.get('/auth/session', authenticate, authController.session);

  // Unauthenticated domain previews. They are advisory and never authorize or
  // create a transaction.
  router.post('/mandates/validate', postValidateMandate);
  router.post('/policy/evaluate', postEvaluateProposal);

  router.get('/mandates/current', authenticate, buyerOnly, mandateController.current);
  router.put('/mandates/current', authenticate, buyerOnly, mandateController.save);

  router.post('/guardian-relationships', authenticate, buyerOnly, guardianController.invite);
  router.get('/guardian-relationships', authenticate, buyerOnly, guardianController.list);
  router.post('/guardian-relationships/:relationshipId/accept', authenticate, guardianController.accept);

  router.post('/transactions', authenticate, buyerOnly, transactionController.create);
  router.get('/transactions/sellers', authenticate, buyerOnly, transactionController.sellerChoices);
  router.get('/transactions', authenticate, participantOnly, transactionController.list);
  router.get('/transactions/:transactionId', authenticate, participantOnly, transactionController.detail);
  router.get('/transactions/:transactionId/audit', authenticate, participantOnly, transactionController.audit);
  router.get('/transactions/:transactionId/check-ins', authenticate, participantOnly, transactionController.checkIns);
  router.get('/transactions/:transactionId/payment-reference', authenticate, participantOnly, transactionController.paymentReference);
  router.post('/transactions/:transactionId/evaluate', authenticate, buyerOnly, transactionController.evaluate);
  router.post('/transactions/:transactionId/guardian-approval', authenticate, guardianOnly, transactionController.guardianDecision);
  router.post('/transactions/:transactionId/handoff-confirmations', authenticate, participantOnly, transactionController.confirmHandoff);
  router.post('/transactions/:transactionId/meetup/start', authenticate, buyerOnly, transactionController.startMeetup);
  router.post('/transactions/:transactionId/check-ins', authenticate, buyerOnly, transactionController.checkIn);

  router.post('/transactions/:transactionId/paypal/order', authenticate, buyerOnly, paymentController.createOrder);
  router.post('/transactions/:transactionId/paypal/authorize', authenticate, buyerOnly, paymentController.authorize);
  router.post('/transactions/:transactionId/paypal/capture', authenticate, buyerOnly, paymentController.capture);
  router.post('/transactions/:transactionId/paypal/void', authenticate, buyerOnly, paymentController.voidAuthorization);
  router.post('/transactions/:transactionId/paypal/reconcile', authenticate, buyerOnly, paymentController.reconcile);
  router.get('/transactions/:transactionId/payment-status', authenticate, buyerOnly, paymentController.status);
  router.post('/ai/assessments', authenticate, buyerOnly, aiAssessmentLimit, aiAssessmentController.assess);

  return router;
}
