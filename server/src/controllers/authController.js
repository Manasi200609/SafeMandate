import { ApiError } from '../middleware/errors.js';

export function createAuthController(authService) {
  return Object.freeze({
    async register(req, res) {
      const result = await authService.register(req.body);
      res.set('Cache-Control', 'no-store');
      return res.status(201).json(result);
    },
    async login(req, res) {
      const result = await authService.login(req.body);
      res.set('Cache-Control', 'no-store');
      return res.status(200).json(result);
    },
    async logout(req, res) {
      await authService.logout(req.principal);
      return res.status(204).end();
    },
    async session(req, res) {
      if (!req.principal) throw new ApiError(401, 'AUTH_REQUIRED', 'A valid bearer session token is required.');
      res.set('Cache-Control', 'no-store');
      return res.status(200).json({
        user: {
          userId: req.principal.userId,
          email: req.principal.email,
          displayName: req.principal.displayName,
          role: req.principal.role,
        },
      });
    },
  });
}
