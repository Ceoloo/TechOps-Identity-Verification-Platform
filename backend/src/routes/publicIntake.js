'use strict';

/**
 * Public-facing intake + status routes (no auth; rate-limited).
 *
 *   GET  /api/public/intake/:businessId/form         -> dynamic form descriptor
 *   POST /api/public/intake/:businessId              -> submit intake
 *   GET  /api/public/verifications/:businessId/:id/status -> customer status view
 */

const express = require('express');
const config = require('../config');
const { rateLimit } = require('../middleware/rateLimit');
const intake = require('../services/intakeService');

const router = express.Router();

// Wrap async handlers so rejections reach the error middleware.
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const submitLimiter = rateLimit({
  windowMs: parseInt(config.intakeRateWindowMs || 60000, 10),
  max: parseInt(config.intakeRateMax || 10, 10),
});

router.get(
  '/intake/:businessId/form',
  asyncHandler(async (req, res) => {
    const form = await intake.getIntakeForm(
      req.params.businessId,
      req.query.tierId || null
    );
    res.json(form);
  })
);

router.post(
  '/intake/:businessId',
  submitLimiter,
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const result = await intake.submitIntake({
      businessId: req.params.businessId,
      tierId: body.tierId || null,
      subjectType: body.subjectType || 'individual',
      subject: body.subject || {},
      consentAccepted: body.consentAccepted === true,
      consentVersion: body.consentVersion,
      ipAddress: req.ip,
      userAgent: req.get('user-agent') || null,
    });
    res.status(201).json(result);
  })
);

router.get(
  '/verifications/:businessId/:id/status',
  asyncHandler(async (req, res) => {
    const status = await intake.getStatus(req.params.businessId, req.params.id);
    if (!status) return res.status(404).json({ error: 'Not found' });
    return res.json(status);
  })
);

// Submit an email OTP code to complete an interactive check, then re-evaluate.
router.post(
  '/verifications/:businessId/:id/email-otp',
  submitLimiter,
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const result = await intake.verifyEmailOtp({
      businessId: req.params.businessId,
      verificationId: req.params.id,
      reference: body.reference,
      code: body.code,
      ipAddress: req.ip,
    });
    // Customer-safe: expose only whether it verified and the resulting status.
    res.json({ verified: result.verified, status: result.status });
  })
);

module.exports = router;
