import mongoose from 'mongoose';

let connectionPromise = null;
let connectionUri = null;
let connectionDatabaseName = null;

/**
 * Connects the process-wide Mongoose connection. Models are registered by
 * importing the model modules that the repository layer uses.
 */
export async function connectDatabase(uri, { serverSelectionTimeoutMS = 5000, dbName = null } = {}) {
  if (typeof uri !== 'string' || !uri.trim()) throw new TypeError('A MongoDB connection URI is required.');
  const normalizedUri = uri.trim();
  if (mongoose.connection.readyState === 1) {
    if (connectionUri && (connectionUri !== normalizedUri || connectionDatabaseName !== dbName)) {
      throw new Error('MongoDB is already connected to a different target.');
    }
    return mongoose.connection;
  }
  if (connectionPromise) {
    if (connectionUri !== normalizedUri || connectionDatabaseName !== dbName) {
      throw new Error('MongoDB connection is already being established for a different target.');
    }
    return connectionPromise;
  }

  connectionUri = normalizedUri;
  connectionDatabaseName = dbName;
  connectionPromise = mongoose.connect(normalizedUri, { serverSelectionTimeoutMS, autoIndex: true, ...(dbName ? { dbName } : {}) })
    .then(() => mongoose.connection)
    .catch((error) => {
      connectionUri = null;
      connectionDatabaseName = null;
      throw error;
    })
    .finally(() => { connectionPromise = null; });
  return connectionPromise;
}

export async function disconnectDatabase() {
  if (connectionPromise) await connectionPromise.catch(() => {});
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  connectionUri = null;
  connectionDatabaseName = null;
}

export function isDatabaseConnected() {
  return mongoose.connection.readyState === 1;
}
