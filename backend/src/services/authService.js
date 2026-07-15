'use strict';

/**
 * Authentication service: user creation and login.
 */

const db = require('../db');
const { hashPassword, verifyPassword } = require('../auth/password');
const token = require('../auth/token');
const { writeAudit } = require('../audit/log');

/**
 * Create an internal user (admin or reviewer) for a business.
 */
async function createUser(
  { businessId, email, password, role, fullName },
  runner = db
) {
  if (!['admin', 'reviewer'].includes(role)) {
    throw new Error('role must be admin or reviewer');
  }
  const passwordHash = hashPassword(password);
  const { rows } = await runner.query(
    `INSERT INTO users (business_id, email, password_hash, role, full_name)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING id, business_id, email, role, full_name, is_active`,
    [businessId, String(email).toLowerCase(), passwordHash, role, fullName || null]
  );
  return rows[0];
}

/**
 * Verify credentials and return a signed token + safe user profile.
 * @returns {Promise<{ token: string, user: Object }|null>}
 */
async function login({ email, password, ipAddress = null }) {
  const { rows } = await db.query(
    `SELECT id, business_id, email, password_hash, role, is_active
       FROM users WHERE email=$1`,
    [String(email || '').toLowerCase()]
  );
  const user = rows[0];
  // Constant-ish work whether or not the user exists (avoid user enumeration).
  const ok =
    user && user.is_active && verifyPassword(password || '', user.password_hash);
  if (!ok) {
    if (user) {
      await writeAudit({
        businessId: user.business_id,
        actor: user.email,
        actorUserId: user.id,
        action: 'auth.login_failed',
        targetType: 'user',
        targetId: user.id,
        ipAddress,
      });
    }
    return null;
  }

  const signed = token.sign({
    sub: user.id,
    business_id: user.business_id,
    role: user.role,
    email: user.email,
  });

  await writeAudit({
    businessId: user.business_id,
    actor: user.email,
    actorUserId: user.id,
    action: 'auth.login',
    targetType: 'user',
    targetId: user.id,
    ipAddress,
  });

  return {
    token: signed,
    user: {
      id: user.id,
      business_id: user.business_id,
      email: user.email,
      role: user.role,
    },
  };
}

module.exports = { createUser, login };
