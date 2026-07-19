# Incident Response — Identity Platform (runbook)

1. **Detect**: alert on abnormal decrypt volume, denied-access spikes, provider
   error-rate, or audit-log gaps (telemetry snapshot).
2. **Contain**: rotate the affected encryption key (`KeyProvider`), revoke
   provider credentials, freeze operator roles.
3. **Assess**: use the access log to scope which subjects/fields were accessed.
4. **Notify**: follow jurisdictional breach-notification obligations (legal).
5. **Recover**: re-issue keys, restore from backups (once configured), resume.
6. **Post-mortem**: record root cause; update THREAT_MODEL and rules.

Suspected key exposure = rotate immediately; ciphertexts record key_id so old
data remains decryptable under the retired key until re-encrypted.
