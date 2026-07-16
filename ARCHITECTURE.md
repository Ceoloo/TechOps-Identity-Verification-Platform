# Architecture — Identity Verification Platform

## Flow
```
start_verification(subject, pii)
  -> PIIVault.store (field-level encrypted, access-logged)
  -> provider.start (licensed provider adapter)
  -> emit identity.verification_started (opaque refs only)
finalize(provider_ref, context)
  -> provider.status
  -> RuleSet.evaluate (versioned decision + evidence)
  -> emit identity.verification_completed | failed | manual_review_required
```

## Boundaries
- PII lives only in the vault, encrypted per-field with AAD binding
  (subject:field). It never enters events, telemetry, or ordinary logs.
- The rules engine is versioned; every decision records `ruleset_version` and
  `rule_id` for audit.
- Provider secrets are env-only; webhooks are HMAC-signature-validated.
- RBAC: viewer (masked), operator/reviewer (decrypt w/ purpose), admin
  (delete/export). Every access is logged, including denials.
