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


def validate_runtime_configuration(environment: Mapping[str, str] | None = None) -> None:
    """Fail closed before serving hosted traffic with a weak service credential."""

    values = os.environ if environment is None else environment
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
