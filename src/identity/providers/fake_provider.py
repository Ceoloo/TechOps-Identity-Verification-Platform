"""Contract-tested fake identity provider."""
from __future__ import annotations
import json
from typing import Any
from .base import (
    VerificationProvider, VerificationRequest, ProviderResult, VerificationStatus,
    verify_webhook_signature,
)


class FakeVerificationProvider:
    name = "fake"

    def __init__(self, result: str = "pass", webhook_secret: bytes = b"test-secret") -> None:
        self._result = result
        self._secret = webhook_secret
        self._counter = 0
        self.cancelled: set[str] = set()

    def start(self, request: VerificationRequest) -> ProviderResult:
        self._counter += 1
        ref = f"fake-{self._counter}"
        return ProviderResult(status=VerificationStatus.PENDING.value, provider_ref=ref,
                              normalized_result="retry", evidence_ref=None)

    def status(self, provider_ref: str) -> ProviderResult:
        if provider_ref in self.cancelled:
            return ProviderResult(VerificationStatus.CANCELLED.value, provider_ref, "fail")
        return ProviderResult(VerificationStatus.COMPLETED.value, provider_ref,
                              self._result, evidence_ref=f"ev-{provider_ref}")

    def handle_webhook(self, body: bytes, headers: dict) -> ProviderResult:
        sig = headers.get("X-Signature", "")
        if not verify_webhook_signature(body, sig, self._secret):
            raise ValueError("invalid webhook signature")
        data = json.loads(body.decode())
        return ProviderResult(VerificationStatus.COMPLETED.value,
                              data.get("provider_ref", "unknown"),
                              data.get("normalized_result", self._result),
                              evidence_ref=data.get("evidence_ref"))

    def cancel(self, provider_ref: str) -> bool:
        self.cancelled.add(provider_ref)
        return True

    def sign(self, body: bytes) -> str:
        import hashlib, hmac
        return hmac.new(self._secret, body, hashlib.sha256).hexdigest()
