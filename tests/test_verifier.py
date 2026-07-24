"""The identity side of the shared voice->identity contract."""

from aion_platform.integrations.identity import IdentityVerifier, VerificationStatus

from identity import (
    FieldCipher, InMemoryKeyProvider, PIIVault, AccessLog,
    FakeVerificationProvider, VerificationService,
)
from identity.rules_engine import Decision
from identity.verifier import ServiceBackedVerifier


def _service():
    kp = InMemoryKeyProvider(); kp.add_key("k1")
    vault = PIIVault(FieldCipher(kp), AccessLog())
    return VerificationService(FakeVerificationProvider(result="pass"), vault)


def test_adapter_satisfies_shared_protocol():
    v: IdentityVerifier = ServiceBackedVerifier({"c1": Decision.PASS.value})
    assert v.check("c1").is_clear()


def test_mapping_from_platform_decisions():
    lookup = {
        "passed": Decision.PASS.value,
        "review": Decision.MANUAL_REVIEW.value,
        "failed": Decision.FAIL.value,
        "restricted": Decision.RESTRICTED.value,
    }
    v = ServiceBackedVerifier(lookup)
    assert v.check("passed").status is VerificationStatus.VERIFIED
    assert v.check("review").status is VerificationStatus.PENDING_REVIEW
    assert v.check("failed").status is VerificationStatus.REJECTED
    assert v.check("restricted").status is VerificationStatus.REJECTED


def test_unknown_contact_fails_closed():
    v = ServiceBackedVerifier({})
    d = v.check("never-seen")
    assert d.status is VerificationStatus.UNVERIFIED
    assert not d.is_clear()


def test_callable_lookup_backed_by_service_result():
    # End-to-end: run a real verification, record its decision, expose via adapter.
    svc = _service()
    started = svc.start_verification("subject-1", {"national_id": "999-99-9999"}, actor="svc")
    result = svc.finalize("subject-1", started["provider_ref"],
                          {"consent": True, "age": 40, "risk_score": 10},
                          correlation_id=started["correlation_id"])
    decisions = {"contact-1": result["decision"]}
    v = ServiceBackedVerifier(decisions.get)
    assert v.check("contact-1").is_clear()
