"""Append-only access log for all PII reads/writes.

Every access to the vault records who, what, why (purpose-of-use), and when.
The log never stores the PII value itself — only the field name and a masked
subject reference.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional


def _mask(subject_id: str) -> str:
    return "subj:" + hashlib.sha256(subject_id.encode()).hexdigest()[:12]


@dataclass
class AccessRecord:
    actor: str
    action: str          # read | write | delete | export | decrypt
    field_name: str
    subject_ref: str
    purpose: str
    at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    allowed: bool = True
    detail: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {"actor": self.actor, "action": self.action, "field": self.field_name,
                "subject_ref": self.subject_ref, "purpose": self.purpose,
                "at": self.at, "allowed": self.allowed, "detail": self.detail}


class AccessLog:
    def __init__(self) -> None:
        self._records: list[AccessRecord] = []

    def record(self, actor: str, action: str, field_name: str, subject_id: str,
               purpose: str, *, allowed: bool = True, detail: str = "") -> AccessRecord:
        rec = AccessRecord(actor=actor, action=action, field_name=field_name,
                           subject_ref=_mask(subject_id), purpose=purpose,
                           allowed=allowed, detail=detail)
        self._records.append(rec)
        return rec

    def for_subject(self, subject_id: str) -> list[AccessRecord]:
        ref = _mask(subject_id)
        return [r for r in self._records if r.subject_ref == ref]

    def all(self) -> list[AccessRecord]:
        return list(self._records)

    def count(self) -> int:
        return len(self._records)
