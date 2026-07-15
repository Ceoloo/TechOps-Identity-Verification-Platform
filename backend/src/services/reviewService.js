'use strict';

/**
 * Manual review queue (Phase 6).
 *
 * Reviewers see a NON-RAW summary of check outcomes — never the raw provider
 * payloads / full PII — unless an admin explicitly requests the raw view, which
 * is decrypted through subjectService and audited. Every decision writes to
 * audit_log with the reviewer id, decision, and required reason.
 */

const db = require('../db');
const enc = require('../crypto/encryption');
const { writeAudit } = require('../audit/log');
const { readSubjectPII, aadFor } = require('./subjectService');

/**
 * List verifications awaiting manual review for the tenant.
 */
async function listQueue(businessId, { limit = 25, offset = 0 } = {}) {
  const { rows } = await db.query(
    `SELECT v.id, v.subject_type, v.status, v.risk_score, v.created_at, v.tier_id,
            t.tier_name,
            (SELECT count(*)::int FROM verification_checks vc WHERE vc.verification_id = v.id) AS check_count
       FROM verifications v
       LEFT JOIN verification_tiers t ON t.id = v.tier_id
      WHERE v.business_id=$1 AND v.status='manual_review'
      ORDER BY v.created_at ASC
      LIMIT $2 OFFSET $3`,
    [businessId, Math.min(Number(limit) || 25, 100), Number(offset) || 0]
  );
  return rows;
}

/**
 * A verification with its check summaries (outcome/score only — no raw data).
 */
async function getVerification(businessId, verificationId) {
  const { rows } = await db.query(
    `SELECT id, subject_id, tier_id, subject_type, status, risk_score,
            decision_reason, created_at, decided_at, decided_by
       FROM verifications WHERE id=$1 AND business_id=$2`,
    [verificationId, businessId]
  );
  if (rows.length === 0) return null;
  const verification = rows[0];

  const { rows: checks } = await db.query(
    `SELECT id, check_type, provider, outcome, score, provider_reference, "timestamp"
       FROM verification_checks WHERE verification_id=$1 AND business_id=$2
      ORDER BY "timestamp" ASC`,
    [verificationId, businessId]
  );

  return { verification, checks }; // NB: no raw payloads
}

/**
 * Admin-only: decrypt and return the raw payloads for a verification's checks,
 * plus the subject PII. Every read is audited (pii.read / check.read_raw).
 */
async function getRawPayloads(businessId, verificationId, actor) {
  const { rows: v } = await db.query(
    'SELECT subject_id FROM verifications WHERE id=$1 AND business_id=$2',
    [verificationId, businessId]
  );
  if (v.length === 0) return null;

  const { rows: checks } = await db.query(
    `SELECT id, check_type, provider, outcome, raw_result_encrypted
       FROM verification_checks WHERE verification_id=$1 AND business_id=$2`,
    [verificationId, businessId]
  );
  const decrypted = checks.map((c) => ({
    id: c.id,
    check_type: c.check_type,
    provider: c.provider,
    outcome: c.outcome,
    raw: c.raw_result_encrypted
      ? enc.decryptJson(c.raw_result_encrypted, aadFor(businessId))
      : null,
  }));

  await writeAudit({
    businessId,
    actor: actor.email,
    actorUserId: actor.userId,
    action: 'check.read_raw',
    targetType: 'verification',
    targetId: verificationId,
    metadata: { check_count: checks.length },
  });

  let subjectPII = null;
  if (v[0].subject_id) {
    subjectPII = await readSubjectPII(db, {
      businessId,
      subjectId: v[0].subject_id,
      actor: actor.email,
      actorUserId: actor.userId,
      reason: 'manual_review_raw_view',
    });
  }

  return { checks: decrypted, subject: subjectPII };
}

/**
 * Record a reviewer decision. Requires a non-empty reason.
 */
async function decide(businessId, actor, verificationId, decision, reason) {
  if (!['approved', 'rejected'].includes(decision)) {
    const err = new Error('decision must be "approved" or "rejected"');
    err.statusCode = 400;
    throw err;
  }
  if (!reason || !String(reason).trim()) {
    const err = new Error('a reason note is required');
    err.statusCode = 400;
    throw err;
  }

  return db.withTransaction(async (c) => {
    const { rows } = await c.query(
      `UPDATE verifications
          SET status=$1, decided_at=now(), decided_by=$2, decision_reason=$3
        WHERE id=$4 AND business_id=$5 AND status='manual_review'
        RETURNING id, status`,
      [decision, actor.userId, String(reason).trim(), verificationId, businessId]
    );
    if (rows.length === 0) {
      const err = new Error('Verification not found or not in manual_review');
      err.statusCode = 404;
      throw err;
    }
    await writeAudit(
      {
        businessId,
        actor: actor.email,
        actorUserId: actor.userId,
        action: 'verification.decide',
        targetType: 'verification',
        targetId: verificationId,
        metadata: { status: decision, auto: false, reason: String(reason).trim().slice(0, 500) },
      },
      c
    );
    return rows[0];
  });
}

module.exports = { listQueue, getVerification, getRawPayloads, decide };
