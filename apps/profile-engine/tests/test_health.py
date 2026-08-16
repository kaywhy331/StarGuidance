from fastapi.testclient import TestClient

from profile_engine.main import app


def test_health_contract() -> None:
    response = TestClient(app).get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "service": "profile-engine",
        "status": "ok",
        "version": "0.1.0",
    }
