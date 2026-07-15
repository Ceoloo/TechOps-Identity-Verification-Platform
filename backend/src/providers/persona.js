'use strict';

/**
 * Persona adapter — alternative individual verification and business KYB.
 * Docs: https://docs.withpersona.com/
 *
 * Persona runs "inquiries" against a configured template. `submit` creates an
 * inquiry (returning its id as the reference); `getStatus` reads the inquiry
 * status. The same adapter serves individual and business checks — the
 * `subject_type`/template determines which, so `checkType` is reported as
 * 'identity_kyb' generically and refined via meta.
 */

const { VerificationProvider } = require('./base');
const { makeResult, errorResult } = require('./result');
const { httpRequest } = require('./http');
const { sandboxReference, deriveOutcome } = require('./sandbox');

const API_BASE = 'https://api.withpersona.com/api/v1';

function mapPersonaStatus(status) {
  // Persona inquiry status: created | pending | completed | approved | declined | ...
  switch (status) {
    case 'approved':
    case 'completed':
      return { outcome: 'pass', score: 8 };
    case 'declined':
    case 'failed':
      return { outcome: 'fail', score: 85 };
    case 'needs_review':
    case 'marked_for_review':
      return { outcome: 'manual_review', score: 55 };
    case 'created':
    case 'pending':
    case 'expired':
      return { outcome: 'pending', score: null };
    default:
      return { outcome: 'manual_review', score: 50 };
  }
}

class PersonaProvider extends VerificationProvider {
  static get key() {
    return 'persona';
  }

  static get checkType() {
    return 'identity_kyb';
  }

  async submit(subjectData) {
    const checkType = PersonaProvider.checkType;
    if (this.isSandbox) {
      const { outcome, score } = deriveOutcome(subjectData);
      return makeResult({
        provider: PersonaProvider.key,
        checkType,
        outcome,
        score,
        reference: sandboxReference('inq', JSON.stringify(subjectData)),
        raw: { sandbox: true, status: outcome === 'pass' ? 'approved' : 'needs_review' },
        meta: { mode: 'sandbox', subject_type: subjectData && subjectData.subjectType },
      });
    }

    const apiKey = this.config.api_key;
    const templateId = this.config.template_id;
    if (!apiKey || !templateId) {
      return errorResult(
        PersonaProvider.key,
        checkType,
        'missing api_key or template_id in provider config'
      );
    }
    try {
      const { status, json } = await httpRequest(`${API_BASE}/inquiries`, {
        method: 'POST',
        providerKey: PersonaProvider.key,
        headers: {
          authorization: `Bearer ${apiKey}`,
          'persona-version': '2023-01-05',
        },
        body: { data: { attributes: { 'inquiry-template-id': templateId } } },
      });
      if (status >= 400) {
        return errorResult(PersonaProvider.key, checkType, `http ${status}`);
      }
      const id = json && json.data && json.data.id;
      return makeResult({
        provider: PersonaProvider.key,
        checkType,
        outcome: 'pending',
        reference: id,
        raw: json,
        meta: { mode: 'live' },
      });
    } catch (err) {
      return errorResult(PersonaProvider.key, checkType, err.message);
    }
  }

  async getStatus(referenceId) {
    const checkType = PersonaProvider.checkType;
    if (this.isSandbox) {
      return makeResult({
        provider: PersonaProvider.key,
        checkType,
        outcome: 'pass',
        score: 8,
        reference: referenceId,
        raw: { sandbox: true, status: 'approved' },
        meta: { mode: 'sandbox' },
      });
    }
    const apiKey = this.config.api_key;
    if (!apiKey) {
      return errorResult(PersonaProvider.key, checkType, 'missing api_key');
    }
    try {
      const { status, json } = await httpRequest(
        `${API_BASE}/inquiries/${encodeURIComponent(referenceId)}`,
        {
          providerKey: PersonaProvider.key,
          headers: {
            authorization: `Bearer ${apiKey}`,
            'persona-version': '2023-01-05',
          },
        }
      );
      if (status >= 400) {
        return errorResult(PersonaProvider.key, checkType, `http ${status}`);
      }
      const personaStatus =
        json && json.data && json.data.attributes && json.data.attributes.status;
      const { outcome, score } = mapPersonaStatus(personaStatus);
      return makeResult({
        provider: PersonaProvider.key,
        checkType,
        outcome,
        score,
        reference: referenceId,
        raw: json,
        meta: { mode: 'live', status: personaStatus },
      });
    } catch (err) {
      return errorResult(PersonaProvider.key, checkType, err.message);
    }
  }
}

module.exports = { PersonaProvider };
