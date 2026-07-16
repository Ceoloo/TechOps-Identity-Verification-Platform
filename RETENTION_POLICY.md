# Retention Policy — Identity Platform

- PII is retained only as long as required for the verification purpose and any
  legal-hold obligation.
- Data-subject **deletion** requests: `RetentionManager` clears all encrypted
  fields and marks the subject deleted (irreversible); logged.
- Data-subject **export** requests: admin-only decrypt-and-package; logged.
- Retention classes align with the event contract (standard/extended/legal_hold).
- Retention jobs and their health are surfaced as non-PII telemetry.
