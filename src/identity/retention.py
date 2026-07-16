"""Retention, deletion, and export request workflows."""
from __future__ import annotations
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional
from .vault import PIIVault, Role


class RequestType(str, Enum):
    DELETION = "deletion"
    EXPORT = "export"


class RequestState(str, Enum):
    RECEIVED = "received"
    APPROVED = "approved"
    COMPLETED = "completed"
    REJECTED = "rejected"


@dataclass
class DataSubjectRequest:
    subject_id: str
    request_type: str
    request_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    state: str = RequestState.RECEIVED.value
    result: Optional[dict] = None
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    completed_at: Optional[str] = None


class RetentionManager:
    """Handles GDPR/CCPA-style deletion and export requests against the vault."""

    def __init__(self, vault: PIIVault) -> None:
        self.vault = vault
        self._requests: dict[str, DataSubjectRequest] = {}

    def submit(self, subject_id: str, request_type: RequestType) -> DataSubjectRequest:
        req = DataSubjectRequest(subject_id=subject_id, request_type=request_type.value)
        self._requests[req.request_id] = req
        return req

    def approve_and_execute(self, req: DataSubjectRequest, *, actor: str, role: Role,
                            purpose: str = "data_subject_request") -> DataSubjectRequest:
        req.state = RequestState.APPROVED.value
        if req.request_type == RequestType.DELETION.value:
            deleted = self.vault.delete_subject(req.subject_id, actor=actor, role=role, purpose=purpose)
            req.result = {"deleted": deleted}
        else:
            req.result = self.vault.export_subject(req.subject_id, actor=actor, role=role, purpose=purpose)
        req.state = RequestState.COMPLETED.value
        req.completed_at = datetime.now(timezone.utc).isoformat()
        return req
