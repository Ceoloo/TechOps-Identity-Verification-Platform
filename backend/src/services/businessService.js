'use strict';

/**
 * Read helpers for tenant config used by the public intake flow:
 * business profile/branding, the active verification tier, the active consent
 * document, and the intake field set derived from the tier config.
 */

const db = require('../db');

// Base fields always collected.
const BASE_FIELDS = [
  { name: 'email', label: 'Email address', type: 'email', required: true },
];

// Map a required check_type to the subject fields it needs. This is how the
// intake form stays config-driven: change a tier's required_checks and the
// rendered fields change with it.
const CHECK_FIELD_MAP = {
  id_document: [
    { name: 'firstName', label: 'First name', type: 'text', required: true },
    { name: 'lastName', label: 'Last name', type: 'text', required: true },
    { name: 'dob', label: 'Date of birth', type: 'date', required: true },
  ],
  liveness: [], // handled by the provider's hosted flow
  sanctions_screening: [
    { name: 'firstName', label: 'First name', type: 'text', required: true },
    { name: 'lastName', label: 'Last name', type: 'text', required: true },
  ],
  business_registry: [
    { name: 'businessName', label: 'Legal business name', type: 'text', required: true },
    { name: 'jurisdiction', label: 'Jurisdiction', type: 'text', required: false },
  ],
  phone: [{ name: 'phone', label: 'Phone number', type: 'tel', required: true }],
  email_otp: [], // uses the base email field
};

async function getBusiness(businessId, runner = db) {
  const { rows } = await runner.query(
    'SELECT id, name, industry, jurisdiction, branding, status FROM businesses WHERE id=$1',
    [businessId]
  );
  return rows[0] || null;
}

/**
 * Resolve the active tier for a business. If `tierId` is given it must belong
 * to the business and be active; otherwise the most recently created active
 * tier is returned.
 */
async function getActiveTier(businessId, tierId = null, runner = db) {
  if (tierId) {
    const { rows } = await runner.query(
      `SELECT id, tier_name, required_checks, risk_thresholds, is_active
         FROM verification_tiers
        WHERE id=$1 AND business_id=$2`,
      [tierId, businessId]
    );
    const tier = rows[0];
    if (!tier || !tier.is_active) return null;
    return tier;
  }
  const { rows } = await runner.query(
    `SELECT id, tier_name, required_checks, risk_thresholds, is_active
       FROM verification_tiers
      WHERE business_id=$1 AND is_active=TRUE
      ORDER BY created_at DESC
      LIMIT 1`,
    [businessId]
  );
  return rows[0] || null;
}

async function getActiveConsent(businessId, runner = db) {
  const { rows } = await runner.query(
    `SELECT id, version, body FROM consent_documents
      WHERE business_id=$1 AND is_active=TRUE
      ORDER BY version DESC LIMIT 1`,
    [businessId]
  );
  return rows[0] || null;
}

/**
 * Derive the intake field set from a tier's required_checks. Explicit `fields`
 * arrays on individual checks are merged in. Fields are de-duplicated by name;
 * a field is `required` if any contributing source marks it required.
 */
function deriveIntakeFields(tier) {
  const byName = new Map();
  const add = (f) => {
    if (!f || !f.name) return;
    const existing = byName.get(f.name);
    if (existing) {
      existing.required = existing.required || f.required;
    } else {
      byName.set(f.name, { ...f });
    }
  };

  BASE_FIELDS.forEach(add);

  const checks = (tier && tier.required_checks) || [];
  for (const raw of checks) {
    const checkType = typeof raw === 'string' ? raw : raw.check_type;
    (CHECK_FIELD_MAP[checkType] || []).forEach(add);
    if (raw && Array.isArray(raw.fields)) raw.fields.forEach(add);
  }

  return Array.from(byName.values());
}

module.exports = {
  getBusiness,
  getActiveTier,
  getActiveConsent,
  deriveIntakeFields,
  CHECK_FIELD_MAP,
};
