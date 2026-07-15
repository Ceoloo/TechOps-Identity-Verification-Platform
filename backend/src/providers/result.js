'use strict';

/**
 * Standard, provider-agnostic result shape returned by every adapter.
 *
 * The rules engine (Phase 3) consumes only this normalised shape, so it never
 * needs to know provider-specific payload formats. The raw provider payload is
 * carried in `raw` and is expected to be encrypted at rest by the caller
 * before it lands in `verification_checks.raw_result_encrypted`.
 *
 * @typedef {Object} CheckResult
 * @property {string} provider   provider key, e.g. 'stripe_identity'
 * @property {string} checkType  e.g. 'id_document', 'sanctions_screening'
 * @property {('pass'|'fail'|'manual_review'|'error'|'pending')} outcome
 * @property {number|null} score confidence/risk score (0-100) when applicable
 * @property {string|null} reference external reference id for getStatus polling
 * @property {Object} raw         raw provider payload (PII; encrypt before store)
 * @property {Object} meta        non-sensitive metadata (counts, flags, mode)
 */

const OUTCOMES = ['pass', 'fail', 'manual_review', 'error', 'pending'];

/**
 * Build a normalised {@link CheckResult}, validating the outcome value.
 * @param {Partial<CheckResult> & { provider: string, checkType: string, outcome: string }} fields
 * @returns {CheckResult}
 */
function makeResult(fields) {
  const { provider, checkType, outcome } = fields;
  if (!provider) throw new Error('makeResult: provider is required');
  if (!checkType) throw new Error('makeResult: checkType is required');
  if (!OUTCOMES.includes(outcome)) {
    throw new Error(
      `makeResult: invalid outcome "${outcome}" (expected one of ${OUTCOMES.join(', ')})`
    );
  }
  return {
    provider,
    checkType,
    outcome,
    score: fields.score === undefined ? null : fields.score,
    reference: fields.reference === undefined ? null : fields.reference,
    raw: fields.raw || {},
    meta: fields.meta || {},
  };
}

/**
 * Convenience for an error result (e.g. provider unreachable). We surface these
 * as `error` outcomes so the rules engine can route to manual review rather
 * than silently pass/fail.
 */
function errorResult(provider, checkType, message, extra = {}) {
  return makeResult({
    provider,
    checkType,
    outcome: 'error',
    // Keep the message non-PII; it describes the failure, not the subject.
    raw: { error: message, ...extra },
    meta: { error: true },
  });
}

module.exports = { makeResult, errorResult, OUTCOMES };
