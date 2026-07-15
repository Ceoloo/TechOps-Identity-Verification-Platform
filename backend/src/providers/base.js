'use strict';

/**
 * VerificationProvider — the pluggable adapter interface.
 *
 * Every provider adapter extends this class and implements `submit` and
 * `getStatus`. Adapters are constructed with the *decrypted, per-business*
 * config (never global env vars) plus a mode flag, so different tenants can use
 * different providers and keys. See docs/README.md → "Adding a new verification
 * provider adapter".
 */

class VerificationProvider {
  /**
   * @param {Object} config decrypted per-business secret config (may be {})
   * @param {Object} [options]
   * @param {('sandbox'|'live')} [options.mode='sandbox']
   */
  constructor(config = {}, options = {}) {
    this.config = config || {};
    this.mode = options.mode === 'live' ? 'live' : 'sandbox';
  }

  /** Stable provider key, e.g. 'stripe_identity'. Overridden by subclasses. */
  static get key() {
    throw new Error('Provider subclass must define static get key()');
  }

  /** The check type this adapter produces, e.g. 'id_document'. */
  static get checkType() {
    throw new Error('Provider subclass must define static get checkType()');
  }

  get isSandbox() {
    return this.mode === 'sandbox';
  }

  /**
   * Submit subject data for verification.
   * @param {Object} _subjectData
   * @returns {Promise<import('./result').CheckResult>}
   */
  // eslint-disable-next-line no-unused-vars
  async submit(_subjectData) {
    throw new Error(`${this.constructor.name}.submit() not implemented`);
  }

  /**
   * Poll the status of a previously submitted verification.
   * @param {string} _referenceId
   * @returns {Promise<import('./result').CheckResult>}
   */
  // eslint-disable-next-line no-unused-vars
  async getStatus(_referenceId) {
    throw new Error(`${this.constructor.name}.getStatus() not implemented`);
  }
}

module.exports = { VerificationProvider };
