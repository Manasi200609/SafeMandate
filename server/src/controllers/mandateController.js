import { validateMandate } from '../domain/mandate/validateMandate.js';

export function postValidateMandate(req, res) {
  const validation = validateMandate(req.body);
  return res.status(200).json(validation);
}
