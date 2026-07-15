'use strict';

/**
 * Admin configuration routes (Phase 5). All require an authenticated admin.
 * The tenant is always the authenticated user's business — never taken from
 * the request body/path — so there is no cross-tenant surface.
 */

const express = require('express');
const { requireAuth, requireRole } = require('../auth/middleware');
const admin = require('../services/adminService');

const router = express.Router();
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

router.use(requireAuth, requireRole('admin'));

const biz = (req) => req.user.businessId;

// Business profile
router.get('/business', asyncHandler(async (req, res) => {
  res.json(await admin.getBusinessProfile(biz(req)));
}));
router.patch('/business', asyncHandler(async (req, res) => {
  res.json(await admin.updateBusinessProfile(biz(req), req.user, req.body || {}));
}));

// Verification tiers
router.get('/tiers', asyncHandler(async (req, res) => {
  res.json(await admin.listTiers(biz(req)));
}));
router.post('/tiers', asyncHandler(async (req, res) => {
  res.status(201).json(await admin.createTier(biz(req), req.user, req.body || {}));
}));
router.patch('/tiers/:tierId', asyncHandler(async (req, res) => {
  const updated = await admin.updateTier(biz(req), req.user, req.params.tierId, req.body || {});
  if (!updated) return res.status(404).json({ error: 'Tier not found' });
  return res.json(updated);
}));

// Provider integrations (secrets never returned)
router.get('/integrations', asyncHandler(async (req, res) => {
  res.json(await admin.listIntegrations(biz(req)));
}));
router.put('/integrations/:provider', asyncHandler(async (req, res) => {
  const body = req.body || {};
  const result = await admin.upsertIntegration(biz(req), req.user, req.params.provider, {
    config: body.config,
    mode: body.mode,
    is_active: body.is_active,
  });
  res.json(result);
}));

// Consent editor (auto-versioned)
router.get('/consent', asyncHandler(async (req, res) => {
  res.json(await admin.listConsentVersions(biz(req)));
}));
router.get('/consent/:version', asyncHandler(async (req, res) => {
  const doc = await admin.getConsentVersion(biz(req), Number(req.params.version));
  if (!doc) return res.status(404).json({ error: 'Not found' });
  return res.json(doc);
}));
router.post('/consent', asyncHandler(async (req, res) => {
  res.status(201).json(await admin.saveConsent(biz(req), req.user, (req.body || {}).body));
}));

// Retention policies
router.get('/retention', asyncHandler(async (req, res) => {
  res.json(await admin.listRetention(biz(req)));
}));
router.put('/retention/:dataType', asyncHandler(async (req, res) => {
  const days = Number((req.body || {}).retention_days);
  res.json(await admin.upsertRetention(biz(req), req.user, req.params.dataType, days));
}));

// Notification settings
router.get('/notifications', asyncHandler(async (req, res) => {
  res.json(await admin.listNotifications(biz(req)));
}));
router.put('/notifications/:eventType', asyncHandler(async (req, res) => {
  const body = req.body || {};
  res.json(await admin.upsertNotification(biz(req), req.user, req.params.eventType, body.emails, body.is_active));
}));

// Users
router.get('/users', asyncHandler(async (req, res) => {
  res.json(await admin.listUsers(biz(req)));
}));
router.post('/users', asyncHandler(async (req, res) => {
  res.status(201).json(await admin.createUser(biz(req), req.user, req.body || {}));
}));

module.exports = router;
