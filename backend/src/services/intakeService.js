'use strict';

/**
 * Public intake orchestration (Phase 4).
 *
 * Flow on submit:
 *   1. Validate the business, active tier, and active consent version.
 *   2. [txn] Persist encrypted subject PII, the consent record, and a pending
 *      verification.
 *   3. Run the tier's required provider checks (outside the txn — adapters may
 *      make network calls in live mode).
 *   4. [txn] Store each check with its encrypted raw payload, run the rules
 *      engine (audited), and update the verification status.
 *
 * The customer status view never exposes raw check results or provider data.
 */

const db = require('../db');
const enc = require('../crypto/encryption');
const { writeAudit } = require('../audit/log');
const { loadProviderForBusiness, EmailOtpProvider } = require('../providers');
const { evaluateAndLog } = require('../rules');
const subjectService = require('./subjectService');
const notificationService = require('./notificationService');
const {
  getBusiness,
  getActiveTier,
  getActiveConsent,
  deriveIntakeFields,
} = require('./businessService');

const { aadFor } = subjectService;

class IntakeError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'IntakeError';
    this.statusCode = statusCode;
  }
}

/**
 * Build the public intake form descriptor for a business's active tier.
 */
async function getIntakeForm(businessId, tierId = null) {
  const business = await getBusiness(businessId);
  if (!business || business.status !== 'active') {
    throw new IntakeError('Business not found', 404);
  }
  const tier = await getActiveTier(businessId, tierId);
  if (!tier) throw new IntakeError('No active verification tier', 404);
  const consent = await getActiveConsent(businessId);
  if (!consent) throw new IntakeError('No active consent document', 409);

  return {
    business: { id: business.id, name: business.name, branding: business.branding },
    tier: { id: tier.id, tier_name: tier.tier_name },
    consent: { version: consent.version, body: consent.body },
    fields: deriveIntakeFields(tier),
    subject_types: ['individual', 'business'],
  };
}

function validateRequiredFields(fields, subject) {
  const missing = fields
    .filter((f) => f.required)
    .map((f) => f.name)
    .filter((name) => {
      const v = subject ? subject[name] : undefined;
      return v === undefined || v === null || String(v).trim() === '';
    });
  if (missing.length) {
    throw new IntakeError(`Missing required fields: ${missing.join(', ')}`);
  }
}

/**
 * Run one provider check for the intake. Returns the normalised CheckResult.
 */
async function runCheck(businessId, checkSpec, subjectData) {
  const providerKey = checkSpec.provider;
  if (!providerKey) {
    return {
      provider: 'unknown',
      checkType: checkSpec.check_type,
      outcome: 'error',
      score: null,
      reference: null,
      raw: { error: 'no provider configured for check' },
      meta: {},
    };
  }
  try {
    const adapter = await loadProviderForBusiness({
      businessId,
      providerKey,
      requireActive: true,
    });
    const result = await adapter.submit(subjectData);
    // Tag the result with the requested check_type. A single provider can back
    // several check types (e.g. Stripe covers both id_document and liveness);
    // recording the requested type is what lets the rules engine match it to
    // the tier's required_checks.
    return { ...result, checkType: checkSpec.check_type };
  } catch (err) {
    // Adapter/config errors become error results so the rules engine can route
    // to manual review rather than crashing the intake.
    return {
      provider: providerKey,
      checkType: checkSpec.check_type,
      outcome: 'error',
      score: null,
      reference: null,
      raw: { error: err.message },
      meta: {},
    };
  }
}

/**
 * Submit an intake.
 * @param {Object} params
 * @returns {Promise<{ verificationId: string, status: string }>}
 */
async function submitIntake(params) {
  const {
    businessId,
    tierId = null,
    subjectType = 'individual',
    subject = {},
    consentAccepted,
    consentVersion,
    ipAddress = null,
    userAgent = null,
  } = params;

  if (!['individual', 'business'].includes(subjectType)) {
    throw new IntakeError('Invalid subject_type');
  }

  const business = await getBusiness(businessId);
  if (!business || business.status !== 'active') {
    throw new IntakeError('Business not found', 404);
  }
  const tier = await getActiveTier(businessId, tierId);
  if (!tier) throw new IntakeError('No active verification tier', 404);
  const consent = await getActiveConsent(businessId);
  if (!consent) throw new IntakeError('No active consent document', 409);

  if (consentAccepted !== true) {
    throw new IntakeError('Consent must be explicitly accepted');
  }
  if (Number(consentVersion) !== Number(consent.version)) {
    throw new IntakeError('Consent version is out of date; reload the form');
  }

  const fields = deriveIntakeFields(tier);
  validateRequiredFields(fields, subject);

  // --- txn 1: subject + consent + pending verification ---------------------
  const { subjectId, verificationId } = await db.withTransaction(async (c) => {
    const { id: sid } = await subjectService.createSubject(c, {
      businessId,
      pii: subject,
      lookupValue: subject.email,
      actor: 'public-intake',
      ipAddress,
    });

    await c.query(
      `INSERT INTO consent_records
         (business_id, subject_id, consent_text_version, consent_text, ip_address, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [businessId, sid, consent.version, consent.body, ipAddress, userAgent]
    );

    const { rows } = await c.query(
      `INSERT INTO verifications (business_id, tier_id, subject_id, subject_type, status)
       VALUES ($1,$2,$3,$4,'pending') RETURNING id`,
      [businessId, tier.id, sid, subjectType]
    );
    const vid = rows[0].id;

    await writeAudit(
      {
        businessId,
        actor: 'public-intake',
        action: 'consent.record',
        targetType: 'verification',
        targetId: vid,
        ipAddress,
        metadata: { consent_version: consent.version },
      },
      c
    );
    await writeAudit(
      {
        businessId,
        actor: 'public-intake',
        action: 'verification.create',
        targetType: 'verification',
        targetId: vid,
        ipAddress,
        metadata: { tier_id: tier.id, subject_type: subjectType },
      },
      c
    );

    return { subjectId: sid, verificationId: vid };
  });

  // --- run provider checks (outside txn) -----------------------------------
  const subjectData = { ...subject, subjectType };
  const checks = Array.isArray(tier.required_checks) ? tier.required_checks : [];
  const runResults = [];
  for (const spec of checks) {
    const normalisedSpec =
      typeof spec === 'string' ? { check_type: spec } : spec;
    const result = await runCheck(businessId, normalisedSpec, subjectData);
    runResults.push(result);
  }

  // --- txn 2: persist checks + rules + status ------------------------------
  const status = await db.withTransaction(async (c) => {
    for (const r of runResults) {
      await c.query(
        `INSERT INTO verification_checks
           (verification_id, business_id, check_type, provider, provider_reference,
            raw_result_encrypted, outcome, score)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          verificationId,
          businessId,
          r.checkType,
          r.provider,
          r.reference || null,
          enc.encryptJson(r.raw || {}, aadFor(businessId)),
          r.outcome,
          typeof r.score === 'number' ? r.score : null,
        ]
      );
    }

    const outcome = await evaluateAndLog({
      tier,
      results: runResults,
      businessId,
      verificationId,
      actor: 'rules-engine',
      ipAddress,
      runner: c,
    });

    const isAuto = outcome.status === 'approved' || outcome.status === 'rejected';
    await c.query(
      `UPDATE verifications
          SET status=$1,
              risk_score=$2,
              decision_reason=$3,
              decided_at = CASE WHEN $4 THEN now() ELSE NULL END
        WHERE id=$5`,
      [
        outcome.status,
        outcome.riskScore,
        outcome.reasons.join('; ').slice(0, 500),
        isAuto,
        verificationId,
      ]
    );

    await writeAudit(
      {
        businessId,
        actor: 'rules-engine',
        action: 'verification.decide',
        targetType: 'verification',
        targetId: verificationId,
        ipAddress,
        metadata: { status: outcome.status, decision: outcome.decision, auto: isAuto },
      },
      c
    );

    return outcome.status;
  });

  // Best-effort notification when routed to a human reviewer.
  if (status === 'manual_review') {
    await notificationService.notifyManualReview({ businessId, verificationId });
  }

  return { verificationId, status };
}

/**
 * Customer-facing status view. Returns ONLY the status and coarse timestamps —
 * never raw check results or provider payloads.
 */
async function getStatus(businessId, verificationId) {
  const { rows } = await db.query(
    `SELECT id, status, created_at, decided_at
       FROM verifications WHERE id=$1 AND business_id=$2`,
    [verificationId, businessId]
  );
  if (rows.length === 0) return null;
  const v = rows[0];
  return {
    verification_id: v.id,
    status: v.status,
    submitted_at: v.created_at,
    decided_at: v.decided_at,
  };
}

module.exports = {
  IntakeError,
  getIntakeForm,
  submitIntake,
  getStatus,
};
