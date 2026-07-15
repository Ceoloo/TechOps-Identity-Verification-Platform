'use strict';

// Retention automation integration test. Self-skips without a database.

const crypto = require('crypto');
process.env.PII_ENCRYPTION_KEY =
  process.env.PII_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const enc = require('../src/crypto/encryption');
const { runRetention } = require('../src/services/retentionService');

let dbAvailable = false;
let businessId;

test.before(async () => {
  try { await db.query('SELECT 1 FROM businesses LIMIT 1'); dbAvailable = true; }
  catch (_e) { dbAvailable = false; return; }

  await db.withTransaction(async (c) => {
    const { rows } = await c.query("INSERT INTO businesses (name) VALUES ('RetentionCo') RETURNING id");
    businessId = rows[0].id;
    const { rows: s } = await c.query(
      "INSERT INTO pii.subjects (business_id, pii_encrypted) VALUES ($1,$2) RETURNING id",
      [businessId, enc.encryptJson({ name: 'x' }, `business:${businessId}`)]
    );
    const { rows: v } = await c.query(
      "INSERT INTO verifications (business_id, subject_type, status) VALUES ($1,'individual','approved') RETURNING id",
      [businessId]
    );
    // One OLD check (400 days ago) with raw, one RECENT check with raw.
    await c.query(
      `INSERT INTO verification_checks (verification_id, business_id, check_type, provider, raw_result_encrypted, outcome, "timestamp")
       VALUES ($1,$2,'id_document','stripe_identity',$3,'pass', now() - interval '400 days'),
              ($1,$2,'id_document','stripe_identity',$3,'pass', now())`,
      [v[0].id, businessId, enc.encryptJson({ secret: 'pii' }, `business:${businessId}`)]
    );
    // One OLD consent (400d) and one recent.
    await c.query(
      `INSERT INTO consent_records (business_id, subject_id, consent_text_version, consent_text, "timestamp")
       VALUES ($1,$2,1,'c', now() - interval '400 days'),
              ($1,$2,1,'c', now())`,
      [businessId, s[0].id]
    );
    // Policies: 365-day retention for both.
    await c.query(
      `INSERT INTO retention_policies (business_id, data_type, retention_days)
       VALUES ($1,'verification_checks',365),($1,'consent_records',365)`,
      [businessId]
    );
  });
});

test.after(async () => {
  if (dbAvailable && businessId) await db.query('DELETE FROM businesses WHERE id=$1', [businessId]);
  await db.close();
});

test('dry run reports counts without mutating', async (t) => {
  if (!dbAvailable) return t.skip('no database');
  const results = await runRetention({ dryRun: true });
  const mine = results.filter((r) => r.business_id === businessId);
  const checks = mine.find((r) => r.data_type === 'verification_checks');
  const consents = mine.find((r) => r.data_type === 'consent_records');
  assert.equal(checks.affected, 1);
  assert.equal(consents.affected, 1);

  // Nothing changed.
  const { rows } = await db.query(
    "SELECT count(*)::int AS n FROM verification_checks WHERE business_id=$1 AND raw_result_encrypted IS NOT NULL",
    [businessId]
  );
  assert.equal(rows[0].n, 2);
});

test('enforcement anonymises old checks and deletes old consents, audited', async (t) => {
  if (!dbAvailable) return t.skip('no database');
  await runRetention({ dryRun: false });

  // Old check anonymised (raw nulled), recent check untouched.
  const { rows: checks } = await db.query(
    'SELECT raw_result_encrypted FROM verification_checks WHERE business_id=$1 ORDER BY "timestamp"',
    [businessId]
  );
  assert.equal(checks[0].raw_result_encrypted, null); // old
  assert.notEqual(checks[1].raw_result_encrypted, null); // recent

  // Old consent deleted, recent remains.
  const { rows: consents } = await db.query(
    'SELECT count(*)::int AS n FROM consent_records WHERE business_id=$1',
    [businessId]
  );
  assert.equal(consents[0].n, 1);

  // Sweeps were audited.
  const { rows: audit } = await db.query(
    "SELECT count(*)::int AS n FROM audit_log WHERE business_id=$1 AND action='retention.sweep'",
    [businessId]
  );
  assert.ok(audit[0].n >= 2);
});

test('second run is a no-op (idempotent within window)', async (t) => {
  if (!dbAvailable) return t.skip('no database');
  const results = await runRetention({ dryRun: false });
  const mine = results.filter((r) => r.business_id === businessId);
  assert.equal(mine.find((r) => r.data_type === 'verification_checks').affected, 0);
  assert.equal(mine.find((r) => r.data_type === 'consent_records').affected, 0);
});
