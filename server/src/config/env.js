const DEFAULT_FRONTEND_ORIGINS = ['http://127.0.0.1:5173', 'http://localhost:5173'];

export function getConfig(env = process.env) {
  const parsedPort = env.PORT === undefined ? 3001 : Number(env.PORT);
  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
    throw new TypeError('PORT must be an integer between 1 and 65535.');
  }

  const configuredOrigins = env.FRONTEND_ORIGINS
    ?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return Object.freeze({
    port: parsedPort,
    host: env.HOST || '127.0.0.1',
    frontendOrigins: Object.freeze(configuredOrigins?.length ? configuredOrigins : DEFAULT_FRONTEND_ORIGINS),
  });
}
