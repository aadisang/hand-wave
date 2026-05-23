from fastapi.testclient import TestClient

from inference import main
from inference.model import ModelBackend
from inference.schemas import LandmarkFrame, Prediction, PredictResponse


class FakeBackend(ModelBackend):
    async def predict_frames(self, frames: list[LandmarkFrame]) -> PredictResponse:
        label = "" if len(frames) < 8 else "waiting"
        confidence = 0.0 if not label else 0.05
        return PredictResponse(
            prediction=Prediction(label=label, confidence=confidence),
            partial_text="",
            stable_text="",
        )


def client(monkeypatch):
    monkeypatch.setattr(main, "load_backend", FakeBackend)
    return TestClient(main.app)


def landmark_frame(index: int = 0) -> list[float]:
    return [0.1 + index, 0.2, 0.0] * 54


def test_health_returns_ok(monkeypatch) -> None:
    with client(monkeypatch) as test_client:
        response = test_client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_predict_accepts_frame_features(monkeypatch) -> None:
    with client(monkeypatch) as test_client:
        response = test_client.post(
            "/v1/predict",
            json={"frames": [landmark_frame()]},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["prediction"]["confidence"] == 0
    assert body["partial_text"] == ""


def test_session_append_keeps_rolling_window(monkeypatch) -> None:
    with client(monkeypatch) as test_client:
        created = test_client.post(
            "/v1/sessions",
            json={"max_window_frames": 8, "min_stable_frames": 2},
        )
        assert created.status_code == 200
        session_id = created.json()["session_id"]

        response = test_client.post(
            f"/v1/sessions/{session_id}/frames",
            json={"frames": [landmark_frame(i) for i in range(10)]},
        )

    assert response.status_code == 200
    assert response.json()["session_id"] == session_id
    assert response.json()["buffered_frames"] == 8


def test_session_reset_clears_state(monkeypatch) -> None:
    with client(monkeypatch) as test_client:
        session_id = test_client.post("/v1/sessions", json={}).json()["session_id"]
        test_client.post(
            f"/v1/sessions/{session_id}/frames",
            json={"frames": [landmark_frame(i) for i in range(3)]},
        )

        response = test_client.post(f"/v1/sessions/{session_id}/reset")

    assert response.status_code == 200
    assert response.json()["buffered_frames"] == 0
    assert response.json()["partial_text"] == ""
    assert response.json()["stable_text"] == ""


def test_missing_session_returns_404(monkeypatch) -> None:
    with client(monkeypatch) as test_client:
        response = test_client.post(
            "/v1/sessions/missing/frames",
            json={"frames": [landmark_frame()]},
        )

    assert response.status_code == 404
