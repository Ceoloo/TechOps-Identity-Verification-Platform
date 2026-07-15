'use strict';

/**
 * Deterministic sandbox helpers.
 *
 * Sandbox mode must never call a real API and must be predictable so tests and
 * local dev behave consistently. Outcomes are derived from magic keywords in
 * the subject data so any flow can be exercised without real providers:
 *
 *   - a name/field containing "fail"    -> fail
 *   - a name/field containing "review"  -> manual_review
 *   - a name/field containing "sanction"-> treated as a sanctions hit (fail)
 *   - anything else                     -> pass
 *
 * These conventions are documented in docs/README.md.
 */

const crypto = require('crypto');

/** Stable pseudo-reference id for a sandbox submission. */
function sandboxReference(prefix, seed) {
  const h = crypto
    .createHash('sha256')
    .update(String(seed || Math.random()))
    .digest('hex')
    .slice(0, 16);
  return `${prefix}_sbx_${h}`;
}

/** Lower-cased concatenation of the string-ish values in an object. */
function flatten(obj) {
  if (!obj || typeof obj !== 'object') return String(obj || '').toLowerCase();
  return Object.values(obj)
    .map((v) =>
      v && typeof v === 'object' ? flatten(v) : String(v == null ? '' : v)
    )
    .join(' ')
    .toLowerCase();
}

/**
 * Derive a deterministic outcome + score from subject data using the magic
 * keyword conventions above.
 * @returns {{ outcome: 'pass'|'fail'|'manual_review', score: number, matched: string|null }}
 */
function deriveOutcome(subjectData) {
  const hay = flatten(subjectData);
  if (hay.includes('sanction')) {
    return { outcome: 'fail', score: 95, matched: 'sanction' };
  }
  if (hay.includes('fail')) {
    return { outcome: 'fail', score: 80, matched: 'fail' };
  }
  if (hay.includes('review')) {
    return { outcome: 'manual_review', score: 55, matched: 'review' };
  }
  return { outcome: 'pass', score: 10, matched: null };
}

module.exports = { sandboxReference, deriveOutcome, flatten };
