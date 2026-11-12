import { createApp } from './app.js';
import { getConfig } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './db/mongoose.js';
import { createMongoRepositories } from './persistence/mongoRepositories.js';

const config = getConfig();

async function start() {
  try {
    await connectDatabase(config.mongodbUri, { serverSelectionTimeoutMS: config.mongoServerSelectionTimeoutMs });
  } catch {
    console.error('Safe Mandate API could not start because the MongoDB connection failed.');
    process.exitCode = 1;
    return;
  }

  const app = createApp({ frontendOrigins: config.frontendOrigins, repositories: createMongoRepositories(), config });
  const server = app.listen(config.port, config.host, () => {
    console.log(`Safe Mandate API listening at http://${config.host}:${config.port}`);
  });

  let shuttingDown = false;
  async function shutDown() {
    if (shuttingDown) return;
    shuttingDown = true;
    server.close(async (error) => {
      if (error) {
        console.error('HTTP server shutdown failed.');
        process.exitCode = 1;
      }
      await disconnectDatabase();
    });
  }

  process.once('SIGINT', shutDown);
  process.once('SIGTERM', shutDown);
}

await start();
