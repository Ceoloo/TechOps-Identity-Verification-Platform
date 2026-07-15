'use strict';

/**
 * Data-driven rules engine.
 *
 * Given a verification tier's config (`required_checks` + `risk_thresholds`)
 * and the normalised results of the Phase 2 adapter calls, compute a decision:
 *
 *   auto_approve | manual_review | auto_reject
 *
 * The logic is entirely driven by the tier's jsonb config — there is nothing
 * per-business hardcoded here — so an admin editing thresholds in the UI changes
 * behavior with no code deploy.
 *
 * ---------------------------------------------------------------------------
 * risk_thresholds config shape (all fields optional):
 * {
 *   "auto_reject":  { <condition>: <value>, ... },   // OR — any match rejects
 *   "auto_approve": { <condition>: <value>, ... },   // AND — all must hold
 *   "default": "manual_review" | "approved" | "rejected"
 * }
 *
 * Supported conditions (evaluated against aggregated facts):
 *   all_required_pass:      true   every required check outcome === 'pass'
 *   any_required_fail:      true   some required check outcome === 'fail'
 *   any_required_missing:   true   a required check has no result
 *   any_error:              true   some check outcome === 'error'
 *   any_manual_review:      true   some check outcome === 'manual_review'
 *   any_sanctions_hit:      true   a sanctions_screening check === 'fail'
 *   required_checks_completed: true  no required check missing/pending
 *   max_risk_score:         N      aggregate risk_score <= N   (approve-style)
 *   min_risk_score:         N      aggregate risk_score >= N   (reject-style)
 * ---------------------------------------------------------------------------
 */

const DECISION_TO_STATUS = {
  auto_approve: 'approved',
  auto_reject: 'rejected',
  manual_review: 'manual_review',
};

const SANCTIONS_CHECK_TYPE = 'sanctions_screening';

/**
 * Normalise a required_checks entry to a { check_type, provider, required }.
 */
function normaliseRequired(entry) {
  if (typeof entry === 'string') {
    return { check_type: entry, provider: null, required: true };
  }
  return {
    check_type: entry.check_type,
    provider: entry.provider || null,
    required: entry.required !== false,
  };
}

/**
 * Find the result matching a required check (by check_type, and provider when
 * the requirement pins one).
 */
function findResult(results, req) {
  return results.find((r) => {
    if (r.checkType !== req.check_type) return false;
    if (req.provider && r.provider !== req.provider) return false;
    return true;
  });
}

/**
 * Compute the aggregate facts the conditions are evaluated against.
 * @param {Array} requiredChecks tier.required_checks
 * @param {Array} results normalised CheckResult[]
 */
function computeFacts(requiredChecks, results) {
  const required = (requiredChecks || [])
    .map(normaliseRequired)
    .filter((r) => r.required && r.check_type);

  const requiredStatus = required.map((req) => {
    const res = findResult(results, req);
    return {
      check_type: req.check_type,
      provider: req.provider,
      outcome: res ? res.outcome : 'missing',
    };
  });

  const passCount = requiredStatus.filter((r) => r.outcome === 'pass').length;

  const scores = results
    .map((r) => (typeof r.score === 'number' ? r.score : null))
    .filter((s) => s !== null);
  // Aggregate risk = the highest observed score (most conservative).
  const riskScore = scores.length ? Math.max(...scores) : 0;

  return {
    required_total: required.length,
    required_pass: passCount,
    all_required_pass:
      required.length > 0 && requiredStatus.every((r) => r.outcome === 'pass'),
    any_required_fail: requiredStatus.some((r) => r.outcome === 'fail'),
    any_required_missing: requiredStatus.some((r) => r.outcome === 'missing'),
    required_checks_completed: requiredStatus.every(
      (r) => r.outcome !== 'missing' && r.outcome !== 'pending'
    ),
    any_error: results.some((r) => r.outcome === 'error'),
    any_manual_review: results.some((r) => r.outcome === 'manual_review'),
    any_sanctions_hit: results.some(
      (r) => r.checkType === SANCTIONS_CHECK_TYPE && r.outcome === 'fail'
    ),
    risk_score: riskScore,
    required_status: requiredStatus,
  };
}

/**
 * Evaluate a single condition key/value against the facts.
 * Returns { matched: boolean, detail: string }.
 */
function evalCondition(key, value, facts) {
  switch (key) {
    case 'all_required_pass':
    case 'any_required_fail':
    case 'any_required_missing':
    case 'required_checks_completed':
    case 'any_error':
    case 'any_manual_review':
    case 'any_sanctions_hit': {
      const matched = Boolean(value) === Boolean(facts[key]);
      // Only treat as a positive signal when the requested truthy value holds.
      return {
        matched: Boolean(value) ? Boolean(facts[key]) : matched,
        detail: `${key}=${facts[key]}`,
      };
    }
    case 'max_risk_score':
      return {
        matched: facts.risk_score <= Number(value),
        detail: `risk_score(${facts.risk_score})<=${value}`,
      };
    case 'min_risk_score':
      return {
        matched: facts.risk_score >= Number(value),
        detail: `risk_score(${facts.risk_score})>=${value}`,
      };
    default:
      // Unknown condition keys never match; surfaced in reasons for visibility.
      return { matched: false, detail: `unknown_condition:${key}` };
  }
}

/**
 * OR semantics: any listed condition matching triggers.
 */
function anyConditionMatches(conditions, facts) {
  const reasons = [];
  let matched = false;
  for (const [key, value] of Object.entries(conditions || {})) {
    const r = evalCondition(key, value, facts);
    if (r.matched) {
      matched = true;
      reasons.push(r.detail);
    }
  }
  return { matched, reasons };
}

/**
 * AND semantics: every listed condition must match.
 */
function allConditionsMatch(conditions, facts) {
  const entries = Object.entries(conditions || {});
  if (entries.length === 0) return { matched: false, reasons: ['no_approve_rules'] };
  const reasons = [];
  let matched = true;
  for (const [key, value] of entries) {
    const r = evalCondition(key, value, facts);
    reasons.push(`${r.detail}${r.matched ? '' : '(unmet)'}`);
    if (!r.matched) matched = false;
  }
  return { matched, reasons };
}

/**
 * Evaluate the rules for a tier against adapter results. Pure function.
 *
 * @param {Object} tier              { required_checks, risk_thresholds }
 * @param {Array}  results           normalised CheckResult[]
 * @returns {{ decision: string, status: string, riskScore: number,
 *             reasons: string[], facts: Object }}
 */
function evaluate(tier, results) {
  const requiredChecks = (tier && tier.required_checks) || [];
  const thresholds = (tier && tier.risk_thresholds) || {};
  const list = Array.isArray(results) ? results : [];
  const facts = computeFacts(requiredChecks, list);

  // 1. Reject wins first (fail-safe): any configured reject condition.
  const reject = anyConditionMatches(thresholds.auto_reject, facts);
  if (reject.matched) {
    return decision('auto_reject', facts, [
      'matched auto_reject:',
      ...reject.reasons,
    ]);
  }

  // 2. Approve requires ALL configured approve conditions.
  const approve = allConditionsMatch(thresholds.auto_approve, facts);
  if (approve.matched) {
    return decision('auto_approve', facts, [
      'matched auto_approve:',
      ...approve.reasons,
    ]);
  }

  // 3. Fall through to the configured default (or manual_review).
  const fallback = thresholds.default || 'manual_review';
  const dec =
    fallback === 'approved'
      ? 'auto_approve'
      : fallback === 'rejected'
        ? 'auto_reject'
        : 'manual_review';
  return decision(dec, facts, [
    `default=${fallback}`,
    ...(approve.reasons || []),
  ]);
}

function decision(dec, facts, reasons) {
  return {
    decision: dec,
    status: DECISION_TO_STATUS[dec] || 'manual_review',
    riskScore: facts.risk_score,
    reasons,
    facts,
  };
}

module.exports = {
  evaluate,
  computeFacts,
  DECISION_TO_STATUS,
};
