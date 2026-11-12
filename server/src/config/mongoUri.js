const SCHEMES = Object.freeze(['mongodb://', 'mongodb+srv://']);

/** Parses MongoDB seed lists without treating them as web URLs. */
export function inspectMongoUri(uri) {
  if (typeof uri !== 'string' || !uri || /\s/.test(uri) || uri.includes('#')) return null;
  const scheme = SCHEMES.find((candidate) => uri.startsWith(candidate));
  if (!scheme) return null;

  const remainder = uri.slice(scheme.length);
  const pathStart = remainder.indexOf('/');
  const authority = pathStart === -1 ? remainder : remainder.slice(0, pathStart);
  const pathAndQuery = pathStart === -1 ? '' : remainder.slice(pathStart + 1);
  const atIndex = authority.lastIndexOf('@');
  const hostList = (atIndex === -1 ? authority : authority.slice(atIndex + 1)).split(',');
  if (!authority || hostList.some((host) => !host)) return null;

  const hostnames = hostList.map((host) => {
    if (host.startsWith('[')) {
      const closingBracket = host.indexOf(']');
      return closingBracket > 1 ? host.slice(1, closingBracket).toLowerCase() : '';
    }
    return host.split(':')[0].toLowerCase();
  });
  if (hostnames.some((host) => !host)) return null;

  let databaseName = '';
  try {
    databaseName = decodeURIComponent(pathAndQuery.split('?')[0]);
  } catch {
    return null;
  }

  return Object.freeze({
    scheme: scheme.slice(0, -3),
    hostnames: Object.freeze(hostnames),
    databaseName,
    isAtlas: hostnames.some((host) => host.endsWith('.mongodb.net')),
  });
}

export function isValidMongoUri(uri) {
  return inspectMongoUri(uri) !== null;
}
