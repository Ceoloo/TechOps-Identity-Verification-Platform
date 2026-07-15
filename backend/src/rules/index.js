'use strict';

/**
 * Rules engine public surface + audit-logged evaluation.
 */

const { evaluate, computeFacts, DECISION_TO_STATUS } = require('./engine');
const { writeAudit } = require('../audit/log');

/**
 * Build a non-PII summary of adapter results suitable for the audit log.
 * Deliberately excludes `raw` (which may contain PII) — only outcomes/scores.
 */
function summariseResults(results) {
  return (results || []).map((r) => ({
    provider: r.provider,
    check_type: r.checkType,
    outcome: r.outcome,
    score: typeof r.score === 'number' ? r.score : null,
  }));
}

/**
 * Evaluate a tier's rules against adapter results and record the evaluation to
 * audit_log with its inputs (non-PII) and outcome.
 *
 * @param {Object} params
 * @param {Object} params.tier          { id?, required_checks, risk_thresholds }
 * @param {Array}  params.results        normalised CheckResult[]
 * @param {string} params.businessId
 * @param {string} [params.verificationId]
 * @param {string} [params.actor='rules-engine']
 * @param {string} [params.actorUserId]
 * @param {string} [params.ipAddress]
 * @param {import('pg').PoolClient} [params.runner] txn client for atomic audit
 * @returns {Promise<ReturnType<typeof evaluate>>}
 */
async function evaluateAndLog({
  tier,
  results,
  businessId,
  verificationId,
  actor = 'rules-engine',
  actorUserId = null,
  ipAddress = null,
  runner,
}) {
  const outcome = evaluate(tier, results);

  await writeAudit(
    {
      businessId,
      actor,
      actorUserId,
      action: 'rules.evaluate',
      targetType: 'verification',
      targetId: verificationId || null,
      ipAddress,
      metadata: {
        tier_id: tier && tier.id ? tier.id : null,
        decision: outcome.decision,
        status: outcome.status,
        risk_score: outcome.riskScore,
        reasons: outcome.reasons,
        // Non-PII inputs: aggregated facts + per-check outcomes only.
        facts: {
          required_total: outcome.facts.required_total,
          required_pass: outcome.facts.required_pass,
          all_required_pass: outcome.facts.all_required_pass,
          any_required_fail: outcome.facts.any_required_fail,
          any_required_missing: outcome.facts.any_required_missing,
          any_sanctions_hit: outcome.facts.any_sanctions_hit,
          any_error: outcome.facts.any_error,
          any_manual_review: outcome.facts.any_manual_review,
        },
        checks: summariseResults(results),
      },
    },
    runner
  );

  return outcome;
}

module.exports = {
  evaluate,
  evaluateAndLog,
  computeFacts,
  summariseResults,
  DECISION_TO_STATUS,
};
