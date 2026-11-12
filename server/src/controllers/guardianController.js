import { ApiError } from '../middleware/errors.js';

export function createGuardianController(service) {
  return Object.freeze({
    async invite(req, res) {
      const relationship = await service.invite({ principal: req.principal, body: req.body });
      res.set('Cache-Control', 'no-store');
      return res.status(201).json({ relationship });
    },
    async accept(req, res) {
      const relationshipId = req.params.relationshipId;
      if (typeof relationshipId !== 'string' || !relationshipId.trim()) throw new ApiError(400, 'RELATIONSHIP_ID_REQUIRED', 'relationshipId is required.');
      const relationship = await service.accept({ principal: req.principal, relationshipId });
      res.set('Cache-Control', 'no-store');
      return res.status(200).json({ relationship });
    },
    async list(req, res) {
      const relationships = await service.list({ principal: req.principal });
      res.set('Cache-Control', 'no-store');
      return res.status(200).json({ relationships });
    },
  });
}
