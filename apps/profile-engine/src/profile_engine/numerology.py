import re
import unicodedata
from datetime import date

from profile_engine.models import NumerologyResult

ALGORITHM_VERSION = "pythagorean-v1"
MASTER_NUMBERS = frozenset({11, 22, 33})
VOWELS = frozenset("AEIOU")


def reduce_number(value: int) -> int:
    while value > 9 and value not in MASTER_NUMBERS:
        value = sum(int(digit) for digit in str(value))
    return value


def _render_name(original: str, latin_rendering: str | None) -> tuple[str, str]:
    source = latin_rendering if latin_rendering else original
    transformation = (
        "user_supplied_latin_rendering" if latin_rendering else "latin_diacritic_normalization"
    )
    normalized = unicodedata.normalize("NFKD", source)
    if any(
        unicodedata.category(character).startswith("L") and ord(character) > 127
        for character in normalized
    ):
        raise ValueError("A user-confirmed Latin-letter rendering is required for non-Latin names")
    letters = "".join(character for character in normalized.upper() if "A" <= character <= "Z")
    if not letters:
        raise ValueError("Name rendering must contain Latin letters")
    if latin_rendering is None and re.fullmatch(r"[A-Za-z\s'\u2019\-]+", original):
        transformation = "punctuation_ignored"
    return letters, transformation


def _letter_value(letter: str) -> int:
    return ((ord(letter) - ord("A")) % 9) + 1


def calculate_numerology(
    full_birth_name: str, birth_date: date, latin_name_rendering: str | None = None
) -> NumerologyResult:
    letters, transformation = _render_name(full_birth_name, latin_name_rendering)
    vowels = [letter for letter in letters if letter in VOWELS]
    consonants = [letter for letter in letters if letter not in VOWELS]
    date_digits = [int(digit) for digit in birth_date.isoformat() if digit.isdigit()]

    return NumerologyResult(
        life_path=reduce_number(sum(date_digits)),
        expression=reduce_number(sum(_letter_value(letter) for letter in letters)),
        soul_urge=reduce_number(sum(_letter_value(letter) for letter in vowels)),
        personality=reduce_number(sum(_letter_value(letter) for letter in consonants)),
        birthday=reduce_number(birth_date.day),
        name_rendering=letters,
        transformation=transformation,
        algorithm_version=ALGORITHM_VERSION,
    )
