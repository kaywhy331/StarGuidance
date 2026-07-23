from datetime import date

import pytest

from profile_engine.dreamspell import calculate_dreamspell
from profile_engine.numerology import calculate_numerology, reduce_number
from profile_engine.traits import synthesize_traits


def test_master_numbers_are_preserved() -> None:
    assert reduce_number(11) == 11
    assert reduce_number(22) == 22
    assert reduce_number(33) == 33
    assert reduce_number(34) == 7


def test_punctuation_and_diacritics_have_documented_transformations() -> None:
    punctuated = calculate_numerology("Anne-Marie O'Neill", date(1990, 1, 1))
    accented = calculate_numerology("Joséphine", date(1990, 1, 1))

    assert punctuated.name_rendering == "ANNEMARIEONEILL"
    assert punctuated.transformation == "punctuation_ignored"
    assert accented.name_rendering == "JOSEPHINE"
    assert accented.transformation == "latin_diacritic_normalization"


def test_non_latin_names_require_user_confirmed_rendering() -> None:
    with pytest.raises(ValueError, match="user-confirmed"):
        calculate_numerology("李小龍", date(1940, 11, 27))

    result = calculate_numerology("李小龍", date(1940, 11, 27), "Lee Jun-fan")
    assert result.name_rendering == "LEEJUNFAN"
    assert result.transformation == "user_supplied_latin_rendering"


def test_dreamspell_anchor_and_cycle_are_deterministic() -> None:
    anchor = calculate_dreamspell(date(1987, 7, 26))
    repeated = calculate_dreamspell(date(1988, 4, 11))

    assert (anchor.kin, anchor.tone_name, anchor.solar_seal_name) == (34, "Galactic", "Wizard")
    assert repeated.kin == anchor.kin
    assert anchor.certification_status == "implemented_pending_approved_reference_dataset"


def test_trait_synthesis_preserves_source_and_uncertainty() -> None:
    numerology = calculate_numerology("Ada Lovelace", date(1815, 12, 10))
    dreamspell = calculate_dreamspell(date(1815, 12, 10))

    traits, tensions = synthesize_traits(numerology, dreamspell)

    assert len(traits) == 5
    assert all(trait.source_rule for trait in traits)
    assert all(trait.stability == "stable" for trait in traits[:4])
    assert traits[-1].stability == "uncertain"
    assert len(tensions) <= 1
