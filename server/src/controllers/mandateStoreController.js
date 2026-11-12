import { ApiError } from '../middleware/errors.js';

export function createMandateStoreController(mandateService) {
  return Object.freeze({
    async save(req, res) {
      const mandate = await mandateService.saveMandate({ principal: req.principal, body: req.body });
      res.set('Cache-Control', 'no-store');
      return res.status(200).json({ mandate });
    },
    async current(req, res) {
      const mandate = await mandateService.getCurrentMandate({ principal: req.principal });
      res.set('Cache-Control', 'no-store');
      return res.status(200).json({ mandate });
    },
  });
}

export function requireTransactionId(req) {
  const transactionId = req.params?.transactionId;
  if (typeof transactionId !== 'string' || !transactionId.trim()) {
    throw new ApiError(400, 'TRANSACTION_ID_REQUIRED', 'transactionId is required.');
  }
  return transactionId.trim();
}
