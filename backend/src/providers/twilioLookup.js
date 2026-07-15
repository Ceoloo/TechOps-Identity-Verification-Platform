'use strict';

/**
 * Twilio Lookup adapter — phone number validation.
 * Docs: https://www.twilio.com/docs/lookup/v2-api
 *
 * Synchronous: `submit` validates the phone number and reports validity.
 * `getStatus` re-runs it. Live mode uses Basic auth with the business's
 * account_sid + auth_token from config.
 */

const { VerificationProvider } = require('./base');
const { makeResult, errorResult } = require('./result');
const { httpRequest } = require('./http');

const LOOKUP_BASE = 'https://lookups.twilio.com/v2/PhoneNumbers';

class TwilioLookupProvider extends VerificationProvider {
  static get key() {
    return 'twilio_lookup';
  }

  static get checkType() {
    return 'phone';
  }

  async submit(subjectData) {
    const checkType = TwilioLookupProvider.checkType;
    const phone = subjectData && subjectData.phone;

    if (this.isSandbox) {
      // Deterministic: valid unless it contains "fail" or is too short.
      const digits = String(phone || '').replace(/[^\d]/g, '');
      const valid = digits.length >= 10 && !String(phone).toLowerCase().includes('fail');
      return makeResult({
        provider: TwilioLookupProvider.key,
        checkType,
        outcome: valid ? 'pass' : 'fail',
        score: valid ? 10 : 70,
        raw: { sandbox: true, valid, national_format: valid ? phone : null },
        meta: { mode: 'sandbox' },
      });
    }

    if (!phone) {
      return errorResult(TwilioLookupProvider.key, checkType, 'no phone provided');
    }
    const sid = this.config.account_sid;
    const token = this.config.auth_token;
    if (!sid || !token) {
      return errorResult(
        TwilioLookupProvider.key,
        checkType,
        'missing account_sid or auth_token in provider config'
      );
    }
    try {
      const auth = Buffer.from(`${sid}:${token}`).toString('base64');
      const { status, json } = await httpRequest(
        `${LOOKUP_BASE}/${encodeURIComponent(phone)}`,
        {
          providerKey: TwilioLookupProvider.key,
          headers: { authorization: `Basic ${auth}` },
        }
      );
      if (status === 404) {
        return makeResult({
          provider: TwilioLookupProvider.key,
          checkType,
          outcome: 'fail',
          score: 70,
          raw: { valid: false },
          meta: { mode: 'live' },
        });
      }
      if (status >= 400) {
        return errorResult(TwilioLookupProvider.key, checkType, `http ${status}`);
      }
      const valid = json && json.valid === true;
      return makeResult({
        provider: TwilioLookupProvider.key,
        checkType,
        outcome: valid ? 'pass' : 'fail',
        score: valid ? 10 : 70,
        raw: json,
        meta: { mode: 'live', valid },
      });
    } catch (err) {
      return errorResult(TwilioLookupProvider.key, checkType, err.message);
    }
  }

  async getStatus(referenceId) {
    return makeResult({
      provider: TwilioLookupProvider.key,
      checkType: TwilioLookupProvider.checkType,
      outcome: 'pending',
      reference: referenceId,
      raw: { note: 'phone lookup is synchronous; call submit()' },
      meta: { mode: this.mode },
    });
  }
}

module.exports = { TwilioLookupProvider };
