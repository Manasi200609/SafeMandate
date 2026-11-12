const DEFAULT_FRONTEND_ORIGINS = ['http://127.0.0.1:5173', 'http://localhost:5173'];
// Keep the one deployed Safe Mandate frontend available even when a Render
// environment value is missing or lists only preview/development origins.
const CANONICAL_PRODUCTION_FRONTEND_ORIGINS = ['https://safemandate.vercel.app'];
const DEFAULT_MONGODB_URI = 'mongodb://127.0.0.1:27017/safe_mandate';
import { isValidMongoUri } from './mongoUri.js';

function parseInteger(env, name, fallback, min, max) {
  if (env[name] === undefined || env[name] === '') return fallback;
  const value = Number(env[name]);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new TypeError(`${name} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

export function getConfig(env = process.env) {
  return readConfig(env, { validatePort: true });
}

/** App construction does not bind a port; tests can use ephemeral ports without weakening server validation. */
export function getAppConfig(env = process.env) {
  return readConfig(env, { validatePort: false });
}

function readConfig(env, { validatePort }) {
  const nodeEnv = env.NODE_ENV || 'development';
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    throw new TypeError('NODE_ENV must be development, test, or production.');
  }
  const configuredOrigins = env.FRONTEND_ORIGINS
    ?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  const configuredMongoUri = typeof env.MONGODB_URI === 'string' ? env.MONGODB_URI.trim() : '';
  if (configuredMongoUri && !isValidMongoUri(configuredMongoUri)) {
    throw new TypeError('MONGODB_URI must be a valid MongoDB connection URI.');
  }
  if (nodeEnv === 'production' && !configuredMongoUri) {
    throw new TypeError('MONGODB_URI must be explicitly configured in production.');
  }
  if (validatePort && nodeEnv === 'production' && (env.PORT === undefined || env.PORT === '')) {
    throw new TypeError('PORT must be provided by the production hosting platform.');
  }
  const parsedPort = validatePort ? parseInteger(env, 'PORT', 3001, 1, 65535) : 3001;

  const configuredHost = typeof env.HOST === 'string' ? env.HOST.trim() : '';
  const host = configuredHost || (nodeEnv === 'production' ? '0.0.0.0' : '127.0.0.1');
  if (nodeEnv === 'production' && host !== '0.0.0.0') {
    throw new TypeError('HOST must be 0.0.0.0 in production.');
  }

  const frontendOrigins = new Set(configuredOrigins?.length ? configuredOrigins : DEFAULT_FRONTEND_ORIGINS);
  if (nodeEnv === 'production') {
    for (const origin of CANONICAL_PRODUCTION_FRONTEND_ORIGINS) frontendOrigins.add(origin);
  }

  return Object.freeze({
    nodeEnv,
    port: parsedPort,
    host,
    frontendOrigins: Object.freeze([...frontendOrigins]),
    mongodbUri: configuredMongoUri || DEFAULT_MONGODB_URI,
    mongoServerSelectionTimeoutMs: parseInteger(env, 'MONGODB_SERVER_SELECTION_TIMEOUT_MS', 5000, 100, 60000),
    sessionTtlMinutes: parseInteger(env, 'SESSION_TTL_MINUTES', 480, 5, 1440),
    authLoginLimit: parseInteger(env, 'AUTH_LOGIN_LIMIT', 10, 1, 1000),
    authRegisterLimit: parseInteger(env, 'AUTH_REGISTER_LIMIT', 5, 1, 1000),
    authRateWindowMs: parseInteger(env, 'AUTH_RATE_WINDOW_MS', 900000, 1000, 86400000),
  });
}
