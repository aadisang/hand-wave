from fastapi.testclient import TestClient

from inference import main
from inference.model import ModelBackend
from inference.schemas import LandmarkFrame, Prediction, PredictOut


class FakeBackend(ModelBackend):
    async def predict_frames(self, frames: list[LandmarkFrame]) -> PredictOut:
        label = "" if len(frames) < 8 else "waiting"
        confidence = 0.0 if not label else 0.92
        return PredictOut(
            prediction=Prediction(label=label, confidence=confidence),
            alternatives=[],
            spans=[],
            greedy_text=label,
            blank_ratio=0.0,
            tail_blank_ratio=0.0,
            partial_text=label,
            stable_text="",
            tail_blank_frames=len(frames),
        )


def client(monkeypatch):
    monkeypatch.setattr(main, "load_backend", FakeBackend)
    return TestClient(main.app)


def landmark_frame(index: int = 0) -> list[float]:
    return [0.1 + index, 0.2, 0.0] * 54


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


def test_predict_is_stateless(monkeypatch) -> None:
    with client(monkeypatch) as test_client:
        short = test_client.post(
            "/v1/predict",
            json={"frames": [landmark_frame(i) for i in range(4)]},
        )
        full = test_client.post(
            "/v1/predict",
            json={"frames": [landmark_frame(i) for i in range(10)]},
        )

    assert short.status_code == 200
    assert short.json()["partial_text"] == ""
    assert short.json()["tail_blank_frames"] == 4

    assert full.status_code == 200
    assert full.json()["partial_text"] == "waiting"
    assert full.json()["tail_blank_frames"] == 10


def test_recognize_returns_state_for_finalize(monkeypatch) -> None:
    # This test exercises the accept -> finalize commit mechanism with three
    # sightings; pin the commit gates so tuned deployment defaults (which
    # require more streaming evidence) don't change what it asserts.
    monkeypatch.setenv("COMMIT_MIN_COUNT", "3")
    monkeypatch.setenv("COMMIT_MIN_STREAK", "3")
    monkeypatch.setenv("COMMIT_MIN_CONFIDENCE", "0.85")
    context = {
        "idle_frames": 0,
        "missing_frames": 0,
        "segment_frames": 10,
        "motion": 0.2,
    }
    with client(monkeypatch) as test_client:
        decode = test_client.post(
            "/v1/recognize",
            json={
                "frames": [landmark_frame(i) for i in range(10)],
                "context": context,
            },
        )
        state = decode.json()["state"]
        for _ in range(2):
            decode = test_client.post(
                "/v1/recognize",
                json={
                    "frames": [landmark_frame(i) for i in range(10)],
                    "state": state,
                    "context": context,
                },
            )
            state = decode.json()["state"]
        finalize = test_client.post(
            "/v1/recognize",
            json={
                "state": state,
                "context": {**context, "endpoint_reason": "idle"},
                "finalize": True,
            },
        )

    assert decode.status_code == 200
    assert decode.json()["display_prediction"]["label"] == "waiting"
    assert decode.json()["trace"]["decode"]["buffered_frames"] == 10
    assert finalize.status_code == 200
    assert finalize.json()["committed"] is True
    assert finalize.json()["display_prediction"]["label"] == "waiting"


def test_websocket_stream_accumulates_only_new_frames(monkeypatch) -> None:
    context = {
        "idle_frames": 0,
        "missing_frames": 0,
        "segment_frames": 10,
        "motion": 0.2,
    }
    with client(monkeypatch) as test_client:
        with test_client.websocket_connect(
            "/v1/stream", subprotocols=["handwave.v1"]
        ) as websocket:
            websocket.send_json(
                {
                    "type": "recognize",
                    "sequence": 1,
                    "frames": [landmark_frame(i) for i in range(10)],
                    "context": context,
                }
            )
            first = websocket.receive_json()
            websocket.send_json(
                {
                    "type": "recognize",
                    "sequence": 2,
                    "frames": [landmark_frame(i) for i in range(10, 13)],
                    "context": {**context, "segment_frames": 13},
                }
            )
            second = websocket.receive_json()
            websocket.send_json(
                {
                    "type": "recognize",
                    "sequence": 3,
                    "finalize": True,
                    "context": {**context, "segment_frames": 13, "endpoint_reason": "idle"},
                }
            )
            finalized = websocket.receive_json()
            websocket.send_json(
                {
                    "type": "recognize",
                    "sequence": 4,
                    "frames": [landmark_frame(i) for i in range(10)],
                    "context": context,
                }
            )
            next_segment = websocket.receive_json()

    assert first["type"] == "result"
    assert first["result"]["trace"]["decode"]["buffered_frames"] == 10
    assert second["result"]["trace"]["decode"]["buffered_frames"] == 13
    assert finalized["type"] == "result"
    assert next_segment["result"]["trace"]["decode"]["buffered_frames"] == 10
