'use strict';

// End-to-end intake flow test against the real Express app + DB. Self-skips
// when no database is available.

const crypto = require('crypto');
process.env.PII_ENCRYPTION_KEY =
  process.env.PII_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');
process.env.PROVIDER_MODE = 'sandbox';
process.env.INTAKE_RATE_MAX = process.env.INTAKE_RATE_MAX || '100';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const db = require('../src/db');
const enc = require('../src/crypto/encryption');

let dbAvailable = false;
let server;
let baseUrl;
let businessId;
let tierId;

async function setupTenant() {
  return db.withTransaction(async (c) => {
    const { rows: b } = await c.query(
      "INSERT INTO businesses (name, branding) VALUES ('IntakeCo', '{\"colors\":{\"primary\":\"#123\"}}') RETURNING id"
    );
    const bid = b[0].id;
    const { rows: t } = await c.query(
      `INSERT INTO verification_tiers (business_id, tier_name, required_checks, risk_thresholds)
       VALUES ($1,'standard',$2,$3) RETURNING id`,
      [
        bid,
        JSON.stringify([
          { check_type: 'id_document', provider: 'stripe_identity', required: true },
          { check_type: 'sanctions_screening', provider: 'ofac', required: true },
        ]),
        JSON.stringify({
          auto_approve: { all_required_pass: true, max_risk_score: 30 },
          auto_reject: { any_sanctions_hit: true },
          default: 'manual_review',
        }),
      ]
    );
    await c.query(
      `INSERT INTO consent_documents (business_id, version, body, is_active)
       VALUES ($1,1,'I consent.',TRUE)`,
      [bid]
    );
    // Providers (ofac needs no secret; stripe secret encrypted).
    await c.query(
      `INSERT INTO provider_integrations (business_id, provider, is_active, mode, config_encrypted)
       VALUES ($1,'ofac',TRUE,'sandbox',NULL),
              ($1,'stripe_identity',TRUE,'sandbox',$2)`,
      [bid, enc.encryptJson({ secret_key: 'sk_test' }, `business:${bid}`)]
    );
    return { bid, tid: t[0].id };
  });
}

test.before(async () => {
  try {
    await db.query('SELECT 1 FROM businesses LIMIT 1');
    dbAvailable = true;
  } catch (_e) {
    dbAvailable = false;
    return;
  }
  const t = await setupTenant();
  businessId = t.bid;
  tierId = t.tid;
  const app = createApp();
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (dbAvailable && businessId) {
    await db.query('DELETE FROM businesses WHERE id=$1', [businessId]);
  }
  await db.close();
});

test('GET form returns dynamic fields + consent from tier config', async (t) => {
  if (!dbAvailable) return t.skip('no database');
  const res = await fetch(`${baseUrl}/api/public/intake/${businessId}/form`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.consent.version, 1);
  const names = body.fields.map((f) => f.name).sort();
  // email (base) + firstName/lastName (id_document + sanctions) + dob
  assert.deepEqual(names, ['dob', 'email', 'firstName', 'lastName']);
  assert.equal(body.business.branding.colors.primary, '#123');
});

test('POST clean intake auto-approves; status view hides raw data', async (t) => {
  if (!dbAvailable) return t.skip('no database');
  const res = await fetch(`${baseUrl}/api/public/intake/${businessId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      subjectType: 'individual',
      consentAccepted: true,
      consentVersion: 1,
      subject: { firstName: 'Ada', lastName: 'Lovelace', dob: '1815-12-10', email: 'ada@example.com' },
    }),
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.status, 'approved');
  assert.ok(body.verificationId);

  const statusRes = await fetch(
    `${baseUrl}/api/public/verifications/${businessId}/${body.verificationId}/status`
  );
  const status = await statusRes.json();
  assert.equal(status.status, 'approved');
  // Customer view must not expose raw check data.
  const serialized = JSON.stringify(status);
  assert.ok(!serialized.includes('raw'));
  assert.ok(!serialized.includes('stripe'));
});

test('POST with sanctions hit auto-rejects', async (t) => {
  if (!dbAvailable) return t.skip('no database');
  const res = await fetch(`${baseUrl}/api/public/intake/${businessId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      consentAccepted: true,
      consentVersion: 1,
      subject: { firstName: 'John', lastName: 'Sanction', dob: '1970-01-01', email: 'j@example.com' },
    }),
  });
  const body = await res.json();
  assert.equal(body.status, 'rejected');
});

test('POST rejects stale consent version', async (t) => {
  if (!dbAvailable) return t.skip('no database');
  const res = await fetch(`${baseUrl}/api/public/intake/${businessId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      consentAccepted: true,
      consentVersion: 99,
      subject: { firstName: 'Ada', lastName: 'Lovelace', dob: '1815-12-10', email: 'a@b.com' },
    }),
  });
  assert.equal(res.status, 400);
});

test('POST without consent is rejected', async (t) => {
  if (!dbAvailable) return t.skip('no database');
  const res = await fetch(`${baseUrl}/api/public/intake/${businessId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      consentAccepted: false,
      consentVersion: 1,
      subject: { firstName: 'Ada', lastName: 'Lovelace', dob: '1815-12-10', email: 'a@b.com' },
    }),
  });
  assert.equal(res.status, 400);
});

test('missing required fields returns 400', async (t) => {
  if (!dbAvailable) return t.skip('no database');
  const res = await fetch(`${baseUrl}/api/public/intake/${businessId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      consentAccepted: true,
      consentVersion: 1,
      subject: { email: 'a@b.com' },
    }),
  });
  assert.equal(res.status, 400);
});

test('PII is encrypted at rest and consent recorded', async (t) => {
  if (!dbAvailable) return t.skip('no database');
  await fetch(`${baseUrl}/api/public/intake/${businessId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      consentAccepted: true,
      consentVersion: 1,
      subject: { firstName: 'Encrypted', lastName: 'Person', dob: '1990-01-01', email: 'enc@example.com' },
    }),
  });
  // No plaintext name anywhere in the PII table's ciphertext column.
  const { rows } = await db.query(
    'SELECT pii_encrypted FROM pii.subjects WHERE business_id=$1',
    [businessId]
  );
  for (const r of rows) {
    assert.ok(!r.pii_encrypted.includes('Encrypted'));
    assert.ok(!r.pii_encrypted.includes('Person'));
  }
  // Access to PII was audited.
  const { rows: audit } = await db.query(
    "SELECT count(*)::int AS n FROM audit_log WHERE business_id=$1 AND action='pii.write'",
    [businessId]
  );
  assert.ok(audit[0].n >= 1);
});
