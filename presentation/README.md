# AirDnD presentation and 30-second capture

## Deck

Serve the repository over HTTP, then open `presentation/index.html`:

```sh
python3 -m http.server 4173
# http://127.0.0.1:4173/presentation/
```

The 1920×1080 HTML deck has eight timed sections totaling exactly 3:00. Use ←/→ to navigate, `N` to hide spoken cues, and `F` for fullscreen. The first slide is the exact six-beat, 30-second hook storyboard.

The deck does not embed benchmark values. It attempts to load, in order:

1. `presentation/evidence/final-report.json`
2. `evidence/final-report.json`
3. the URL passed as `?evidence=...`
4. a JSON file chosen with the evidence-slide file picker

If qualifying final evidence is unavailable, it displays **GENERATE EVIDENCE FIRST** and no benchmark statistics. A qualifying report must at minimum include `final: true`, `paired_seeds >= 30`, `git_revision`, and `configuration` or `configuration_hash`. Individual acceptance results are shown only if declared by that artifact.

AC-019 is labeled as a host benchmark, not airborne hardware validation. AC-026 is shown as passed only when the report declares it passed and includes an actual M3 model, exactly 24 GB of memory, and a system-profile artifact. The roadmap keeps simulator evidence separate from future HITL and flight validation.

## 30-second capture

Prerequisites: the AirDnD app is running with a valid `VITE_CESIUM_ION_TOKEN`, Google Photorealistic 3D Tiles have loaded, `playwright` is installed for Node, Chromium is installed for Playwright, and `ffmpeg` is on `PATH`. The capture fails rather than substituting an offline map when the real tiles are unavailable.

```sh
npm install --save-dev playwright
npx playwright install chromium
```

Then capture:

```sh
AIRDND_APP_URL=http://127.0.0.1:5173 node scripts/capture_demo.mjs
```

Outputs go to `presentation/captures/` by default:

- `airdnd-hook-30s.webm` — 749 frames at 25 FPS (29.96 seconds, below the 30-second limit)
- `airdnd-hook-raw.webm` — untrimmed Playwright source
- seven timestamped PNG screenshots

Optional environment variables:

- `AIRDND_OUTPUT_DIR` — output path relative to the repository, or absolute
- `AIRDND_EVIDENCE_PATH` — final evidence JSON to inject before capture
- `AIRDND_HEADLESS=0` — show the browser
- `AIRDND_SELECTORS` — JSON file overriding the selector contract below

### App selector contract

The capture intentionally fails instead of silently fabricating or skipping a required state. The running app must expose these stable test IDs:

| Test ID | Required state/action |
|---|---|
| `map-ready` | real Google Photorealistic 3D Tiles loaded through Cesium ion |
| `view-overview` | reveal whole battlespace |
| `blackout-status` | zero RF counters with separate NIR identity status |
| `replay-naive` | fixed-seed naive duplicate-pursuit replay |
| `replay-airdnd` | fixed-seed AirDnD replay |
| `perspective-interceptor` | INTERCEPTOR VIEW |
| `decision-inspector` | local beliefs, utility, hysteresis, basket and velocity trace |
| `rvo-trace` | preferred and safe velocity / RVO2-3D state |
| `replay-miss` | fixed-seed miss-recovery replay |
| `perspective-observer` | OBSERVER VIEW |
| `nav-evidence` | open the separate evidence page |
| `evidence-status` | evidence provenance or generate-evidence-first state |

Timing is anchored to the hook cue start, not chained waits: 0s overview, 5s blackout, 10s naive duplication, 15s local AirDnD intent, 19s decision/RVO, 23s miss recovery, 27s evidence freeze, 30s cut. Startup readiness runs in a separate unrecorded browser. `ffmpeg` emits 749 frames at 25 FPS so the final recording remains below the 30-second acceptance limit.
