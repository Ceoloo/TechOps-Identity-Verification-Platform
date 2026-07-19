import pytest

from identity import (
    FieldCipher, InMemoryKeyProvider, DecryptionError,
    PIIVault, Role, AccessDenied, AccessLog,
    RuleSet, default_ruleset, Decision,
    FakeVerificationProvider, verify_webhook_signature,
    RetentionManager, RequestType, IdentityHealth,
    VerificationService,
)
from identity import aion_events as ev


def make_cipher():
    kp = InMemoryKeyProvider(); kp.add_key("k1")
    return FieldCipher(kp), kp


# -- crypto ----------------------------------------------------------------
def test_encrypt_decrypt_round_trip():
    cipher, _ = make_cipher()
    ct = cipher.encrypt("national-id-123")
    assert ct.ct != "national-id-123"
    assert cipher.decrypt(ct) == "national-id-123"


def test_wrong_key_fails():
    cipher, kp = make_cipher()
    ct = cipher.encrypt("secret")
    # tamper key id to a different key
    kp.add_key("k2", make_current=False)
    ct.key_id = "k2"
    with pytest.raises(DecryptionError):
        cipher.decrypt(ct)


def test_tampered_ciphertext_fails():
    cipher, _ = make_cipher()
    ct = cipher.encrypt("secret")
    import base64
    raw = bytearray(base64.b64decode(ct.ct)); raw[0] ^= 0x01
    ct.ct = base64.b64encode(bytes(raw)).decode()
    with pytest.raises(DecryptionError):
        cipher.decrypt(ct)


def test_key_rotation():
    cipher, kp = make_cipher()
    ct1 = cipher.encrypt("v1")           # under k1
    kp.add_key("k2", make_current=True)
    ct2 = cipher.encrypt("v2")           # under k2
    assert ct1.key_id == "k1" and ct2.key_id == "k2"
    assert cipher.decrypt(ct1) == "v1"   # old key still decrypts
    assert cipher.decrypt(ct2) == "v2"


# -- vault + access log ----------------------------------------------------
def make_vault():
    cipher, _ = make_cipher()
    log = AccessLog()
    return PIIVault(cipher, log), log


def test_vault_store_and_masked_read():
    vault, log = make_vault()
    vault.store("s1", "national_id", "123456789", actor="svc", role=Role.SERVICE, purpose="verify")
    masked = vault.read_masked("s1", "national_id", actor="viewer", role=Role.VIEWER, purpose="support")
    assert masked.endswith("89") and masked.startswith("*")
    assert log.count() == 2  # write + read


def test_viewer_cannot_decrypt():
    vault, log = make_vault()
    vault.store("s1", "national_id", "123456789", actor="svc", role=Role.SERVICE, purpose="verify")
    with pytest.raises(AccessDenied):
        vault.decrypt("s1", "national_id", actor="viewer", role=Role.VIEWER, purpose="curiosity")
    # denied attempt is logged
    denied = [r for r in log.all() if not r.allowed]
    assert denied and denied[0].action == "decrypt"


def test_operator_decrypt_requires_purpose():
    vault, _ = make_vault()
    vault.store("s1", "national_id", "123456789", actor="svc", role=Role.SERVICE, purpose="verify")
    with pytest.raises(AccessDenied):
        vault.decrypt("s1", "national_id", actor="op", role=Role.OPERATOR, purpose="")
    assert vault.decrypt("s1", "national_id", actor="op", role=Role.OPERATOR,
                         purpose="manual_review") == "123456789"


def test_access_log_never_stores_raw_pii():
    vault, log = make_vault()
    vault.store("s1", "national_id", "123456789", actor="svc", role=Role.SERVICE, purpose="verify")
    assert "123456789" not in str([r.to_dict() for r in log.all()])
    assert "s1" not in str([r.to_dict() for r in log.all()])  # subject masked


# -- rules engine ----------------------------------------------------------
def test_rules_versioned_and_auditable():
    rs = default_ruleset()
    r = rs.evaluate({"consent": False})
    assert r.decision == Decision.CONSENT_MISSING.value
    assert r.ruleset_version == "1.0"
    assert r.rule_id == "consent.required"


def test_rules_manual_review_on_high_risk():
    rs = default_ruleset()
    r = rs.evaluate({"consent": True, "age": 30, "risk_score": 90})
    assert r.decision == Decision.MANUAL_REVIEW.value


def test_rules_pass_when_clean():
    rs = default_ruleset()
    r = rs.evaluate({"consent": True, "age": 30, "risk_score": 10, "provider_result": "pass"})
    assert r.decision == Decision.PASS.value


# -- provider + webhook ----------------------------------------------------
def test_webhook_signature_validation():
    prov = FakeVerificationProvider(result="pass", webhook_secret=b"sekret")
    body = b'{"provider_ref": "fake-1", "normalized_result": "pass"}'
    good = prov.sign(body)
    res = prov.handle_webhook(body, {"X-Signature": good})
    assert res.normalized_result == "pass"
    with pytest.raises(ValueError):
        prov.handle_webhook(body, {"X-Signature": "deadbeef"})


def test_provider_cancel():
    prov = FakeVerificationProvider()
    r = prov.start.__self__  # noqa
    res = prov.start(__import__("identity").VerificationRequest(subject_ref="x"))
    assert prov.cancel(res.provider_ref) is True


# -- retention -------------------------------------------------------------
def test_deletion_workflow():
    vault, _ = make_vault()
    vault.store("s1", "national_id", "123", actor="svc", role=Role.SERVICE, purpose="verify")
    rm = RetentionManager(vault)
    req = rm.submit("s1", RequestType.DELETION)
    rm.approve_and_execute(req, actor="admin", role=Role.ADMIN)
    assert req.result["deleted"] is True
    assert not vault.has_subject("s1")


def test_export_workflow():
    vault, _ = make_vault()
    vault.store("s1", "full_name", "Jane Doe", actor="svc", role=Role.SERVICE, purpose="verify")
    rm = RetentionManager(vault)
    req = rm.submit("s1", RequestType.EXPORT)
    rm.approve_and_execute(req, actor="admin", role=Role.ADMIN)
    assert req.result["fields"]["full_name"] == "Jane Doe"


def test_non_admin_cannot_delete():
    vault, _ = make_vault()
    vault.store("s1", "national_id", "123", actor="svc", role=Role.SERVICE, purpose="verify")
    with pytest.raises(AccessDenied):
        vault.delete_subject("s1", actor="op", role=Role.OPERATOR, purpose="x")


# -- service + telemetry ---------------------------------------------------
def test_service_end_to_end_no_pii_in_events():
    events = []
    vault, _ = make_vault()
    prov = FakeVerificationProvider(result="pass")
    svc = VerificationService(prov, vault, sink=events.append)
    started = svc.start_verification("subject-xyz", {"national_id": "999-99-9999"},
                                     actor="svc")
    result = svc.finalize("subject-xyz", started["provider_ref"],
                          {"consent": True, "age": 40, "risk_score": 10},
                          correlation_id=started["correlation_id"])
    assert result["decision"] == "pass"
    for e in events:
        assert ev.validate_event(e) == []
        assert "999-99-9999" not in str(e)
        assert "subject-xyz" not in str(e)  # masked
    assert svc.health.snapshot()["verifications_started"] == 1


def test_telemetry_snapshot_is_non_pii():
    h = IdentityHealth()
    h.verifications_started = 5
    h.record("manual_review")
    snap = h.snapshot()
    assert snap["manual_review_count"] == 1
    assert "national_id" not in str(snap)
