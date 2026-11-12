const TEST_DATABASE_PATTERN = /^safe_mandate_phase1_test_[a-f0-9]{32}$/i;
const LOCAL_MONGO_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** Only explicitly named, unique loopback databases may be used by destructive local integration tests. */
export function isSafeLocalTestDatabaseUri(uri, applicationUri = process.env.MONGODB_URI) {
  try {
    const target = new URL(uri);
    const databaseName = decodeURIComponent(target.pathname.replace(/^\/+/, '').split('/')[0]);
    if (target.protocol !== 'mongodb:' || !LOCAL_MONGO_HOSTS.has(target.hostname) || !TEST_DATABASE_PATTERN.test(databaseName)) return false;

    if (applicationUri) {
      const application = new URL(applicationUri);
      const applicationName = decodeURIComponent(application.pathname.replace(/^\/+/, '').split('/')[0]);
      if (target.hostname === application.hostname && databaseName === applicationName) return false;
    }
    return true;
  } catch {
    return false;
  }
}
