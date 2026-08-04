import asyncio
import threading
from pathlib import Path

from inference.ctc import DecodedAlternative, DecodedText
from inference.model import CheckpointBackend
from inference.schemas import LandmarkFrame


class BlockingRuntime:
    def __init__(self) -> None:
        self.active = 0
        self.max_active = 0
        self.started = threading.Event()
        self.release = threading.Event()
        self.lock = threading.Lock()

    def predict(self, _frames: list[LandmarkFrame]) -> DecodedText:
        with self.lock:
            self.active += 1
            self.max_active = max(self.max_active, self.active)
        self.started.set()
        assert self.release.wait(timeout=30), "test did not release the model runtime"
        with self.lock:
            self.active -= 1
        best = DecodedAlternative("hello", 1, 0, 0, "hello")
        return DecodedText("hello", 1, (best,), (), "hello", 0, 0, 0)


def test_cancelled_prediction_never_overlaps_the_next_runtime_call(monkeypatch) -> None:
    runtime = BlockingRuntime()
    monkeypatch.setattr("inference.runtime.HandwaveRuntime", lambda _path, **_kwargs: runtime)
    backend = CheckpointBackend(Path("unused.ckpt"))
    frame = LandmarkFrame(root=[0.0] * 162)

    async def run() -> None:
        first = asyncio.create_task(backend.predict_frames([frame]))
        assert await asyncio.wait_for(
            asyncio.to_thread(runtime.started.wait),
            timeout=30,
        )
        first.cancel()
        try:
            await first
        except asyncio.CancelledError:
            pass
        else:
            raise AssertionError("cancelled prediction completed")

        second = asyncio.create_task(backend.predict_frames([frame]))
        await asyncio.sleep(0)
        assert not second.done()
        assert runtime.max_active == 1
        runtime.release.set()
        await second
        assert runtime.max_active == 1

    asyncio.run(run())
