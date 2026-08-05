from datetime import date

from profile_engine.dreamspell import calculate_dreamspell
from profile_engine.nine_star_ki import calculate_nine_star_ki
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


def test_non_latin_names_reduce_detail_without_transliteration() -> None:
    result = calculate_numerology("李小龍", date(1940, 11, 27))

    assert result.name_calculation_status == "unavailable"
    assert result.name_rendering is None
    assert result.expression is None
    assert result.transformation == "unsupported_writing_system"
    assert result.life_path > 0


def test_dreamspell_anchor_and_cycle_are_deterministic() -> None:
    anchor = calculate_dreamspell(date(1987, 7, 26))
    repeated = calculate_dreamspell(date(1988, 4, 11))

    assert (anchor.kin, anchor.tone_name, anchor.solar_seal_name) == (34, "Galactic", "Wizard")
    assert repeated.kin == anchor.kin
    assert anchor.certification_status == "implemented_pending_approved_reference_dataset"


def test_trait_synthesis_preserves_source_and_uncertainty() -> None:
    numerology = calculate_numerology("Ada Lovelace", date(1815, 12, 10))
    dreamspell = calculate_dreamspell(date(1815, 12, 10))
    nine_star_ki = calculate_nine_star_ki(date(1815, 12, 10))

    traits, tensions = synthesize_traits(numerology, dreamspell, nine_star_ki)

    assert len(traits) == 8
    assert all(trait.source_rule for trait in traits)
    assert all(trait.stability == "stable" for trait in traits[:4])
    assert all(trait.stability == "uncertain" for trait in traits[4:])
    assert [trait.source_system for trait in traits[-3:]] == ["nineStarKi"] * 3
    assert len(tensions) <= 1


def test_nine_star_ki_matches_versioned_golden_examples() -> None:
    april_2009 = calculate_nine_star_ki(date(2009, 4, 15))
    two_eight_eight = calculate_nine_star_ki(date(1962, 5, 17))
    three_seven_one = calculate_nine_star_ki(date(1961, 9, 10))

    assert (
        april_2009.principal_star.number,
        april_2009.character_star.number,
    ) == (9, 3)
    assert (
        two_eight_eight.principal_star.number,
        two_eight_eight.character_star.number,
        two_eight_eight.energy_star.number,
    ) == (2, 8, 8)
    assert (
        three_seven_one.principal_star.number,
        three_seven_one.character_star.number,
        three_seven_one.energy_star.number,
    ) == (3, 7, 1)


def test_nine_star_ki_applies_explicit_year_and_month_boundaries() -> None:
    before_year_boundary = calculate_nine_star_ki(date(1966, 2, 3))
    on_year_boundary = calculate_nine_star_ki(date(1966, 2, 4))
    before_month_boundary = calculate_nine_star_ki(date(1965, 5, 4))
    on_month_boundary = calculate_nine_star_ki(date(1965, 5, 5))

    assert before_year_boundary.principal_star.number == 8
    assert on_year_boundary.principal_star.number == 7
    assert before_month_boundary.character_star.number == 9
    assert on_month_boundary.character_star.number == 8
    assert on_month_boundary.third_star_convention == "lo_shu_position_derived"
