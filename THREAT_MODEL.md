# Threat Model — Identity Platform (summary)

Assets: subject PII, encryption keys, access logs, provider credentials.

| Threat | Mitigation |
| --- | --- |
| PII exfiltration via logs/telemetry | no PII in logs/events; masked refs only; PII-leak tests |
| Ciphertext tampering | authenticated encryption (encrypt-then-MAC); tamper test |
| Key compromise | KeyProvider abstraction, rotation, KMS in prod; per-field AAD |
| Unauthorized decryption | RBAC + purpose-of-use; denials logged |
| Forged provider webhooks | HMAC signature validation (constant-time) |
| Insider misuse | append-only access log; admin-only delete/export |

Out of scope this sprint: live pen-test, formal cryptographic review of the
reference cipher (production uses AES-GCM/KMS).
