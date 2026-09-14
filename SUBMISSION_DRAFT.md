# SalvoCore — SDTH 2026 Challenge Track Synthesis & Submission Dossier

**Target Event:** Singapore Defense Tech Hackathon (SDTH 2026)  
**Organizers:** NUS Enterprise, Defence Venture Lab (DVL), TUM Venture Labs  
**Key Dates:** Challenge Selection: 15 Sep 2026 (2359H) | Main Hackathon: 25–27 Sep 2026 @ NUS Enterprise @ i3  
**Target Judging Panel:** MG Kelvin Fan (Chief of Air Force), Tan Peng Yam (Chief Defence Scientist), Prof Quek Tong Boon, Daryl Lee & Mui Whye Kee (DSTA), Timo Levo (Accenture)  
**Evaluation Rubric:** 40% Technical Execution ("Does it work?") | 30% Operational Fit | 30% Venture Incubatability  

---

## 1. Challenge Track Selection & Strategic Synthesis

### Selected Primary Track
**`03. Interceptors — Layer 3: Onboard Autonomy & Swarm Coordination`**  
*(Cross-cutting Strategic Interlock with `04. One Picture, Many Eyes` for Ground Commander Intent & Debris Geofencing)*

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    STRATEGIC C2 LAYER (PS/04 Interlock)                    │
│   Multi-Source Ingest (CoT/ADS-B) ➔ Urban Debris Safety ➔ 3-Card Intent Gating│
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ Commander 1-Click Authorize
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│               TACTICAL EDGE SWARM (PS/03 Layer 3 - Core Submission)        │
│    EW Jamming Link Severed ➔ P2P Auction Mesh ➔ Sub-100ms WTA Allocation    │
│      Dynamic Reassignment upon Interceptor Attrition ➔ Zero Leakage        │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Strategic Rationale & Alignment Matrix

| Evaluation Dimension | How SalvoCore Optimizes for the Rubric & Judges |
| :--- | :--- |
| **40% Does it work? (Software Demo)** | Directly addresses the exact requirements of **PS/03 Layer 3**: deterministic simulation benchmarking decentralized Peer-to-Peer (P2P) Weapon-Target Assignment (WTA) auction convergence, message overhead under high packet loss, dynamic reassignment on intercept failure, and leakage reduction against naive nearest-neighbor baselines. |
| **30% Operational Fit (SAF & SG Reality)** | Solves Singapore’s core defense vulnerability: **zero strategic depth (50 km)** and warning times measured in seconds. In a dense Electronic Warfare (EW) environment, central links will be severed. SalvoCore eliminates the single point of failure (central C2) while enforcing safety geofencing to prevent kinetic debris over dense HDB residential estates. |
| **30% Venture Incubatability (DVL "Little Red Dome")** | Fits DVL's "Lord of the Rings" prime strategy. SalvoCore is the **software-defined autonomous coordination brain** that is hardware-agnostic—slotting onto COTS/indigenous interceptor airframes (Layers 1 & 2) and bridging into existing SAF C2 ecosystems via Cursor-on-Target (CoT). |

---

## 2. Google Form Submission

* **Google Form URL:** [SDTH 2026 Challenge Selection Form](https://docs.google.com/forms/d/e/1FAIpQLSf5FF0zB5-y3EDVy3z7KsbwOemJ7dlkGkBdtWVzg4VT497bhw/viewform?usp=sharing&ouid=115329330951351982487)
* **Team Name:** SalvoCore
* **Challenge Track:** `03. Interceptors (Layer 3: Onboard Autonomy & Swarm Coordination)`

### One-Liner Description
> **"A two-tiered air defense software engine combining 1-click agentic commander intent gating with jamming-resilient, decentralized P2P swarm auction algorithms to defeat mass drone salvos in seconds."**

---

## 3. WhatsApp Group Pitch Submission (4 Prompts)

*Copy-paste ready for the official SDTH 2026 WhatsApp Group:*

---

### 🛡️ Team SalvoCore | Challenge Selection: 03. Interceptors (Layer 3: Onboard Autonomy & Swarm Coordination)

**Q1: What problem are you solving, and in what time frame (near term or longer term)?**
* **The Problem:** In mass asymmetric drone salvos (100+ inbound attritable threats), traditional air defense suffers two fatal bottlenecks: (1) **Operator Cognitive Saturation**—human operators cannot manually pair weapons to targets within Singapore’s 50 km zero-depth reaction window (seconds, not minutes); and (2) **Link Denial Single Point of Failure**—adversarial Electronic Warfare (EW) severing central radar/ground telemetry paralyzes centralized C2.
* **Time Frame:**
  * **Near-Term (1–2 Years):** Software-defined C2 intent orchestration layer and edge-consensus coordination algorithms deployable on commercial-off-the-shelf (COTS) and existing inventory interceptor platforms.
  * **Longer-Term (3–5 Years):** Sovereign, standard-issue autonomous swarm coordination operating across heterogenous multi-domain counter-UAS interceptors (kinetic FPVs, RF effectors, and automated turrets) under DVL’s "Little Red Dome" framework.

---

**Q2: What is your proposed approach?**
* SalvoCore decouples strategic authorization from split-second tactical execution through a **two-tiered architecture**:
  1. **Strategic Layer (Commander Intent & Collateral Gating):** An agentic pipeline analyzes multi-source tracks, clusters threat corridors, models kinetic collateral debris footprints (geofencing away from high-density HDB estates and Changi airspace), and streams 3 clear COA strategy cards for single-click commander authorization.
  2. **Tactical Layer (Decentralized Edge Auction WTA):** Once authorized or upon total comms link severance (EW jamming), flying interceptors transition to a distributed Peer-to-Peer (P2P) market-based auction consensus engine (CBBA). Interceptors dynamically bid on targets locally over low-bandwidth mesh radio ($O(N \log N)$ complexity), instantly reassigning targets upon interceptor attrition or miss without requiring central ground telemetry.

---

**Q3: What will you build or demonstrate through software codes to show that it works?**
* We will deliver a **live, deterministic software benchmark & 3D tactical simulation** demonstrating:
  1. **Distributed WTA Auction Convergence:** Real-time P2P target bidding across a 50+ interceptor swarm converging to globally optimal assignments in under 100 milliseconds.
  2. **EW Jamming Resilience & Link Dropoff:** Telemetry link to ground severed mid-engagement (100% packet loss); the swarm seamlessly degrades to edge consensus and re-optimizes assignments locally.
  3. **Dynamic Reassignment & Leakage Benchmarking:** Injected effector failures/misses triggering instantaneous target rebidding, proving statistically significant reduction in salvo leakage rates compared to greedy nearest-neighbor baselines.
  4. **Collateral Safety Geofencing:** Real-time kinetic intercept corridors calculated over Singapore littoral waters, preventing debris impact on urban zones.

---

**Q4: If it works, what future developments would be needed to make it an operational solution?**
* **MIL-STD & Hardware-in-the-Loop (HIL) Flight Validation:** Porting the lightweight edge consensus engine to embedded companion microcontrollers (STM32/NVIDIA Jetson) on physical interceptors and flight-testing over mesh radios (Silvus/Doodle Labs) under active RF jamming.
* **Heterogeneous Weapon-Target Matching:** Expanding the auction cost function to pair mixed-effector arsenals (directed energy, electronic jamming, net interceptors, and kinetic hit-to-kill drones) based on threat classification and kinematic energy budgets.
* **SAF/C4I Integration:** Hardening protocol adaptors for military standards (STANAG 4586, Cursor-on-Target, Link 16) and co-developing operational doctrine with RSAF/DSTA for calibrated commander trust thresholds and rules of engagement (ROE).
