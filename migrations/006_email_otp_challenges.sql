-- @UP
-- ---------------------------------------------------------------------------
-- 006: Email OTP challenges (persistent store)
-- ---------------------------------------------------------------------------
-- Backs the email_otp adapter with durable, cross-instance storage so a code
-- issued on one node survives restarts and can be verified on another. The
-- challenge payload (code hash, salt, attempts, subject email) is stored as an
-- encrypted envelope; no plaintext PII or code material at rest.
-- ---------------------------------------------------------------------------

CREATE TABLE email_otp_challenges (
  reference          TEXT PRIMARY KEY,
  business_id        UUID REFERENCES businesses (id) ON DELETE CASCADE,
  payload_encrypted  TEXT NOT NULL,
  expires_at         TIMESTAMPTZ NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_email_otp_challenges_business_id ON email_otp_challenges (business_id);
CREATE INDEX idx_email_otp_challenges_expires_at ON email_otp_challenges (expires_at);

-- @DOWN
DROP TABLE IF EXISTS email_otp_challenges;
