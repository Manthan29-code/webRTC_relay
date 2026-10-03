'use strict';

const crypto = require('crypto');

// Excludes visually ambiguous characters: 0/O, 1/I/L, 8/B
const ALPHABET = 'ACDEFGHJKMNPQRTUVWXY234679';
const CODE_LENGTH = 6;

/**
 * Generates a random 6-character room code using a crypto-safe RNG.
 * Rejects the code if it's already in use, guaranteeing uniqueness
 * for as long as the room stays active.
 *
 * @param {Set<string>} existingCodes - codes currently in use
 * @returns {string}
 */
function generateUniqueCode(existingCodes) {
  let code;
  do {
    code = generateCode();
  } while (existingCodes.has(code));
  return code;
}

function generateCode() {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    const index = crypto.randomInt(0, ALPHABET.length);
    code += ALPHABET[index];
  }
  return code;
}

module.exports = { generateUniqueCode, CODE_LENGTH };
