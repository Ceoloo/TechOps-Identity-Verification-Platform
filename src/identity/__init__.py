"""TechOps Identity Verification Platform.

An independent compliance and identity-infrastructure product. It orchestrates
licensed verification providers, stores PII under field-level encryption with
access logging and role-based access, applies a versioned rules engine, and
supports retention/deletion/export — publishing only non-sensitive telemetry.
"""

from .crypto import (
    FieldCipher, KeyProvider, EnvKeyProvider, InMemoryKeyProvider,
    Ciphertext, DecryptionError,
)
from .access_log import AccessLog, AccessRecord
from .vault import PIIVault, Role, AccessDenied, mask_display
from .rules_engine import RuleSet, Rule, Decision, default_ruleset, RuleResult
from .providers import (
    VerificationProvider, VerificationRequest, VerificationStatus,
    ProviderResult, verify_webhook_signature, FakeVerificationProvider,
)
from .retention import RetentionManager, DataSubjectRequest, RequestType, RequestState
from .telemetry import IdentityHealth
from .service import VerificationService

__version__ = "1.0.0"
