import { requireTransactionId } from './mandateStoreController.js';

export function createTransactionController(transactionService) {
  return Object.freeze({
    async create(req, res) {
      const transaction = await transactionService.createTransaction({ principal: req.principal, body: req.body });
      res.set('Cache-Control', 'no-store');
      return res.status(201).json({ transaction });
    },
    async list(req, res) {
      const transactions = await transactionService.listTransactions({ principal: req.principal });
      res.set('Cache-Control', 'no-store');
      return res.status(200).json({ transactions });
    },
    async detail(req, res) {
      const transaction = await transactionService.getTransaction({
        principal: req.principal,
        transactionId: requireTransactionId(req),
      });
      res.set('Cache-Control', 'no-store');
      return res.status(200).json({ transaction });
    },
    async evaluate(req, res) {
      const transaction = await transactionService.evaluateTransaction({
        principal: req.principal,
        transactionId: requireTransactionId(req),
      });
      res.set('Cache-Control', 'no-store');
      return res.status(200).json({ transaction });
    },
    async guardianDecision(req, res) {
      const transaction = await transactionService.guardianDecision({
        principal: req.principal,
        transactionId: requireTransactionId(req),
        body: req.body,
      });
      res.set('Cache-Control', 'no-store');
      return res.status(200).json({ transaction });
    },
    async confirmHandoff(req, res) {
      const transaction = await transactionService.confirmHandoff({
        principal: req.principal,
        transactionId: requireTransactionId(req),
      });
      res.set('Cache-Control', 'no-store');
      return res.status(200).json({ transaction });
    },
    async startMeetup(req, res) {
      const transaction = await transactionService.startMeetup({
        principal: req.principal,
        transactionId: requireTransactionId(req),
        body: req.body,
      });
      res.set('Cache-Control', 'no-store');
      return res.status(200).json({ transaction });
    },
    async checkIn(req, res) {
      const checkIn = await transactionService.recordCheckIn({
        principal: req.principal,
        transactionId: requireTransactionId(req),
        body: req.body,
      });
      res.set('Cache-Control', 'no-store');
      return res.status(201).json({ checkIn });
    },
    async checkIns(req, res) {
      const checkIns = await transactionService.getCheckIns({
        principal: req.principal,
        transactionId: requireTransactionId(req),
      });
      res.set('Cache-Control', 'no-store');
      return res.status(200).json({ checkIns });
    },
    async audit(req, res) {
      const audit = await transactionService.getAuditLog({
        principal: req.principal,
        transactionId: requireTransactionId(req),
      });
      res.set('Cache-Control', 'no-store');
      return res.status(200).json(audit);
    },
    async paymentReference(req, res) {
      const reference = await transactionService.getPaymentReference({
        principal: req.principal,
        transactionId: requireTransactionId(req),
      });
      res.set('Cache-Control', 'no-store');
      return res.status(200).json(reference);
    },
  });
}
