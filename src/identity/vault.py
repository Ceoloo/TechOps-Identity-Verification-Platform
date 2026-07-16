"""Encrypted PII vault with role-based access, masking, and access logging."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional

from .crypto import FieldCipher, Ciphertext, DecryptionError
from .access_log import AccessLog


class Role(str, Enum):
    VIEWER = "viewer"          # masked reads only
    OPERATOR = "operator"      # can decrypt with purpose
    REVIEWER = "reviewer"      # manual review: decrypt with purpose
    ADMIN = "admin"            # decrypt + delete/export
    SERVICE = "service"        # write + masked read (no decrypt)


# Which roles may decrypt / delete / export.
_CAN_DECRYPT = {Role.OPERATOR, Role.REVIEWER, Role.ADMIN}
_CAN_DELETE = {Role.ADMIN}
_CAN_EXPORT = {Role.ADMIN}

# Data classification per field (drives retention + handling).
DEFAULT_CLASSIFICATION = {
    "full_name": "confidential",
    "national_id": "restricted",
    "dob": "restricted",
    "address": "confidential",
    "document_number": "restricted",
}


class AccessDenied(PermissionError):
    pass


def mask_display(value: str) -> str:
    """Return a masked display form (last 2 chars visible for restricted data)."""
    if not value:
        return ""
    if len(value) <= 2:
        return "*" * len(value)
    return "*" * (len(value) - 2) + value[-2:]


@dataclass
class VaultRecord:
    subject_id: str
    fields: dict[str, dict] = field(default_factory=dict)   # field -> ciphertext dict
    classification: dict[str, str] = field(default_factory=dict)
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    deleted: bool = False


class PIIVault:
    def __init__(self, cipher: FieldCipher, access_log: Optional[AccessLog] = None) -> None:
        self.cipher = cipher
        self.log = access_log or AccessLog()
        self._records: dict[str, VaultRecord] = {}

    # -- writes ------------------------------------------------------------
    def store(self, subject_id: str, field_name: str, value: str, *,
              actor: str, role: Role, purpose: str) -> None:
        rec = self._records.setdefault(subject_id, VaultRecord(subject_id=subject_id))
        if rec.deleted:
            raise AccessDenied("subject data has been deleted")
        aad = f"{subject_id}:{field_name}".encode()
        ct = self.cipher.encrypt(value, aad=aad)
        rec.fields[field_name] = ct.to_dict()
        rec.classification[field_name] = DEFAULT_CLASSIFICATION.get(field_name, "confidential")
        self.log.record(actor, "write", field_name, subject_id, purpose)

    # -- reads -------------------------------------------------------------
    def read_masked(self, subject_id: str, field_name: str, *, actor: str,
                    role: Role, purpose: str) -> Optional[str]:
        rec = self._records.get(subject_id)
        if not rec or rec.deleted or field_name not in rec.fields:
            return None
        # A masked read still logs access, but returns only a masked form.
        clear = self._decrypt_field(rec, field_name, subject_id)
        self.log.record(actor, "read", field_name, subject_id, purpose)
        return mask_display(clear)

    def decrypt(self, subject_id: str, field_name: str, *, actor: str,
                role: Role, purpose: str) -> str:
        if role not in _CAN_DECRYPT:
            self.log.record(actor, "decrypt", field_name, subject_id, purpose,
                            allowed=False, detail=f"role {role.value} may not decrypt")
            raise AccessDenied(f"role {role.value} is not permitted to decrypt PII")
        if not purpose:
            raise AccessDenied("purpose-of-use is required to decrypt PII")
        rec = self._records.get(subject_id)
        if not rec or rec.deleted or field_name not in rec.fields:
            raise KeyError("field not found")
        clear = self._decrypt_field(rec, field_name, subject_id)
        self.log.record(actor, "decrypt", field_name, subject_id, purpose)
        return clear

    def _decrypt_field(self, rec: VaultRecord, field_name: str, subject_id: str) -> str:
        aad = f"{subject_id}:{field_name}".encode()
        return self.cipher.decrypt(Ciphertext.from_dict(rec.fields[field_name]), aad=aad)

    # -- deletion / export -------------------------------------------------
    def delete_subject(self, subject_id: str, *, actor: str, role: Role, purpose: str) -> bool:
        if role not in _CAN_DELETE:
            self.log.record(actor, "delete", "*", subject_id, purpose, allowed=False)
            raise AccessDenied(f"role {role.value} may not delete subject data")
        rec = self._records.get(subject_id)
        if not rec:
            return False
        rec.fields.clear()
        rec.deleted = True
        self.log.record(actor, "delete", "*", subject_id, purpose)
        return True

    def export_subject(self, subject_id: str, *, actor: str, role: Role, purpose: str) -> dict[str, Any]:
        if role not in _CAN_EXPORT:
            self.log.record(actor, "export", "*", subject_id, purpose, allowed=False)
            raise AccessDenied(f"role {role.value} may not export subject data")
        rec = self._records.get(subject_id)
        if not rec or rec.deleted:
            return {"subject_id": subject_id, "fields": {}, "deleted": bool(rec and rec.deleted)}
        out = {name: self._decrypt_field(rec, name, subject_id) for name in rec.fields}
        self.log.record(actor, "export", "*", subject_id, purpose)
        return {"subject_id": subject_id, "fields": out, "classification": dict(rec.classification)}

    def has_subject(self, subject_id: str) -> bool:
        rec = self._records.get(subject_id)
        return bool(rec and not rec.deleted and rec.fields)
