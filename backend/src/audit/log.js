'use strict';

/**
 * Reusable audit-log writer.
 *
 * Every security-relevant action (PII access, decisions, deletions, retention
 * sweeps, key rotations, rules evaluations) is recorded here. Callers pass a
 * `runner` (the pool or a transaction client) so audit rows commit atomically
 * with the action they describe.
 *
 * IMPORTANT: `metadata` must never contain raw PII. Store ids, counts,
 * outcomes, versions, and reasons — not names, documents, or provider payloads.
 */

const db = require('../db');

/**
 * @param {Object} entry
 * @param {string|null} entry.businessId
 * @param {string} entry.actor            free-form actor label (required)
 * @param {string} entry.action           dotted action name (required)
 * @param {string|null} [entry.actorUserId]
 * @param {string|null} [entry.targetType]
 * @param {string|null} [entry.targetId]
 * @param {string|null} [entry.ipAddress]
 * @param {Object} [entry.metadata]       non-PII context
 * @param {import('pg').PoolClient} [runner] optional txn client (defaults to pool)
 * @returns {Promise<number>} the new audit_log id
 */
async function writeAudit(entry, runner) {
  const {
    businessId = null,
    actor,
    action,
    actorUserId = null,
    targetType = null,
    targetId = null,
    ipAddress = null,
    metadata = {},
  } = entry;

  if (!actor) throw new Error('writeAudit: actor is required');
  if (!action) throw new Error('writeAudit: action is required');

  const q = runner || db;
  const { rows } = await q.query(
    `INSERT INTO audit_log
       (business_id, actor, actor_user_id, action, target_type, target_id, ip_address, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id`,
    [
      businessId,
      actor,
      actorUserId,
      action,
      targetType,
      targetId == null ? null : String(targetId),
      ipAddress,
      JSON.stringify(metadata || {}),
    ]
  );
  return rows[0].id;
}

module.exports = { writeAudit };
