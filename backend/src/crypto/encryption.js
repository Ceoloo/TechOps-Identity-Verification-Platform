'use strict';

/**
 * Field-level encryption for PII and per-business provider secrets.
 *
 * Uses AES-256-GCM (authenticated encryption). This is application-layer,
 * field-level encryption — independent of, and in addition to, any disk/volume
 * encryption. Ciphertext is self-describing so we can rotate keys without a
 * data migration: each envelope records the key id it was sealed with.
 *
 * Envelope layout (packed as a single base64 string):
 *   version(1) | keyIdLen(1) | keyId(keyIdLen) | iv(12) | authTag(16) | ciphertext(n)
 *
 * Optional Additional Authenticated Data (AAD) can bind ciphertext to a
 * context (e.g. `business_id:verification_id`) so a blob cannot be silently
 * moved between records.
 */

const crypto = require('crypto');
const config = require('../config');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit nonce, recommended for GCM
const TAG_LENGTH = 16;
const VERSION = 1;

/**
 * Registry of available keys, keyed by key id. Supports rotation: new data is
 * sealed with the "current" key while old data can still be opened with the
 * key id embedded in its envelope.
 *
 * For now we load a single key from config; additional keys can be registered
 * via PII_ENCRYPTION_KEYS (JSON map) in a later phase without changing callers.
 */
function loadKeys() {
  const keys = new Map();
  if (config.encryption.key) {
    const buf = Buffer.from(config.encryption.key, 'base64');
    keys.set(config.encryption.keyId, buf);
  }
  return keys;
}

const keyRegistry = loadKeys();
const currentKeyId = config.encryption.keyId;

function getKey(keyId) {
  const key = keyRegistry.get(keyId);
  if (!key) {
    throw new Error(`Encryption key "${keyId}" is not configured`);
  }
  if (key.length !== 32) {
    throw new Error(
      `Encryption key "${keyId}" must be 32 bytes (got ${key.length}); ` +
        'set PII_ENCRYPTION_KEY to a base64-encoded 32-byte value.'
    );
  }
  return key;
}

/**
 * True when at least one usable key is configured.
 */
function isConfigured() {
  try {
    getKey(currentKeyId);
    return true;
  } catch (_err) {
    return false;
  }
}

/**
 * Encrypt a UTF-8 string. Returns a base64 envelope string.
 * @param {string} plaintext
 * @param {string} [aad] optional additional authenticated data
 * @returns {string}
 */
function encrypt(plaintext, aad) {
  if (typeof plaintext !== 'string') {
    throw new TypeError('encrypt() expects a string plaintext');
  }
  const key = getKey(currentKeyId);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: TAG_LENGTH,
  });
  if (aad) cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  const keyIdBuf = Buffer.from(currentKeyId, 'utf8');

  const envelope = Buffer.concat([
    Buffer.from([VERSION]),
    Buffer.from([keyIdBuf.length]),
    keyIdBuf,
    iv,
    authTag,
    ciphertext,
  ]);
  return envelope.toString('base64');
}

/**
 * Decrypt a base64 envelope produced by {@link encrypt}.
 * @param {string} envelopeB64
 * @param {string} [aad] must match the AAD used at encryption time
 * @returns {string} plaintext
 */
function decrypt(envelopeB64, aad) {
  if (typeof envelopeB64 !== 'string') {
    throw new TypeError('decrypt() expects a base64 envelope string');
  }
  const envelope = Buffer.from(envelopeB64, 'base64');
  let offset = 0;

  const version = envelope.readUInt8(offset);
  offset += 1;
  if (version !== VERSION) {
    throw new Error(`Unsupported ciphertext envelope version: ${version}`);
  }

  const keyIdLen = envelope.readUInt8(offset);
  offset += 1;
  const keyId = envelope.slice(offset, offset + keyIdLen).toString('utf8');
  offset += keyIdLen;

  const iv = envelope.slice(offset, offset + IV_LENGTH);
  offset += IV_LENGTH;
  const authTag = envelope.slice(offset, offset + TAG_LENGTH);
  offset += TAG_LENGTH;
  const ciphertext = envelope.slice(offset);

  const key = getKey(keyId);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: TAG_LENGTH,
  });
  decipher.setAuthTag(authTag);
  if (aad) decipher.setAAD(Buffer.from(aad, 'utf8'));

  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}

/**
 * Encrypt a JSON-serialisable value. Convenience wrapper around {@link encrypt}.
 */
function encryptJson(value, aad) {
  return encrypt(JSON.stringify(value), aad);
}

/**
 * Decrypt to a JSON value. Convenience wrapper around {@link decrypt}.
 */
function decryptJson(envelopeB64, aad) {
  return JSON.parse(decrypt(envelopeB64, aad));
}

module.exports = {
  encrypt,
  decrypt,
  encryptJson,
  decryptJson,
  isConfigured,
  currentKeyId,
};
