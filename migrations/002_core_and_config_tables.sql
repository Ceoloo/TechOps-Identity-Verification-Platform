-- @UP
-- ---------------------------------------------------------------------------
-- 002: Core tenant tables + per-tenant configuration
-- ---------------------------------------------------------------------------
-- Multi-tenant root (`businesses`) plus internal users and the config tables
-- that make the platform a template: verification tiers, provider integrations,
-- versioned consent documents, and retention policies. Every tenant-owned row
-- carries `business_id` for isolation.
-- ---------------------------------------------------------------------------

-- --- businesses (tenant root) ----------------------------------------------
CREATE TABLE businesses (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  industry     TEXT,
  jurisdiction TEXT,
  -- branding config: { "logo_url": "...", "colors": { "primary": "#...", ... } }
  branding     JSONB NOT NULL DEFAULT '{}'::jsonb,
  status       TEXT NOT NULL DEFAULT 'active'
               CHECK (status IN ('active', 'suspended')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_businesses_status ON businesses (status);

CREATE TRIGGER trg_businesses_updated_at
  BEFORE UPDATE ON businesses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- --- users (internal: admin / reviewer) ------------------------------------
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   UUID NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  password_hash TEXT,
  role          TEXT NOT NULL CHECK (role IN ('admin', 'reviewer')),
  full_name     TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, email)
);

CREATE INDEX idx_users_business_id ON users (business_id);

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- --- verification_tiers -----------------------------------------------------
CREATE TABLE verification_tiers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     UUID NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  tier_name       TEXT NOT NULL,
  description     TEXT,
  -- required_checks: array of check specs consumed by the rules engine, e.g.
  --   [{ "check_type": "id_document", "provider": "stripe_identity", "required": true }, ...]
  required_checks JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- risk_thresholds: data-driven rules config, e.g.
  --   { "auto_approve": {...}, "auto_reject": {...}, "default": "manual_review" }
  risk_thresholds JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, tier_name)
);

CREATE INDEX idx_verification_tiers_business_id ON verification_tiers (business_id);
CREATE INDEX idx_verification_tiers_active ON verification_tiers (business_id, is_active);

CREATE TRIGGER trg_verification_tiers_updated_at
  BEFORE UPDATE ON verification_tiers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- --- provider_integrations (per-business provider config; Phase 2 reads this) -
-- Secrets (API keys) live encrypted in `config_encrypted` and are NEVER
-- returned to any API client. `config_meta` holds only non-secret metadata.
CREATE TABLE provider_integrations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id       UUID NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  provider          TEXT NOT NULL,
  is_active         BOOLEAN NOT NULL DEFAULT FALSE,
  mode              TEXT NOT NULL DEFAULT 'sandbox'
                    CHECK (mode IN ('sandbox', 'live')),
  -- AES-256-GCM envelope (base64) of the provider secret config; nullable until
  -- keys are entered. Never selected into API responses.
  config_encrypted  TEXT,
  -- Non-secret metadata: which fields are set, last rotation time, etc.
  config_meta       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, provider)
);

CREATE INDEX idx_provider_integrations_business_id ON provider_integrations (business_id);
CREATE INDEX idx_provider_integrations_active ON provider_integrations (business_id, is_active);

CREATE TRIGGER trg_provider_integrations_updated_at
  BEFORE UPDATE ON provider_integrations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- --- consent_documents (editable, versioned consent text) ------------------
-- The admin consent-language editor writes new versions here (Phase 5); the
-- public intake flow renders the active version (Phase 4). The exact text the
-- customer accepted is snapshotted into `consent_records` at consent time.
CREATE TABLE consent_documents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  version     INTEGER NOT NULL,
  body        TEXT NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT FALSE,
  created_by  UUID REFERENCES users (id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, version)
);

CREATE INDEX idx_consent_documents_business_id ON consent_documents (business_id);
-- At most one active consent document per business.
CREATE UNIQUE INDEX idx_consent_documents_one_active
  ON consent_documents (business_id)
  WHERE is_active;

-- --- retention_policies -----------------------------------------------------
CREATE TABLE retention_policies (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    UUID NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  data_type      TEXT NOT NULL,
  retention_days INTEGER NOT NULL CHECK (retention_days >= 0),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, data_type)
);

CREATE INDEX idx_retention_policies_business_id ON retention_policies (business_id);

CREATE TRIGGER trg_retention_policies_updated_at
  BEFORE UPDATE ON retention_policies
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- @DOWN
DROP TABLE IF EXISTS retention_policies;
DROP TABLE IF EXISTS consent_documents;
DROP TABLE IF EXISTS provider_integrations;
DROP TABLE IF EXISTS verification_tiers;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS businesses;
