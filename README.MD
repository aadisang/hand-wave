# Hand Wave

Sign recognition for web and iOS, backed by a small Python inference service.

[Watch the demo on YouTube](https://youtu.be/KzZ0YsMSmO8)

## Setup

Requirements: pnpm 10.33+, Node 22+, Python 3.11/3.12, uv, moon, and Git LFS.

```sh
git lfs install
git lfs pull
pnpm install
uv sync --project apps/inference --group deploy
uv run --project apps/inference --group deploy modal setup
uv run --project apps/inference --group deploy modal environment create dev
```

## Development

```sh
pnpm dev
```

This starts an isolated Modal backend and configures both clients; use `pnpm dev:mobile` for iOS only and keep the command running while testing.

## Testing and releases

Run `pnpm test` (or `pnpm test --web-only`) for real-service checks and saved evidence in `artifacts/e2e`; browser checks require `pnpm --filter @hand-wave/web exec playwright install chromium` once.
Merging to `main` runs checks, then publishes TestFlight and the website with a backend from the same commit; the **Release** workflow shows progress, results, and downloadable artifacts.

## Research Credits

- [Questure Tracker](https://github.com/tyleryzw/Questure_Tracker)
- [MiCT-RANet for ASL Fingerspelling](https://github.com/fmahoudeau/MiCT-RANet-ASL-FingerSpelling)
- [A Two-Stream Neural Network for Pose-Based Handshape Recognition in American Sign Language](https://link.springer.com/chapter/10.1007/978-3-031-44237-7_29)
- [Mixed 3D/2D Convolutional Tube for Human Action Recognition](https://www.microsoft.com/en-us/research/uploads/prod/2018/05/Zhou_MiCT_Mixed_3D2D_CVPR_2018_paper.pdf)
- [Fingerspelling Recognition in the Wild with Iterative Visual Attention](https://arxiv.org/pdf/1908.10546.pdf)
- [FSBoard: Over 3 million characters of ASL fingerspelling collected via smartphones](https://arxiv.org/abs/2407.15806)
