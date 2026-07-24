"""Local binding to the shared AION event contract.

Previously this module was a hand-vendored copy of the event envelope,
redaction, masking and validation logic. That logic now lives once, tested, in
the shared package ``aion_platform.contracts`` (in ``Ceoloo/aion-company-os``);
this module is a thin binding that keeps this repo's public surface unchanged
while delegating all the real work to the shared implementation.

What stays local to this repo:

* ``SOURCE_SERVICE`` / ``SOURCE_REPOSITORY`` -- this service's identity.
* ``KNOWN_EVENTS`` -- the event families this repo is allowed to emit. The
  shared validator accepts the whole ecosystem vocabulary; this local
  allow-list keeps a typo or an out-of-scope event from leaving this service.

Everything else (``Event``, ``new_event``, ``validate_event``,
``redact_payload``, ``mask_value``, ``has_unmasked_sensitive``,
``SENSITIVE_KEYS``) is re-exported from the shared package so existing call
sites and tests keep working verbatim.
"""

from __future__ import annotations

import re
from typing import Any, Union

from aion_platform.contracts import (
    Compliance,
    EventEnvelope,
    SENSITIVE_KEYS,
    mask_value,
    redact_payload,
)
from aion_platform.contracts import new_event as _shared_new_event
from aion_platform.contracts.redaction import (
    has_unmasked_sensitive_values as has_unmasked_sensitive,
)

_UUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)

EVENT_VERSION = "1.0"
SOURCE_SERVICE = "techops-identity-verification-platform"
SOURCE_REPOSITORY = "Ceoloo/TechOps-Identity-Verification-Platform"

# Event families this repo is allowed to emit (identity + service only).
KNOWN_EVENTS = frozenset({
    "identity.verification_started", "identity.verification_completed",
    "identity.verification_failed", "identity.manual_review_required",
    "compliance.check_started", "compliance.check_passed", "compliance.check_failed",
    "service.health_reported", "production_readiness.scored",
})

# Backwards-compatible alias: the envelope class this repo historically called ``Event``.
Event = EventEnvelope

__all__ = [
    "EVENT_VERSION", "SOURCE_SERVICE", "SOURCE_REPOSITORY", "KNOWN_EVENTS",
    "SENSITIVE_KEYS", "Event", "new_event", "validate_event",
    "redact_payload", "mask_value", "has_unmasked_sensitive",
]


def new_event(
    event_type: str,
    *,
    payload: dict | None = None,
    metrics: dict | None = None,
    correlation_id: str | None = None,
    contains_pii: bool = False,
    environment: str = "development",
) -> EventEnvelope:
    """Construct an event stamped with this repo's service identity.

    Signature preserved from the previously-vendored module; delegates to the
    shared :func:`aion_platform.contracts.new_event`.
    """
    return _shared_new_event(
        event_type,
        SOURCE_SERVICE,
        SOURCE_REPOSITORY,
        payload=payload or {},
        metrics=metrics or {},
        correlation_id=correlation_id,
        environment=environment,
        compliance=Compliance(contains_pii=contains_pii),
    )


def validate_event(event: Union[EventEnvelope, dict[str, Any]]) -> list[str]:
    """Validate an event and return a list of problems (empty == valid).

    Applies this repo's established validation policy: required fields, the
    local event allow-list, a UUID ``event_id``, and the PII guard-rail (which
    reuses the shared :func:`has_unmasked_sensitive` detector). The stricter
    ecosystem checks in ``aion_platform.contracts.validate_event`` (UUID
    ``correlation_id``, ISO ``occurred_at``) are intentionally NOT applied here
    yet -- tightening that is a separate, deliberate change, not part of
    adopting the shared envelope.
    """
    data = event.to_dict() if isinstance(event, EventEnvelope) else event
    problems: list[str] = []
    for key in ("event_id", "event_version", "event_type", "source_service",
                "source_repository", "environment", "occurred_at", "correlation_id"):
        if not data.get(key):
            problems.append(f"missing required field: {key}")
    et = data.get("event_type")
    if et and et not in KNOWN_EVENTS:
        problems.append(f"unknown event_type for this repo: {et}")
    if data.get("event_id") and not _UUID_RE.match(str(data["event_id"])):
        problems.append("event_id not a uuid")
    comp = data.get("compliance") or {}
    if not comp.get("contains_pii", False) and has_unmasked_sensitive(data.get("payload") or {}):
        problems.append("payload has unmasked sensitive keys but contains_pii is false")
    return problems
