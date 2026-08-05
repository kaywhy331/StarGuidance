import logging
import secrets

import pytest
from fastapi.testclient import TestClient

from profile_engine.configuration import validate_runtime_configuration
from profile_engine.main import app


def profile_request() -> dict[str, object]:
    return {
        "full_birth_name": "Ada Lovelace",
        "birth_date": "1815-12-10",
    }


def test_date_only_profile_returns_unavailable_sensitive_systems() -> None:
    response = TestClient(app).post(
        "/v1/profile/compute",
        json={
            "full_birth_name": "Ada Lovelace",
            "birth_date": "1815-12-10",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["completeness"] == "core"
    assert payload["western_astrology"]["status"] == "unavailable"
    assert payload["bazi"]["status"] == "unavailable"
    assert payload["planetary_angularity"]["reason"] == "precise_birth_time_required"
    assert payload["nine_star_ki"]["principal_star"] == {
        "number": 5,
        "phase": "earth",
    }


def test_birth_time_without_place_or_timezone_is_accepted() -> None:
    response = TestClient(app).post(
        "/v1/profile/compute",
        json={
            "full_birth_name": "Ada Lovelace",
            "birth_date": "1815-12-10",
            "birth_time": "08:15:00",
        },
    )
    assert response.status_code == 200
    assert response.json()["completeness"] == "core"


def test_simple_birthplace_and_time_create_complete_profile() -> None:
    response = TestClient(app).post(
        "/v1/profile/compute",
        json={
            "full_birth_name": "Ada Lovelace",
            "birth_date": "1815-12-10",
            "birthplace": "London, United Kingdom",
            "birth_time": "07:00:00",
        },
    )
    assert response.status_code == 200
    assert response.json()["completeness"] == "complete"


def test_unicode_name_reduces_numerology_detail_without_blocking_profile() -> None:
    response = TestClient(app).post(
        "/v1/profile/compute",
        json={"full_birth_name": "李小龍", "birth_date": "1940-11-27"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["numerology"]["name_calculation_status"] == "unavailable"
    assert payload["numerology"]["expression"] is None
    assert payload["numerology"]["life_path"] > 0


def test_profile_compute_rejects_unauthorized_requests(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    shared_secret = secrets.token_urlsafe(32)
    monkeypatch.setenv("PROFILE_ENGINE_SHARED_SECRET", shared_secret)
    client = TestClient(app)

    response = client.post("/v1/profile/compute", json=profile_request())

    assert response.status_code == 401
    assert shared_secret not in response.text
    assert "Ada Lovelace" not in response.text


def test_profile_compute_accepts_authorized_requests(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    shared_secret = secrets.token_urlsafe(32)
    monkeypatch.setenv("PROFILE_ENGINE_SHARED_SECRET", shared_secret)

    response = TestClient(app).post(
        "/v1/profile/compute",
        json=profile_request(),
        headers={"authorization": f"Bearer {shared_secret}"},
    )

    assert response.status_code == 200


@pytest.mark.parametrize("app_environment", ["staging", "production"])
def test_hosted_runtime_rejects_blank_shared_secret(app_environment: str) -> None:
    with pytest.raises(RuntimeError, match="PROFILE_ENGINE_SHARED_SECRET"):
        validate_runtime_configuration({"APP_ENV": app_environment})


def test_hosted_runtime_rejects_trivially_weak_shared_secret() -> None:
    with pytest.raises(RuntimeError, match="PROFILE_ENGINE_SHARED_SECRET"):
        validate_runtime_configuration(
            {
                "APP_ENV": "staging",
                "PROFILE_ENGINE_SHARED_SECRET": "placeholder-shared-secret-that-must-change",
            }
        )


def test_hosted_runtime_accepts_strong_shared_secret() -> None:
    validate_runtime_configuration(
        {
            "APP_ENV": "staging",
            "PROFILE_ENGINE_SHARED_SECRET": secrets.token_urlsafe(32),
        }
    )


@pytest.mark.parametrize(
    "feature_flag",
    [
        "ENABLE_WESTERN_ASTROLOGY",
        "ENABLE_BAZI",
        "ENABLE_PLANETARY_ANGULARITY",
    ],
)
def test_unvalidated_calculation_flag_cannot_activate_fabricated_results(
    feature_flag: str,
) -> None:
    with pytest.raises(RuntimeError, match=feature_flag):
        validate_runtime_configuration({feature_flag: "true"})


def test_disabled_unvalidated_calculation_flags_keep_typed_unavailable_results() -> None:
    validate_runtime_configuration(
        {
            "ENABLE_WESTERN_ASTROLOGY": "false",
            "ENABLE_BAZI": "false",
        }
    )

    payload = TestClient(app).post("/v1/profile/compute", json=profile_request()).json()

    assert payload["western_astrology"] == {
        "status": "unavailable",
        "capability": "western_astrology",
        "reason": "unlicensed_and_unvalidated",
        "calculation_version": "western-astrology-contract-v1",
        "activation_requirements": [
            "commercially compatible ephemeris license",
            "approved conventions",
            "golden reference dataset",
        ],
    }
    assert payload["bazi"]["status"] == "unavailable"


def test_time_and_place_do_not_activate_unvalidated_new_systems() -> None:
    payload = TestClient(app).post(
        "/v1/profile/compute",
        json={
            "full_birth_name": "Ada Lovelace",
            "birth_date": "1815-12-10",
            "birth_time": "07:00:00",
            "birthplace": "London, United Kingdom",
        },
    ).json()

    assert payload["planetary_angularity"]["reason"] == (
        "licensed_ephemeris_and_mapping_adapter_required"
    )


def test_profile_request_and_response_are_not_logged(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    shared_secret = secrets.token_urlsafe(32)
    monkeypatch.setenv("PROFILE_ENGINE_SHARED_SECRET", shared_secret)
    with caplog.at_level(logging.DEBUG):
        response = TestClient(app).post(
            "/v1/profile/compute",
            json=profile_request(),
            headers={"authorization": f"Bearer {shared_secret}"},
        )

    assert response.status_code == 200
    combined_logs = "\n".join(record.getMessage() for record in caplog.records)
    assert "Ada Lovelace" not in combined_logs
    assert shared_secret not in combined_logs
    assert response.text not in combined_logs
