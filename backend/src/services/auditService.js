'use strict';

/**
 * Audit log viewer + Data Subject Rights tooling (Phase 7).
 *
 * - searchAuditLog: filterable, tenant-scoped audit history.
 * - findSubjects: privacy-preserving lookup by identifier (via lookup_hash).
 * - getSubjectRecords: all records tied to a subject (for a DSAR access request),
 *   decrypting PII with an audited read.
 * - deleteSubjectData: right-to-erasure — cascades across the subject's
 *   verifications/checks/consent and logs the deletion itself.
 */

const db = require('../db');
const { lookupHash } = require('../crypto/hash');
const { writeAudit } = require('../audit/log');
const { readSubjectPII } = require('./subjectService');

/**
 * Search the audit log with optional filters.
 * @param {string} businessId
 * @param {Object} filters { from, to, actor, action, targetId, limit, offset }
 */
async function searchAuditLog(businessId, filters = {}) {
  const clauses = ['business_id = $1'];
  const values = [businessId];
  let i = 2;

  if (filters.from) { clauses.push(`"timestamp" >= $${i}`); values.push(filters.from); i += 1; }
  if (filters.to) { clauses.push(`"timestamp" <= $${i}`); values.push(filters.to); i += 1; }
  if (filters.actor) { clauses.push(`actor = $${i}`); values.push(filters.actor); i += 1; }
  if (filters.action) { clauses.push(`action = $${i}`); values.push(filters.action); i += 1; }
  if (filters.targetId) { clauses.push(`target_id = $${i}`); values.push(String(filters.targetId)); i += 1; }

  const limit = Math.min(Number(filters.limit) || 50, 200);
  const offset = Number(filters.offset) || 0;
  values.push(limit, offset);

  const { rows } = await db.query(
    `SELECT id, business_id, actor, actor_user_id, action, target_type, target_id,
            ip_address, metadata, "timestamp"
       FROM audit_log
      WHERE ${clauses.join(' AND ')}
      ORDER BY "timestamp" DESC
      LIMIT $${i} OFFSET $${i + 1}`,
    values
  );
  return rows;
}

/**
 * Find subjects by a plaintext identifier (e.g. email) using its lookup hash,
 * or directly by subject id. Returns lightweight descriptors (no PII).
 */
async function findSubjects(businessId, { email, subjectId } = {}) {
  if (subjectId) {
    const { rows } = await db.query(
      'SELECT id, external_ref, created_at FROM pii.subjects WHERE id=$1 AND business_id=$2',
      [subjectId, businessId]
    );
    return rows;
  }
  if (email) {
    const hash = lookupHash(email);
    const { rows } = await db.query(
      'SELECT id, external_ref, created_at FROM pii.subjects WHERE business_id=$1 AND lookup_hash=$2',
      [businessId, hash]
    );
    return rows;
  }
  return [];
}

/**
 * Gather all records associated with a subject for a DSAR access request.
 * Decrypts the subject PII (audited). Check payloads are summarised, not raw.
 */
async function getSubjectRecords(businessId, subjectId, actor) {
  const { rows: subj } = await db.query(
    'SELECT id, external_ref, created_at FROM pii.subjects WHERE id=$1 AND business_id=$2',
    [subjectId, businessId]
  );
  if (subj.length === 0) return null;

  const pii = await readSubjectPII(db, {
    businessId,
    subjectId,
    actor: actor.email,
    actorUserId: actor.userId,
    reason: 'dsar_access_request',
  });

  const { rows: consents } = await db.query(
    `SELECT id, consent_text_version, ip_address, "timestamp"
       FROM consent_records WHERE subject_id=$1 AND business_id=$2 ORDER BY "timestamp"`,
    [subjectId, businessId]
  );
  const { rows: verifications } = await db.query(
    `SELECT id, tier_id, subject_type, status, risk_score, created_at, decided_at
       FROM verifications WHERE subject_id=$1 AND business_id=$2 ORDER BY created_at`,
    [subjectId, businessId]
  );
  const { rows: checks } = await db.query(
    `SELECT vc.id, vc.verification_id, vc.check_type, vc.provider, vc.outcome, vc.score, vc."timestamp"
       FROM verification_checks vc
       JOIN verifications v ON v.id = vc.verification_id
      WHERE v.subject_id=$1 AND vc.business_id=$2
      ORDER BY vc."timestamp"`,
    [subjectId, businessId]
  );

  return {
    subject: { ...subj[0], pii },
    consent_records: consents,
    verifications,
    verification_checks: checks, // summaries only
  };
}

/**
 * Right-to-erasure: delete all data for a subject and log the deletion.
 * Order matters — verifications must be deleted explicitly (their FK to the
 * subject is SET NULL, not CASCADE) so their encrypted checks cascade away;
 * deleting the subject then cascades consent_records.
 */
async function deleteSubjectData(businessId, actor, subjectId) {
  return db.withTransaction(async (c) => {
    const { rows: subj } = await c.query(
      'SELECT id FROM pii.subjects WHERE id=$1 AND business_id=$2 FOR UPDATE',
      [subjectId, businessId]
    );
    if (subj.length === 0) {
      const err = new Error('Subject not found');
      err.statusCode = 404;
      throw err;
    }

    const { rowCount: verificationsDeleted } = await c.query(
      'DELETE FROM verifications WHERE subject_id=$1 AND business_id=$2',
      [subjectId, businessId]
    );
    const { rowCount: consentsDeleted } = await c.query(
      'DELETE FROM consent_records WHERE subject_id=$1 AND business_id=$2',
      [subjectId, businessId]
    );
    const { rowCount: subjectsDeleted } = await c.query(
      'DELETE FROM pii.subjects WHERE id=$1 AND business_id=$2',
      [subjectId, businessId]
    );

    // The deletion itself is audited (GDPR/CCPA accountability).
    await writeAudit(
      {
        businessId,
        actor: actor.email,
        actorUserId: actor.userId,
        action: 'data_subject.delete',
        targetType: 'subject',
        targetId: subjectId,
        metadata: {
          verifications_deleted: verificationsDeleted,
          consents_deleted: consentsDeleted,
          subjects_deleted: subjectsDeleted,
        },
      },
      c
    );

    return {
      subject_id: subjectId,
      verifications_deleted: verificationsDeleted,
      consents_deleted: consentsDeleted,
      subjects_deleted: subjectsDeleted,
    };
  });
}

module.exports = {
  searchAuditLog,
  findSubjects,
  getSubjectRecords,
  deleteSubjectData,
};
