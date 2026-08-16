import os
from collections.abc import Mapping

HOSTED_ENVIRONMENTS = frozenset({"staging", "production"})
MINIMUM_SHARED_SECRET_LENGTH = 32
WEAK_SECRET_MARKERS = (
    "change-me",
    "changeme",
    "example",
    "placeholder",
    "replace-me",
    "secret-value",
    "test-secret",
)
UNVALIDATED_CALCULATION_FLAGS = (
    "ENABLE_WESTERN_ASTROLOGY",
    "ENABLE_BAZI",
    "ENABLE_PLANETARY_ANGULARITY",
)
ENABLED_VALUES = frozenset({"1", "true", "yes", "on"})


def validate_runtime_configuration(environment: Mapping[str, str] | None = None) -> None:
    """Fail closed before serving with unapproved calculations or hosted credentials."""

    values = os.environ if environment is None else environment
    enabled_unvalidated_flags = tuple(
        flag
        for flag in UNVALIDATED_CALCULATION_FLAGS
        if values.get(flag, "").strip().casefold() in ENABLED_VALUES
    )
    if enabled_unvalidated_flags:
        raise RuntimeError(
            f"{', '.join(enabled_unvalidated_flags)} cannot be enabled until a validated "
            "calculation adapter, reference suite, licensing approval, and expert sign-off "
            "are present"
        )

    app_environment = values.get("APP_ENV", "development").strip().lower()
    if app_environment not in HOSTED_ENVIRONMENTS:
        return

    shared_secret = values.get("PROFILE_ENGINE_SHARED_SECRET", "")
    normalized_secret = shared_secret.casefold()
    is_trivially_weak = (
        len(shared_secret) < MINIMUM_SHARED_SECRET_LENGTH
        or shared_secret != shared_secret.strip()
        or len(set(shared_secret)) < 8
        or any(marker in normalized_secret for marker in WEAK_SECRET_MARKERS)
    )
    if is_trivially_weak:
        raise RuntimeError(
            "PROFILE_ENGINE_SHARED_SECRET must be a strong, managed secret in "
            "staging and production"
        )
