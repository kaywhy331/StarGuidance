from datetime import date

from profile_engine.models import DreamspellResult

ALGORITHM_VERSION = "dreamspell-anchor-1987-07-26-kin34-no-leap-v2"
ANCHOR_DATE = date(1987, 7, 26)
ANCHOR_KIN = 34

TONE_NAMES = (
    "Magnetic",
    "Lunar",
    "Electric",
    "Self-Existing",
    "Overtone",
    "Rhythmic",
    "Resonant",
    "Galactic",
    "Solar",
    "Planetary",
    "Spectral",
    "Crystal",
    "Cosmic",
)
SEAL_NAMES = (
    "Dragon",
    "Wind",
    "Night",
    "Seed",
    "Serpent",
    "Worldbridger",
    "Hand",
    "Star",
    "Moon",
    "Dog",
    "Monkey",
    "Human",
    "Skywalker",
    "Wizard",
    "Eagle",
    "Warrior",
    "Earth",
    "Mirror",
    "Storm",
    "Sun",
)
COLORS = ("Red", "White", "Blue", "Yellow")


def _is_gregorian_leap_year(year: int) -> bool:
    return year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)


def _leap_days_on_or_before(value: date) -> int:
    completed_years = value.year - 1
    leap_days = completed_years // 4 - completed_years // 100 + completed_years // 400
    if _is_gregorian_leap_year(value.year) and value >= date(value.year, 2, 29):
        leap_days += 1
    return leap_days


def _no_leap_ordinal(value: date) -> int:
    """Return a civil-day ordinal whose cycle does not advance on February 29.

    A leap-day birth therefore shares the preceding civil day's Kin. This is
    explicit and deterministic, but remains behind the existing Dreamspell
    reference-certification gate.
    """

    return value.toordinal() - _leap_days_on_or_before(value)


def calculate_dreamspell(birth_date: date) -> DreamspellResult:
    day_delta = _no_leap_ordinal(birth_date) - _no_leap_ordinal(ANCHOR_DATE)
    kin = ((ANCHOR_KIN - 1 + day_delta) % 260) + 1
    tone = ((kin - 1) % 13) + 1
    seal = ((kin - 1) % 20) + 1
    return DreamspellResult(
        kin=kin,
        tone=tone,
        tone_name=TONE_NAMES[tone - 1],
        solar_seal=seal,
        solar_seal_name=SEAL_NAMES[seal - 1],
        color=COLORS[(seal - 1) % 4],
        algorithm_version=ALGORITHM_VERSION,
        certification_status="implemented_pending_approved_reference_dataset",
    )
