'use strict';

const crypto = require('crypto');
process.env.PII_ENCRYPTION_KEY =
  process.env.PII_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluate } = require('../src/rules');

// A representative tier config (mirrors the seed).
const tier = {
  id: 'tier-1',
  required_checks: [
    { check_type: 'id_document', provider: 'stripe_identity', required: true },
    { check_type: 'sanctions_screening', provider: 'ofac', required: true },
    { check_type: 'phone', provider: 'twilio_lookup', required: false },
  ],
  risk_thresholds: {
    auto_approve: { all_required_pass: true, max_risk_score: 30 },
    auto_reject: { any_sanctions_hit: true, min_risk_score: 80 },
    default: 'manual_review',
  },
};

function res(checkType, provider, outcome, score) {
  return { provider, checkType, outcome, score, reference: null, raw: {}, meta: {} };
}

test('auto_approve when all required pass and risk is low', () => {
  const out = evaluate(tier, [
    res('id_document', 'stripe_identity', 'pass', 5),
    res('sanctions_screening', 'ofac', 'pass', 2),
  ]);
  assert.equal(out.decision, 'auto_approve');
  assert.equal(out.status, 'approved');
  assert.equal(out.riskScore, 5);
});

test('auto_reject on a sanctions hit even if others pass', () => {
  const out = evaluate(tier, [
    res('id_document', 'stripe_identity', 'pass', 5),
    res('sanctions_screening', 'ofac', 'fail', 98),
  ]);
  assert.equal(out.decision, 'auto_reject');
  assert.equal(out.status, 'rejected');
});

test('auto_reject when aggregate risk crosses min_risk_score', () => {
  const out = evaluate(tier, [
    res('id_document', 'stripe_identity', 'fail', 85),
    res('sanctions_screening', 'ofac', 'pass', 2),
  ]);
  assert.equal(out.decision, 'auto_reject');
});

test('approve requires ALL approve conditions (high risk blocks approve)', () => {
  // All required pass, but a non-required check pushes risk above max_risk_score.
  const out = evaluate(tier, [
    res('id_document', 'stripe_identity', 'pass', 5),
    res('sanctions_screening', 'ofac', 'pass', 2),
    res('phone', 'twilio_lookup', 'pass', 40),
  ]);
  // risk_score = 40 > 30 so not auto_approve, and 40 < 80 so not auto_reject.
  assert.equal(out.decision, 'manual_review');
});

test('missing required check falls through to manual_review', () => {
  const out = evaluate(tier, [
    res('id_document', 'stripe_identity', 'pass', 5),
    // no sanctions result
  ]);
  assert.equal(out.decision, 'manual_review');
  assert.equal(out.facts.any_required_missing, true);
});

test('manual_review outcome from a provider does not auto-approve', () => {
  const out = evaluate(tier, [
    res('id_document', 'stripe_identity', 'manual_review', 55),
    res('sanctions_screening', 'ofac', 'pass', 2),
  ]);
  assert.equal(out.decision, 'manual_review');
});

test('empty auto_approve config never auto-approves', () => {
  const t2 = {
    required_checks: [{ check_type: 'id_document', required: true }],
    risk_thresholds: { auto_reject: { any_sanctions_hit: true } },
  };
  const out = evaluate(t2, [res('id_document', 'stripe_identity', 'pass', 1)]);
  assert.equal(out.decision, 'manual_review');
});

test('default can be configured to approved', () => {
  const t3 = {
    required_checks: [],
    risk_thresholds: { default: 'approved' },
  };
  const out = evaluate(t3, []);
  assert.equal(out.decision, 'auto_approve');
  assert.equal(out.status, 'approved');
});

test('reasons explain the decision', () => {
  const out = evaluate(tier, [
    res('id_document', 'stripe_identity', 'pass', 5),
    res('sanctions_screening', 'ofac', 'fail', 98),
  ]);
  assert.ok(out.reasons.join(' ').includes('auto_reject'));
  assert.ok(out.reasons.join(' ').includes('any_sanctions_hit'));
});
