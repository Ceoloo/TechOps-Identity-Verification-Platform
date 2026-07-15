'use strict';

/**
 * Auth routes: login + current-user profile.
 */

const express = require('express');
const { rateLimit } = require('../middleware/rateLimit');
const authService = require('../services/authService');
const { requireAuth } = require('../auth/middleware');

const router = express.Router();
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// Throttle login attempts per IP.
const loginLimiter = rateLimit({ windowMs: 60000, max: 10, keyGenerator: (req) => `login:${req.ip}` });

router.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const { email, password } = req.body || {};
    const result = await authService.login({ email, password, ipAddress: req.ip });
    if (!result) return res.status(401).json({ error: 'Invalid credentials' });
    return res.json(result);
  })
);

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
