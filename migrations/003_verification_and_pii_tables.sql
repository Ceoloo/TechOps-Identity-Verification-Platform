-- @UP
-- ---------------------------------------------------------------------------
-- 003: Subject PII (isolated schema) + verification flow tables
-- ---------------------------------------------------------------------------
-- `pii.subjects` holds encrypted subject PII in a schema separate from
-- operational data. Verification-flow tables reference subjects by id and keep
-- only encrypted raw provider payloads. All tenant-owned rows carry business_id.
-- ---------------------------------------------------------------------------

-- --- pii.subjects (isolated, encrypted PII) --------------------------------
CREATE TABLE pii.subjects (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   UUID NOT NULL REFERENCES public.businesses (id) ON DELETE CASCADE,
  -- Optional business-supplied correlation id (their own customer id).
  external_ref  TEXT,
  -- Keyed hash (e.g. HMAC of a normalised email) enabling data-subject lookup
  -- without storing the identifier in plaintext. Populated by the app layer.
  lookup_hash   TEXT,
  -- AES-256-GCM envelope (base64) of the subject PII payload
  -- (name, dob, address, email, phone, ...). Never returned raw to customers.
  pii_encrypted TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pii_subjects_business_id ON pii.subjects (business_id);
CREATE INDEX idx_pii_subjects_lookup ON pii.subjects (business_id, lookup_hash);
CREATE INDEX idx_pii_subjects_external_ref ON pii.subjects (business_id, external_ref);

CREATE TRIGGER trg_pii_subjects_updated_at
  BEFORE UPDATE ON pii.subjects
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- --- consent_records --------------------------------------------------------
-- Immutable record of a specific consent event: the exact text version the
-- subject accepted, when, and from where.
CREATE TABLE consent_records (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id           UUID NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  subject_id            UUID REFERENCES pii.subjects (id) ON DELETE CASCADE,
  consent_text_version  INTEGER NOT NULL,
  consent_text          TEXT NOT NULL,
  ip_address            INET,
  user_agent            TEXT,
  "timestamp"           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_consent_records_business_id ON consent_records (business_id);
CREATE INDEX idx_consent_records_subject_id ON consent_records (subject_id);
CREATE INDEX idx_consent_records_timestamp ON consent_records (business_id, "timestamp");

-- --- verifications ----------------------------------------------------------
CREATE TABLE verifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     UUID NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  tier_id         UUID REFERENCES verification_tiers (id) ON DELETE SET NULL,
  subject_id      UUID REFERENCES pii.subjects (id) ON DELETE SET NULL,
  subject_type    TEXT NOT NULL CHECK (subject_type IN ('individual', 'business')),
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'rejected', 'manual_review')),
  -- Aggregate risk score produced by the rules engine (Phase 3); nullable.
  risk_score      NUMERIC,
  decision_reason TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at      TIMESTAMPTZ,
  -- NULL when auto-decided by the rules engine; set to a reviewer on manual
  -- decisions (Phase 6).
  decided_by      UUID REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX idx_verifications_business_id ON verifications (business_id);
CREATE INDEX idx_verifications_status ON verifications (status);
CREATE INDEX idx_verifications_business_status ON verifications (business_id, status);
CREATE INDEX idx_verifications_tier_id ON verifications (tier_id);
CREATE INDEX idx_verifications_subject_id ON verifications (subject_id);
CREATE INDEX idx_verifications_created_at ON verifications (business_id, created_at);

-- --- verification_checks ----------------------------------------------------
-- One row per provider check run for a verification. `raw_result_encrypted`
-- holds the encrypted raw provider payload (field-level encryption at rest).
CREATE TABLE verification_checks (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  verification_id      UUID NOT NULL REFERENCES verifications (id) ON DELETE CASCADE,
  -- Denormalised for tenant-scoped queries and retention sweeps.
  business_id          UUID NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  check_type           TEXT NOT NULL,
  provider             TEXT NOT NULL,
  -- External reference for async status polling (getStatus in Phase 2 adapters).
  provider_reference   TEXT,
  -- AES-256-GCM envelope (base64) of the raw provider result JSON. PII.
  raw_result_encrypted TEXT,
  outcome              TEXT NOT NULL DEFAULT 'pending'
                       CHECK (outcome IN ('pass', 'fail', 'manual_review', 'error', 'pending')),
  score                NUMERIC,
  "timestamp"          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_verification_checks_verification_id ON verification_checks (verification_id);
CREATE INDEX idx_verification_checks_business_id ON verification_checks (business_id);
CREATE INDEX idx_verification_checks_outcome ON verification_checks (business_id, outcome);
CREATE INDEX idx_verification_checks_timestamp ON verification_checks (business_id, "timestamp");

-- @DOWN
DROP TABLE IF EXISTS verification_checks;
DROP TABLE IF EXISTS verifications;
DROP TABLE IF EXISTS consent_records;
DROP TABLE IF EXISTS pii.subjects;
