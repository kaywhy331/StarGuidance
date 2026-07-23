from datetime import date

from profile_engine.models import DreamspellResult

ALGORITHM_VERSION = "dreamspell-anchor-1987-07-26-kin34-v1"
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


def calculate_dreamspell(birth_date: date) -> DreamspellResult:
    kin = ((ANCHOR_KIN - 1 + (birth_date - ANCHOR_DATE).days) % 260) + 1
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
