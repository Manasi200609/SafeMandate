import { ApiError } from './errors.js';

/**
 * Bounded per-process auth limiter. Express proxy trust stays disabled by
 * default, so req.ip comes from the socket rather than caller-supplied headers.
 * Production deployments with multiple instances should replace the Map with
 * a shared store before scaling horizontally.
 */
export function createRateLimitMiddleware({ maxRequests = 10, windowMs = 15 * 60 * 1000, now = Date.now, maxClients = 10000 } = {}) {
  if (!Number.isInteger(maxRequests) || maxRequests < 1) throw new TypeError('maxRequests must be a positive integer.');
  if (!Number.isInteger(windowMs) || windowMs < 1000) throw new TypeError('windowMs must be at least one second.');
  const clients = new Map();

  const middleware = function rateLimit(req, res, next) {
    const key = req.ip || req.socket?.remoteAddress || 'unknown';
    const timestamp = now();
    let entry = clients.get(key);
    if (!entry || timestamp >= entry.resetAt) {
      entry = { count: 0, resetAt: timestamp + windowMs };
      clients.set(key, entry);
    }

    if (clients.size > maxClients) {
      for (const [clientKey, clientEntry] of clients) {
        if (timestamp >= clientEntry.resetAt) clients.delete(clientKey);
      }
      while (clients.size > maxClients) clients.delete(clients.keys().next().value);
    }

    entry.count += 1;
    res.set('RateLimit-Limit', String(maxRequests));
    res.set('RateLimit-Remaining', String(Math.max(0, maxRequests - entry.count)));
    res.set('RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));
    if (entry.count > maxRequests) {
      const retryAfter = Math.max(1, Math.ceil((entry.resetAt - timestamp) / 1000));
      res.set('Retry-After', String(retryAfter));
      throw new ApiError(429, 'AUTH_RATE_LIMITED', 'Too many authentication attempts. Please try again later.');
    }
    return next();
  };
  Object.defineProperty(middleware, 'clientCount', { get: () => clients.size });
  return middleware;
}
