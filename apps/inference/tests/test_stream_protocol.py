from fastapi.testclient import TestClient

from inference import main
from inference.model import ModelBackend
from inference.schemas import Emission, LandmarkFrame, Prediction, PredictOut


class FakeBackend(ModelBackend):
    async def predict_frames(self, frames: list[LandmarkFrame]) -> PredictOut:
        label = "waiting" if len(frames) >= 8 else ""
        return PredictOut(
            prediction=Prediction(label=label, confidence=0.92 if label else 0.0),
            alternatives=[],
            spans=[],
            greedy_text=label,
            blank_ratio=0.0,
            tail_blank_ratio=0.0,
            partial_text=label,
            stable_text="",
            tail_blank_frames=len(frames),
        )

    async def predict_emission(self, emission: Emission) -> PredictOut:
        return await self.predict_frames([landmark_frame()] * (len(emission.values) * 2))


class FailOnceBackend(FakeBackend):
    def __init__(self) -> None:
        self.failed = False

    async def predict_frames(self, frames: list[LandmarkFrame]) -> PredictOut:
        if not self.failed:
            self.failed = True
            raise ValueError("temporary inference failure")
        return await super().predict_frames(frames)


def client(monkeypatch) -> TestClient:
    monkeypatch.setattr(main, "load_backend", FakeBackend)
    return TestClient(main.app)


def client_with(monkeypatch, backend: type[ModelBackend]) -> TestClient:
    monkeypatch.setattr(main, "load_backend", backend)
    return TestClient(main.app)


def landmark_frame(index: int = 0) -> list[float]:
    return [0.1 + index, 0.2, 0.0] * 54


def context(segment_frames: int) -> dict[str, int | float]:
    return {
        "idle_frames": 0,
        "missing_frames": 0,
        "segment_frames": segment_frames,
        "motion": 0.2,
    }


def test_stream_accumulates_deltas_and_resets_after_finalize(monkeypatch) -> None:
    with client(monkeypatch) as test_client:
        with test_client.websocket_connect("/v1/stream", subprotocols=["handwave.v1"]) as socket:
            socket.send_json(
                {
                    "type": "recognize",
                    "sequence": 1,
                    "protocol": 1,
                    "input": "frames",
                    "frames": [landmark_frame(i) for i in range(10)],
                    "context": context(10),
                }
            )
            first = socket.receive_json()
            socket.send_json(
                {
                    "type": "recognize",
                    "sequence": 2,
                    "protocol": 1,
                    "input": "frames",
                    "frames": [landmark_frame(i) for i in range(10, 13)],
                    "context": context(13),
                }
            )
            second = socket.receive_json()
            socket.send_json(
                {
                    "type": "recognize",
                    "sequence": 3,
                    "protocol": 1,
                    "input": "finalize",
                    "context": {**context(13), "endpoint_reason": "idle"},
                }
            )
            socket.receive_json()
            socket.send_json(
                {
                    "type": "recognize",
                    "sequence": 4,
                    "protocol": 1,
                    "input": "frames",
                    "frames": [landmark_frame(i) for i in range(10)],
                    "context": context(10),
                }
            )
            next_segment = socket.receive_json()

    assert first["result"]["trace"]["decode"]["buffered_frames"] == 10
    assert second["result"]["trace"]["decode"]["buffered_frames"] == 13
    assert next_segment["result"]["trace"]["decode"]["buffered_frames"] == 10


def test_stream_accepts_on_device_emissions(monkeypatch) -> None:
    with client(monkeypatch) as test_client:
        with test_client.websocket_connect("/v1/stream", subprotocols=["handwave.v1"]) as socket:
            socket.send_json(
                {
                    "type": "recognize",
                    "sequence": 1,
                    "protocol": 1,
                    "input": "emission",
                    "emission": {
                        "values": [[0.0] * 60 for _ in range(5)],
                        "frame_confidence": 0.9,
                    },
                    "context": context(10),
                }
            )
            response = socket.receive_json()

    assert response["type"] == "result"
    assert response["result"]["trace"]["decode"]["buffered_frames"] == 10


def test_control_messages_use_versioned_envelopes(monkeypatch) -> None:
    with client(monkeypatch) as test_client:
        with test_client.websocket_connect("/v1/stream", subprotocols=["handwave.v1"]) as socket:
            socket.send_json({"type": "ping", "sequence": 7, "protocol": 1})
            pong = socket.receive_json()
            socket.send_json({"type": "reset", "sequence": 8, "protocol": 1})
            reset = socket.receive_json()

    assert pong == {"type": "pong", "sequence": 7, "protocol": 1}
    assert reset == {"type": "reset", "sequence": 8, "protocol": 1}


def test_recognize_rejects_missing_context(monkeypatch) -> None:
    with client(monkeypatch) as test_client:
        with test_client.websocket_connect("/v1/stream", subprotocols=["handwave.v1"]) as socket:
            socket.send_json(
                {
                    "type": "recognize",
                    "sequence": 9,
                    "protocol": 1,
                    "input": "frames",
                    "frames": [landmark_frame()],
                }
            )
            response = socket.receive_json()

    assert response["type"] == "error"
    assert response["sequence"] == 9
    assert "context" in response["detail"]


def test_recognize_rejects_fields_from_another_input_variant(monkeypatch) -> None:
    with client(monkeypatch) as test_client:
        with test_client.websocket_connect("/v1/stream", subprotocols=["handwave.v1"]) as socket:
            socket.send_json(
                {
                    "type": "recognize",
                    "sequence": 10,
                    "protocol": 1,
                    "input": "frames",
                    "frames": [landmark_frame()],
                    "emission": {
                        "values": [[0.0] * 60],
                        "frame_confidence": 0.9,
                    },
                    "context": context(1),
                }
            )
            response = socket.receive_json()

    assert response["type"] == "error"
    assert response["sequence"] == 10
    assert "emission" in response["detail"]


def test_failed_request_does_not_mutate_stream_window(monkeypatch) -> None:
    with client_with(monkeypatch, FailOnceBackend) as test_client:
        with test_client.websocket_connect("/v1/stream", subprotocols=["handwave.v1"]) as socket:
            socket.send_json(
                {
                    "type": "recognize",
                    "sequence": 1,
                    "protocol": 1,
                    "input": "frames",
                    "frames": [landmark_frame(i) for i in range(5)],
                    "context": context(5),
                }
            )
            failed = socket.receive_json()
            socket.send_json(
                {
                    "type": "recognize",
                    "sequence": 2,
                    "protocol": 1,
                    "input": "frames",
                    "frames": [landmark_frame(i) for i in range(8)],
                    "context": context(8),
                }
            )
            recovered = socket.receive_json()

    assert failed["type"] == "error"
    assert recovered["result"]["trace"]["decode"]["buffered_frames"] == 8


def test_all_messages_reject_the_wrong_protocol(monkeypatch) -> None:
    with client(monkeypatch) as test_client:
        with test_client.websocket_connect("/v1/stream", subprotocols=["handwave.v1"]) as socket:
            for sequence, message_type in enumerate(("ping", "reset"), start=20):
                socket.send_json({"type": message_type, "sequence": sequence, "protocol": 2})
                response = socket.receive_json()
                assert response["type"] == "error"
                assert response["sequence"] == sequence
