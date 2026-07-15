'use strict';

/**
 * Audit log viewer + Data Subject Rights routes (Phase 7). Admin only.
 */

const express = require('express');
const { requireAuth, requireRole } = require('../auth/middleware');
const audit = require('../services/auditService');

const router = express.Router();
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

router.use(requireAuth, requireRole('admin'));

const biz = (req) => req.user.businessId;

// Searchable/filterable audit log.
router.get('/log', asyncHandler(async (req, res) => {
  const rows = await audit.searchAuditLog(biz(req), {
    from: req.query.from,
    to: req.query.to,
    actor: req.query.actor,
    action: req.query.action,
    targetId: req.query.targetId,
    limit: req.query.limit,
    offset: req.query.offset,
  });
  res.json(rows);
}));

// Data Subject Request: find subjects by identifier.
router.get('/subjects', asyncHandler(async (req, res) => {
  const rows = await audit.findSubjects(biz(req), {
    email: req.query.email,
    subjectId: req.query.subjectId,
  });
  res.json(rows);
}));

// DSAR access: all records for a subject.
router.get('/subjects/:id/records', asyncHandler(async (req, res) => {
  const records = await audit.getSubjectRecords(biz(req), req.params.id, req.user);
  if (!records) return res.status(404).json({ error: 'Subject not found' });
  return res.json(records);
}));

// Right-to-erasure: delete all data for a subject (cascades + audited).
router.delete('/subjects/:id', asyncHandler(async (req, res) => {
  const result = await audit.deleteSubjectData(biz(req), req.user, req.params.id);
  res.json(result);
}));

module.exports = router;
