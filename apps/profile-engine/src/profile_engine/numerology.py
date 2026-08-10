import re
import unicodedata
from datetime import date

from profile_engine.models import NumerologyResult

ALGORITHM_VERSION = "pythagorean-v3"
MASTER_NUMBERS = frozenset({11, 22, 33})
VOWELS = frozenset("AEIOU")

# NFKD handles ordinary Latin diacritics, but it deliberately does not expand
# every Latin letter or ligature. These equivalents are an explicit product
# convention, not a general-purpose transliteration step. Any letter left
# outside ASCII after this allowlist and NFKD normalization fails closed.
LATIN_EXTENDED_EQUIVALENTS = str.maketrans(
    {
        "Æ": "AE",
        "æ": "ae",
        "Ð": "D",
        "ð": "d",
        "Đ": "D",
        "đ": "d",
        "Ħ": "H",
        "ħ": "h",
        "\u0131": "i",
        "ĸ": "k",
        "Ł": "L",
        "ł": "l",
        "Ŋ": "N",
        "ŋ": "n",
        "Œ": "OE",
        "œ": "oe",
        "Ø": "O",
        "ø": "o",
        "ß": "ss",
        "ẞ": "SS",
        "Þ": "TH",
        "þ": "th",
        "Ŧ": "T",
        "ŧ": "t",
    }
)


def reduce_number(value: int) -> int:
    while value > 9 and value not in MASTER_NUMBERS:
        value = sum(int(digit) for digit in str(value))
    return value


def _render_name(original: str) -> tuple[str | None, str]:
    mapped = original.translate(LATIN_EXTENDED_EQUIVALENTS)
    normalized = unicodedata.normalize("NFKD", mapped)
    if any(
        unicodedata.category(character).startswith("L") and ord(character) > 127
        for character in normalized
    ):
        return None, "unsupported_writing_system"
    letters = "".join(character for character in normalized.upper() if "A" <= character <= "Z")
    if not letters:
        return None, "unsupported_writing_system"
    transformation = "latin_diacritic_normalization"
    if mapped != original:
        transformation = "latin_extended_normalization"
    if re.fullmatch(r"[A-Za-z\s'\u2019\-]+", original):
        transformation = "punctuation_ignored"
    return letters, transformation


def _letter_value(letter: str) -> int:
    return ((ord(letter) - ord("A")) % 9) + 1


def calculate_numerology(full_birth_name: str, birth_date: date) -> NumerologyResult:
    letters, transformation = _render_name(full_birth_name)
    vowels = [letter for letter in letters if letter in VOWELS] if letters else []
    consonants = [letter for letter in letters if letter not in VOWELS] if letters else []
    life_path_components = (
        reduce_number(birth_date.month),
        reduce_number(birth_date.day),
        reduce_number(birth_date.year),
    )

    return NumerologyResult(
        name_calculation_status="available" if letters else "unavailable",
        life_path=reduce_number(sum(life_path_components)),
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
