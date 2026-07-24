"""Adapter exposing this platform's verification results via the shared contract.

The outreach/voice repo depends on ``aion_platform.integrations.identity``'s
``IdentityVerifier`` Protocol to answer one question: "is this contact cleared
to be contacted?" This module implements that Protocol on top of this
platform's own ``Decision`` vocabulary, so the voice system can call into
identity through a stable, PII-free interface.

``VerificationService.finalize()`` returns a ``Decision`` string per subject.
Callers record those keyed by the contact_id the voice system uses (the
persistent result store is out of scope here); this adapter maps a recorded
decision onto the shared status, failing closed when none is on file.
"""

from __future__ import annotations

from typing import Callable, Mapping, Optional, Union

from aion_platform.integrations.identity import (
    IdentityDecision,
    IdentityVerifier,
    status_from_decision,
)

DecisionLookup = Union[Mapping[str, str], Callable[[str], Optional[str]]]


class ServiceBackedVerifier(IdentityVerifier):
    """Map recorded platform ``Decision`` values to the shared identity status."""

    def __init__(self, lookup: DecisionLookup) -> None:
        if callable(lookup):
            self._lookup: Callable[[str], Optional[str]] = lookup
        else:
            snapshot = dict(lookup)
            self._lookup = snapshot.get

    def check(self, contact_id: str) -> IdentityDecision:
        decision = self._lookup(contact_id)
        status = status_from_decision(decision)
        return IdentityDecision(status=status, reason=f"decision={decision or 'none'}")
