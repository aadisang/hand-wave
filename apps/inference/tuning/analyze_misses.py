"""Per-case diagnosis: for each recording, show what the beams offered.

Answers, per missed case: was the label ever reachable (raw beam text or
normalized), what the dominant top-1 candidates were across windows, and what
the full-segment endpoint decode said. Points the finger at emissions vs LM vs
normalizer vs commit gates.

Usage: uv run python tuning/analyze_misses.py [--alpha 1.6] [--beta 2.0]
"""

from __future__ import annotations

import argparse
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from harness import (
    BatchDecoder,
    DecoderParams,
    _normalized_clean,
    load_all_cached_cases,
)

from inference.recognition import clean


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--alpha", type=float, default=1.6)
    parser.add_argument("--beta", type=float, default=2.0)
    parser.add_argument("--unk", type=float, default=-10.0)
    parser.add_argument("--only-label", default=None)
    args = parser.parse_args()

    cases = load_all_cached_cases()
    decoder = BatchDecoder()
    params = DecoderParams(alpha=args.alpha, beta=args.beta, unk_score_offset=args.unk)

    for case in cases:
        if args.only_label and case.label != args.only_label:
            continue
        decoded = decoder.decode_case(case, params)
        top1_counts = Counter()
        label_hits = {"raw_any": 0, "norm_top1": 0, "norm_top3": 0}
        for window in decoded.windows:
            if not window.beams:
                continue
            top1 = _normalized_clean(window.beams[0][0])
            top1_counts[top1] += 1
            if any(clean(text) == case.label for text, _lg, _lm in window.beams):
                label_hits["raw_any"] += 1
            if top1 == case.label:
                label_hits["norm_top1"] += 1
            if any(_normalized_clean(t) == case.label for t, _, _ in window.beams[:3]):
                label_hits["norm_top3"] += 1

        full_beams = [
            (_normalized_clean(t), round(lg + lm, 1)) for t, lg, lm in decoded.full.beams[:5]
        ]
        n = len(decoded.windows)
        print(f"\n== {case.label!r} [{case.trace}] windows={n}")
        print(f"   hits: {label_hits} (of {n} windows)")
        print(f"   top1 candidates: {top1_counts.most_common(6)}")
        print(f"   full-segment top5: {full_beams}")


if __name__ == "__main__":
    main()
