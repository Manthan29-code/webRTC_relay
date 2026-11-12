// Mirrors server/lib/codeGenerator.js's alphabet so the receiver's input
// field can reject characters that could never be valid, before ever
// asking the server. The server remains the source of truth for whether
// a code actually maps to a live room.
export const CODE_LENGTH = 6;
const ALLOWED_CHARS = /[^ACDEFGHJKMNPQRTUVWXY234679]/gi;

/** Strips whitespace, URLs, and invalid characters, returning uppercase code up to 6 chars. */
export function sanitizeCodeInput(raw) {
  if (typeof raw !== 'string') return '';
  let str = raw;
  if (str.includes('#')) {
    str = str.split('#').pop();
  }
  return str.toUpperCase().replace(/\s+/g, '').replace(ALLOWED_CHARS, '').slice(0, CODE_LENGTH);
}

export function isCompleteCode(code) {
  return typeof code === 'string' && code.length === CODE_LENGTH;
}

/** "KP34EE" -> "KP3 4EE" for easier reading/dictation. */
export function formatCodeForDisplay(code) {
  if (!code) return '';
  const mid = Math.ceil(code.length / 2);
  return `${code.slice(0, mid)} ${code.slice(mid)}`;
}
