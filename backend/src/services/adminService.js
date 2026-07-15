'use strict';

/**
 * Admin configuration service (Phase 5).
 *
 * All operations are tenant-scoped by the caller's businessId. Secrets
 * (provider API keys) are encrypted on write and NEVER returned in any read.
 * Config changes are audited.
 */

const db = require('../db');
const enc = require('../crypto/encryption');
const { writeAudit } = require('../audit/log');
const { getProviderClass, listProviders } = require('../providers');
const { hashPassword } = require('../auth/password');

function aadFor(businessId) {
  return `business:${businessId}`;
}

function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

async function audit(entry, runner) {
  return writeAudit(entry, runner);
}

// --- Business profile -------------------------------------------------------

async function getBusinessProfile(businessId) {
  const { rows } = await db.query(
    'SELECT id, name, industry, jurisdiction, branding, status, created_at FROM businesses WHERE id=$1',
    [businessId]
  );
  return rows[0] || null;
}

async function updateBusinessProfile(businessId, actor, patch) {
  const fields = [];
  const values = [];
  let i = 1;
  for (const key of ['name', 'industry', 'jurisdiction', 'branding']) {
    if (patch[key] !== undefined) {
      fields.push(`${key}=$${i}`);
      values.push(key === 'branding' ? JSON.stringify(patch[key]) : patch[key]);
      i += 1;
    }
  }
  if (fields.length === 0) return getBusinessProfile(businessId);
  values.push(businessId);
  const { rows } = await db.query(
    `UPDATE businesses SET ${fields.join(', ')} WHERE id=$${i}
     RETURNING id, name, industry, jurisdiction, branding, status`,
    values
  );
  await audit({
    businessId,
    actor: actor.email,
    actorUserId: actor.userId,
    action: 'business.update',
    targetType: 'business',
    targetId: businessId,
    metadata: { fields: Object.keys(patch) },
  });
  return rows[0];
}

// --- Verification tiers ------------------------------------------------------

async function listTiers(businessId) {
  const { rows } = await db.query(
    `SELECT id, tier_name, description, required_checks, risk_thresholds, is_active, created_at, updated_at
       FROM verification_tiers WHERE business_id=$1 ORDER BY created_at DESC`,
    [businessId]
  );
  return rows;
}

async function createTier(businessId, actor, data) {
  const { rows } = await db.query(
    `INSERT INTO verification_tiers
       (business_id, tier_name, description, required_checks, risk_thresholds, is_active)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6,TRUE))
     RETURNING id, tier_name, description, required_checks, risk_thresholds, is_active`,
    [
      businessId,
      data.tier_name,
      data.description || null,
      JSON.stringify(data.required_checks || []),
      JSON.stringify(data.risk_thresholds || {}),
      data.is_active,
    ]
  );
  await audit({
    businessId,
    actor: actor.email,
    actorUserId: actor.userId,
    action: 'tier.create',
    targetType: 'verification_tier',
    targetId: rows[0].id,
    metadata: { tier_name: data.tier_name },
  });
  return rows[0];
}

async function updateTier(businessId, actor, tierId, data) {
  const fields = [];
  const values = [];
  let i = 1;
  const map = {
    tier_name: (v) => v,
    description: (v) => v,
    required_checks: (v) => JSON.stringify(v),
    risk_thresholds: (v) => JSON.stringify(v),
    is_active: (v) => v,
  };
  for (const [key, tx] of Object.entries(map)) {
    if (data[key] !== undefined) {
      fields.push(`${key}=$${i}`);
      values.push(tx(data[key]));
      i += 1;
    }
  }
  if (fields.length === 0) return null;
  values.push(tierId, businessId);
  const { rows } = await db.query(
    `UPDATE verification_tiers SET ${fields.join(', ')}
      WHERE id=$${i} AND business_id=$${i + 1}
      RETURNING id, tier_name, description, required_checks, risk_thresholds, is_active`,
    values
  );
  if (rows.length === 0) return null;
  await audit({
    businessId,
    actor: actor.email,
    actorUserId: actor.userId,
    action: 'tier.update',
    targetType: 'verification_tier',
    targetId: tierId,
    metadata: { fields: Object.keys(data) },
  });
  return rows[0];
}

// --- Provider integrations (secrets encrypted, never returned) --------------

async function listIntegrations(businessId) {
  const { rows } = await db.query(
    `SELECT provider, is_active, mode, config_meta, updated_at,
            (config_encrypted IS NOT NULL) AS has_secret
       FROM provider_integrations WHERE business_id=$1 ORDER BY provider`,
    [businessId]
  );
  // Also surface providers that exist in code but aren't yet configured.
  const configured = new Set(rows.map((r) => r.provider));
  const available = listProviders()
    .filter((p) => !configured.has(p))
    .map((p) => ({ provider: p, is_active: false, mode: 'sandbox', config_meta: {}, has_secret: false, configured: false }));
  return [...rows.map((r) => ({ ...r, configured: true })), ...available];
}

/**
 * Create or rotate a provider integration's secret config. The secret object is
 * encrypted; only field NAMES are retained in config_meta. Returns metadata
 * only — never the secret.
 */
async function upsertIntegration(businessId, actor, provider, { config, mode, is_active }) {
  try { getProviderClass(provider); } catch (e) { throw badRequest(e.message); } // validate provider key
  const hasConfig = config && typeof config === 'object' && Object.keys(config).length > 0;
  const encrypted = hasConfig ? enc.encryptJson(config, aadFor(businessId)) : null;
  const meta = { fields_set: hasConfig ? Object.keys(config) : [], rotated_at: new Date().toISOString() };

  const { rows } = await db.query(
    `INSERT INTO provider_integrations (business_id, provider, is_active, mode, config_encrypted, config_meta)
     VALUES ($1,$2,COALESCE($3,FALSE),COALESCE($4,'sandbox'),$5,$6)
     ON CONFLICT (business_id, provider) DO UPDATE SET
        is_active = COALESCE($3, provider_integrations.is_active),
        mode = COALESCE($4, provider_integrations.mode),
        config_encrypted = COALESCE($5, provider_integrations.config_encrypted),
        config_meta = CASE WHEN $5 IS NOT NULL THEN $6 ELSE provider_integrations.config_meta END
     RETURNING provider, is_active, mode, config_meta, (config_encrypted IS NOT NULL) AS has_secret`,
    [businessId, provider, is_active, mode, encrypted, JSON.stringify(meta)]
  );
  await audit({
    businessId,
    actor: actor.email,
    actorUserId: actor.userId,
    action: hasConfig ? 'integration.rotate_key' : 'integration.update',
    targetType: 'provider_integration',
    targetId: provider,
    metadata: { provider, is_active: rows[0].is_active, mode: rows[0].mode, secret_updated: hasConfig },
  });
  return rows[0]; // metadata only, no secret
}

// --- Consent documents (auto-versioned) -------------------------------------

async function listConsentVersions(businessId) {
  const { rows } = await db.query(
    `SELECT id, version, is_active, created_at FROM consent_documents
      WHERE business_id=$1 ORDER BY version DESC`,
    [businessId]
  );
  return rows;
}

async function getConsentVersion(businessId, version) {
  const { rows } = await db.query(
    'SELECT id, version, body, is_active, created_at FROM consent_documents WHERE business_id=$1 AND version=$2',
    [businessId, version]
  );
  return rows[0] || null;
}

/**
 * Save new consent text as the next version and make it active (keeping older
 * versions as history).
 */
async function saveConsent(businessId, actor, body) {
  if (!body || !String(body).trim()) throw badRequest('consent body required');
  return db.withTransaction(async (c) => {
    const { rows: maxRows } = await c.query(
      'SELECT COALESCE(MAX(version),0) AS max FROM consent_documents WHERE business_id=$1',
      [businessId]
    );
    const nextVersion = Number(maxRows[0].max) + 1;
    await c.query('UPDATE consent_documents SET is_active=FALSE WHERE business_id=$1 AND is_active=TRUE', [businessId]);
    const { rows } = await c.query(
      `INSERT INTO consent_documents (business_id, version, body, is_active, created_by)
       VALUES ($1,$2,$3,TRUE,$4) RETURNING id, version, is_active, created_at`,
      [businessId, nextVersion, body, actor.userId || null]
    );
    await audit(
      {
        businessId,
        actor: actor.email,
        actorUserId: actor.userId,
        action: 'consent.save',
        targetType: 'consent_document',
        targetId: rows[0].id,
        metadata: { version: nextVersion },
      },
      c
    );
    return rows[0];
  });
}

// --- Retention policies ------------------------------------------------------

async function listRetention(businessId) {
  const { rows } = await db.query(
    'SELECT data_type, retention_days, updated_at FROM retention_policies WHERE business_id=$1 ORDER BY data_type',
    [businessId]
  );
  return rows;
}

async function upsertRetention(businessId, actor, dataType, retentionDays) {
  if (!Number.isInteger(retentionDays) || retentionDays < 0) {
    throw badRequest('retention_days must be a non-negative integer');
  }
  const { rows } = await db.query(
    `INSERT INTO retention_policies (business_id, data_type, retention_days)
     VALUES ($1,$2,$3)
     ON CONFLICT (business_id, data_type) DO UPDATE SET retention_days=$3
     RETURNING data_type, retention_days`,
    [businessId, dataType, retentionDays]
  );
  await audit({
    businessId,
    actor: actor.email,
    actorUserId: actor.userId,
    action: 'retention.update',
    targetType: 'retention_policy',
    targetId: dataType,
    metadata: { data_type: dataType, retention_days: retentionDays },
  });
  return rows[0];
}

// --- Notification settings ---------------------------------------------------

async function listNotifications(businessId) {
  const { rows } = await db.query(
    'SELECT event_type, emails, is_active, updated_at FROM notification_settings WHERE business_id=$1 ORDER BY event_type',
    [businessId]
  );
  return rows;
}

async function upsertNotification(businessId, actor, eventType, emails, isActive) {
  const list = Array.isArray(emails) ? emails.map((e) => String(e).toLowerCase()) : [];
  const { rows } = await db.query(
    `INSERT INTO notification_settings (business_id, event_type, emails, is_active)
     VALUES ($1,$2,$3,COALESCE($4,TRUE))
     ON CONFLICT (business_id, event_type) DO UPDATE SET
        emails=$3, is_active=COALESCE($4, notification_settings.is_active)
     RETURNING event_type, emails, is_active`,
    [businessId, eventType, JSON.stringify(list), isActive]
  );
  await audit({
    businessId,
    actor: actor.email,
    actorUserId: actor.userId,
    action: 'notification.update',
    targetType: 'notification_setting',
    targetId: eventType,
    metadata: { event_type: eventType, recipient_count: list.length },
  });
  return rows[0];
}

// --- Users -------------------------------------------------------------------

async function listUsers(businessId) {
  const { rows } = await db.query(
    'SELECT id, email, role, full_name, is_active, created_at FROM users WHERE business_id=$1 ORDER BY created_at',
    [businessId]
  );
  return rows;
}

async function createUser(businessId, actor, { email, password, role, fullName }) {
  if (!['admin', 'reviewer'].includes(role)) throw badRequest('role must be admin or reviewer');
  const passwordHash = hashPassword(password);
  const { rows } = await db.query(
    `INSERT INTO users (business_id, email, password_hash, role, full_name)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING id, email, role, full_name, is_active`,
    [businessId, String(email).toLowerCase(), passwordHash, role, fullName || null]
  );
  await audit({
    businessId,
    actor: actor.email,
    actorUserId: actor.userId,
    action: 'user.create',
    targetType: 'user',
    targetId: rows[0].id,
    metadata: { role },
  });
  return rows[0];
}

module.exports = {
  getBusinessProfile,
  updateBusinessProfile,
  listTiers,
  createTier,
  updateTier,
  listIntegrations,
  upsertIntegration,
  listConsentVersions,
  getConsentVersion,
  saveConsent,
  listRetention,
  upsertRetention,
  listNotifications,
  upsertNotification,
  listUsers,
  createUser,
};
