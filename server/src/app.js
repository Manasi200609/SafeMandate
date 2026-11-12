import express from 'express';
import { getAppConfig } from './config/env.js';
import { createApiRoutes } from './routes/apiRoutes.js';
import { createMemoryRepositories } from './persistence/memoryRepositories.js';
import { createCorsMiddleware } from './middleware/cors.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';

/**
 * Repositories are injected so tests can run against an in-memory contract
 * implementation and production runs against MongoDB.
 */
export function createApp({ frontendOrigins, repositories = createMemoryRepositories(), config: suppliedConfig, paypalAdapterFactory, aiProviderFactory } = {}) {
  const config = { ...getAppConfig(), ...(suppliedConfig ?? {}) };
  const app = express();
  app.disable('x-powered-by');
  app.use(createCorsMiddleware(frontendOrigins ?? config.frontendOrigins));
  app.use(express.json({ limit: '64kb', strict: true }));
  app.use('/api', createApiRoutes({ repositories, config, ...(paypalAdapterFactory ? { paypalAdapterFactory } : {}), ...(aiProviderFactory ? { aiProviderFactory } : {}) }));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
