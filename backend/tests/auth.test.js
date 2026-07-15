'use strict';

const crypto = require('crypto');
process.env.PII_ENCRYPTION_KEY =
  process.env.PII_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');
process.env.AUTH_TOKEN_SECRET = process.env.AUTH_TOKEN_SECRET || 'test-auth-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const { hashPassword, verifyPassword } = require('../src/auth/password');
const token = require('../src/auth/token');

test('password hash verifies correctly and rejects wrong password', () => {
  const stored = hashPassword('correct horse battery');
  assert.ok(stored.startsWith('scrypt$'));
  assert.equal(verifyPassword('correct horse battery', stored), true);
  assert.equal(verifyPassword('wrong', stored), false);
});

test('password hashing rejects short passwords', () => {
  assert.throws(() => hashPassword('short'));
});

test('token round-trips claims and validates signature', () => {
  const t = token.sign({ sub: 'u1', business_id: 'b1', role: 'admin' });
  const payload = token.verify(t);
  assert.equal(payload.sub, 'u1');
  assert.equal(payload.business_id, 'b1');
  assert.equal(payload.role, 'admin');
});

test('tampered token is rejected', () => {
  const t = token.sign({ sub: 'u1' });
  const tampered = t.slice(0, -3) + 'aaa';
  assert.equal(token.verify(tampered), null);
});

test('expired token is rejected', () => {
  const t = token.sign({ sub: 'u1' }, -1); // already expired
  assert.equal(token.verify(t), null);
});
