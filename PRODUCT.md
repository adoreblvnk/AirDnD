# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

React, TypeScript, Vite, Resium, and CesiumJS frontend. FastAPI WebSocket backend. Python, NumPy, OR-Tools, PyTorch, ONNX Runtime, and RVO2-3D simulation and evidence pipeline.

## Users

Primary users are SDTH 2026 judges evaluating AirDnD in a 3-minute pitch and technical reviewers reproducing the software archive. Operators use the tactical worldview to inspect local decisions and replay fixed-seed engagements.

## Product Purpose

AirDnD demonstrates decentralized interceptor-swarm coordination during prolonged total radio blackout. The finished archive must make the mechanism inspectable, run deterministic demonstrations, and produce reproducible benchmark evidence against stated baselines.

## Positioning

AirDnD coordinates without shared truth. Each interceptor uses only noisy local tracks, onboard dead reckoning, observed friendly motion, and preloaded doctrine. The NIR beacon confirms identity only and carries no tracks, assignments, or intent.

## Operating Context

The product is presented over Marina Bay in a fixed-seed tactical replay using Google Photorealistic 3D Tiles through the paid Google Map Tiles API and a Cesium ion Google geocoder, then verified through a separate evidence view and headless benchmark outputs. If the hosted tiles cannot be loaded, the worldview blocks explicitly instead of substituting a procedural or ion-cached map.

## Capabilities and Constraints

- Total RF blackout with zero ground, inter-drone, or target-assignment messages
- Local track identities and local noisy observations
- Vertical picket grid, reserve mobilization, Observer claims, miss recovery, and DR-RTH
- Deterministic mission utility, tie-breaking, hysteresis, receding-horizon guidance, and collision avoidance
- System One MLP and GRU belief model with ONNX INT8 export
- Fixed-seed success and miss-recovery replays backed by simulator logs
- Separate evidence page with exact seed, configuration, Git revision, metrics, and raw downloads
- Exactly 100 hostiles in the scalability benchmark and at least 30 paired seeds for statistical comparisons
- No invented operational evidence. Hardware-only acceptance claims remain clearly identified as future validation.

## Brand Commitments

The product name is AirDnD. The interface must be minimalist, operational, and free of redundant status badges or decorative tactical clutter. Use the terms `HOSTILE VIEW`, `INTERCEPTOR VIEW`, and `OBSERVER VIEW`. Observer is a temporary role, not an airframe class.

## Evidence on Hand

- `AIRDND.md` is the normative architecture and acceptance specification
- `resources/00_Introduction.md` and `resources/03_Interceptors.md` contain organizer constraints
- `resources/announement.md` contains event and judging context
- `PROBLEM_STATEMENTS.md` summarizes challenge material
- No benchmark results, trained model, screenshots, video, or hardware evidence existed before implementation

## Product Principles

- Show local reasoning without exposing shared ground truth
- Keep the tactical screen focused and move proof material to the evidence page
- Back every displayed result with replayable simulator output
- Prefer deterministic, inspectable mechanisms around the bounded learned belief estimator
- Require real hosted geospatial context and fail explicitly when it is unavailable
- Preserve reproducible simulator, model, and evidence outputs

## Accessibility & Inclusion

Target WCAG 2.2 AA contrast, keyboard-operable controls, visible focus, reduced-motion support, and non-color-only state labels.
