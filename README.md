# AirDnD: Smart Air Defense C2 with Jamming-Resilient Swarm Coordination

> **Target Event:** Singapore Defense Tech Hackathon (SDTH 2026)  
> **Event Link:** [https://luma.com/sdth-2026](https://luma.com/sdth-2026)  
> **Dates & Venue:** 25–27 September 2026 @ NUS Enterprise @ i3  
> **Organizers:** European Defense Tech Hub (EDTH), NUS Enterprise, TUM Venture Labs, Defence Venture Lab (DVL)  
> **Challenge Track:** Track 03: *Interceptors (Layer 3: Onboard Autonomy & Swarm Coordination)* with Track 04: *One Picture, Many Eyes* (Strategic Ground C2 Interlock)

---

## 1. Executive Summary

When hundreds of low-cost attritable drones attack simultaneously in a zero-depth environment like Singapore (50 km wide), traditional air defense suffers two fatal bottlenecks:
1. **Operator Cognitive Overload:** Manual weapon-target pairing collapses when warning times drop to seconds.
2. **Link-Denial Single Point of Failure:** Adversarial Electronic Warfare (EW) cuts central radar and ground telemetry links, paralyzing centralized Command & Control (C2).

**AirDnD** decouples strategic authorization from tactical execution through a **two-tiered architecture**:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                 1. STRATEGIC LAYER (Ground C2 / Human-on-the-Loop)          │
│  - Multi-source track ingestion (Radar, ADS-B, Cursor-on-Target)            │
│  - Real-time collateral debris geofencing away from dense HDB residential   │
│  - Agentic AI synthesizes 150+ threats into 3 clear Strategy Cards (COAs)   │
│  - Human commander authorizes defense policy with a single click            │
└──────────────────────────────────────────────────────────────────────┬──────────┘
                                       │ 1-Click Commander Authorization
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                 2. TACTICAL LAYER (Decentralized Edge Swarm)                │
│  - Operates when Electronic Warfare (EW) jams ground links (100% loss)      │
│  - Interceptors communicate peer-to-peer over local mesh (802.15.4 / Wi-Fi) │
│  - Decentralized Weapon-Target Assignment (WTA) converges in <100ms         │
│  - EscrowCore & CRDTs prevent split-brain overcommitment under partitions   │
│  - Dynamic rebidding upon interceptor attrition or missed targets            │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Core Technical White Space

- **EscrowCore (Partition-Safe Commitment Credits):** In a fragmented radio mesh, disconnected interceptor clusters risk double-spending scarce interceptors on the same threat. AirDnD partitions finite engagement rights using bounded-counter CRDTs, preserving safety invariants without requiring live global consensus.
- **Collateral-Aware Littoral Geofencing:** Real-time computation of kinetic intercept footprints, ensuring engagements occur over littoral waters and away from high-density urban areas.
- **Hardware-in-the-Loop (HIL) Credibility Anchor:** Core consensus algorithms benchmarked on low-cost **ESP32** microcontrollers (sub-5ms loop time, <512KB SRAM footprint) to prove sim-to-real deployability on expendable airframes.

---

## 3. Repository Layout

| Path | Description |
| :--- | :--- |
| `src/` | 3D tactical digital twin, C2 dashboard, swarm simulation, voice control |
| `src/airdnd/` | AirDnD tactical defense layer (simulation, swarm consensus, serial, audio) |
| `server/` | Vite dev server, provider middleware, key management |
| `firmware/airdnd_node/` | ESP32-C6 embedded consensus firmware (Arduino C++) |
| `public/models/` | 3D aircraft models (MQ-9, 787, ATR-72, Citation, Bell 206, C172, jet, ship) |
| `scripts/` | Dev launchers, QA probes, build helpers |
| `config/` | CCTV source configurations by city |
| `SETUP_GUIDE.md` | GCP + OpenAI + Cesium ion setup instructions |
| `PROBLEM_STATEMENTS.md` | Track 03 & 04 briefs, constraints, and judging criteria |
| `resources/` | Official SDTH 2026 organizer problem briefs |

---

## 4. Planned Deliverables (25–27 Sep 2026)

1. **3D Tactical Digital Twin & C2 Dashboard:**
   - Single-page interactive simulation (Three.js / Canvas).
   - Inbound 40–150 threat salvo (Mixture of Threats: Shaheds, high-speed jet drones, FPVs).
   - Interactive Ground C2 with 3-Card Strategy selection and HDB collateral geofencing.
   - EW Jamming trigger: instant degradation to decentralized P2P swarm auction with sub-100ms convergence and zero leakage.
2. **Physical ESP32 Bench Rig (Hardware Credibility Anchor):**
   - Embedded C++ consensus running live on an ESP32 connected via USB/Serial to demonstrate real-time compute feasibility under memory and power constraints.
3. **Submission Assets:**
   - 30-second demonstration video.
   - 3-minute pitch deck for the judging panel.
   - Technical archive with full reproducible source code and benchmark logs.

---

## 5. Quick Start

Use **Node.js 24.x (24.14.0 or later) or 26.x**.

```bash
git clone https://github.com/adoreblvnk/AirDnD.git
cd AirDnD
npm ci
npm run dev
```

Open **`http://localhost:4173`**.

For GCP, OpenAI, and Cesium ion key setup, see [SETUP_GUIDE.md](SETUP_GUIDE.md).
