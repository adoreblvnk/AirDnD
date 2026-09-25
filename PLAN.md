# AirDnD: Autonomous Swarm Air Defense & Spatial Wargaming C2
## Tactical Engineering & Implementation Plan (SDTH 2026)

> **Product Name:** **AirDnD**  
> **Target Event:** Singapore Defense Tech Hackathon (SDTH 2026)  
> **Venue & Dates:** NUS Enterprise @ i3 | 25–27 September 2026  
> **Primary Challenge Track:** Track 03: *Interceptors (Layer 3: Onboard Autonomy & Swarm Coordination)*  
> **Secondary Integration:** Track 04: *One Picture, Many Eyes* (Strategic Ground C2 & Civilian Deconfliction)  
> **Key Judges Addressed:** MG Kelvin Fan (Chief of Air Force), Tan Peng Yam (Chief Defence Scientist), DSTA Leadership  
> **Hardware Anchor:** Physical ESP32-C6 Microcontroller (`/dev/cu.usbmodem101`)

---

## 1. Standardized Product Glossary

| Term | Official AirDnD Definition |
| :--- | :--- |
| **AirDnD** | Autonomous swarm air defense and spatial wargaming C2 platform featuring a two-tiered command architecture (Ground Strategic Intent + Edge Swarm Consensus). |
| **Brain 1 (Ground C2)** | Strategic intent gating layer. Calculates kinetic collateral debris footprints over urban HDB zones and provides the Commander with 3 distinct Courses of Action (COAs) for 1-click authorization. |
| **Brain 2 (Sky Swarm)** | Decentralized edge swarm consensus engine. When Electronic Warfare (EW) cuts ground links, interceptors use EscrowCore to divide targets locally in $<25\text{ ms}$ over mesh radio. |
| **EscrowCore** | A bounded-counter CRDT distributed protocol that treats physical interceptor commitments as finite mathematical rights, mathematically preventing split-brain overkill across radio partitions. |
| **Split-Brain Overkill** | The physical failure mode where isolated swarm clusters independently commit scarce interceptors to the same threat while adjacent threats leak through to civilian assets. |
| **WTA** | Weapon-Target Assignment (the optimization matching defensive interceptors to incoming threats). |
| **MoT (Mixture of Threats)** | An asymmetric salvo combining heterogeneous threats: Shahed fixed-wings (200 km/h), subsonic jet UAS (600 km/h), and agile FPVs (130 km/h). |
| **Littoral Killbox** | Designated maritime engagement corridor over Singapore territorial waters where kinetic intercepts are permitted with zero debris risk to land. |
| **HIL (Hardware-in-the-Loop)** | Physical ESP32-C6 microcontroller plugged into the workstation acting as Swarm Node #1, running bare-metal C++ auction math in $<3\text{ ms}$. |
| **Nose-Cam** | 1st-person terminal seeker camera locked to the lead interceptor executing Proportional Navigation (PN) pursuit with range-to-impact counters. |
| **Timeline Scrubber** | Interactive VCR-style time-series buffer allowing judges to rewind the live battle 15–30 seconds, change doctrine or jamming conditions, and watch the simulation branch in real time. |

---

## 2. Integrated 3D Model Assets

AirDnD now incorporates real binary glTF (`.glb`) 3D assets in `public/models/`:

| Entity | Model File | Visual Behavior |
| :--- | :--- | :--- |
| **Hostile Strike Drones (Shaheds/UAVs)** | `public/models/mq9.glb` (531 KB) | Full 3D military drone with twin tail and wings. Trailing red trajectory ribbon. |
| **AirDnD Interceptor Drones** | `public/models/jet.glb` (265 KB) | Supersonic delta-wing interceptor. Trailing cyan pursuit trail. Node D-01 flagged with gold marker. |
| **Civilian Maritime Vessels** | `public/models/ship.glb` (225 KB) | Commercial cargo container ship / oil tanker navigating Singapore Strait via live AISStream data. |
| **Civilian Commercial Aircraft** | `public/models/airplane.glb` (87 KB) | Commercial airliner climbing out of Changi Airport via live OpenSky ADS-B data. |

---

## 3. High-Agency Architecture: "The Interactive Wargaming Sandbox"

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    TACTICAL BROWSER DASHBOARD (Vite + CesiumJS)            │
│  - Photorealistic 3D Singapore (Google 3D Tiles + 3D GLB Models)           │
│  - Nose-Cam (Seeker View): 1st-person dogfight chase locked to Node D-01   │
│  - FLIR Thermal / NVG Shader Toggle: Military heat-vision modes             │
│  - Paint-a-Raid Tool: Click/drag anywhere to launch custom hostile salvos  │
│  - Timeline Scrubber (VCR Rewind): Rewind 20s and branch with new math     │
│  - Kinetic FX: Expanding shockwave rings, tumbling debris, Web Audio boom  │
│  - Swarm Engine: Decentralized P2P WTA auction + EscrowCore CRDTs          │
└───────────────────────┬─────────────────────────────▲───────────────────────┘
                        │ HTTP / WebSocket            │ Web Serial (/dev/cu.usbmodem101)
                        ▼                             │
┌───────────────────────────────────────┐  ┌──────────┴──────────────────────┐
│       AIRDND LOCAL PROXY SERVER       │  │   PHYSICAL ESP32-C6 NODE        │
│  - Vite configureServer middleware    │  │  - 32-bit RISC-V @ 160MHz       │
│  - AISStream & OpenSky Ingestion      │  │  - Embedded C++ Consensus Engine│
│  - ATAK Cursor-on-Target Broadcaster  │  │  - Sub-3ms Bid Computation      │
│  - Server-side serial auto-reconnect  │  │  - Physical EW Kill Switch (GPIO)│
└───────────────────────────────────────┘  └─────────────────────────────────┘
```

---

## 4. Four-Sprint Implementation Plan

### Sprint 1: 3D Drone Models & Nose-Cam Seeker View
- [ ] Bind `public/models/mq9.glb` to threats and `public/models/jet.glb` to interceptors in Cesium using dynamic heading/pitch orientations.
- [ ] Build the **1st-Person Nose-Cam View**: Press `C` or click an interceptor to drop the camera into its nose, showing the target locked in crosshairs with closing range tickers.
- [ ] Add **Manual Pilot Takeover**: In nose-cam mode, allow arrow keys/WASD to nudge the interceptor's flight path, with PN guidance visibly correcting back to target.

### Sprint 2: Anti-Hardcode Interactive Tools (Paint-a-Raid & Timeline Scrubber)
- [ ] Build the **Paint-a-Raid Tool**: A button enabling the user/judge to click and drag an attack vector across the Singapore Strait, instantly spawning a custom threat wave.
- [ ] Build the **Interactive Timeline Scrubber**: An in-memory state buffer recording the last 60 seconds. Scrub backward to replay and branch alternative decisions.
- [ ] Add the **Drone Brain Inspector**: Click any drone to see its live battery, top 3 auction bids, and a red `[KILL DRONE]` button that forces immediate dynamic rebidding.

### Sprint 3: Visual "Juice" & Immersion (Explosions, FLIR, Audio)
- [ ] **Kinetic Impact FX**: Expanding shockwave rings, bright flash, and tumbling burning debris particles on target intercept.
- [ ] **FLIR / NVG Shaders**: Press `V` to toggle between standard 3D tiles, FLIR (thermal heat-vision: white drones over black sea), and NVG (phosphor green).
- [ ] **Tactical Web Audio Engine**: Procedural radar pings, radio squelch clicks, EW jamming klaxons, and deep kinetic explosion booms ($0 cost, 100% offline).

### Sprint 4: ESP32 Hardware Bridge & Demo Hotkeys
- [ ] Implement automatic server-side serial reconnection to `/dev/cu.usbmodem101`.
- [ ] Live serial terminal HUD drawer showing raw C++ ASCII bid frames.
- [ ] Automated 2-minute pitch sequence hotkeys (`1`-`4`, `Spacebar`, `R`).
