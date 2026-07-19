# SEAMS — Identity Verification Platform

| Integration | Adapter | Unit tested | Mock tested | Live creds | Live test | Result | Remaining risk |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Identity provider (licensed) | `providers.FakeVerificationProvider` + contract | ✓ | ✓ | no | no | mocked | real provider + evidence retrieval not wired |
| Provider webhook | `verify_webhook_signature` | ✓ | ✓ | no | no | mocked | real signing scheme per-provider |
| Encryption / KMS | `FieldCipher` + `EnvKeyProvider` | ✓ | ✓ | no | no | reference cipher | AES-GCM + KMS required for production |
| AION telemetry | `telemetry.IdentityHealth` + `aion_events` | ✓ | ✓ | n/a | no | mocked | HTTP transport not load-tested |

No integration validated against live credentials this sprint. The bundled
cipher is a stdlib reference, NOT production-grade crypto.
