'use strict';

/**
 * OpenCorporates adapter — business registry lookup (KYB).
 * Docs: https://api.opencorporates.com/documentation/API-Reference
 *
 * Synchronous lookup: `submit` searches the registry for the business and
 * reports whether an active matching company exists. `getStatus` re-runs it.
 * Live mode reads an optional api_token from config (higher rate limits).
 */

const { VerificationProvider } = require('./base');
const { makeResult, errorResult } = require('./result');
const { httpRequest } = require('./http');
const { flatten } = require('./sandbox');

const API_BASE = 'https://api.opencorporates.com/v0.4';

class OpenCorporatesProvider extends VerificationProvider {
  static get key() {
    return 'opencorporates';
  }

  static get checkType() {
    return 'business_registry';
  }

  async submit(subjectData) {
    const checkType = OpenCorporatesProvider.checkType;
    const businessName = subjectData && subjectData.businessName;

    if (this.isSandbox) {
      const hay = flatten(subjectData);
      let outcome = 'pass';
      let score = 10;
      if (hay.includes('fail') || hay.includes('dissolved')) {
        outcome = 'fail';
        score = 80;
      } else if (hay.includes('review') || !businessName) {
        outcome = 'manual_review';
        score = 50;
      }
      return makeResult({
        provider: OpenCorporatesProvider.key,
        checkType,
        outcome,
        score,
        raw: {
          sandbox: true,
          query: businessName || null,
          company: outcome === 'pass'
            ? { name: businessName, current_status: 'Active' }
            : null,
        },
        meta: { mode: 'sandbox' },
      });
    }

    if (!businessName) {
      return errorResult(
        OpenCorporatesProvider.key,
        checkType,
        'no businessName to look up'
      );
    }
    try {
      const params = new URLSearchParams({ q: businessName });
      if (subjectData.jurisdiction) {
        params.set('jurisdiction_code', String(subjectData.jurisdiction).toLowerCase());
      }
      if (this.config.api_token) params.set('api_token', this.config.api_token);
      const { status, json } = await httpRequest(
        `${API_BASE}/companies/search?${params.toString()}`,
        { providerKey: OpenCorporatesProvider.key }
      );
      if (status >= 400) {
        return errorResult(OpenCorporatesProvider.key, checkType, `http ${status}`);
      }
      const companies =
        (json && json.results && json.results.companies) || [];
      if (companies.length === 0) {
        return makeResult({
          provider: OpenCorporatesProvider.key,
          checkType,
          outcome: 'fail',
          score: 75,
          raw: { total: 0 },
          meta: { mode: 'live', matches: 0 },
        });
      }
      const top = companies[0].company || {};
      const inactive = top.inactive === true;
      return makeResult({
        provider: OpenCorporatesProvider.key,
        checkType,
        outcome: inactive ? 'manual_review' : 'pass',
        score: inactive ? 55 : 12,
        reference: top.company_number || null,
        raw: { total: companies.length, top },
        meta: { mode: 'live', matches: companies.length, inactive },
      });
    } catch (err) {
      return errorResult(OpenCorporatesProvider.key, checkType, err.message);
    }
  }

  async getStatus(referenceId) {
    return makeResult({
      provider: OpenCorporatesProvider.key,
      checkType: OpenCorporatesProvider.checkType,
      outcome: 'pending',
      reference: referenceId,
      raw: { note: 'registry lookup is synchronous; call submit()' },
      meta: { mode: this.mode },
    });
  }
}

module.exports = { OpenCorporatesProvider };
