# Data Classification — Identity Platform

| Field | Classification | Handling |
| --- | --- | --- |
| national_id, dob, document_number | restricted | encrypted; decrypt only w/ purpose by operator+; masked responses |
| full_name, address | confidential | encrypted; masked by default |
| subject_ref (opaque) | internal | may appear in events/telemetry (masked hash) |
| aggregate health metrics | internal | non-PII; publishable to ecosystem |

Rules: restricted/confidential data never leaves the vault unencrypted, never
appears in telemetry, and is masked in ordinary reads.
