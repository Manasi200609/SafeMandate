const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE = /(?<!\w)\+?\d(?:[\d\s().-]{6,}\d)(?!\w)/g;

/** Remove direct seller contact details before untrusted text leaves the server. */
export function sanitizeAiText(value) {
  return String(value ?? '').replace(EMAIL, '[contact redacted]').replace(PHONE, '[contact redacted]');
}
