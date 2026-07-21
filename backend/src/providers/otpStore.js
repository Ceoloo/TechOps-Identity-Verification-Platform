'use strict';

/**
 * Durable, cross-instance store for email OTP challenges.
 *
 * Implements the get/set/delete interface the EmailOtpProvider expects, backed
 * by the `email_otp_challenges` table. The challenge object (code hash, salt,
 * attempts, subject email) is encrypted as a single envelope bound by AAD to
 * its reference, so nothing sensitive is stored in plaintext.
 */

const db = require('../db');
const enc = require('../crypto/encryption');

function aadFor(reference) {
  return `otp:${reference}`;
}

class DbOtpStore {
  /**
   * @param {Object} [opts]
   * @param {string|null} [opts.businessId] tenant that owns the challenge
   * @param {Object} [opts.runner] pool or txn client
   */
  constructor({ businessId = null, runner = db } = {}) {
    this.businessId = businessId;
    this.db = runner;
  }

  async set(reference, value) {
    const payload = enc.encryptJson(value, aadFor(reference));
    const expiresAt = new Date(value && value.expiresAt ? value.expiresAt : Date.now());
    await this.db.query(
      `INSERT INTO email_otp_challenges (reference, business_id, payload_encrypted, expires_at)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (reference) DO UPDATE
         SET payload_encrypted = EXCLUDED.payload_encrypted,
             expires_at = EXCLUDED.expires_at`,
      [reference, this.businessId, payload, expiresAt]
    );
  }

  async get(reference) {
    const { rows } = await this.db.query(
      'SELECT payload_encrypted FROM email_otp_challenges WHERE reference=$1',
      [reference]
    );
    if (rows.length === 0) return undefined;
    return enc.decryptJson(rows[0].payload_encrypted, aadFor(reference));
  }

  async delete(reference) {
    await this.db.query('DELETE FROM email_otp_challenges WHERE reference=$1', [reference]);
  }

  /** Housekeeping: remove expired challenges. Returns the number deleted. */
  static async deleteExpired(runner = db) {
    const res = await runner.query(
      'DELETE FROM email_otp_challenges WHERE expires_at < now()'
    );
    return res.rowCount || 0;
  }
}

module.exports = { DbOtpStore };
