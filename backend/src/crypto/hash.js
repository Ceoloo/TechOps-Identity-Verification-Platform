'use strict';

/**
 * Keyed hashing for privacy-preserving lookup.
 *
 * We need to find a subject by a stable identifier (e.g. email) WITHOUT storing
 * that identifier in plaintext. An HMAC over a normalised value gives a
 * deterministic, non-reversible key that supports equality lookup while keeping
 * the raw identifier only inside the encrypted PII payload.
 */

const crypto = require('crypto');
const config = require('../config');

// Derive a dedicated lookup key from the configured encryption key so we don't
// reuse the raw encryption key directly for a different purpose. Falls back to
// a clearly-labelled dev key if none is configured (non-production only).
function lookupKey() {
  const base = config.encryption.key
    ? Buffer.from(config.encryption.key, 'base64')
    : Buffer.from('insecure-dev-lookup-key');
  return crypto.createHash('sha256').update(Buffer.concat([base, Buffer.from(':lookup')])).digest();
}

const KEY = lookupKey();

/**
 * Normalise then HMAC a value for lookup. Returns a hex string, or null for
 * empty input.
 * @param {string} value
 * @returns {string|null}
 */
function lookupHash(value) {
  if (value == null) return null;
  const normalised = String(value).trim().toLowerCase();
  if (!normalised) return null;
  return crypto.createHmac('sha256', KEY).update(normalised).digest('hex');
}

module.exports = { lookupHash };
