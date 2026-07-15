'use strict';

/**
 * Manual review queue routes (Phase 6). Reviewers and admins.
 * The raw-payload view is admin-only.
 */

const express = require('express');
const { requireAuth, requireRole } = require('../auth/middleware');
const review = require('../services/reviewService');

const router = express.Router();
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

router.use(requireAuth, requireRole('reviewer'));

const biz = (req) => req.user.businessId;

router.get('/queue', asyncHandler(async (req, res) => {
  const rows = await review.listQueue(biz(req), {
    limit: req.query.limit,
    offset: req.query.offset,
  });
  res.json(rows);
}));

router.get('/verifications/:id', asyncHandler(async (req, res) => {
  const detail = await review.getVerification(biz(req), req.params.id);
  if (!detail) return res.status(404).json({ error: 'Not found' });
  return res.json(detail);
}));

// Admin-only raw/PII view (decrypts + audits).
router.get(
  '/verifications/:id/raw',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const raw = await review.getRawPayloads(biz(req), req.params.id, req.user);
    if (!raw) return res.status(404).json({ error: 'Not found' });
    return res.json(raw);
  })
);

router.post('/verifications/:id/decision', asyncHandler(async (req, res) => {
  const { decision, reason } = req.body || {};
  const result = await review.decide(biz(req), req.user, req.params.id, decision, reason);
  res.json(result);
}));

module.exports = router;
