'use strict';

/**
 * Development seed data.
 *
 * Creates one demo tenant ("Acme Financial") fully configured through the
 * data model — tiers, consent document, provider integrations (with encrypted
 * secrets), retention policies, and two internal users — to demonstrate the
 * config-driven / multi-tenant design and give later phases something to run
 * against. Idempotent: re-running upserts the same demo business by name.
 *
 * Usage: node src/db/seed.js
 */

const { withTransaction, close } = require('./index');
const enc = require('../crypto/encryption');
const { hashPassword } = require('../auth/password');

async function seed() {
  await withTransaction(async (c) => {
    // Upsert the demo business by name (no unique constraint on name, so look
    // it up first and only insert when absent — keeps the seed idempotent).
    const { rows: existing } = await c.query(
      'SELECT id FROM businesses WHERE name=$1 LIMIT 1',
      ['Acme Financial']
    );

    let businessId;
    if (existing.length) {
      businessId = existing[0].id;
    } else {
      const { rows } = await c.query(
        `INSERT INTO businesses (name, industry, jurisdiction, branding)
         VALUES ($1,$2,$3,$4)
         RETURNING id`,
        [
          'Acme Financial',
          'fintech',
          'US-DE',
          {
            logo_url: 'https://example.com/acme-logo.svg',
            colors: { primary: '#1f6feb', accent: '#0abf53' },
          },
        ]
      );
      businessId = rows[0].id;
    }
    const aad = `business:${businessId}`;

    // Internal users: one admin, one reviewer (dev password: "password123").
    const devPasswordHash = hashPassword('password123');
    await c.query(
      `INSERT INTO users (business_id, email, password_hash, role, full_name)
       VALUES ($1,'admin@acme.example',$2,'admin','Acme Admin'),
              ($1,'reviewer@acme.example',$2,'reviewer','Acme Reviewer')
       ON CONFLICT (business_id, email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
      [businessId, devPasswordHash]
    );

    // A verification tier: data-driven required checks + thresholds.
    await c.query(
      `INSERT INTO verification_tiers (business_id, tier_name, description, required_checks, risk_thresholds)
       VALUES ($1,'standard-individual','Standard individual KYC',$2,$3)
       ON CONFLICT (business_id, tier_name) DO UPDATE
         SET required_checks = EXCLUDED.required_checks,
             risk_thresholds = EXCLUDED.risk_thresholds`,
      [
        businessId,
        JSON.stringify([
          { check_type: 'id_document', provider: 'stripe_identity', required: true },
          { check_type: 'liveness', provider: 'stripe_identity', required: true },
          { check_type: 'sanctions_screening', provider: 'ofac', required: true },
          { check_type: 'phone', provider: 'twilio_lookup', required: false },
        ]),
        JSON.stringify({
          auto_approve: { all_required_pass: true, max_risk_score: 30 },
          auto_reject: { any_sanctions_hit: true, min_risk_score: 80 },
          default: 'manual_review',
        }),
      ]
    );

    // Active consent document (version 1).
    await c.query(
      `INSERT INTO consent_documents (business_id, version, body, is_active)
       VALUES ($1,1,$2,TRUE)
       ON CONFLICT (business_id, version) DO NOTHING`,
      [
        businessId,
        'I consent to Acme Financial verifying my identity using licensed ' +
          'third-party verification providers for the purpose of account opening ' +
          'and regulatory compliance.',
      ]
    );

    // Provider integrations with encrypted (sandbox) secrets. Secrets live only
    // in config_encrypted; config_meta records non-secret metadata.
    const integrations = [
      ['stripe_identity', { secret_key: 'sk_test_stripe_demo' }],
      ['ofac', {}], // OFAC is a free public API; no secret required.
      ['twilio_lookup', { account_sid: 'AC_demo', auth_token: 'demo_token' }],
    ];
    for (const [provider, secret] of integrations) {
      await c.query(
        `INSERT INTO provider_integrations
           (business_id, provider, is_active, mode, config_encrypted, config_meta)
         VALUES ($1,$2,TRUE,'sandbox',$3,$4)
         ON CONFLICT (business_id, provider) DO UPDATE
           SET config_encrypted = EXCLUDED.config_encrypted,
               config_meta = EXCLUDED.config_meta,
               is_active = TRUE`,
        [
          businessId,
          provider,
          Object.keys(secret).length ? enc.encryptJson(secret, aad) : null,
          JSON.stringify({ fields_set: Object.keys(secret) }),
        ]
      );
    }

    // Retention policies.
    const policies = [
      ['verification_checks', 365],
      ['consent_records', 2555], // ~7 years
    ];
    for (const [dataType, days] of policies) {
      await c.query(
        `INSERT INTO retention_policies (business_id, data_type, retention_days)
         VALUES ($1,$2,$3)
         ON CONFLICT (business_id, data_type) DO UPDATE
           SET retention_days = EXCLUDED.retention_days`,
        [businessId, dataType, days]
      );
    }

    // Audit the seed action itself.
    await c.query(
      `INSERT INTO audit_log (business_id, actor, action, target_type, target_id, metadata)
       VALUES ($1,'system','seed.run','business',$2,$3)`,
      [businessId, businessId, JSON.stringify({ note: 'demo seed applied' })]
    );

    // eslint-disable-next-line no-console
    console.log(`[seed] demo business ready: ${businessId}`);
  });
}

if (require.main === module) {
  seed()
    .then(() => close())
    .catch(async (err) => {
      // eslint-disable-next-line no-console
      console.error(`[seed] failed: ${err.message}`);
      await close();
      process.exitCode = 1;
    });
}

module.exports = { seed };
