'use strict';

/**
 * Stripe Identity adapter — individual ID document + liveness/selfie check.
 * Docs: https://stripe.com/docs/identity
 *
 * Live mode creates a VerificationSession and reads its status. Because Stripe
 * Identity is inherently asynchronous (the subject completes a hosted flow),
 * `submit` returns a `pending` result plus a reference; `getStatus` resolves the
 * final outcome. Sandbox mode returns a deterministic completed result.
 */

const { VerificationProvider } = require('./base');
const { makeResult, errorResult } = require('./result');
const { httpRequest } = require('./http');
const { sandboxReference, deriveOutcome } = require('./sandbox');

const API_BASE = 'https://api.stripe.com/v1';

function mapStripeStatus(session) {
  // Stripe: status in requires_input | processing | verified | canceled
  if (session.status === 'verified') return { outcome: 'pass', score: 5 };
  if (session.status === 'processing') return { outcome: 'pending', score: null };
  if (session.status === 'requires_input') {
    // last_error present -> failed a check; otherwise awaiting the subject.
    return session.last_error
      ? { outcome: 'manual_review', score: 60 }
      : { outcome: 'pending', score: null };
  }
  if (session.status === 'canceled') return { outcome: 'fail', score: 90 };
  return { outcome: 'manual_review', score: 50 };
}

class StripeIdentityProvider extends VerificationProvider {
  static get key() {
    return 'stripe_identity';
  }

  static get checkType() {
    return 'id_document';
  }

  async submit(subjectData) {
    const checkType = StripeIdentityProvider.checkType;
    if (this.isSandbox) {
      const { outcome, score } = deriveOutcome(subjectData);
      const reference = sandboxReference('vs', JSON.stringify(subjectData));
      // In sandbox we return the resolved outcome directly for convenience.
      return makeResult({
        provider: StripeIdentityProvider.key,
        checkType,
        outcome,
        score,
        reference,
        raw: { sandbox: true, status: outcome === 'pass' ? 'verified' : 'requires_input' },
        meta: { mode: 'sandbox' },
      });
    }

    const secret = this.config.secret_key;
    if (!secret) {
      return errorResult(
        StripeIdentityProvider.key,
        checkType,
        'missing secret_key in provider config'
      );
    }
    try {
      const { status, json } = await httpRequest(
        `${API_BASE}/identity/verification_sessions`,
        {
          method: 'POST',
          providerKey: StripeIdentityProvider.key,
          headers: {
            authorization: `Bearer ${secret}`,
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: 'type=document',
        }
      );
      if (status >= 400) {
        return errorResult(StripeIdentityProvider.key, checkType, `http ${status}`);
      }
      return makeResult({
        provider: StripeIdentityProvider.key,
        checkType,
        outcome: 'pending',
        reference: json.id,
        raw: json,
        meta: { mode: 'live', client_secret_present: Boolean(json.client_secret) },
      });
    } catch (err) {
      return errorResult(StripeIdentityProvider.key, checkType, err.message);
    }
  }

  async getStatus(referenceId) {
    const checkType = StripeIdentityProvider.checkType;
    if (this.isSandbox) {
      // Sandbox references encode nothing; treat as verified unless caller
      // stored otherwise. Return pass for determinism.
      return makeResult({
        provider: StripeIdentityProvider.key,
        checkType,
        outcome: 'pass',
        score: 5,
        reference: referenceId,
        raw: { sandbox: true, status: 'verified' },
        meta: { mode: 'sandbox' },
      });
    }
    const secret = this.config.secret_key;
    if (!secret) {
      return errorResult(StripeIdentityProvider.key, checkType, 'missing secret_key');
    }
    try {
      const { status, json } = await httpRequest(
        `${API_BASE}/identity/verification_sessions/${encodeURIComponent(referenceId)}`,
        {
          providerKey: StripeIdentityProvider.key,
          headers: { authorization: `Bearer ${secret}` },
        }
      );
      if (status >= 400) {
        return errorResult(StripeIdentityProvider.key, checkType, `http ${status}`);
      }
      const { outcome, score } = mapStripeStatus(json);
      return makeResult({
        provider: StripeIdentityProvider.key,
        checkType,
        outcome,
        score,
        reference: referenceId,
        raw: json,
        meta: { mode: 'live', status: json.status },
      });
    } catch (err) {
      return errorResult(StripeIdentityProvider.key, checkType, err.message);
    }
  }
}

module.exports = { StripeIdentityProvider };
