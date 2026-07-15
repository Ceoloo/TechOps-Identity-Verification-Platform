'use strict';

/**
 * Provider registry + factory.
 *
 * Maps stable provider keys to adapter classes and builds a ready-to-use
 * adapter for a given business by reading that business's row in
 * `provider_integrations` (Phase 1 schema), decrypting its secret config, and
 * selecting the mode. Credentials are ALWAYS sourced per-business — never from
 * global env vars — which is what makes the platform multi-tenant.
 */

const config = require('../config');
const db = require('../db');
const enc = require('../crypto/encryption');

const { StripeIdentityProvider } = require('./stripeIdentity');
const { PersonaProvider } = require('./persona');
const { OfacProvider } = require('./ofac');
const { OpenCorporatesProvider } = require('./openCorporates');
const { TwilioLookupProvider } = require('./twilioLookup');
const { EmailOtpProvider } = require('./emailOtp');

const PROVIDER_CLASSES = {
  [StripeIdentityProvider.key]: StripeIdentityProvider,
  [PersonaProvider.key]: PersonaProvider,
  [OfacProvider.key]: OfacProvider,
  [OpenCorporatesProvider.key]: OpenCorporatesProvider,
  [TwilioLookupProvider.key]: TwilioLookupProvider,
  [EmailOtpProvider.key]: EmailOtpProvider,
};

function getProviderClass(providerKey) {
  const cls = PROVIDER_CLASSES[providerKey];
  if (!cls) {
    throw new Error(`Unknown provider "${providerKey}"`);
  }
  return cls;
}

function listProviders() {
  return Object.keys(PROVIDER_CLASSES);
}

/**
 * Resolve the effective mode. A global PROVIDER_MODE=sandbox forces every
 * adapter into sandbox regardless of the stored per-business mode (safe default
 * for dev). Otherwise the stored mode wins.
 */
function resolveMode(storedMode) {
  if (config.providerMode === 'sandbox') return 'sandbox';
  return storedMode === 'live' ? 'live' : 'sandbox';
}

/**
 * Build an adapter directly from an already-decrypted config (no DB access).
 * Useful for tests and for callers that already hold the config.
 * @param {string} providerKey
 * @param {Object} decryptedConfig
 * @param {Object} [options] { mode, ...adapterOptions }
 */
function buildAdapter(providerKey, decryptedConfig = {}, options = {}) {
  const Cls = getProviderClass(providerKey);
  const mode = resolveMode(options.mode);
  return new Cls(decryptedConfig, { ...options, mode });
}

/**
 * Load and construct an adapter for a business from `provider_integrations`.
 * @param {Object} params
 * @param {string} params.businessId
 * @param {string} params.providerKey
 * @param {import('pg').PoolClient} [params.client] optional txn client
 * @param {boolean} [params.requireActive=true] error if integration inactive
 * @param {Object} [params.options] extra adapter options (e.g. store, sendEmail)
 * @returns {Promise<VerificationProvider>}
 */
async function loadProviderForBusiness({
  businessId,
  providerKey,
  client,
  requireActive = true,
  options = {},
}) {
  getProviderClass(providerKey); // validate key early
  const runner = client || db;
  const { rows } = await runner.query(
    `SELECT provider, is_active, mode, config_encrypted
       FROM provider_integrations
      WHERE business_id = $1 AND provider = $2
      LIMIT 1`,
    [businessId, providerKey]
  );

  if (rows.length === 0) {
    throw new Error(
      `Provider "${providerKey}" is not configured for business ${businessId}`
    );
  }
  const row = rows[0];
  if (requireActive && !row.is_active) {
    throw new Error(
      `Provider "${providerKey}" is inactive for business ${businessId}`
    );
  }

  let decryptedConfig = {};
  if (row.config_encrypted) {
    // AAD binds the secret to its owning business so a blob can't be replayed
    // under a different tenant.
    decryptedConfig = enc.decryptJson(row.config_encrypted, `business:${businessId}`);
  }

  const mode = resolveMode(row.mode);
  const Cls = getProviderClass(providerKey);
  return new Cls(decryptedConfig, { ...options, mode });
}

module.exports = {
  PROVIDER_CLASSES,
  getProviderClass,
  listProviders,
  buildAdapter,
  loadProviderForBusiness,
  resolveMode,
};
