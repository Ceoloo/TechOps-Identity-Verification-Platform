'use strict';

// Integration tests for the Phase 1 schema. These require a reachable database
// with migrations applied. They self-skip when no database is available so the
// unit suite can run in environments without Postgres.

const test = require('node:test');
const assert = require('node:assert/strict');

const crypto = require('crypto');
process.env.PII_ENCRYPTION_KEY =
  process.env.PII_ENCRYPTION_KEY ||
  crypto.randomBytes(32).toString('base64');

const db = require('../src/db');
const enc = require('../src/crypto/encryption');

let dbAvailable = false;
test.before(async () => {
  try {
    await db.query('SELECT 1');
    // Confirm migrations have run.
    await db.query('SELECT 1 FROM businesses LIMIT 1');
    dbAvailable = true;
  } catch (_err) {
    dbAvailable = false;
    // eslint-disable-next-line no-console
    console.log('[schema.test] database not available — skipping integration tests');
  }
});

test.after(async () => {
  await db.close();
});

test('full tenant graph inserts, decrypts, and cascades', async (t) => {
  if (!dbAvailable) return t.skip('no database');

  await db.withTransaction(async (c) => {
    const { rows: brows } = await c.query(
      "INSERT INTO businesses (name, industry, jurisdiction) VALUES ($1,$2,$3) RETURNING id",
      ['Test Co', 'fintech', 'US-DE']
    );
    const bid = brows[0].id;
    const aad = `business:${bid}`;

    const { rows: trows } = await c.query(
      "INSERT INTO verification_tiers (business_id, tier_name, required_checks, risk_thresholds) VALUES ($1,$2,$3,$4) RETURNING id",
      [bid, 'standard', JSON.stringify([{ check_type: 'id_document' }]), JSON.stringify({ default: 'manual_review' })]
    );

    const pii = { name: 'Ada Lovelace', dob: '1815-12-10' };
    const { rows: srows } = await c.query(
      "INSERT INTO pii.subjects (business_id, lookup_hash, pii_encrypted) VALUES ($1,$2,$3) RETURNING id",
      [bid, 'lookup-hash', enc.encryptJson(pii, aad)]
    );
    const sid = srows[0].id;

    await c.query(
      "INSERT INTO consent_records (business_id, subject_id, consent_text_version, consent_text, ip_address) VALUES ($1,$2,1,'consent','203.0.113.5')",
      [bid, sid]
    );

    const { rows: vrows } = await c.query(
      "INSERT INTO verifications (business_id, tier_id, subject_id, subject_type, status) VALUES ($1,$2,$3,'individual','pending') RETURNING id",
      [bid, trows[0].id, sid]
    );

    await c.query(
      "INSERT INTO verification_checks (verification_id, business_id, check_type, provider, raw_result_encrypted, outcome) VALUES ($1,$2,'id_document','stripe_identity',$3,'pending')",
      [vrows[0].id, bid, enc.encryptJson({ ok: false }, aad)]
    );

    // Decrypt PII back from the DB.
    const { rows: got } = await c.query('SELECT pii_encrypted FROM pii.subjects WHERE id=$1', [sid]);
    const decoded = enc.decryptJson(got[0].pii_encrypted, aad);
    assert.equal(decoded.name, 'Ada Lovelace');

    // Cascade: deleting the business removes all tenant-scoped children.
    await c.query('DELETE FROM businesses WHERE id=$1', [bid]);
    const { rows: counts } = await c.query(
      `SELECT
         (SELECT count(*)::int FROM verifications WHERE business_id=$1) AS v,
         (SELECT count(*)::int FROM verification_checks WHERE business_id=$1) AS c,
         (SELECT count(*)::int FROM consent_records WHERE business_id=$1) AS r,
         (SELECT count(*)::int FROM pii.subjects WHERE business_id=$1) AS s`,
      [bid]
    );
    assert.deepEqual(counts[0], { v: 0, c: 0, r: 0, s: 0 });

    // Roll back so the test leaves no residue.
    throw new Error('__rollback__');
  }).catch((e) => {
    if (e.message !== '__rollback__') throw e;
  });
});

test('subject_type and status are constrained', async (t) => {
  if (!dbAvailable) return t.skip('no database');
  await db.withTransaction(async (c) => {
    const { rows } = await c.query(
      "INSERT INTO businesses (name) VALUES ('C') RETURNING id"
    );
    const bid = rows[0].id;
    await assert.rejects(
      c.query(
        "INSERT INTO verifications (business_id, subject_type, status) VALUES ($1,'individual','not_a_status')",
        [bid]
      )
    );
    throw new Error('__rollback__');
  }).catch((e) => {
    if (e.message !== '__rollback__') throw e;
  });
});
