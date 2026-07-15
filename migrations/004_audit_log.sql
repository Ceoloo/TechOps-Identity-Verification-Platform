-- @UP
-- ---------------------------------------------------------------------------
-- 004: Audit log (append-only)
-- ---------------------------------------------------------------------------
-- Central, tenant-scoped audit trail. Captures who did what to which target,
-- including every access to PII tables (security requirement). `metadata` must
-- NEVER contain raw PII — store references/ids and non-sensitive context only.
-- ---------------------------------------------------------------------------

CREATE TABLE audit_log (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Nullable to allow platform-level events not tied to a single tenant.
  business_id   UUID REFERENCES businesses (id) ON DELETE SET NULL,
  -- Free-form actor label: user id, 'system', 'public-intake', 'retention-job'.
  actor         TEXT NOT NULL,
  -- Structured link to an internal user when the actor is one.
  actor_user_id UUID REFERENCES users (id) ON DELETE SET NULL,
  -- e.g. 'pii.read', 'verification.decide', 'consent.record',
  -- 'rules.evaluate', 'data_subject.delete', 'retention.delete',
  -- 'integration.rotate_key'.
  action        TEXT NOT NULL,
  target_type   TEXT,
  target_id     TEXT,
  ip_address    INET,
  -- Non-PII context only (counts, outcomes, versions, reasons).
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  "timestamp"   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_log_business_time ON audit_log (business_id, "timestamp" DESC);
CREATE INDEX idx_audit_log_action ON audit_log (action);
CREATE INDEX idx_audit_log_actor ON audit_log (actor);
CREATE INDEX idx_audit_log_target ON audit_log (target_type, target_id);

-- @DOWN
DROP TABLE IF EXISTS audit_log;
