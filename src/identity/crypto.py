"""Field-level encryption with a pluggable key provider.

SECURITY NOTE
=============
This module ships a **stdlib-only reference AEAD** (HMAC-SHA256 keystream in
counter mode, encrypt-then-MAC) so the platform is testable without external
dependencies. It provides confidentiality + integrity (wrong key or tampering
fails decryption), but **production deployments MUST swap in AES-256-GCM** via
the `cryptography` package behind the same `FieldCipher` interface and manage
keys in a KMS/HSM. See SECURITY.md.

The `KeyProvider` abstraction keeps key material out of source and enables
rotation: each ciphertext records the key id used.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import struct
from dataclasses import dataclass
from typing import Optional, Protocol


class KeyProvider(Protocol):
    def current_key_id(self) -> str: ...
    def get_key(self, key_id: str) -> bytes: ...


class EnvKeyProvider:
    """Loads keys from environment variables. Never hardcodes key material.

    Expects ``IDENTITY_ENC_KEY_<KEYID>`` as base64. ``IDENTITY_ENC_CURRENT_KEY``
    names the active key id.
    """

    def __init__(self, env: Optional[dict] = None) -> None:
        self._env = env if env is not None else os.environ

    def current_key_id(self) -> str:
        kid = self._env.get("IDENTITY_ENC_CURRENT_KEY")
        if not kid:
            raise KeyError("IDENTITY_ENC_CURRENT_KEY not set")
        return kid

    def get_key(self, key_id: str) -> bytes:
        raw = self._env.get(f"IDENTITY_ENC_KEY_{key_id}")
        if not raw:
            raise KeyError(f"key {key_id} not available")
        return base64.b64decode(raw)


class InMemoryKeyProvider:
    """For tests / local: holds keys in memory, supports rotation."""

    def __init__(self) -> None:
        self._keys: dict[str, bytes] = {}
        self._current: Optional[str] = None

    def add_key(self, key_id: str, key: Optional[bytes] = None, make_current: bool = True) -> str:
        self._keys[key_id] = key or os.urandom(32)
        if make_current or self._current is None:
            self._current = key_id
        return key_id

    def current_key_id(self) -> str:
        if not self._current:
            raise KeyError("no current key configured")
        return self._current

    def get_key(self, key_id: str) -> bytes:
        if key_id not in self._keys:
            raise KeyError(f"key {key_id} not available")
        return self._keys[key_id]


class DecryptionError(Exception):
    pass


@dataclass
class Ciphertext:
    key_id: str
    nonce: str   # base64
    ct: str      # base64
    tag: str     # base64
    alg: str = "HMAC-CTR-SHA256-v1"

    def to_dict(self) -> dict:
        return {"key_id": self.key_id, "nonce": self.nonce, "ct": self.ct,
                "tag": self.tag, "alg": self.alg}

    @classmethod
    def from_dict(cls, d: dict) -> "Ciphertext":
        return cls(key_id=d["key_id"], nonce=d["nonce"], ct=d["ct"], tag=d["tag"],
                   alg=d.get("alg", "HMAC-CTR-SHA256-v1"))


def _keystream(key: bytes, nonce: bytes, length: int) -> bytes:
    out = bytearray()
    counter = 0
    while len(out) < length:
        block = hmac.new(key, nonce + struct.pack(">Q", counter), hashlib.sha256).digest()
        out.extend(block)
        counter += 1
    return bytes(out[:length])


class FieldCipher:
    """Encrypt/decrypt individual field values under a KeyProvider."""

    def __init__(self, key_provider: KeyProvider) -> None:
        self.keys = key_provider

    def _derive(self, key: bytes) -> tuple[bytes, bytes]:
        enc_key = hashlib.sha256(b"enc" + key).digest()
        mac_key = hashlib.sha256(b"mac" + key).digest()
        return enc_key, mac_key

    def encrypt(self, plaintext: str, *, key_id: Optional[str] = None,
                aad: bytes = b"") -> Ciphertext:
        kid = key_id or self.keys.current_key_id()
        key = self.keys.get_key(kid)
        enc_key, mac_key = self._derive(key)
        nonce = os.urandom(16)
        data = plaintext.encode("utf-8")
        ks = _keystream(enc_key, nonce, len(data))
        ct = bytes(a ^ b for a, b in zip(data, ks))
        tag = hmac.new(mac_key, nonce + aad + ct, hashlib.sha256).digest()
        b64 = lambda b: base64.b64encode(b).decode()
        return Ciphertext(key_id=kid, nonce=b64(nonce), ct=b64(ct), tag=b64(tag))

    def decrypt(self, ct: Ciphertext, *, aad: bytes = b"") -> str:
        key = self.keys.get_key(ct.key_id)
        enc_key, mac_key = self._derive(key)
        nonce = base64.b64decode(ct.nonce)
        ciphertext = base64.b64decode(ct.ct)
        tag = base64.b64decode(ct.tag)
        expected = hmac.new(mac_key, nonce + aad + ciphertext, hashlib.sha256).digest()
        if not hmac.compare_digest(tag, expected):
            raise DecryptionError("authentication failed (wrong key or tampered ciphertext)")
        ks = _keystream(enc_key, nonce, len(ciphertext))
        data = bytes(a ^ b for a, b in zip(ciphertext, ks))
        return data.decode("utf-8")
