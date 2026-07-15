'use strict';

const crypto = require('crypto');
process.env.PII_ENCRYPTION_KEY =
  process.env.PII_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');
process.env.PROVIDER_MODE = 'sandbox';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  StripeIdentityProvider,
  PersonaProvider,
  OfacProvider,
  OpenCorporatesProvider,
  TwilioLookupProvider,
  EmailOtpProvider,
  buildAdapter,
  listProviders,
  getProviderClass,
} = require('../src/providers');

const SANDBOX = { mode: 'sandbox' };

test('all adapters implement the interface and report keys/checkTypes', () => {
  for (const key of listProviders()) {
    const Cls = getProviderClass(key);
    assert.equal(typeof Cls.key, 'string');
    assert.equal(typeof Cls.checkType, 'string');
    const inst = new Cls({}, SANDBOX);
    assert.equal(typeof inst.submit, 'function');
    assert.equal(typeof inst.getStatus, 'function');
  }
});

test('Stripe Identity sandbox: pass by default, keyword-driven outcomes', async () => {
  const p = new StripeIdentityProvider({}, SANDBOX);
  const ok = await p.submit({ firstName: 'Ada', lastName: 'Lovelace' });
  assert.equal(ok.outcome, 'pass');
  assert.equal(ok.provider, 'stripe_identity');
  assert.equal(ok.checkType, 'id_document');
  assert.ok(ok.reference);

  const bad = await p.submit({ firstName: 'Fail', lastName: 'User' });
  assert.equal(bad.outcome, 'fail');

  const review = await p.submit({ firstName: 'Review', lastName: 'Me' });
  assert.equal(review.outcome, 'manual_review');
});

test('Persona sandbox returns a reference and pass by default', async () => {
  const p = new PersonaProvider({}, SANDBOX);
  const r = await p.submit({ firstName: 'Grace', lastName: 'Hopper', subjectType: 'individual' });
  assert.equal(r.outcome, 'pass');
  assert.ok(r.reference.startsWith('inq_sbx_'));
  const status = await p.getStatus(r.reference);
  assert.equal(status.outcome, 'pass');
});

test('OFAC sandbox flags sanctions hits, passes clean names', async () => {
  const p = new OfacProvider({}, SANDBOX);
  const clean = await p.submit({ firstName: 'Ada', lastName: 'Lovelace' });
  assert.equal(clean.outcome, 'pass');

  const hit = await p.submit({ firstName: 'John', lastName: 'Sanction' });
  assert.equal(hit.outcome, 'fail');
  assert.ok(hit.score >= 90);

  const deny = await p.submit({ businessName: 'Evil Corp' });
  assert.equal(deny.outcome, 'fail');
});

test('OpenCorporates sandbox validates business names', async () => {
  const p = new OpenCorporatesProvider({}, SANDBOX);
  const ok = await p.submit({ businessName: 'Acme Widgets LLC' });
  assert.equal(ok.outcome, 'pass');

  const missing = await p.submit({});
  assert.equal(missing.outcome, 'manual_review');

  const dissolved = await p.submit({ businessName: 'Dissolved Co' });
  assert.equal(dissolved.outcome, 'fail');
});

test('Twilio Lookup sandbox validates phone length', async () => {
  const p = new TwilioLookupProvider({}, SANDBOX);
  const ok = await p.submit({ phone: '+1 415 555 0132' });
  assert.equal(ok.outcome, 'pass');

  const short = await p.submit({ phone: '123' });
  assert.equal(short.outcome, 'fail');
});

test('Email OTP: submit -> verify happy path and wrong-code path', async () => {
  const store = new Map();
  const p = new EmailOtpProvider({}, { mode: 'sandbox', store });
  const sub = await p.submit({ email: 'ada@example.com' });
  assert.equal(sub.outcome, 'pending');
  assert.ok(sub.reference);
  const code = sub.meta.sandbox_code;
  assert.match(code, /^\d{6}$/);

  const wrong = await p.verify(sub.reference, '000000' === code ? '111111' : '000000');
  assert.equal(wrong.outcome, 'fail');

  const right = await p.verify(sub.reference, code);
  assert.equal(right.outcome, 'pass');

  const status = await p.getStatus(sub.reference);
  assert.equal(status.outcome, 'pass');
});

test('Email OTP locks out after max attempts', async () => {
  const store = new Map();
  const p = new EmailOtpProvider({}, { mode: 'sandbox', store });
  const sub = await p.submit({ email: 'x@example.com' });
  const bad = sub.meta.sandbox_code === '999999' ? '000000' : '999999';
  let last;
  for (let i = 0; i < 6; i += 1) {
    last = await p.verify(sub.reference, bad);
  }
  assert.equal(last.outcome, 'fail');
  assert.ok(last.meta.locked || last.raw.reason === 'too_many_attempts');
});

test('buildAdapter honours forced sandbox mode', () => {
  const p = buildAdapter('stripe_identity', { secret_key: 'sk_live_x' }, { mode: 'live' });
  // PROVIDER_MODE=sandbox forces sandbox regardless of requested mode.
  assert.equal(p.isSandbox, true);
});

test('unknown provider key throws', () => {
  assert.throws(() => getProviderClass('nope'));
});
