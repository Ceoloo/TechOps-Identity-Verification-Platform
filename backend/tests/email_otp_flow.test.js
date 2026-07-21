'use strict';

// Persistent email-OTP store + end-to-end verify flow. Self-skips without a DB.

const crypto = require('crypto');
process.env.PII_ENCRYPTION_KEY =
  process.env.PII_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');
process.env.PROVIDER_MODE = 'sandbox';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const db = require('../src/db');
const enc = require('../src/crypto/encryption');
const { DbOtpStore } = require('../src/providers/otpStore');
const { EmailOtpProvider } = require('../src/providers');

let dbAvailable = false;
let server;
let base;
let businessId;

async function api(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* none */ }
  return { status: res.status, body: json };
}

test.before(async () => {
  try { await db.query('SELECT 1 FROM email_otp_challenges LIMIT 1'); dbAvailable = true; }
  catch (_e) { dbAvailable = false; return; }

  await db.withTransaction(async (c) => {
    const { rows } = await c.query("INSERT INTO businesses (name) VALUES ('OtpCo') RETURNING id");
    businessId = rows[0].id;
    await c.query(
      `INSERT INTO verification_tiers (business_id, tier_name, required_checks, risk_thresholds)
       VALUES ($1,'otp',$2,$3)`,
      [
        businessId,
        JSON.stringify([{ check_type: 'email_otp', provider: 'email_otp', required: true }]),
        JSON.stringify({ auto_approve: { all_required_pass: true }, default: 'manual_review' }),
      ]
    );
    await c.query("INSERT INTO consent_documents (business_id, version, body, is_active) VALUES ($1,1,'c',TRUE)", [businessId]);
    await c.query("INSERT INTO provider_integrations (business_id, provider, is_active, mode) VALUES ($1,'email_otp',TRUE,'sandbox')", [businessId]);
  });

  const app = createApp();
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (dbAvailable && businessId) await db.query('DELETE FROM businesses WHERE id=$1', [businessId]);
  await db.close();
});

test('DbOtpStore round-trips an encrypted challenge and persists across instances', async (t) => {
  if (!dbAvailable) return t.skip('no database');
  const store1 = new DbOtpStore({ businessId });
  const provider = new EmailOtpProvider({}, { mode: 'sandbox', store: store1 });
  const sub = await provider.submit({ email: 'p@otp.test' });
  assert.equal(sub.outcome, 'pending');

  // A fresh store instance (simulating another node) can read + verify it.
  const store2 = new DbOtpStore({ businessId });
  const provider2 = new EmailOtpProvider({}, { mode: 'sandbox', store: store2 });
  const ok = await provider2.verify(sub.reference, sub.meta.sandbox_code);
  assert.equal(ok.outcome, 'pass');

  // Ciphertext at rest reveals neither the code nor the email.
  const { rows } = await db.query('SELECT payload_encrypted FROM email_otp_challenges WHERE reference=$1', [sub.reference]);
  assert.ok(!rows[0].payload_encrypted.includes(sub.meta.sandbox_code));
  assert.ok(!rows[0].payload_encrypted.includes('p@otp.test'));

  await store2.delete(sub.reference);
  assert.equal(await store2.get(sub.reference), undefined);
});

test('intake with email_otp stays pending; wrong code fails via public API', async (t) => {
  if (!dbAvailable) return t.skip('no database');
  const intakeService = require('../src/services/intakeService');

  // Submit intake: email_otp check is created pending -> not yet approved.
  const { verificationId, status } = await intakeService.submitIntake({
    businessId,
    subjectType: 'individual',
    subject: { email: 'flow@otp.test' },
    consentAccepted: true,
    consentVersion: 1,
  });
  assert.notEqual(status, 'approved');

  const { rows } = await db.query(
    "SELECT provider_reference FROM verification_checks WHERE verification_id=$1 AND provider='email_otp'",
    [verificationId]
  );
  const reference = rows[0].provider_reference;
  const { rows: chal } = await db.query('SELECT payload_encrypted FROM email_otp_challenges WHERE reference=$1', [reference]);
  // Challenge payload at rest carries no plaintext email.
  assert.ok(!chal[0].payload_encrypted.includes('flow@otp.test'));

  // A wrong code fails (200 with verified=false) and does not approve.
  const wrong = await api('POST', `/api/public/verifications/${businessId}/${verificationId}/email-otp`, { reference, code: '000000' });
  assert.equal(wrong.status, 200);
  assert.equal(wrong.body.verified, false);
  assert.notEqual(wrong.body.status, 'approved');
});

test('correct email OTP code approves the verification (public API)', async (t) => {
  if (!dbAvailable) return t.skip('no database');
  // Build a verification whose only required check is email_otp.
  const { rows: v } = await db.query(
    "INSERT INTO verifications (business_id, subject_type, status, tier_id) SELECT $1,'individual','pending', id FROM verification_tiers WHERE business_id=$1 LIMIT 1 RETURNING id",
    [businessId]
  );
  const verificationId = v[0].id;

  // Issue a challenge via the adapter (so we know the code), attach it to a check.
  const store = new DbOtpStore({ businessId });
  const provider = new EmailOtpProvider({}, { mode: 'sandbox', store });
  const sub = await provider.submit({ email: 'win@otp.test' });
  const code = sub.meta.sandbox_code;
  await db.query(
    `INSERT INTO verification_checks (verification_id, business_id, check_type, provider, provider_reference, outcome)
     VALUES ($1,$2,'email_otp','email_otp',$3,'pending')`,
    [verificationId, businessId, sub.reference]
  );

  const res = await api('POST', `/api/public/verifications/${businessId}/${verificationId}/email-otp`, { reference: sub.reference, code });
  assert.equal(res.status, 200);
  assert.equal(res.body.verified, true);
  assert.equal(res.body.status, 'approved');

  // Persisted status reflects the approval.
  const { rows: after } = await db.query('SELECT status FROM verifications WHERE id=$1', [verificationId]);
  assert.equal(after[0].status, 'approved');
});

test('public verify endpoint 404s for an unknown reference', async (t) => {
  if (!dbAvailable) return t.skip('no database');
  const intakeService = require('../src/services/intakeService');
  const { verificationId } = await intakeService.submitIntake({
    businessId,
    subjectType: 'individual',
    subject: { email: 'x2@otp.test' },
    consentAccepted: true,
    consentVersion: 1,
  });
  const res = await api('POST', `/api/public/verifications/${businessId}/${verificationId}/email-otp`, { reference: 'otp_nope', code: '123456' });
  assert.equal(res.status, 404);
});
