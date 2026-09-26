# AirDnD

AirDnD is a deterministic software prototype for decentralized interceptor-swarm coordination under total RF blackout. The archive separates simulator truth, per-interceptor local observations, and presentation state. All navigation, identity, engagement, separation, and hit-rate results are simulation evidence, not flight validation.

## Run

Prerequisites: macOS or Linux, `uv`, Node.js 20+, npm, and a Cesium ion account with access to Google Photorealistic 3D Tiles.

```sh
uv sync
npm install
npm --prefix frontend install
cp frontend/.env.example frontend/.env.local
```

Set `VITE_CESIUM_ION_TOKEN` in `frontend/.env.local` to a token created at `https://ion.cesium.com/tokens`. The worldview intentionally blocks instead of substituting an offline or procedural map when the token or Google tiles cannot be loaded. Never commit `.env.local`.

Generate the checked evidence bundle:

```sh
uv run python scripts/generate_evidence.py --output evidence --models-output models --seeds 30 --hostiles 100 --interceptors 125
```

Start the API and worldview in separate terminals:

```sh
uv run uvicorn airdnd.api:app --host 127.0.0.1 --port 8000
npm --prefix frontend run dev -- --port 5173
```

Open `http://127.0.0.1:5173` for the live CesiumJS/Resium worldview backed by Google Photorealistic 3D Tiles. Open `/evidence` for generated reports and downloads. Open `/training` to launch the real PyTorch training pipeline, monitor per-epoch training and held-out loss, run ONNX/INT8 verification, and download the produced artifacts.

## Verify

```sh
uv run pytest -q
npm --prefix frontend test -- --run
npm --prefix frontend run build
```

The generated evidence contains 30 paired seeds across 5 methods and exactly 100 hostiles per run. Current simulation results support AC-020 and AC-031. AC-021 fails because the learned-model comparison confidence interval crosses zero, so learned-model superiority is not claimed. Collision filtering uses the vendored official `snape/RVO2-3D` C++ implementation at revision `c726b3c537639ca2cf202c49bcae0f6b7889f344`.

Verify archive hashes:

```sh
cd evidence
shasum -a 256 -c manifest.sha256
```

## Presentation

Serve `presentation/index.html` from the repository root for the timed 3-minute deck. With the API and worldview running, generate the exact 30-second hook video and 7 screenshots:

```sh
npm run capture-demo
```

Outputs are written to `presentation/captures/` and excluded from Git because video capture is machine-generated.

## Layout

- `src/airdnd/` simulator, model, decision, guidance, benchmark, and API
- `tests/` Python regression and API tests
- `frontend/` React, TypeScript, Resium, and Cesium worldview
- `evidence/` raw paired runs, reports, fixed replays, and SHA-256 manifest
- `models/` trained PyTorch and ONNX INT8 model artifacts
- `configs/` benchmark and frozen parameter declarations
- `presentation/` timed deck and capture instructions
- `scripts/` evidence and video generation workflows

`AIRDND.md` remains the normative architecture and acceptance specification.
