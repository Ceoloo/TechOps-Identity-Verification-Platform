'use strict';

/**
 * Retention automation (Phase 8).
 *
 * Scans retention_policies per business and enforces the retention window:
 *   - verification_checks: ANONYMISED — the encrypted raw payload is nulled out
 *     past the window, keeping the outcome/score row for audit/statistics.
 *   - consent_records: DELETED past the window.
 *
 * Every sweep that affects rows writes a `retention.sweep` audit entry with
 * counts (no PII). Supports a dry run that reports counts without mutating.
 */

const db = require('../db');
const { writeAudit } = require('../audit/log');

// data_type -> how to enforce it.
const HANDLERS = {
  verification_checks: {
    action: 'anonymize',
    countSql:
      `SELECT count(*)::int AS n FROM verification_checks
        WHERE business_id=$1 AND raw_result_encrypted IS NOT NULL AND "timestamp" < $2`,
    applySql:
      `UPDATE verification_checks SET raw_result_encrypted=NULL
        WHERE business_id=$1 AND raw_result_encrypted IS NOT NULL AND "timestamp" < $2`,
  },
  consent_records: {
    action: 'delete',
    countSql:
      `SELECT count(*)::int AS n FROM consent_records
        WHERE business_id=$1 AND "timestamp" < $2`,
    applySql:
      `DELETE FROM consent_records WHERE business_id=$1 AND "timestamp" < $2`,
  },
};

/**
 * Run retention enforcement.
 * @param {Object} [opts]
 * @param {Date} [opts.now] reference "now" (defaults to current time)
 * @param {boolean} [opts.dryRun] compute counts only, do not mutate
 * @returns {Promise<Array>} per-policy results
 */
async function runRetention({ now = new Date(), dryRun = false } = {}) {
  const { rows: policies } = await db.query(
    `SELECT business_id, data_type, retention_days FROM retention_policies ORDER BY business_id`
  );

  const results = [];
  for (const policy of policies) {
    const handler = HANDLERS[policy.data_type];
    if (!handler) {
      results.push({
        business_id: policy.business_id,
        data_type: policy.data_type,
        skipped: true,
        reason: 'no handler for data_type',
      });
      continue;
    }

    const cutoff = new Date(now.getTime() - policy.retention_days * 24 * 60 * 60 * 1000);

    // Each policy in its own transaction so one failure doesn't block others.
    // eslint-disable-next-line no-await-in-loop
    const affected = await db.withTransaction(async (c) => {
      if (dryRun) {
        const { rows } = await c.query(handler.countSql, [policy.business_id, cutoff]);
        return rows[0].n;
      }
      const res = await c.query(handler.applySql, [policy.business_id, cutoff]);
      const count = res.rowCount || 0;
      if (count > 0) {
        await writeAudit(
          {
            businessId: policy.business_id,
            actor: 'retention-job',
            action: 'retention.sweep',
            targetType: policy.data_type,
            targetId: null,
            metadata: {
              data_type: policy.data_type,
              action: handler.action,
              retention_days: policy.retention_days,
              cutoff: cutoff.toISOString(),
              affected: count,
            },
          },
          c
        );
      }
      return count;
    });

    results.push({
      business_id: policy.business_id,
      data_type: policy.data_type,
      action: handler.action,
      retention_days: policy.retention_days,
      cutoff: cutoff.toISOString(),
      affected,
      dry_run: dryRun,
    });
  }

  return results;
}

module.exports = { runRetention, HANDLERS };
