'use strict';

/**
 * Authentication + role authorization middleware for internal (admin/reviewer)
 * routes. Tenant isolation is enforced here: the authenticated user's
 * business_id is the only tenant they can act on.
 */

const token = require('./token');

/**
 * Require a valid bearer token. Populates req.user = { userId, businessId, role, email }.
 */
function requireAuth(req, res, next) {
  const header = req.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return res.status(401).json({ error: 'Missing bearer token' });
  }
  const payload = token.verify(match[1]);
  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  req.user = {
    userId: payload.sub,
    businessId: payload.business_id,
    role: payload.role,
    email: payload.email,
  };
  return next();
}

/**
 * Require the user to have one of the given roles. Admins implicitly satisfy
 * any reviewer-only requirement (admin is a superset).
 */
function requireRole(...roles) {
  return function roleGuard(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    const allowed = new Set(roles);
    if (allowed.has(req.user.role) || req.user.role === 'admin') {
      return next();
    }
    return res.status(403).json({ error: 'Insufficient permissions' });
  };
}

/**
 * Ensure a :businessId route param matches the authenticated user's tenant.
 * Use on routes that take an explicit businessId to prevent cross-tenant access.
 */
function sameTenant(paramName = 'businessId') {
  return function tenantGuard(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (req.params[paramName] && req.params[paramName] !== req.user.businessId) {
      return res.status(403).json({ error: 'Cross-tenant access denied' });
    }
    return next();
  };
}

module.exports = { requireAuth, requireRole, sameTenant };
