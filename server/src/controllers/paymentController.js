import { requireTransactionId } from './mandateStoreController.js';

export function createPaymentController(paymentService) {
  const run = (operation) => async (req, res) => {
    const result = await operation({
      principal: req.principal,
      transactionId: requireTransactionId(req),
      body: req.body,
    });
    res.set('Cache-Control', 'no-store');
    const { statusCode = 200, ...payload } = result;
    return res.status(statusCode).json(payload);
  };
  return Object.freeze({
    createOrder: run((input) => paymentService.createOrder(input)),
    authorize: run((input) => paymentService.authorize(input)),
    capture: run((input) => paymentService.capture(input)),
    voidAuthorization: run((input) => paymentService.voidAuthorization(input)),
    reconcile: run((input) => paymentService.reconcile(input)),
    status: run((input) => paymentService.getStatus(input)),
  });
}
