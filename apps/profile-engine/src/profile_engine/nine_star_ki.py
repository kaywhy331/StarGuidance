from datetime import date
from typing import Literal

from profile_engine.models import NineStarKiResult, NineStarKiStar

ALGORITHM_VERSION = "nine-star-ki-fixed-boundaries-lo-shu-v1"
INTERPRETATION_VERSION = "nine-star-ki-original-editorial-v1"

# This version deliberately implements a named civil-date convention rather than
# pretending that approximate seasonal dates are exact astronomical instants.
# A future exact-solar-term implementation must receive a new version identifier.
BOUNDARY_DAY_BY_MONTH = {
    1: 5,
    2: 4,
    3: 5,
    4: 5,
    5: 5,
    6: 6,
    7: 7,
    8: 7,
    9: 8,
    10: 8,
    11: 7,
    12: 7,
}

FivePhase = Literal["water", "earth", "wood", "metal", "fire"]

PHASE_BY_STAR: dict[int, FivePhase] = {
    1: "water",
    2: "earth",
    3: "wood",
    4: "wood",
    5: "earth",
    6: "metal",
    7: "metal",
    8: "earth",
    9: "fire",
}


def _wrap_star(value: int) -> int:
    return ((value - 1) % 9) + 1


def _star(number: int) -> NineStarKiStar:
    return NineStarKiStar(number=number, phase=PHASE_BY_STAR[number])


def _principal_number(birth_date: date) -> int:
    solar_year = birth_date.year
    if (birth_date.month, birth_date.day) < (2, 4):
        solar_year -= 1
    # 1963 is the stable cycle anchor for 1 Water; the sequence descends yearly.
    return _wrap_star(1964 - solar_year)


def _solar_month_index(birth_date: date) -> int:
    """Return February=0 through January=11 under the fixed-boundary convention."""

    current_month_index = (birth_date.month - 2) % 12
    if birth_date.day < BOUNDARY_DAY_BY_MONTH[birth_date.month]:
        return (current_month_index - 1) % 12
    return current_month_index


def _character_number(principal_number: int, solar_month_index: int) -> int:
    if principal_number in {2, 5, 8}:
        february_number = 2
    elif principal_number in {1, 4, 7}:
        february_number = 8
    else:
        february_number = 5
    return _wrap_star(february_number - solar_month_index)


def _energy_number(principal_number: int, character_number: int) -> int:
    # Explicitly the Lo Shu positional derivation. Other schools derive the
    # optional third number differently, so the convention is part of the version.
    return _wrap_star(principal_number - character_number + 5)


def calculate_nine_star_ki(birth_date: date) -> NineStarKiResult:
    principal_number = _principal_number(birth_date)
    character_number = _character_number(
        principal_number, _solar_month_index(birth_date)
    )
    energy_number = _energy_number(principal_number, character_number)
    return NineStarKiResult(
        principal_star=_star(principal_number),
        character_star=_star(character_number),
        energy_star=_star(energy_number),
        boundary_convention="fixed_civil_dates_feb04_and_monthly_jie_approximation",
        third_star_convention="lo_shu_position_derived",
        algorithm_version=ALGORITHM_VERSION,
        interpretation_version=INTERPRETATION_VERSION,
        certification_status="implemented_pending_independent_reference_review",
    )
