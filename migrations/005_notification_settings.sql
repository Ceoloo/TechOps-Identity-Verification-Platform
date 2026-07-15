-- @UP
-- ---------------------------------------------------------------------------
-- 005: Notification settings (Phase 5)
-- ---------------------------------------------------------------------------
-- Per-business config for who gets notified on events such as a verification
-- being routed to manual_review.
-- ---------------------------------------------------------------------------

CREATE TABLE notification_settings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  event_type  TEXT NOT NULL,             -- e.g. 'manual_review'
  emails      JSONB NOT NULL DEFAULT '[]'::jsonb,  -- array of recipient emails
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, event_type)
);

CREATE INDEX idx_notification_settings_business_id ON notification_settings (business_id);

CREATE TRIGGER trg_notification_settings_updated_at
  BEFORE UPDATE ON notification_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- @DOWN
DROP TABLE IF EXISTS notification_settings;
