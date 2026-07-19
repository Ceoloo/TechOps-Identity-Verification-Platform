"""Provider adapter contract + webhook signature validation.

The platform does not itself perform regulated identity verification; it
orchestrates licensed providers behind this contract. Provider secrets are
never stored in source (env only).
"""
from __future__ import annotations
import hashlib
import hmac
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional, Protocol


class VerificationStatus(str, Enum):
    STARTED = "started"
    PENDING = "pending"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass
class VerificationRequest:
    subject_ref: str            # opaque, NOT raw PII
    checks: list[str] = field(default_factory=lambda: ["document", "liveness"])
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class ProviderResult:
    status: str
    provider_ref: str
    normalized_result: str      # pass | fail | manual_review | retry | document_required
    evidence_ref: Optional[str] = None   # opaque pointer to provider evidence
    raw: dict[str, Any] = field(default_factory=dict)


class VerificationProvider(Protocol):
    name: str
    def start(self, request: VerificationRequest) -> ProviderResult: ...
    def status(self, provider_ref: str) -> ProviderResult: ...
    def handle_webhook(self, body: bytes, headers: dict) -> ProviderResult: ...
    def cancel(self, provider_ref: str) -> bool: ...


def verify_webhook_signature(body: bytes, signature: str, secret: bytes) -> bool:
    """Constant-time HMAC-SHA256 webhook signature check."""
    expected = hmac.new(secret, body, hashlib.sha256).hexdigest()
    try:
        return hmac.compare_digest(expected, signature)
    except Exception:
        return False
