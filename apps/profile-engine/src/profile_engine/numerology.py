import re
import unicodedata
from datetime import date

from profile_engine.models import NumerologyResult

ALGORITHM_VERSION = "pythagorean-v2"
MASTER_NUMBERS = frozenset({11, 22, 33})
VOWELS = frozenset("AEIOU")


def reduce_number(value: int) -> int:
    while value > 9 and value not in MASTER_NUMBERS:
        value = sum(int(digit) for digit in str(value))
    return value


def _render_name(original: str) -> tuple[str | None, str]:
    normalized = unicodedata.normalize("NFKD", original)
    if any(
        unicodedata.category(character).startswith("L") and ord(character) > 127
        for character in normalized
    ):
        return None, "unsupported_writing_system"
    letters = "".join(character for character in normalized.upper() if "A" <= character <= "Z")
    if not letters:
        return None, "unsupported_writing_system"
    transformation = "latin_diacritic_normalization"
    if re.fullmatch(r"[A-Za-z\s'\u2019\-]+", original):
        transformation = "punctuation_ignored"
    return letters, transformation


def _letter_value(letter: str) -> int:
    return ((ord(letter) - ord("A")) % 9) + 1


def calculate_numerology(full_birth_name: str, birth_date: date) -> NumerologyResult:
    letters, transformation = _render_name(full_birth_name)
    vowels = [letter for letter in letters if letter in VOWELS] if letters else []
    consonants = [letter for letter in letters if letter not in VOWELS] if letters else []
    date_digits = [int(digit) for digit in birth_date.isoformat() if digit.isdigit()]

    return NumerologyResult(
        name_calculation_status="available" if letters else "unavailable",
        life_path=reduce_number(sum(date_digits)),
        expression=(
            reduce_number(sum(_letter_value(letter) for letter in letters)) if letters else None
        ),
        soul_urge=(
            reduce_number(sum(_letter_value(letter) for letter in vowels)) if letters else None
        ),
        personality=(
            reduce_number(sum(_letter_value(letter) for letter in consonants)) if letters else None
        ),
        birthday=reduce_number(birth_date.day),
        name_rendering=letters,
        transformation=transformation,
        algorithm_version=ALGORITHM_VERSION,
    )
