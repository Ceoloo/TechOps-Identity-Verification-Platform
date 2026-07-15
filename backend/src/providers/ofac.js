'use strict';

/**
 * OFAC sanctions / PEP screening adapter.
 *
 * Screening is synchronous: `submit` performs the screen and returns the final
 * outcome; `getStatus` re-runs it (screens are idempotent for a given name).
 *
 * Live mode queries the U.S. government's free Consolidated Screening List
 * (CSL) API, which aggregates OFAC's SDN list with other federal screening
 * lists: https://developer.trade.gov/consolidated-screening-list.html
 * A free api.data.gov key goes in config.api_key. No key is required for
 * sandbox mode.
 *
 * A sanctions HIT is a `fail` (the rules engine typically maps any hit to
 * auto-reject). No match is a `pass`.
 */

const { VerificationProvider } = require('./base');
const { makeResult, errorResult } = require('./result');
const { httpRequest } = require('./http');
const { flatten } = require('./sandbox');

const CSL_API = 'https://api.trade.gov/consolidated_screening_list/search';

// Tiny fake denylist so sandbox mode can exercise a "hit" deterministically,
// in addition to the "sanction" keyword convention.
const SANDBOX_DENYLIST = ['john sanction', 'evil corp', 'blocked person'];

class OfacProvider extends VerificationProvider {
  static get key() {
    return 'ofac';
  }

  static get checkType() {
    return 'sanctions_screening';
  }

  _fullName(subjectData) {
    if (!subjectData) return '';
    if (subjectData.businessName) return String(subjectData.businessName);
    return [subjectData.firstName, subjectData.lastName]
      .filter(Boolean)
      .join(' ')
      .trim();
  }

  async submit(subjectData) {
    const checkType = OfacProvider.checkType;
    const name = this._fullName(subjectData);

    if (this.isSandbox) {
      const hay = flatten(subjectData);
      const denyHit = SANDBOX_DENYLIST.some((n) => hay.includes(n));
      const hit = denyHit || hay.includes('sanction');
      return makeResult({
        provider: OfacProvider.key,
        checkType,
        outcome: hit ? 'fail' : 'pass',
        score: hit ? 98 : 2,
        reference: null,
        raw: { sandbox: true, query: name, hits: hit ? 1 : 0 },
        meta: { mode: 'sandbox', matched: hit },
      });
    }

    if (!name) {
      return errorResult(OfacProvider.key, checkType, 'no name to screen');
    }
    try {
      const url = `${CSL_API}?name=${encodeURIComponent(name)}&fuzzy_name=true`;
      const headers = {};
      if (this.config.api_key) headers['subscription-key'] = this.config.api_key;
      const { status, json } = await httpRequest(url, {
        providerKey: OfacProvider.key,
        headers,
      });
      if (status >= 400) {
        return errorResult(OfacProvider.key, checkType, `http ${status}`);
      }
      const total = (json && json.total) || 0;
      const results = (json && json.results) || [];
      const hit = total > 0;
      return makeResult({
        provider: OfacProvider.key,
        checkType,
        outcome: hit ? 'fail' : 'pass',
        score: hit ? 98 : 2,
        reference: null,
        // Keep the raw screening detail (names/programs) for the audit trail;
        // it is encrypted at rest by the caller.
        raw: { total, results },
        meta: { mode: 'live', hits: total },
      });
    } catch (err) {
      return errorResult(OfacProvider.key, checkType, err.message);
    }
  }

  async getStatus(referenceId) {
    // Screening is synchronous; there is no async session to poll. We report
    // pending so a caller that only has a reference knows to re-submit.
    return makeResult({
      provider: OfacProvider.key,
      checkType: OfacProvider.checkType,
      outcome: 'pending',
      reference: referenceId,
      raw: { note: 'sanctions screening is synchronous; call submit()' },
      meta: { mode: this.mode },
    });
  }
}

module.exports = { OfacProvider };
