import test from 'node:test';
import assert from 'node:assert/strict';
import { getAppConfig, getConfig } from '../../src/config/env.js';
import { inspectMongoUri, isValidMongoUri } from '../../src/config/mongoUri.js';

test('configuration provides development defaults and reads database/auth settings', () => {
  const config = getConfig({
    NODE_ENV: 'development',
    MONGODB_URI: 'mongodb://localhost/safe_mandate',
    HOST: '127.0.0.1',
    PORT: '3100',
    FRONTEND_ORIGINS: 'https://safe.example,https://app.example',
  });
  assert.equal(config.nodeEnv, 'development');
  assert.equal(getConfig({}).host, '127.0.0.1');
  assert.equal(config.mongodbUri, 'mongodb://localhost/safe_mandate');
  assert.equal(config.port, 3100);
  assert.deepEqual(config.frontendOrigins, ['https://safe.example', 'https://app.example']);
});

test('production requires an explicit MongoDB URI but no unrelated session secret', () => {
  const mongoUri = 'mongodb://user:pass@atlas-a.mongodb.net:27017,atlas-b.mongodb.net:27017/safe_mandate?replicaSet=atlas';
  assert.throws(() => getConfig({ NODE_ENV: 'production' }), /MONGODB_URI/);
  assert.throws(() => getConfig({ NODE_ENV: 'production', MONGODB_URI: mongoUri }), /PORT/);
  const valid = getConfig({ NODE_ENV: 'production', MONGODB_URI: mongoUri, PORT: '43127' });
  assert.equal(valid.nodeEnv, 'production');
  assert.equal(valid.host, '0.0.0.0');
  assert.equal(valid.port, 43127);
  assert.equal(valid.mongodbUri, mongoUri);
});

test('production only accepts an all-interface host, while development may explicitly bind elsewhere', () => {
  const mongoUri = 'mongodb://user:pass@atlas-a.mongodb.net:27017/safe_mandate';
  assert.equal(getConfig({ NODE_ENV: 'production', MONGODB_URI: mongoUri, PORT: '43128', HOST: '0.0.0.0' }).host, '0.0.0.0');
  assert.throws(() => getConfig({ NODE_ENV: 'production', MONGODB_URI: mongoUri, PORT: '43128', HOST: '127.0.0.1' }), /HOST/);
  assert.equal(getConfig({ HOST: '127.0.0.2' }).host, '127.0.0.2');
});

test('MongoDB URI parser accepts Atlas multi-host seed lists and identifies the configured database', () => {
  const uri = 'mongodb://user:pass@atlas-a.mongodb.net:27017,atlas-b.mongodb.net:27017/safe_mandate?replicaSet=atlas';
  const inspected = inspectMongoUri(uri);
  assert.equal(isValidMongoUri(uri), true);
  assert.equal(inspected.isAtlas, true);
  assert.equal(inspected.databaseName, 'safe_mandate');
  assert.equal(inspectMongoUri('mongodb://127.0.0.1:27017').databaseName, '');
  assert.equal(isValidMongoUri('mongodb://127.0.0.1:27017/safe_mandate'), true);
});

test('configuration rejects invalid environment names, ports, and auth limits', () => {
  assert.throws(() => getConfig({ NODE_ENV: 'preview' }), /NODE_ENV/);
  assert.throws(() => getConfig({ PORT: '0' }), /PORT/);
  assert.throws(() => getConfig({ AUTH_LOGIN_LIMIT: '0' }), /AUTH_LOGIN_LIMIT/);
  assert.throws(() => getConfig({ MONGODB_URI: 'https://localhost/not-mongodb' }), /MONGODB_URI/);
  assert.equal(getAppConfig({ PORT: '0' }).port, 3001);
});
