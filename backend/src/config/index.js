'use strict';

/**
 * Centralised configuration loader.
 *
 * Reads from environment variables (optionally hydrated from a `.env` file in
 * non-production). All configuration is intentionally read here so the rest of
 * the codebase never touches `process.env` directly.
 */

const path = require('path');

// Load .env for local/dev convenience. In production, real env vars win.
try {
  // eslint-disable-next-line global-require
  require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
} catch (_err) {
  // dotenv is optional at runtime; ignore if unavailable.
}

function buildDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const {
    PGUSER = 'postgres',
    PGPASSWORD = 'postgres',
    PGHOST = 'localhost',
    PGPORT = '5432',
    PGDATABASE = 'techops_kyc',
  } = process.env;
  return `postgres://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${PGDATABASE}`;
}

const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '4000', 10),
  databaseUrl: buildDatabaseUrl(),
  encryption: {
    // Base64-encoded 32-byte key. Required for any PII/secret operation.
    key: process.env.PII_ENCRYPTION_KEY || '',
    keyId: process.env.PII_ENCRYPTION_KEY_ID || 'k1',
  },
  // "sandbox" forces provider adapters into mock mode (Phase 2).
  providerMode: process.env.PROVIDER_MODE || 'sandbox',
  // Public intake rate limiting (Phase 4).
  intakeRateWindowMs: parseInt(process.env.INTAKE_RATE_WINDOW_MS || '60000', 10),
  intakeRateMax: parseInt(process.env.INTAKE_RATE_MAX || '10', 10),
  // Trusted proxy hops for correct client IP (behind a load balancer).
  trustProxy: process.env.TRUST_PROXY || 'loopback',
};

module.exports = config;
