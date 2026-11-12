export class DuplicateKeyError extends Error {
  constructor(message = 'A record with the same unique identity already exists.') {
    super(message);
    this.name = 'DuplicateKeyError';
  }
}
