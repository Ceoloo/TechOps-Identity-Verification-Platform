# Runbook — Identity Platform

## Verify a subject
1. `VerificationService.start_verification(subject, pii)` — PII encrypted+stored.
2. Provider processes; on webhook/status poll call `finalize(...)`.
3. Rules engine decides pass/fail/manual_review; events emitted (non-PII).

## Manual review
Reviewer role decrypts specific fields with a recorded purpose. All access logged.

## Data-subject request
`RetentionManager.submit(subject, DELETION|EXPORT)` then admin `approve_and_execute`.

## Key rotation
Add a new key via the KeyProvider and make it current. New writes use it; old
ciphertexts still decrypt under their recorded key_id until re-encrypted.

## Rollback
Stateless service logic; redeploy previous image. Vault/key state is external
and unaffected. No destructive migration.
