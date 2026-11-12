export function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'The requested API route was not found.' } });
}

/** An error with a public status code and message. Internal errors never expose details. */
export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);

  if (error instanceof ApiError) {
    return res.status(error.status).json({ error: { code: error.code, message: error.message } });
  }

  const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 500 ? error.status : 500;
  const body = status >= 400 && status < 500
    ? { code: 'INVALID_REQUEST', message: 'The request body is invalid or exceeds the allowed size.' }
    : { code: 'INTERNAL_ERROR', message: 'The server could not complete the request.' };
  return res.status(status).json({ error: body });
}
