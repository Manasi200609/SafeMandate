import { evaluateProposal } from '../domain/mandate/evaluateProposal.js';

export function postEvaluateProposal(req, res) {
  const { mandate, proposal } = req.body ?? {};
  const result = evaluateProposal(mandate, proposal, new Date().toISOString());
  // Inputs are caller-supplied until authentication and authoritative mandate loading exist.
  // This result is advisory only and cannot create or authorize a transaction.
  return res.status(200).json({ ...result, evaluationOnly: true, authorizationGranted: false });
}
