import express from 'express';
import { getConfig } from './config/env.js';
import apiRoutes from './routes/apiRoutes.js';
import { createCorsMiddleware } from './middleware/cors.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';

export function createApp({ frontendOrigins = getConfig().frontendOrigins } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(createCorsMiddleware(frontendOrigins));
  app.use(express.json({ limit: '64kb', strict: true }));
  app.use('/api', apiRoutes);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

export default createApp();
