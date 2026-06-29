# Hand Wave

Sign recognition for web and iOS, backed by a small Python inference service.

## Apps

```txt
apps/web        TanStack Start frontend
apps/inference FastAPI inference service
apps/mobile    SwiftUI iOS client
```

Clients capture landmarks. The inference service loads the recognition model and
decodes predictions.

## Setup

Requirements: pnpm 10.33+, Node 22+, Python 3.11/3.12, uv, and moon.

```sh
cp .env.example .env
pnpm install
uv sync --project apps/inference
```

Set `VITE_INFERENCE_URL` in `.env` for local web builds.

## Development

```sh
pnpm dev
```

Useful direct targets:

```sh
moon run web:dev
moon run inference:dev
```

Web runs on `http://localhost:3000`; inference docs run on
`http://localhost:8000/docs`.

## Inference

The API accepts client-owned landmark windows:

| Method | Path            | Use |
| --- | --- | --- |
| `POST` | `/v1/predict` | Decode one landmark window |
| `POST` | `/v1/recognize` | Decode and smooth streaming output |

The local checkpoint is `apps/inference/models/best.ckpt`. It must match the
model class, config, vocab order, landmark layout, and preprocessing code.

## Quality

```sh
pnpm check
pnpm check:affected
pnpm fix
pnpm test
```

## License

MIT. See [LICENSE.md](./LICENSE.md).

## Research Credits

- [MiCT-RANet for ASL Fingerspelling](https://github.com/fmahoudeau/MiCT-RANet-ASL-FingerSpelling), a prior ASL fingerspelling reference by Florent Mahoudeau.
- [A Two-Stream Neural Network for Pose-Based Handshape Recognition in American Sign Language](https://link.springer.com/chapter/10.1007/978-3-031-44237-7_29), the MiCT-RANet paper.
- [Mixed 3D/2D Convolutional Tube for Human Action Recognition](https://www.microsoft.com/en-us/research/uploads/prod/2018/05/Zhou_MiCT_Mixed_3D2D_CVPR_2018_paper.pdf), the MiCT architecture paper.
- [Fingerspelling Recognition in the Wild with Iterative Visual Attention](https://arxiv.org/pdf/1908.10546.pdf), the ChicagoFSWild+ paper.
- [FSBoard: Over 3 million characters of ASL fingerspelling collected via smartphones](https://arxiv.org/abs/2407.15806), a large mobile fingerspelling dataset paper.
