'use strict';

/**
 * Email OTP adapter — a simple email one-time-passcode flow.
 *
 * Unlike the other adapters this one is interactive:
 *   - `submit(subjectData)` generates a 6-digit code, "sends" it to the
 *     subject's email, and returns a `pending` result with a reference id.
 *   - `verify(referenceId, code)` checks the submitted code.
 *   - `getStatus(referenceId)` reports the current challenge state.
 *
 * The code is never stored in plaintext — only a salted SHA-256 hash is kept,
 * with an expiry and a max-attempt counter.
 *
 * Challenge state is kept in an injectable `store` (default: in-memory Map).
 * For production/multi-instance deployments, inject a shared store (Redis or a
 * DB-backed table) so challenges survive restarts and are visible across nodes.
 */

const crypto = require('crypto');
const { VerificationProvider } = require('./base');
const { makeResult, errorResult } = require('./result');

const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ATTEMPTS = 5;

// Module-level fallback store (in-memory). Sufficient for local/sandbox use.
const defaultStore = new Map();

function hashCode(code, salt) {
  return crypto.createHash('sha256').update(`${salt}:${code}`).digest('hex');
}

class EmailOtpProvider extends VerificationProvider {
  /**
   * @param {Object} config per-business config (optional smtp/from settings)
   * @param {Object} options
   * @param {('sandbox'|'live')} [options.mode]
   * @param {Map|Object} [options.store] challenge store (get/set/delete)
   * @param {(to: string, code: string) => Promise<void>} [options.sendEmail]
   */
  constructor(config = {}, options = {}) {
    super(config, options);
    this.store = options.store || defaultStore;
    this.sendEmail = options.sendEmail || null;
    this.ttlMs = options.ttlMs || DEFAULT_TTL_MS;
  }

  static get key() {
    return 'email_otp';
  }

  static get checkType() {
    return 'email_otp';
  }

  async _storeSet(ref, value) {
    if (this.store instanceof Map) this.store.set(ref, value);
    else await this.store.set(ref, value);
  }

  async _storeGet(ref) {
    if (this.store instanceof Map) return this.store.get(ref);
    return this.store.get(ref);
  }

  async _storeDelete(ref) {
    if (this.store instanceof Map) this.store.delete(ref);
    else await this.store.delete(ref);
  }

  async submit(subjectData) {
    const checkType = EmailOtpProvider.checkType;
    const email = subjectData && subjectData.email;
    if (!email) {
      return errorResult(EmailOtpProvider.key, checkType, 'no email provided');
    }

    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const salt = crypto.randomBytes(8).toString('hex');
    const reference = `otp_${crypto.randomBytes(12).toString('hex')}`;
    await this._storeSet(reference, {
      hash: hashCode(code, salt),
      salt,
      expiresAt: Date.now() + this.ttlMs,
      attempts: 0,
      verified: false,
      // NB: email retained only to correlate; encrypt if persisted to a DB.
      email,
    });

    const meta = { mode: this.mode, sent: false };
    if (this.isSandbox) {
      // Surface the code for local/testing convenience only.
      meta.sent = true;
      meta.sandbox_code = code;
    } else if (this.sendEmail) {
      try {
        await this.sendEmail(email, code);
        meta.sent = true;
      } catch (err) {
        return errorResult(EmailOtpProvider.key, checkType, `send failed: ${err.message}`);
      }
    } else {
      return errorResult(
        EmailOtpProvider.key,
        checkType,
        'no sendEmail transport configured for live mode'
      );
    }

    return makeResult({
      provider: EmailOtpProvider.key,
      checkType,
      outcome: 'pending',
      reference,
      raw: { sent: meta.sent },
      meta,
    });
  }

  /**
   * Verify a submitted code against the stored challenge.
   * @param {string} referenceId
   * @param {string} code
   */
  async verify(referenceId, code) {
    const checkType = EmailOtpProvider.checkType;
    const rec = await this._storeGet(referenceId);
    if (!rec) {
      return errorResult(EmailOtpProvider.key, checkType, 'unknown or expired challenge');
    }
    if (Date.now() > rec.expiresAt) {
      await this._storeDelete(referenceId);
      return makeResult({
        provider: EmailOtpProvider.key,
        checkType,
        outcome: 'fail',
        score: 60,
        reference: referenceId,
        raw: { reason: 'expired' },
        meta: { mode: this.mode, expired: true },
      });
    }
    if (rec.attempts >= MAX_ATTEMPTS) {
      await this._storeDelete(referenceId);
      return makeResult({
        provider: EmailOtpProvider.key,
        checkType,
        outcome: 'fail',
        score: 75,
        reference: referenceId,
        raw: { reason: 'too_many_attempts' },
        meta: { mode: this.mode, locked: true },
      });
    }

    rec.attempts += 1;
    const ok = crypto.timingSafeEqual(
      Buffer.from(rec.hash, 'hex'),
      Buffer.from(hashCode(String(code), rec.salt), 'hex')
    );
    if (ok) {
      rec.verified = true;
      await this._storeSet(referenceId, rec);
      return makeResult({
        provider: EmailOtpProvider.key,
        checkType,
        outcome: 'pass',
        score: 5,
        reference: referenceId,
        raw: { verified: true },
        meta: { mode: this.mode },
      });
    }
    await this._storeSet(referenceId, rec);
    return makeResult({
      provider: EmailOtpProvider.key,
      checkType,
      outcome: 'fail',
      score: 65,
      reference: referenceId,
      raw: { verified: false, attempts: rec.attempts },
      meta: { mode: this.mode, remaining_attempts: MAX_ATTEMPTS - rec.attempts },
    });
  }

  async getStatus(referenceId) {
    const checkType = EmailOtpProvider.checkType;
    const rec = await this._storeGet(referenceId);
    if (!rec) {
      return makeResult({
        provider: EmailOtpProvider.key,
        checkType,
        outcome: 'error',
        reference: referenceId,
        raw: { reason: 'unknown or expired challenge' },
        meta: { mode: this.mode },
      });
    }
    const expired = Date.now() > rec.expiresAt;
    let outcome = 'pending';
    if (rec.verified) outcome = 'pass';
    else if (expired) outcome = 'fail';
    return makeResult({
      provider: EmailOtpProvider.key,
      checkType,
      outcome,
      reference: referenceId,
      raw: { verified: rec.verified, expired },
      meta: { mode: this.mode },
    });
  }
}

module.exports = { EmailOtpProvider, defaultStore };
