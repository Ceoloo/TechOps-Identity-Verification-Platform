'use strict';

/**
 * Subject PII service.
 *
 * The only place that writes/reads the encrypted `pii.subjects` payload. Every
 * read/write is logged to audit_log (security requirement: all access to PII
 * tables is recorded). PII is encrypted with an AAD bound to the owning
 * business so a blob cannot be replayed under another tenant.
 */

const enc = require('../crypto/encryption');
const { lookupHash } = require('../crypto/hash');
const { writeAudit } = require('../audit/log');

function aadFor(businessId) {
  return `business:${businessId}`;
}

/**
 * Create a subject with encrypted PII. Runs inside the caller's transaction.
 * @param {import('pg').PoolClient} client
 * @param {Object} params
 * @param {string} params.businessId
 * @param {Object} params.pii            arbitrary PII object (name, dob, ...)
 * @param {string} [params.lookupValue]  value to derive the lookup hash from (e.g. email)
 * @param {string} [params.externalRef]
 * @param {string} [params.actor='public-intake']
 * @param {string} [params.ipAddress]
 * @returns {Promise<{ id: string }>}
 */
async function createSubject(client, params) {
  const {
    businessId,
    pii,
    lookupValue,
    externalRef = null,
    actor = 'public-intake',
    ipAddress = null,
  } = params;

  const ciphertext = enc.encryptJson(pii || {}, aadFor(businessId));
  const hash = lookupValue ? lookupHash(lookupValue) : null;

  const { rows } = await client.query(
    `INSERT INTO pii.subjects (business_id, external_ref, lookup_hash, pii_encrypted)
     VALUES ($1,$2,$3,$4) RETURNING id`,
    [businessId, externalRef, hash, ciphertext]
  );
  const id = rows[0].id;

  await writeAudit(
    {
      businessId,
      actor,
      action: 'pii.write',
      targetType: 'subject',
      targetId: id,
      ipAddress,
      metadata: { fields: Object.keys(pii || {}) }, // field NAMES only, no values
    },
    client
  );

  return { id };
}

/**
 * Read + decrypt a subject's PII, logging the access.
 * @param {import('pg').PoolClient|Object} runner
 * @param {Object} params { businessId, subjectId, actor, actorUserId, ipAddress, reason }
 * @returns {Promise<Object|null>} decrypted PII or null if not found
 */
async function readSubjectPII(runner, params) {
  const {
    businessId,
    subjectId,
    actor,
    actorUserId = null,
    ipAddress = null,
    reason = null,
  } = params;

  const { rows } = await runner.query(
    'SELECT pii_encrypted FROM pii.subjects WHERE id=$1 AND business_id=$2',
    [subjectId, businessId]
  );
  if (rows.length === 0) return null;

  const pii = enc.decryptJson(rows[0].pii_encrypted, aadFor(businessId));

  await writeAudit(
    {
      businessId,
      actor: actor || 'system',
      actorUserId,
      action: 'pii.read',
      targetType: 'subject',
      targetId: subjectId,
      ipAddress,
      metadata: reason ? { reason } : {},
    },
    runner
  );

  return pii;
}

module.exports = { createSubject, readSubjectPII, aadFor };
