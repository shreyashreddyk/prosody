from fastapi.testclient import TestClient

from app.main import app


def test_live_health() -> None:
    with TestClient(app) as client:
        response = client.get("/health/live")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "prosody-agent"}


def test_ready_health_without_supabase_store_is_still_ok() -> None:
    with TestClient(app) as client:
        response = client.get("/health/ready")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "prosody-agent"}
