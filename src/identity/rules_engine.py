"""Versioned, auditable identity decision rules engine."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Callable, Optional


class Decision(str, Enum):
    PASS = "pass"
    FAIL = "fail"
    MANUAL_REVIEW = "manual_review"
    RETRY = "retry"
    DOCUMENT_REQUIRED = "document_required"
    RESTRICTED = "restricted"          # age/jurisdiction restriction
    CONSENT_MISSING = "consent_missing"


@dataclass
class RuleResult:
    decision: str
    reason: str
    rule_id: str
    ruleset_version: str
    evaluated_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    evidence: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {"decision": self.decision, "reason": self.reason, "rule_id": self.rule_id,
                "ruleset_version": self.ruleset_version, "evaluated_at": self.evaluated_at,
                "evidence": self.evidence}


@dataclass
class Rule:
    rule_id: str
    decision: Decision
    reason: str
    predicate: Callable[[dict], bool]


class RuleSet:
    """An ordered, versioned collection of rules. First match wins."""

    def __init__(self, version: str, rules: list[Rule]) -> None:
        self.version = version
        self.rules = rules

    def evaluate(self, context: dict[str, Any]) -> RuleResult:
        for rule in self.rules:
            try:
                fired = rule.predicate(context)
            except Exception:
                fired = False
            if fired:
                return RuleResult(
                    decision=rule.decision.value,
                    reason=rule.reason,
                    rule_id=rule.rule_id,
                    ruleset_version=self.version,
                    evidence={k: context.get(k) for k in
                              ("consent", "risk_score", "age", "jurisdiction",
                               "provider_result", "document_present")
                              if k in context},
                )
        # Default: pass only if nothing failed.
        return RuleResult(Decision.PASS.value, "no failing rule matched",
                          "default.pass", self.version)


def default_ruleset() -> RuleSet:
    """A conservative default ruleset (v1.0)."""
    return RuleSet(
        "1.0",
        [
            Rule("consent.required", Decision.CONSENT_MISSING,
                 "consent not on file", lambda c: not c.get("consent", False)),
            Rule("age.minimum", Decision.RESTRICTED,
                 "subject below minimum age", lambda c: c.get("age", 99) < 18),
            Rule("jurisdiction.blocked", Decision.RESTRICTED,
                 "jurisdiction not supported",
                 lambda c: c.get("jurisdiction") in c.get("blocked_jurisdictions", set())),
            Rule("document.required", Decision.DOCUMENT_REQUIRED,
                 "supporting document required",
                 lambda c: c.get("provider_result") == "document_required"),
            Rule("provider.fail", Decision.FAIL,
                 "provider returned a failing result",
                 lambda c: c.get("provider_result") == "fail"),
            Rule("risk.high", Decision.MANUAL_REVIEW,
                 "risk score above manual-review threshold",
                 lambda c: c.get("risk_score", 0) >= c.get("manual_review_threshold", 70)),
            Rule("provider.retry", Decision.RETRY,
                 "provider transient error", lambda c: c.get("provider_result") == "retry"),
        ],
    )
