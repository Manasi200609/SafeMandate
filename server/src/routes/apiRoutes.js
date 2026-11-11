import { Router } from 'express';
import { getHealth } from '../controllers/healthController.js';
import { postValidateMandate } from '../controllers/mandateController.js';
import { postEvaluateProposal } from '../controllers/policyController.js';

const router = Router();

router.get('/health', getHealth);
router.post('/mandates/validate', postValidateMandate);
router.post('/policy/evaluate', postEvaluateProposal);

export default router;
