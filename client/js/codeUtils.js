// Mirrors server/lib/codeGenerator.js's alphabet so the receiver's input
// field can reject characters that could never be valid, before ever
// asking the server. The server remains the source of truth for whether
// a code actually maps to a live room.
export const CODE_LENGTH = 6;
const ALLOWED_CHARS = /[^ACDEFGHJKMNPQRTUVWXY234679]/gi;

/** Strips invalid characters and upper-cases as the user types. */
export function sanitizeCodeInput(raw) {
  return raw.toUpperCase().replace(ALLOWED_CHARS, '').slice(0, CODE_LENGTH);
}

export function isCompleteCode(code) {
  return typeof code === 'string' && code.length === CODE_LENGTH;
}

/** "KP34EE" -> "KP3 4EE" for easier reading/dictation. */
export function formatCodeForDisplay(code) {
  const mid = Math.ceil(code.length / 2);
  return `${code.slice(0, mid)} ${code.slice(mid)}`;
}
