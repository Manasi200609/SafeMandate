import app from './app.js';
import { getConfig } from './config/env.js';

const config = getConfig();
const server = app.listen(config.port, config.host, () => {
  console.log(`Safe Mandate API listening at http://${config.host}:${config.port}`);
});

function shutDown() {
  server.close((error) => {
    if (error) {
      console.error('HTTP server shutdown failed.');
      process.exitCode = 1;
    }
  });
}

process.once('SIGINT', shutDown);
process.once('SIGTERM', shutDown);
