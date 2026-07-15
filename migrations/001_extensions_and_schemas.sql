-- @UP
-- ---------------------------------------------------------------------------
-- 001: Extensions, schemas, and shared helpers
-- ---------------------------------------------------------------------------
-- Establishes the two-schema layout that isolates PII from operational data:
--   * public  -> operational / config / audit tables
--   * pii     -> encrypted subject PII, isolated from CRM/operational data
-- ---------------------------------------------------------------------------

-- gen_random_uuid() is in core since PG13, but pgcrypto also gives us
-- digest()/hmac helpers we may use for lookup hashing. Enabling it is safe.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Dedicated schema for personally identifiable information. Access to objects
-- in this schema is expected to be granted to a narrower role in production
-- than the operational tables in `public`.
CREATE SCHEMA IF NOT EXISTS pii;

-- Shared trigger function to maintain `updated_at` columns.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- @DOWN
DROP FUNCTION IF EXISTS set_updated_at();
DROP SCHEMA IF EXISTS pii CASCADE;
-- Note: we intentionally do NOT drop the pgcrypto extension on rollback, as it
-- may be shared with other objects.
