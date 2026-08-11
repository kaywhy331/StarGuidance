from typing import Literal

from profile_engine.models import PlanetaryAngularityUnavailable, ProfileRequest

CALCULATION_VERSION: Literal["planetary-angularity-contract-v1"] = (
    "planetary-angularity-contract-v1"
)


def planetary_angularity_availability(
    request: ProfileRequest,
) -> PlanetaryAngularityUnavailable:
    """Describe the activation boundary for geographic planetary angularity.

    A free-text birthplace is not silently treated as a coordinate or historical
    timezone, and Whole Sign output is never substituted for a failed Placidus or
    angular-line calculation.
    """

    if request.birth_time is None:
        reason = "precise_birth_time_required"
    elif request.birthplace is None:
        reason = "validated_birthplace_context_required"
    else:
        reason = "licensed_ephemeris_and_mapping_adapter_required"

    return PlanetaryAngularityUnavailable(
        reason=reason,
        calculation_version=CALCULATION_VERSION,
        activation_requirements=(
            "approved Swiss Ephemeris AGPL-compatible or Professional license",
            "pinned ephemeris files with silent lower-precision fallback disabled",
            "validated coordinates and historical timezone resolution",
            "golden references for rising, setting, culminating, and anti-culminating lines",
            "original conditional interpretations and map presentation",
        ),
    )
