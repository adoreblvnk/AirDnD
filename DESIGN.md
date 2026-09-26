---
name: AirDnD Tactical Observatory
description: Autonomous Interceptor Swarm Coordination System under Total Radio Blackout
colors:
  primary: "#38bdf8"
  primary-hover: "#60a5fa"
  primary-muted: "#2563eb"
  opposing: "#f87171"
  opposing-deep: "#ef4444"
  unknown: "#fbbf24"
  neutral-bg: "#10191e"
  neutral-surface: "#0a1014"
  neutral-border: "rgba(255, 255, 255, 0.08)"
  neutral-border-active: "rgba(56, 189, 248, 0.30)"
  neutral-text: "#f1f5f9"
  neutral-text-muted: "#94a3b8"
  neutral-text-dim: "#64748b"
typography:
  display:
    fontFamily: "Barlow, Inter, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.02em"
  headline:
    fontFamily: "Barlow, Inter, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0.01em"
  title:
    fontFamily: "Barlow, Inter, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.01em"
  body:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "JetBrains Mono, Geist Mono, ui-monospace, monospace"
    fontSize: "0.6875rem"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "0.06em"
rounded:
  none: "0px"
  sm: "2px"
  md: "3px"
spacing:
  2xs: "2px"
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  nav-tab:
    backgroundColor: "transparent"
    textColor: "{colors.neutral-text-muted}"
    rounded: "{rounded.sm}"
    padding: "10px 16px"
  nav-tab-active:
    backgroundColor: "{colors.neutral-surface}"
    textColor: "{colors.primary}"
    rounded: "{rounded.sm}"
    padding: "10px 16px"
  playback-button:
    backgroundColor: "transparent"
    textColor: "{colors.neutral-text}"
    rounded: "{rounded.none}"
    padding: "8px 12px"
  chip-state:
    backgroundColor: "{colors.neutral-surface}"
    textColor: "{colors.neutral-text}"
    rounded: "{rounded.sm}"
    padding: "6px 14px"
---

# Design System: AirDnD Tactical Observatory

## Overview

**Creative North Star: "The Austere Tactical Observatory"**

AirDnD is a specialized mission-inspection console for defense evaluators, operational researchers, and technical judges evaluating autonomous counter-UAS interceptor swarm behavior under prolonged total radio blackout. The design language is defined authoritatively by `output/imagegen/frontend-concepts-v2/` and rejects all commercial SaaS habits, sci-fi cyberpunk tropes, and gratuitous UI dressing.

The interface recedes to let the 3D maritime battlespace over Singapore’s coastline command visual priority. Rather than presenting dense tables of speculative targeting probabilities, flashy reticles, or artificial HUD overlays, the console exhibits calm scientific restraint: pale desaturated daylight lighting, dark charcoal `#10191e` paneling, hairline dividers, and unambiguous 3D spatial depth.

**Key Characteristics:**
- **Zero 2D Screen Cheats:** All vectors, sector volumes, sensor cones, and separation bubbles are native Cesium 3D world entities locked to geospatial coordinates.
- **Elevation Truth Over Planar Ambiguity:** The defensive geometry separates into a lower Active flight layer (~150–200m) and an upper Reserve/Observing tier (~330–400m), reinforced by persistent ground drop lines and synchronized side-elevation profile insets.
- **The Quadcopter Invariant:** Interceptors and Observers share the identical physical airframe; an Observer is a temporary role defined by altitude, vantage point, and downward optical surveillance, never a dedicated airframe.
- **Honest Epistemology:** Silhouette boxes represent visual track detections, not confirmed hostility. Appearance $\neq$ identity. Missing identity data remains classified as Unknown, not hostile.
- **Aesthetic Restraint:** No neon bloom, no saturated gradients, no floating sci-fi reticles, no descriptive marketing prose, and no fake millisecond counters.

---

## Colors

The palette is anchored in dark charcoal slate neutrals with disciplined, restrained semantic accents derived from the V2 concept storyboards.

### Primary
- **Electric Cyan / Friendly** (`#38bdf8`): Represents friendly interceptors, active navigation paths, confirmed friendly tracks, and applied deconfliction maneuvers. Muted friendly state uses `#2563eb`.

### Secondary
- **Muted Coral / Opposing** (`#f87171`): Represents confirmed hostile/opposing aircraft and recorded breach trajectories. Visible strictly in truth-overlay and evaluator review modes. Deep accent uses `#ef4444`.

### Tertiary
- **Tactical Amber / Uncertainty & Observer** (`#fbbf24`): Represents temporary Observer cones, unconfirmed/unknown track detections, observation uncertainty ellipsoids, collision intervention markers (`ORCA`), and low-battery alerts.

### Neutral
- **Console Panel Base** (`#10191e`): The foundational dark charcoal tone for all toolbars, inspectors, and ledger cards.
- **Substrate Surface** (`#0a1014`): Deep obsidian for active selection cards, side elevation backplates, and inner viewer frames.
- **Hairline Border** (`rgba(255, 255, 255, 0.08)`): Subtle separation lines that segment panels without visual clutter.
- **Active Border** (`rgba(56, 189, 248, 0.30)`): Selected state indicator on focused panels and active ledger items.
- **Text High** (`#f1f5f9`): Primary headings, drone IDs (`I001`), and track numbers.
- **Text Muted** (`#94a3b8`): Secondary telemetry labels, ledger table column headers, and elevation tiers.
- **Text Dim** (`#64748b`): Status notes, inactive chips, and disabled controls.

### Named Rules
**The No-Neon Rule.** Luminescent glows, colored text gradients, and diffuse zero-offset box shadows are banned. Accents are applied strictly as crisp 1px strokes, subtle fill washes, or solid marker pips.
**The Truth Overlay Rule.** Opposing red/coral tracks must only appear in evaluator truth mode or verified contact replays. Under local perspective viewports, all visual contacts default to neutral white or amber detection frames.

---

## Typography

**Primary Display / UI Font:** `Barlow` (fallback: `Inter`, `system-ui`)  
**Body Font:** `Inter` (fallback: `ui-sans-serif, -apple-system, sans-serif`)  
**Telemetry & Data Font:** `JetBrains Mono` or `Geist Mono` (fallback: `ui-monospace, monospace`)

**Character:** Clean, structural, low-contrast grotesque typography. Headings and labels are uppercase or title case with slight letter-spacing; all telemetry, timers, coordinates, and status tokens use monospace tabular figures.

### Hierarchy
- **Display** (Bold 700, `1.125rem` / `18px`, line-height `1.2`, letter-spacing `0.02em`): Root brand title (`AirDnD`), view titles (`Scene`, `Cameras`, `Replay`).
- **Headline** (Semibold 600, `0.9375rem` / `15px`, line-height `1.3`, letter-spacing `0.01em`): Section titles (`I001 · Interceptor`, `Track ledger`, `Side elevation`).
- **Title** (Medium 500, `0.8125rem` / `13px`, line-height `1.4`): Navigation tab labels, camera subheadings (`Forward camera`, `Downward camera`).
- **Body** (Regular 400, `0.8125rem` / `13px`, line-height `1.5`, measure `65ch`): Explanatory subtitles, provenance disclosures, and inspection notes.
- **Label / Telemetry** (Medium 500, `0.6875rem` / `11px`, letter-spacing `0.06em`, uppercase): Status chips (`RF DENIED · SCENARIO`), table headers (`TRACK`, `VISIBLE`, `IDENTITY`, `AGE`), and elevation markers (`UPPER`, `LOWER`, `SURFACE`).

### Named Rules
**The Tabular Number Rule.** All numerical figures (time elapsed, velocities, ranges, coordinates, separations) must explicitly declare `font-variant-numeric: tabular-nums` to eliminate layout wobble during real-time 10 Hz playback.

---

## Layout

The application occupies a fixed, non-scrolling full-viewport layout (`100vw × 100vh`) structured into three persistent perimeter zones surrounding the central 3D canvas:

```text
┌──────────────────────────────────────────────────────────────────────────────────┐
│ AirDnD                                                            Concept replay │ Top Bar (36px)
├───────────┬────────────────────────────────────────────────────────┬─────────────┤
│ Scene     │                                                        │             │
│ Cameras   │                                                        │  Context    │
│ Replay    │                  Central 3D Viewport                   │  Inspector  │ Left Rail (150px)
│ Identity  │                 (Cesium / Google 3D)                   │  HUD / Side │ Right Panel (280px)
│ Safety    │                                                        │  Elevation  │
│ Fleet     │                                                        │             │
├───────────┴────────────────────────────────────────────────────────┴─────────────┤
│ [|<] [>] [>|] ───●────────────────────────────  RF denied · scenario | RF msgs 0 │ Bottom Strip (44px)
└──────────────────────────────────────────────────────────────────────────────────┘
```

1. **Top Bar (Height: 36px):** 
   - Left: `AirDnD` brand label (bold 18px).
   - Right: Mode provenance badge (`Concept replay` or `Live simulation`).
   - Hairline bottom divider: `1px solid rgba(255, 255, 255, 0.08)`.

2. **Left Navigation Rail (Width: 150px):**
   - Houses the six primary view selectors: `Scene`, `Cameras`, `Replay`, `Identity`, `Safety`, `Fleet`.
   - Each tab features a clean 16px icon and medium title-case label.
   - Active tab carries a subtle dark-charcoal background (`#0a1014`), cyan icon highlight, and left hairline accent.

3. **Central Viewport (Flex: 1):**
   - Renders photorealistic CesiumJS globe with Marina Bay 3D geometry as the foundation.
   - Supports single-perspective 3D globe (`Scene`, `Safety`, `Fleet`), dual-camera split (`Cameras`, `Replay`), or centered comparative imagery (`Identity`).

4. **Right Context HUD Panel (Width: 280–320px, Context-Aware):**
   - In `Scene`: Side Elevation profile showing Upper, Lower, and Sea Surface tiers with ground projections, plus Truth Overlay toggle.
   - In `Cameras` / `Identity`: Dual-column track inspection ledger (`Track A` vs `Track B`).
   - In `Safety`: RVO2-3D deconfliction inspector and real-time separation graph.
   - In `Fleet`: Real-time fleet state ledger and dock status table.

5. **Bottom Playback Strip (Height: 44px):**
   - Transport controls: Step Backward (`|<`), Play/Pause (`||` / `>`), Step Forward (`>|`).
   - Continuous scrub bar with interactive playhead dot (`#38bdf8`).
   - Right status chips: `RF denied · scenario` | `RF messages 0` | `NIR · identity only`.

---

## Elevation & Depth

Depth in AirDnD is primarily **geometrical in 3D world space**, rather than simulated through synthetic CSS box-shadows.

- **Tonal Layering:** Floating panels use solid `#10191e` or semi-translucent `rgba(16, 25, 30, 0.92)` with `backdrop-filter: blur(8px)`.
- **Zero Heavy Drop Shadows:** Interface cards sit flush against borders (`1px solid rgba(255, 255, 255, 0.08)`). Soft diffuse glows or neon drop shadows are strictly prohibited.
- **3D Spatial Drop Lines:** In the 3D Cesium world, every elevated aircraft entity projects a thin, semi-translucent vertical drop line down to the sea surface with a subtle circular footprint, making relative height unambiguous from any camera angle.
- **Volumetric Sensor Cones:** Observers project downward translucent cones (`rgba(56, 189, 248, 0.12)`) that visually enclose lower-tier aircraft.

---

## Shapes

- **Corner Radii:** Strict adherence to **sharp corners (`0px`)** or **micro-radius (`2px` to `3px`)**. Pill-shaped buttons, heavily rounded cards (`8px–16px`), and bubbly mobile containers are banned.
- **Hairline Borders:** All cards, tables, and pane separators use a crisp `1px` border thickness.
- **3D Primitives:**
  - Aircraft: Identical sleek 4-rotor quadcopter models for all friendly units.
  - Sectors: Transparent 3D wireframe boxes (`A`, `B`, `C`) with faint boundary planes.
  - Collision Volumes: Native 3D translucent spheres ($r = 8\text{ m}$) with thin equatorial rings.
  - Uncertainty Volumes: Nested translucent 3D ellipsoids along flight tracks representing covariance growth.

---

## Components

### 1. View Navigation Rail
- **Item Default:** Background transparent, text `#94a3b8`, icon stroke `1.5px`.
- **Item Hover:** Background `rgba(255, 255, 255, 0.04)`, text `#f1f5f9`.
- **Item Active:** Background `#0a1014`, text `#38bdf8`, 1px border `rgba(56, 189, 248, 0.25)`.

### 2. Side-Elevation HUD Inset
- Compact 2D elevation diagram located in the right rail.
- Displays three reference baselines: `Upper` (~350m), `Lower` (~180m), and `Surface` (0m).
- Dynamically echoes drone altitudes with vertical drop lines and a miniature terrain profile curve of the Singapore coastline.

### 3. Track Ledger Table
- Clean read-only data grid with zero nested borders.
- Header row: 11px uppercase monospace, text `#64748b`, hairline bottom border.
- Data rows: 12px monospace, text `#f1f5f9`.
- Status values use semantic color chips: `Confirmed` (blue), `Unknown` (amber), `Stale` (amber), `Fresh` (muted blue).

### 4. 4-State Identity Chips
- Horizontal pill-strip selector for IFF lineage:
  - `Confirmed`: Border `1px solid rgba(56, 189, 248, 0.4)`, background `rgba(56, 189, 248, 0.1)`, text `#38bdf8`.
  - `Lineage`: Border `1px solid rgba(37, 99, 235, 0.4)`, background `rgba(37, 99, 235, 0.1)`, text `#60a5fa`.
  - `Unknown`: Border `1px solid rgba(251, 191, 36, 0.4)`, background `rgba(251, 191, 36, 0.1)`, text `#fbbf24`.
  - `Hostile evidence`: Border `1px solid rgba(248, 113, 113, 0.4)`, background `rgba(248, 113, 113, 0.1)`, text `#f87171`.

### 5. Timeline & Playback Controller
- Playhead track: 2px hairline bar (`rgba(255, 255, 255, 0.15)`).
- Progress indicator: `#38bdf8` filled line with a 6px circular scrubber pip.
- Transport buttons: High-contrast minimalist SVG glyphs (`play`, `pause`, `step-forward`, `step-back`).

---

## Do's and Don'ts

### Do:
- **Do** anchor every tactical line, vector, sensor cone, and engagement basket as a **native Cesium 3D entity** tied to Cartesian coordinates.
- **Do** use identical quadcopter 3D models for both Interceptor and Observer roles (Screen 01, 02).
- **Do** distinguish altitude layers unambiguously with vertical ground drop lines down to the water surface.
- **Do** use `font-variant-numeric: tabular-nums` for all telemetry readouts, timers, coordinates, and speeds.
- **Do** treat visual bounding boxes as sensor detections (`Track A`, `Track B`), not confirmed enemies.
- **Do** use `#10191e` for panels and `#0a1014` for active surface backplates.
- **Do** support offline playback by bundling verified replay scenarios (`success.json`, `miss_recovery.json`, `naive.json`).

### Don't:
- **Don't** overlay 2D HTML/SVG elements on top of the Cesium canvas using screen pixel coordinates.
- **Don't** render drones as tiny 8px point dots or clip typography into buildings without depth testing disabled.
- **Don't** add neon glows, saturated bloom effects, or sci-fi cyberpunk HUD reticles.
- **Don't** use bubbly rounded corners (`> 3px`) or pill-shaped cards.
- **Don't** classify an unconfirmed track as hostile simply because identity signals are unavailable.
- **Don't** fabricate speculative strike probabilities, target ranking tables, or fake millisecond execution loops.
- **Don't** recreate the Cesium viewer or primitives on React state updates.
