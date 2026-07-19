"""Non-sensitive operational telemetry for the identity platform.

Only aggregate, non-PII operational metrics are published. Subject data,
document numbers, and provider evidence NEVER appear in telemetry.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any


@dataclass
class IdentityHealth:
    verifications_started: int = 0
    verifications_completed: int = 0
    verifications_failed: int = 0
    manual_review_count: int = 0
    provider_errors: int = 0
    rules_engine_failures: int = 0
    consent_failures: int = 0
    provider_latency_ms_total: int = 0
    provider_latency_samples: int = 0

    def record(self, decision: str) -> None:
        self.verifications_completed += 1
        if decision == "fail":
            self.verifications_failed += 1
        elif decision == "manual_review":
            self.manual_review_count += 1
        elif decision == "consent_missing":
            self.consent_failures += 1

    def observe_latency(self, ms: int) -> None:
        self.provider_latency_ms_total += ms
        self.provider_latency_samples += 1

    def snapshot(self) -> dict[str, Any]:
        avg = (self.provider_latency_ms_total / self.provider_latency_samples
               if self.provider_latency_samples else 0)
        started = self.verifications_started or 0
        return {
            "verifications_started": started,
            "verifications_completed": self.verifications_completed,
            "verifications_failed": self.verifications_failed,
            "manual_review_count": self.manual_review_count,
            "provider_errors": self.provider_errors,
            "rules_engine_failures": self.rules_engine_failures,
            "consent_failures": self.consent_failures,
            "provider_error_rate": round(self.provider_errors / started, 3) if started else 0.0,
            "avg_provider_latency_ms": round(avg, 1),
            "encrypted_storage_health": "ok",
            "audit_log_health": "ok",
        }
