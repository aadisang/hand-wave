"""Build the emissions cache: one model forward pass per streaming window.

Usage: uv run python tuning/cache_emissions.py [--traces-dir DIR] [--device cpu]
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from time import perf_counter

sys.path.insert(0, str(Path(__file__).resolve().parent))

from harness import (
    CACHE_DIR,
    CachedWindow,
    case_cache_path,
    load_cases,
    save_case_cache,
    stream_config,
    trace_paths,
    window_ends,
)

from inference.model import resolve_checkpoint_path
from inference.runtime import HandwaveRuntime


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--traces-dir", type=Path, default=Path.home() / "Downloads/Traces")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    runtime = HandwaveRuntime(resolve_checkpoint_path(), device=args.device)
    started = perf_counter()
    total_windows = 0
    for trace_path in trace_paths(args.traces_dir):
        stream = stream_config(trace_path)
        cases = load_cases(trace_path)
        print(f"{trace_path.name}: {len(cases)} recordings", flush=True)
        for case in cases:
            out_path = case_cache_path(case)
            if out_path.exists() and not args.force:
                print(f"  skip {case.recording_id} ({case.label})", flush=True)
                continue
            ends = window_ends(len(case.frames), stream)
            windows: list[CachedWindow] = []
            for end in ends:
                frames = case.frames[max(0, end - stream.window) : end]
                windows.append(encode_window(runtime, frames, end))
            # Production finalize sends the trimmed buffer: last `window` frames.
            full = encode_window(runtime, case.frames[-stream.window :], len(case.frames))
            save_case_cache(case, windows, full)
            total_windows += len(windows) + 1
            print(
                f"  cached {case.recording_id} ({case.label}): {len(windows)} windows",
                flush=True,
            )
    elapsed = perf_counter() - started
    print(f"done: {total_windows} windows in {elapsed:.1f}s -> {CACHE_DIR}", flush=True)


def encode_window(runtime: HandwaveRuntime, frames: list, end: int) -> CachedWindow:
    emission = runtime.encode(frames)
    return CachedWindow(
        end=end,
        emissions=emission.emissions,
        greedy_text=emission.greedy_text,
        blank_ratio=emission.blank_ratio,
        tail_blank_ratio=emission.tail_blank_ratio,
        tail_blank_frames=emission.tail_blank_frames,
        frame_confidence=emission.frame_confidence,
    )


if __name__ == "__main__":
    main()
