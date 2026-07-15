'use strict';

// End-to-end internal API test: auth, admin config, review queue, audit + DSR,
// and role enforcement. Self-skips without a database.

const crypto = require('crypto');
process.env.PII_ENCRYPTION_KEY =
  process.env.PII_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');
process.env.AUTH_TOKEN_SECRET = process.env.AUTH_TOKEN_SECRET || 'test-secret';
process.env.PROVIDER_MODE = 'sandbox';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const db = require('../src/db');
const enc = require('../src/crypto/encryption');
const authService = require('../src/services/authService');
const intakeService = require('../src/services/intakeService');

let dbAvailable = false;
let server;
let base;
let businessId;
let adminToken;
let reviewerToken;

async function activeConsentVersion() {
  const { rows } = await db.query(
    'SELECT version FROM consent_documents WHERE business_id=$1 AND is_active=TRUE',
    [businessId]
  );
  return rows[0].version;
}

async function api(method, path, { token, body } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch (_e) { /* no body */ }
  return { status: res.status, body: json };
}

test.before(async () => {
  try { await db.query('SELECT 1 FROM businesses LIMIT 1'); dbAvailable = true; }
  catch (_e) { dbAvailable = false; return; }

  await db.withTransaction(async (c) => {
    const { rows } = await c.query("INSERT INTO businesses (name) VALUES ('InternalCo') RETURNING id");
    businessId = rows[0].id;
    await c.query(
      `INSERT INTO verification_tiers (business_id, tier_name, required_checks, risk_thresholds)
       VALUES ($1,'standard',$2,$3)`,
      [
        businessId,
        JSON.stringify([{ check_type: 'id_document', provider: 'stripe_identity', required: true }]),
        JSON.stringify({ auto_approve: { all_required_pass: true }, auto_reject: { any_sanctions_hit: true }, default: 'manual_review' }),
      ]
    );
    await c.query("INSERT INTO consent_documents (business_id, version, body, is_active) VALUES ($1,1,'consent',TRUE)", [businessId]);
    await c.query(
      "INSERT INTO provider_integrations (business_id, provider, is_active, mode, config_encrypted) VALUES ($1,'stripe_identity',TRUE,'sandbox',$2)",
      [businessId, enc.encryptJson({ secret_key: 'sk' }, `business:${businessId}`)]
    );
  });

  await authService.createUser({ businessId, email: 'admin@internal.test', password: 'password123', role: 'admin', fullName: 'Admin' });
  await authService.createUser({ businessId, email: 'reviewer@internal.test', password: 'password123', role: 'reviewer', fullName: 'Rev' });

  const app = createApp();
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;

  adminToken = (await api('POST', '/api/auth/login', { body: { email: 'admin@internal.test', password: 'password123' } })).body.token;
  reviewerToken = (await api('POST', '/api/auth/login', { body: { email: 'reviewer@internal.test', password: 'password123' } })).body.token;
});

test.after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (dbAvailable && businessId) await db.query('DELETE FROM businesses WHERE id=$1', [businessId]);
  await db.close();
});

test('login issues a token; bad credentials are rejected', async (t) => {
  if (!dbAvailable) return t.skip('no database');
  assert.ok(adminToken);
  const bad = await api('POST', '/api/auth/login', { body: { email: 'admin@internal.test', password: 'nope' } });
  assert.equal(bad.status, 401);
});

test('admin can read/update business profile and create a tier', async (t) => {
  if (!dbAvailable) return t.skip('no database');
  const profile = await api('GET', '/api/admin/business', { token: adminToken });
  assert.equal(profile.status, 200);
  assert.equal(profile.body.name, 'InternalCo');

  const patch = await api('PATCH', '/api/admin/business', { token: adminToken, body: { industry: 'fintech' } });
  assert.equal(patch.body.industry, 'fintech');

  const tier = await api('POST', '/api/admin/tiers', { token: adminToken, body: { tier_name: 'premium', required_checks: [], risk_thresholds: {} } });
  assert.equal(tier.status, 201);
});

test('integration secrets are never returned', async (t) => {
  if (!dbAvailable) return t.skip('no database');
  const put = await api('PUT', '/api/admin/integrations/twilio_lookup', {
    token: adminToken,
    body: { is_active: true, mode: 'sandbox', config: { account_sid: 'AC', auth_token: 'secrettoken' } },
  });
  assert.equal(put.status, 200);
  assert.equal(put.body.has_secret, true);
  const serialized = JSON.stringify(put.body);
  assert.ok(!serialized.includes('secrettoken'));
  assert.ok(!serialized.includes('config_encrypted'));

  const list = await api('GET', '/api/admin/integrations', { token: adminToken });
  assert.ok(!JSON.stringify(list.body).includes('secrettoken'));
});

test('consent editor auto-versions', async (t) => {
  if (!dbAvailable) return t.skip('no database');
  const save = await api('POST', '/api/admin/consent', { token: adminToken, body: { body: 'Updated consent text v2' } });
  assert.equal(save.status, 201);
  assert.equal(save.body.version, 2);
  assert.equal(save.body.is_active, true);
});

test('reviewer is blocked from admin routes', async (t) => {
  if (!dbAvailable) return t.skip('no database');
  const res = await api('GET', '/api/admin/business', { token: reviewerToken });
  assert.equal(res.status, 403);
});

test('review queue + decision flow', async (t) => {
  if (!dbAvailable) return t.skip('no database');
  // Create a manual_review verification via the intake service ('review' keyword).
  const cv = await activeConsentVersion();
  const { verificationId, status } = await intakeService.submitIntake({
    businessId,
    subjectType: 'individual',
    subject: { firstName: 'Review', lastName: 'Me', dob: '1990-01-01', email: 'review@intake.test' },
    consentAccepted: true,
    consentVersion: cv,
  });
  assert.equal(status, 'manual_review');

  const queue = await api('GET', '/api/review/queue', { token: reviewerToken });
  assert.equal(queue.status, 200);
  assert.ok(queue.body.some((v) => v.id === verificationId));

  const detail = await api('GET', `/api/review/verifications/${verificationId}`, { token: reviewerToken });
  assert.equal(detail.status, 200);
  // Reviewer summary must not include raw payloads.
  assert.ok(!JSON.stringify(detail.body).includes('raw_result_encrypted'));
  assert.ok(!('raw' in (detail.body.checks[0] || {})));

  // Reviewer decision requires a reason.
  const noReason = await api('POST', `/api/review/verifications/${verificationId}/decision`, { token: reviewerToken, body: { decision: 'approved' } });
  assert.equal(noReason.status, 400);

  const decided = await api('POST', `/api/review/verifications/${verificationId}/decision`, { token: reviewerToken, body: { decision: 'approved', reason: 'Docs verified manually' } });
  assert.equal(decided.status, 200);
  assert.equal(decided.body.status, 'approved');

  // Raw view is admin-only.
  const reviewerRaw = await api('GET', `/api/review/verifications/${verificationId}/raw`, { token: reviewerToken });
  assert.equal(reviewerRaw.status, 403);
  const adminRaw = await api('GET', `/api/review/verifications/${verificationId}/raw`, { token: adminToken });
  assert.equal(adminRaw.status, 200);
  assert.ok(Array.isArray(adminRaw.body.checks));
});

test('audit log viewer + data subject rights (access + erasure)', async (t) => {
  if (!dbAvailable) return t.skip('no database');
  // A fresh subject to erase.
  const cv2 = await activeConsentVersion();
  await intakeService.submitIntake({
    businessId,
    subjectType: 'individual',
    subject: { firstName: 'Erase', lastName: 'Me', dob: '1985-05-05', email: 'erase@intake.test' },
    consentAccepted: true,
    consentVersion: cv2,
  });

  const log = await api('GET', '/api/audit/log?action=verification.create', { token: adminToken });
  assert.equal(log.status, 200);
  assert.ok(log.body.length >= 1);

  const found = await api('GET', '/api/audit/subjects?email=erase@intake.test', { token: adminToken });
  assert.equal(found.status, 200);
  assert.equal(found.body.length, 1);
  const subjectId = found.body[0].id;

  const records = await api('GET', `/api/audit/subjects/${subjectId}/records`, { token: adminToken });
  assert.equal(records.status, 200);
  assert.equal(records.body.subject.pii.firstName, 'Erase');
  assert.ok(records.body.consent_records.length >= 1);
  assert.ok(records.body.verifications.length >= 1);

  const del = await api('DELETE', `/api/audit/subjects/${subjectId}`, { token: adminToken });
  assert.equal(del.status, 200);
  assert.equal(del.body.subjects_deleted, 1);
  assert.ok(del.body.verifications_deleted >= 1);

  // Gone.
  const gone = await api('GET', `/api/audit/subjects/${subjectId}/records`, { token: adminToken });
  assert.equal(gone.status, 404);

  // The erasure itself is audited.
  const erasureAudit = await api('GET', `/api/audit/log?action=data_subject.delete`, { token: adminToken });
  assert.ok(erasureAudit.body.some((e) => e.target_id === subjectId));
});
