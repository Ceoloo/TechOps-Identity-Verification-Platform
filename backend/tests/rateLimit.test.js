'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { rateLimit } = require('../src/middleware/rateLimit');

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(k, v) {
      this.headers[k] = v;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(obj) {
      this.body = obj;
      return this;
    },
  };
}

test('allows up to max then returns 429', () => {
  const mw = rateLimit({ windowMs: 60000, max: 3 });
  const req = { ip: '1.2.3.4', params: {} };
  let nextCalls = 0;
  const next = () => {
    nextCalls += 1;
  };

  for (let i = 0; i < 3; i += 1) {
    const res = mockRes();
    mw(req, res, next);
    assert.equal(res.statusCode, 200);
  }
  assert.equal(nextCalls, 3);

  const blocked = mockRes();
  mw(req, blocked, next);
  assert.equal(blocked.statusCode, 429);
  assert.ok(blocked.headers['Retry-After']);
  assert.equal(blocked.headers['X-RateLimit-Remaining'], '0');
});

test('separate keys are limited independently', () => {
  const mw = rateLimit({ windowMs: 60000, max: 1 });
  const next = () => {};
  const a = mockRes();
  mw({ ip: 'a', params: {} }, a, next);
  assert.equal(a.statusCode, 200);
  const b = mockRes();
  mw({ ip: 'b', params: {} }, b, next);
  assert.equal(b.statusCode, 200);
  const a2 = mockRes();
  mw({ ip: 'a', params: {} }, a2, next);
  assert.equal(a2.statusCode, 429);
});

test('window reset allows requests again', async () => {
  const mw = rateLimit({ windowMs: 30, max: 1 });
  const next = () => {};
  const r1 = mockRes();
  mw({ ip: 'x', params: {} }, r1, next);
  assert.equal(r1.statusCode, 200);
  const r2 = mockRes();
  mw({ ip: 'x', params: {} }, r2, next);
  assert.equal(r2.statusCode, 429);
  await new Promise((r) => setTimeout(r, 40));
  const r3 = mockRes();
  mw({ ip: 'x', params: {} }, r3, next);
  assert.equal(r3.statusCode, 200);
});
