'use strict';

// Integration: evaluateAndLog writes a PII-free audit row. Self-skips w/o DB.

const crypto = require('crypto');
process.env.PII_ENCRYPTION_KEY =
  process.env.PII_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const { evaluateAndLog } = require('../src/rules');

let dbAvailable = false;
test.before(async () => {
  try {
    await db.query('SELECT 1 FROM audit_log LIMIT 1');
    dbAvailable = true;
  } catch (_e) {
    dbAvailable = false;
  }
});
test.after(async () => db.close());

test('evaluateAndLog records a PII-free rules.evaluate audit entry', async (t) => {
  if (!dbAvailable) return t.skip('no database');

  await db
    .withTransaction(async (c) => {
      const { rows: b } = await c.query(
        "INSERT INTO businesses (name) VALUES ('RulesCo') RETURNING id"
      );
      const businessId = b[0].id;
      const { rows: v } = await c.query(
        "INSERT INTO verifications (business_id, subject_type, status) VALUES ($1,'individual','pending') RETURNING id",
        [businessId]
      );
      const verificationId = v[0].id;

      const tier = {
        id: 'tier-x',
        required_checks: [{ check_type: 'sanctions_screening', provider: 'ofac', required: true }],
        risk_thresholds: { auto_reject: { any_sanctions_hit: true }, auto_approve: { all_required_pass: true } },
      };
      // Note the raw payload carries a name (PII) that must NOT reach the audit row.
      const results = [
        {
          provider: 'ofac',
          checkType: 'sanctions_screening',
          outcome: 'fail',
          score: 98,
          reference: null,
          raw: { subject_name: 'John Sanction', hits: 1 },
          meta: {},
        },
      ];

      const outcome = await evaluateAndLog({
        tier,
        results,
        businessId,
        verificationId,
        runner: c,
      });
      assert.equal(outcome.decision, 'auto_reject');

      const { rows: audit } = await c.query(
        "SELECT action, target_id, metadata FROM audit_log WHERE business_id=$1 AND action='rules.evaluate'",
        [businessId]
      );
      assert.equal(audit.length, 1);
      assert.equal(audit[0].target_id, verificationId);
      const meta = audit[0].metadata;
      assert.equal(meta.decision, 'auto_reject');
      assert.equal(meta.checks[0].outcome, 'fail');

      // The audit metadata must not leak PII from raw payloads.
      const serialized = JSON.stringify(meta);
      assert.ok(!serialized.includes('John Sanction'));
      assert.ok(!serialized.includes('subject_name'));

      throw new Error('__rollback__');
    })
    .catch((e) => {
      if (e.message !== '__rollback__') throw e;
    });
});
