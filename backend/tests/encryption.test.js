'use strict';

// Ensure a deterministic key is present before the module loads its config.
const crypto = require('crypto');
process.env.PII_ENCRYPTION_KEY =
  process.env.PII_ENCRYPTION_KEY ||
  crypto.randomBytes(32).toString('base64');
process.env.PII_ENCRYPTION_KEY_ID = process.env.PII_ENCRYPTION_KEY_ID || 'k1';

const test = require('node:test');
const assert = require('node:assert/strict');
const enc = require('../src/crypto/encryption');

test('encrypt/decrypt round-trips a string', () => {
  const plain = 'Ada Lovelace';
  const sealed = enc.encrypt(plain);
  assert.equal(enc.decrypt(sealed), plain);
});

test('ciphertext does not leak plaintext', () => {
  const sealed = enc.encrypt('super-secret-ssn-000-00-1234');
  assert.ok(!sealed.includes('secret'));
  assert.ok(!sealed.includes('1234'));
});

test('same plaintext yields different ciphertext (random IV)', () => {
  const a = enc.encrypt('same');
  const b = enc.encrypt('same');
  assert.notEqual(a, b);
  assert.equal(enc.decrypt(a), 'same');
  assert.equal(enc.decrypt(b), 'same');
});

test('encryptJson/decryptJson round-trips an object', () => {
  const obj = { name: 'Grace', dob: '1906-12-09', nested: { a: [1, 2, 3] } };
  const sealed = enc.encryptJson(obj);
  assert.deepEqual(enc.decryptJson(sealed), obj);
});

test('AAD binds ciphertext to context', () => {
  const sealed = enc.encrypt('payload', 'business:abc');
  assert.equal(enc.decrypt(sealed, 'business:abc'), 'payload');
  assert.throws(() => enc.decrypt(sealed, 'business:xyz'));
  // Missing AAD when it was required also fails authentication.
  assert.throws(() => enc.decrypt(sealed));
});

test('tampered ciphertext is rejected (authenticated encryption)', () => {
  const sealed = enc.encrypt('integrity-matters');
  const buf = Buffer.from(sealed, 'base64');
  buf[buf.length - 1] ^= 0xff; // flip a bit in the ciphertext
  const tampered = buf.toString('base64');
  assert.throws(() => enc.decrypt(tampered));
});

test('isConfigured reflects key availability', () => {
  assert.equal(enc.isConfigured(), true);
});
