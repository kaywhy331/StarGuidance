from fastapi.testclient import TestClient

from profile_engine.main import app


def test_date_only_profile_returns_unavailable_sensitive_systems() -> None:
    response = TestClient(app).post(
        "/v1/profile/compute",
        json={
            "full_birth_name": "Ada Lovelace",
            "birth_date": "1815-12-10",
            "birth_time": {"kind": "unknown"},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["completeness"] == "core"
    assert payload["western_astrology"]["status"] == "unavailable"
    assert payload["bazi"]["status"] == "unavailable"


def test_exact_time_without_context_is_rejected() -> None:
    response = TestClient(app).post(
        "/v1/profile/compute",
        json={
            "full_birth_name": "Ada Lovelace",
            "birth_date": "1815-12-10",
            "birth_time": {"kind": "exact", "exact": "08:15:00"},
        },
    )
    assert response.status_code == 422


def test_approximate_time_is_preserved_as_a_range() -> None:
    response = TestClient(app).post(
        "/v1/profile/compute",
        json={
            "full_birth_name": "Ada Lovelace",
            "birth_date": "1815-12-10",
            "birthplace": {
                "city": "London",
                "country_code": "GB",
                "time_zone": "Europe/London",
            },
            "birth_time": {"kind": "approximate", "start": "07:00:00", "end": "09:00:00"},
        },
    )
    assert response.status_code == 200
    assert response.json()["completeness"] == "approximateTime"
