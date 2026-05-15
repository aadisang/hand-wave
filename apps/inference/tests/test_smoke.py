from fastapi.testclient import TestClient

from inference.main import app


def landmark_frame(index: int = 0) -> dict:
    return {
        "timestamp_ms": 1_700_000_000_000 + index,
        "landmarks": [
            {"x": 0.1 + index, "y": 0.2, "z": 0.0},
            {"x": 0.3, "y": 0.4, "z": 0.0},
        ],
    }


def test_health_returns_ok(monkeypatch) -> None:
    monkeypatch.setenv("HANDWAVE_BACKEND", "placeholder")
    with TestClient(app) as client:
        response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_predict_accepts_legacy_landmarks(monkeypatch) -> None:
    monkeypatch.setenv("HANDWAVE_BACKEND", "placeholder")
    with TestClient(app) as client:
        response = client.post(
            "/v1/predict",
            json={"mode": "static", "landmarks": landmark_frame()["landmarks"]},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["prediction"]["confidence"] == 0
    assert body["partial_text"] == ""


def test_session_append_keeps_rolling_window(monkeypatch) -> None:
    monkeypatch.setenv("HANDWAVE_BACKEND", "placeholder")
    with TestClient(app) as client:
        created = client.post(
            "/v1/sessions",
            json={"max_window_frames": 8, "min_stable_frames": 2},
        )
        assert created.status_code == 200
        session_id = created.json()["session_id"]

        response = client.post(
            f"/v1/sessions/{session_id}/frames",
            json={"frames": [landmark_frame(i) for i in range(10)]},
        )

    assert response.status_code == 200
    assert response.json()["session_id"] == session_id
    assert response.json()["buffered_frames"] == 8


def test_session_reset_clears_state(monkeypatch) -> None:
    monkeypatch.setenv("HANDWAVE_BACKEND", "placeholder")
    with TestClient(app) as client:
        session_id = client.post("/v1/sessions", json={}).json()["session_id"]
        client.post(
            f"/v1/sessions/{session_id}/frames",
            json={"frames": [landmark_frame(i) for i in range(3)]},
        )

        response = client.post(f"/v1/sessions/{session_id}/reset")

    assert response.status_code == 200
    assert response.json()["buffered_frames"] == 0
    assert response.json()["partial_text"] == ""
    assert response.json()["stable_text"] == ""


def test_missing_session_returns_404(monkeypatch) -> None:
    monkeypatch.setenv("HANDWAVE_BACKEND", "placeholder")
    with TestClient(app) as client:
        response = client.post(
            "/v1/sessions/missing/frames",
            json={"frames": [landmark_frame()]},
        )

    assert response.status_code == 404
