"""Verification service: orchestrates provider + rules + vault + telemetry.

Ties the pieces together into an auditable identity workflow while keeping PII
inside the vault and out of events/telemetry.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Any, Optional

from . import aion_events as ev
from .providers import VerificationProvider, VerificationRequest, VerificationStatus
from .rules_engine import RuleSet, default_ruleset, Decision
from .vault import PIIVault, Role
from .telemetry import IdentityHealth


class VerificationService:
    def __init__(self, provider: VerificationProvider, vault: PIIVault,
                 ruleset: Optional[RuleSet] = None, sink=None) -> None:
        self.provider = provider
        self.vault = vault
        self.ruleset = ruleset or default_ruleset()
        self.sink = sink
        self.health = IdentityHealth()

    def _emit(self, event_type: str, correlation_id: str, payload: dict) -> None:
        if self.sink is None:
            return
        evt = ev.new_event(event_type, payload=payload, correlation_id=correlation_id)
        problems = ev.validate_event(evt)
        if problems:
            raise ValueError(f"invalid {event_type}: {problems}")
        self.sink(evt.to_dict())

    def start_verification(self, subject_id: str, pii: dict[str, str], *,
                           actor: str, correlation_id: Optional[str] = None) -> dict[str, Any]:
        """Store PII encrypted, start the provider, emit a (non-PII) event."""
        cid = correlation_id or str(uuid.uuid4())
        for field_name, value in pii.items():
            self.vault.store(subject_id, field_name, value, actor=actor,
                             role=Role.SERVICE, purpose="identity_verification")
        self.health.verifications_started += 1
        request = VerificationRequest(subject_ref=_mask(subject_id))
        result = self.provider.start(request)
        # payload carries only opaque refs, never PII
        self._emit("identity.verification_started", cid,
                   {"subject_ref": _mask(subject_id), "provider_ref": result.provider_ref})
        return {"correlation_id": cid, "provider_ref": result.provider_ref}

    def finalize(self, subject_id: str, provider_ref: str, context: dict[str, Any], *,
                 correlation_id: str) -> dict[str, Any]:
        """Fetch provider status, run rules, emit completion/review events."""
        provider_result = self.provider.status(provider_ref)
        ctx = {**context, "provider_result": provider_result.normalized_result}
        rule_result = self.ruleset.evaluate(ctx)
        self.health.record(rule_result.decision)

        payload = {"subject_ref": _mask(subject_id), "provider_ref": provider_ref,
                   "decision": rule_result.decision, "rule_id": rule_result.rule_id,
                   "ruleset_version": rule_result.ruleset_version}

        if rule_result.decision == Decision.MANUAL_REVIEW.value:
            self._emit("identity.manual_review_required", correlation_id, payload)
        elif rule_result.decision in (Decision.FAIL.value, Decision.RESTRICTED.value,
                                      Decision.CONSENT_MISSING.value):
            self._emit("identity.verification_failed", correlation_id, payload)
        else:
            self._emit("identity.verification_completed", correlation_id, payload)

        return {"decision": rule_result.decision, "evidence": rule_result.to_dict(),
                "evidence_ref": provider_result.evidence_ref}


def _mask(subject_id: str) -> str:
    import hashlib
    return "subj:" + hashlib.sha256(subject_id.encode()).hexdigest()[:12]
