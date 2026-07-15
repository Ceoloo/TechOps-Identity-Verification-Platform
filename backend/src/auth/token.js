'use strict';

/**
 * Compact HMAC-signed bearer tokens (JWT-like, no dependency).
 *
 * Format: base64url(payloadJson).base64url(hmacSHA256)
 * The payload carries the user id, business id, role, and expiry. Tokens are
 * stateless; rotate the signing secret to invalidate all outstanding tokens.
 */

const crypto = require('crypto');
const config = require('../config');

function signingKey() {
  if (config.authTokenSecret) return Buffer.from(config.authTokenSecret);
  // Derive from the encryption key so a single configured secret suffices in
  // dev. In production, set AUTH_TOKEN_SECRET explicitly.
  const base = config.encryption.key
    ? Buffer.from(config.encryption.key, 'base64')
    : Buffer.from('insecure-dev-auth-key');
  return crypto.createHash('sha256').update(Buffer.concat([base, Buffer.from(':auth')])).digest();
}

const KEY = signingKey();

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function sign(payload, ttlSeconds = 8 * 3600) {
  const body = {
    ...payload,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const payloadB64 = b64url(JSON.stringify(body));
  const mac = crypto.createHmac('sha256', KEY).update(payloadB64).digest();
  return `${payloadB64}.${b64url(mac)}`;
}

function verify(token) {
  if (!token || typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot < 0) return null;
  const payloadB64 = token.slice(0, dot);
  const macB64 = token.slice(dot + 1);
  const expectedMac = crypto.createHmac('sha256', KEY).update(payloadB64).digest();
  let providedMac;
  try {
    providedMac = Buffer.from(macB64, 'base64url');
  } catch (_err) {
    return null;
  }
  if (
    providedMac.length !== expectedMac.length ||
    !crypto.timingSafeEqual(providedMac, expectedMac)
  ) {
    return null;
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch (_err) {
    return null;
  }
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

module.exports = { sign, verify };
