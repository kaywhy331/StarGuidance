"""Worked product-convention examples, not independent tradition certification.

Expected arithmetic and source requirements: docs/PROFILE-VALIDATION.md.
These cases supplement, and do not replace, the original digest-pinned datasets.
"""

from datetime import date

import pytest
from fastapi.testclient import TestClient

from profile_engine.main import app
from profile_engine.numerology import calculate_numerology


@pytest.mark.parametrize(
    ("name", "birth_date", "expected"),
    [
        ("Ada Lovelace", "1987-07-26", (22, 8, 9, 1, 8)),
        ("Ada Lovelace", "2009-11-11", (33, 11, 9, 1, 8)),
        ("Ada Lovelace", "2000-02-29", (6, 11, 9, 1, 8)),
        ("Ada 李", "2000-02-29", (6, 11, None, None, None)),
    ],
    ids=["N001-component-master", "N002-master33", "N003-leap", "mixed-script-no-strip"],
)
def test_worked_numerology_examples(
    name: str, birth_date: str, expected: tuple[int, int, int | None, int | None, int | None]
) -> None:
    result = calculate_numerology(name, date.fromisoformat(birth_date))
    assert (
        result.life_path, result.birthday, result.expression, result.soul_urge, result.personality
    ) == expected
    assert result.algorithm_version == "pythagorean-v3"
    if "李" in name:
        assert result.name_rendering is None
        assert result.name_calculation_status == "unavailable"


@pytest.mark.parametrize(
    ("optional", "completeness", "angularity_reason"),
    [
        ({}, "core", "precise_birth_time_required"),
        ({"birthplace": "London"}, "locationEnhanced", "precise_birth_time_required"),
        ({"birth_time": "08:15:00"}, "core", "validated_birthplace_context_required"),
        (
            {"birthplace": "London", "birth_time": "08:15:00"},
            "complete",
            "licensed_ephemeris_and_mapping_adapter_required",
        ),
    ],
    ids=["date-only", "location-only", "time-without-place", "time-with-place"],
)
def test_completeness_does_not_invent_context_or_change_date_calculations(
    optional: dict[str, str], completeness: str, angularity_reason: str
) -> None:
    client = TestClient(app)
    core = {"full_birth_name": "Ada Lovelace", "birth_date": "1987-07-26"}
    baseline = client.post("/v1/profile/compute", json=core).json()
    response = client.post("/v1/profile/compute", json={**core, **optional})
    assert response.status_code == 200
    result = response.json()
    assert result["completeness"] == completeness
    for component in ("numerology", "dreamspell", "nine_star_ki", "traits"):
        assert result[component] == baseline[component]
    assert result["western_astrology"]["status"] == "unavailable"
    assert result["bazi"]["status"] == "unavailable"
    assert result["planetary_angularity"]["reason"] == angularity_reason
    assert result["dreamspell"]["certification_status"].startswith("implemented_pending_")
    assert result["nine_star_ki"]["certification_status"].startswith("implemented_pending_")
    assert all(
        trait["stability"] == "uncertain"
        for trait in result["traits"]
        if trait["source_system"] in {"dreamspell", "nineStarKi"}
    )
