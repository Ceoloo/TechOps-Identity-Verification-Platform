# Security — Identity Verification Platform

## Encryption
- Field-level encryption via `FieldCipher` behind a `KeyProvider` abstraction.
- **The bundled cipher is a stdlib reference AEAD** (HMAC-SHA256 CTR keystream,
  encrypt-then-MAC): confidentiality + integrity, wrong-key/tamper detection.
- **PRODUCTION REQUIREMENT:** replace with AES-256-GCM (`cryptography`) and
  manage keys in a KMS/HSM behind the same interface. Keys are env/KMS only.
- Ciphertexts record `key_id` to support rotation; old keys still decrypt.

## Access control & audit
- RBAC enforced in the vault; purpose-of-use required to decrypt.
- Append-only access log records actor/action/field/masked-subject/purpose/time,
  including denied attempts. The log never stores raw PII or raw subject ids.

## PII handling
- No PII in logs, telemetry, or events (opaque/masked refs only).
- Masked API responses by default; decryption is explicit + logged.
- Deletion and export workflows for data-subject requests.

## Secrets
- `.env.example` contract; `scripts/secret_scan.py` gates CI. None committed.

## Not claimed
This documents engineering controls only. It is **not** a legal compliance
certification (GDPR/CCPA/AML). Formal certification requires legal review.
