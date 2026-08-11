import csv
import hashlib
import json
from datetime import date
from pathlib import Path

from profile_engine.dreamspell import ALGORITHM_VERSION as DREAMSPELL_VERSION
from profile_engine.dreamspell import calculate_dreamspell
from profile_engine.nine_star_ki import ALGORITHM_VERSION as NINE_STAR_KI_VERSION
from profile_engine.nine_star_ki import BOUNDARY_DAY_BY_MONTH, calculate_nine_star_ki
from profile_engine.numerology import ALGORITHM_VERSION as NUMEROLOGY_VERSION
from profile_engine.numerology import calculate_numerology, reduce_number
from profile_engine.traits import synthesize_traits

FIXTURES = Path(__file__).parent / "fixtures"


def _optional_int(value: str) -> int | None:
    return int(value) if value else None


def test_master_numbers_are_preserved() -> None:
    assert reduce_number(11) == 11
    assert reduce_number(22) == 22
    assert reduce_number(33) == 33
    assert reduce_number(34) == 7


def test_life_path_uses_component_reduction_and_preserves_master_numbers() -> None:
    divergent = calculate_numerology("Reference Person", date(1987, 7, 26))
    master_33 = calculate_numerology("Reference Person", date(2009, 11, 11))

    assert divergent.life_path == 22
    assert master_33.life_path == 33


def test_punctuation_and_diacritics_have_documented_transformations() -> None:
    punctuated = calculate_numerology("Anne-Marie O'Neill", date(1990, 1, 1))
    accented = calculate_numerology("Joséphine", date(1990, 1, 1))

    assert punctuated.name_rendering == "ANNEMARIEONEILL"
    assert punctuated.transformation == "punctuation_ignored"
    assert accented.name_rendering == "JOSEPHINE"
    assert accented.transformation == "latin_diacritic_normalization"


def test_explicit_latin_extended_equivalents_are_supported() -> None:
    cases = {
        "Jørgen": "JORGEN",
        "Łukasz": "LUKASZ",
        "Weiß": "WEISS",
        "Iş\u0131k": "ISIK",
        "Ægir Œsten": "AEGIROESTEN",
    }

    for original, expected in cases.items():
        result = calculate_numerology(original, date(1990, 1, 1))
        assert result.name_calculation_status == "available"
        assert result.name_rendering == expected
        assert result.transformation == "latin_extended_normalization"


def test_middle_names_and_suffix_letters_remain_part_of_the_birth_name_calculation() -> None:
    without_suffix = calculate_numerology("Ada Byron", date(1815, 12, 10))
    with_middle_and_suffix = calculate_numerology("Ada Augusta Byron III", date(1815, 12, 10))

    assert without_suffix.name_rendering == "ADABYRON"
    assert with_middle_and_suffix.name_rendering == "ADA AUGUSTA BYRON III".replace(" ", "")
    assert with_middle_and_suffix.soul_urge != without_suffix.soul_urge


def test_non_latin_names_reduce_detail_without_transliteration() -> None:
    result = calculate_numerology("李小龍", date(1940, 11, 27))

    assert result.name_calculation_status == "unavailable"
    assert result.name_rendering is None
    assert result.expression is None
    assert result.transformation == "unsupported_writing_system"
    assert result.life_path > 0


def test_numerology_matches_versioned_regression_fixture() -> None:
    metadata = json.loads((FIXTURES / "numerology-pythagorean-v3.json").read_text(encoding="utf-8"))
    case_path = FIXTURES / metadata["caseFile"]

    assert metadata["algorithmVersion"] == NUMEROLOGY_VERSION
    assert hashlib.sha256(case_path.read_bytes()).hexdigest() == metadata["sha256"]

    with case_path.open(encoding="utf-8", newline="") as case_file:
        cases = list(csv.DictReader(case_file, delimiter="|"))

    assert len(cases) == metadata["caseCount"] == 60
    for case in cases:
        result = calculate_numerology(
            case["full_birth_name"], date.fromisoformat(case["birth_date"])
        )
        assert result.algorithm_version == metadata["algorithmVersion"], case["case_id"]
        assert result.life_path == int(case["life_path"]), case["case_id"]
        assert result.birthday == int(case["birthday"]), case["case_id"]
        assert result.name_calculation_status == case["name_status"], case["case_id"]
        assert result.name_rendering == (case["name_rendering"] or None), case["case_id"]
        assert result.expression == _optional_int(case["expression"]), case["case_id"]
        assert result.soul_urge == _optional_int(case["soul_urge"]), case["case_id"]
        assert result.personality == _optional_int(case["personality"]), case["case_id"]
        assert result.transformation == case["transformation"], case["case_id"]


def test_dreamspell_anchor_and_cycle_are_deterministic() -> None:
    anchor = calculate_dreamspell(date(1987, 7, 26))
    before_repeat = calculate_dreamspell(date(1988, 4, 11))
    repeated = calculate_dreamspell(date(1988, 4, 12))

    assert (anchor.kin, anchor.tone_name, anchor.solar_seal_name) == (34, "Galactic", "Wizard")
    assert before_repeat.kin != anchor.kin
    assert repeated.kin == anchor.kin
    assert anchor.certification_status == "implemented_pending_approved_reference_dataset"


def test_dreamspell_cycle_does_not_advance_on_gregorian_leap_day() -> None:
    february_28 = calculate_dreamspell(date(2000, 2, 28))
    leap_day = calculate_dreamspell(date(2000, 2, 29))
    march_1 = calculate_dreamspell(date(2000, 3, 1))

    assert leap_day.kin == february_28.kin
    assert march_1.kin == (leap_day.kin % 260) + 1


def test_dreamspell_matches_versioned_regression_fixture() -> None:
    metadata = json.loads((FIXTURES / "dreamspell-no-leap-v2.json").read_text(encoding="utf-8"))
    case_path = FIXTURES / metadata["caseFile"]

    assert metadata["algorithmVersion"] == DREAMSPELL_VERSION
    assert hashlib.sha256(case_path.read_bytes()).hexdigest() == metadata["sha256"]

    with case_path.open(encoding="utf-8", newline="") as case_file:
        cases = list(csv.DictReader(case_file, delimiter="|"))

    assert len(cases) == metadata["caseCount"] == 60
    for case in cases:
        result = calculate_dreamspell(date.fromisoformat(case["birth_date"]))
        assert result.algorithm_version == metadata["algorithmVersion"], case["case_id"]
        assert result.kin == int(case["kin"]), case["case_id"]
        assert result.tone == int(case["tone"]), case["case_id"]
        assert result.tone_name == case["tone_name"], case["case_id"]
        assert result.solar_seal == int(case["solar_seal"]), case["case_id"]
        assert result.solar_seal_name == case["solar_seal_name"], case["case_id"]
        assert result.color == case["color"], case["case_id"]


def test_trait_synthesis_preserves_source_and_uncertainty() -> None:
    numerology = calculate_numerology("Ada Lovelace", date(1815, 12, 10))
    dreamspell = calculate_dreamspell(date(1815, 12, 10))
    nine_star_ki = calculate_nine_star_ki(date(1815, 12, 10))

    traits, tensions, convergences = synthesize_traits(numerology, dreamspell, nine_star_ki)

    assert len(traits) >= 13
    assert all(trait.source_rule for trait in traits)
    assert all(0 <= trait.strength <= 1 for trait in traits)
    assert all(trait.life_domains for trait in traits)
    assert all(trait.confidence in {"low", "medium", "high"} for trait in traits)
    assert {trait.domain for trait in traits}.issuperset(
        {
            "coreMotivation",
            "decisionStyle",
            "riskOrientation",
            "stabilityVsChange",
            "growthLever",
            "creativeExpression",
            "relationshipNeeds",
            "communicationStyle",
            "conflictResponse",
            "workStyle",
            "emotionalProcessing",
            "socialOrientation",
        }
    )
    assert [trait.source_system for trait in traits[-3:]] == ["nineStarKi"] * 3
    assert len(tensions) <= 1
    assert len(convergences) <= 1
    if convergences:
        assert len(set(convergences[0].source_systems)) == 2


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


def test_nine_star_ki_matches_digest_pinned_boundary_fixture() -> None:
    metadata = json.loads((FIXTURES / "nine-star-ki-v1.json").read_text(encoding="utf-8"))
    case_path = FIXTURES / metadata["caseFile"]

    assert metadata["algorithmVersion"] == NINE_STAR_KI_VERSION
    assert hashlib.sha256(case_path.read_bytes()).hexdigest() == metadata["sha256"]

    with case_path.open(encoding="utf-8", newline="") as case_file:
        cases = list(csv.DictReader(case_file, delimiter="|"))

    assert len(cases) == metadata["caseCount"] == 100
    fixture_dates = {date.fromisoformat(case["birth_date"]) for case in cases}
    for month, boundary in BOUNDARY_DAY_BY_MONTH.items():
        assert date(1965, month, boundary - 1) in fixture_dates
        assert date(1965, month, boundary) in fixture_dates

    principal_character_pairs: set[tuple[int, int]] = set()
    observed_phases: set[str] = set()
    for case in cases:
        result = calculate_nine_star_ki(date.fromisoformat(case["birth_date"]))
        principal_character_pairs.add((result.principal_star.number, result.character_star.number))
        observed_phases.update(
            (
                result.principal_star.phase,
                result.character_star.phase,
                result.energy_star.phase,
            )
        )
        assert result.algorithm_version == metadata["algorithmVersion"], case["case_id"]
        assert result.principal_star.model_dump() == {
            "number": int(case["principal"]),
            "phase": case["principal_phase"],
        }, case["case_id"]
        assert result.character_star.model_dump() == {
            "number": int(case["character"]),
            "phase": case["character_phase"],
        }, case["case_id"]
        assert result.energy_star.model_dump() == {
            "number": int(case["energy"]),
            "phase": case["energy_phase"],
        }, case["case_id"]

    assert len(principal_character_pairs) == 81
    assert observed_phases == {"water", "earth", "wood", "metal", "fire"}
