# TechOps Identity Verification Platform

An independent compliance and identity-infrastructure product. It orchestrates
licensed verification providers, protects PII with field-level encryption and
role-based access, applies versioned decision rules, and supports data-subject
deletion/export — publishing only non-sensitive telemetry.

It is deliberately NOT coupled to the Voice Appointment Setter; it exposes
reusable APIs and telemetry and remains a standalone product.

## Purpose
Provide auditable, privacy-preserving identity verification as infrastructure.

## Architecture
`src/identity/`: `crypto` (field-level AEAD + key provider) · `vault`
(encrypted PII store, RBAC, masking, access log) · `access_log` (append-only) ·
`rules_engine` (versioned decisions) · `providers` (adapter contract + webhook
signature validation) · `retention` (deletion/export) · `telemetry` (non-PII
health) · `service` (orchestration). See `ARCHITECTURE.md`.

## Current status
Unit-tested (18 tests) including encryption round-trip, wrong-key/tamper
failure, RBAC denial, PII-leak checks, rules, webhook signatures, deletion/
export. The bundled cipher is a **stdlib reference AEAD**; production must use
AES-256-GCM + KMS (see `SECURITY.md`). No live provider credentials exercised.

## Local setup & tests
```bash
PYTHONPATH=src python -m pytest -q
```

## Environment variables
See `.env.example`. Encryption keys and provider secrets via env/KMS only.

## Integrations
Licensed identity provider (adapter + webhook), AION telemetry (non-PII only).

## Security notes
Field-level encryption, key abstraction + rotation, access logging, RBAC,
purpose-of-use recording, masked responses, data classification, deletion/
export. No PII in logs, telemetry, or tests-as-fixtures beyond synthetic data.

## Live validation status
None. Provider mocked. Reference cipher, not production KMS.

## Current limitations / roadmap
- Swap reference AEAD for AES-256-GCM via `cryptography` + KMS.
- Add consent/intake service surface and FastAPI webhook receiver.
- Monitoring/backup not configured.

## Relationship to the AION ecosystem
Reusable compliance service. Publishes non-PII identity health to the Executive
Board Health dashboard; not force-coupled into other products.
