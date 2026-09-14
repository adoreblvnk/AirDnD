# Singapore Defense Tech Hackathon (SDTH 2026) — Overview, Briefs & Problem Statements

---

## 📢 Participant Announcement & Submission Guide (September 2026)

### 1. Key Deadlines & Timeline
- **Challenge Selection Deadline:** **Tuesday, 15 Sep 2026, 2359H** (early submission unlocks mentor assignment and early build approval).
- **Early Build Window:** Upon proposal finalization with the Defence Venture Lab (DVL) team and assigned mentors, teams can begin building immediately prior to the event.
- **Main Hackathon Event:** **25–27 September 2026** at NUS Enterprise @ i3.

### 2. Submission Requirements
1. **Google Form (1 submission per team):**
   - **URL:** [SDTH 2026 Challenge Selection Form](https://docs.google.com/forms/d/e/1FAIpQLSf5FF0zB5-y3EDVy3z7KsbwOemJ7dlkGkBdtWVzg4VT497bhw/viewform?usp=sharing&ouid=115329330951351982487)
   - Submit selected challenge track and one-liner description.
2. **WhatsApp Group Pitch (Guided by 4 Prompts):**
   - **Q1 (Scope & Horizon):** What problem are you solving, and in what time frame (near term or longer term)?
   - **Q2 (Approach):** What is your proposed approach?
   - **Q3 (Demonstrable Deliverable):** What will you build or demonstrate through software codes to show that it works?
   - **Q4 (Operational Roadmap):** If it works, what future developments would be needed to make it an operational solution?

### 3. Judging Values & Build Support
- **Judging Focus:** Creativity and technical/scientific feasibility. A working proof of concept tackling a hard problem beats a safe, superficial demo.
- **Reimbursement & BOM:** Reasonable hardware expenses considered with a Bill of Materials (BOM) and justification write-up.
- **3D Printing Support:** Teams can submit CAD/print files and write-ups for pre-event printing (printers also available on-site).
- **Special Challenge ("Lord of the Rings"):** Select 2-day teams may be invited to partner with the 3-month extended track for a dedicated prize pool ([Reference](https://lnkd.in/p/gjzy8bxG)).

---

## 00. Overview & General Constraints (`SDTH/2026/PS/00`)

### Core Thesis
* **The Paradigm Shift:** Asymmetric, low-cost attritable systems ($2,000 drones) now defeat multi-million dollar defense architectures. Advantage belongs to speed of adaptation and software-defined fielding.
* **Singapore Constraints:** Zero strategic depth (50 km wide), no rear area, zero stockpile independence during crisis. Warning and reaction times are measured in minutes/seconds.
* **Format:** 48-hour challenge (25–27 September 2026, NUS Enterprise @ i3). Pure software simulation is fully valid; hardware bench rigs serve as credibility anchors.

### Deliverables & Evaluation Criteria
1. **Video Demonstration:** Max 30 seconds. Working prototype or recorded simulation.
2. **Presentation Deck:** 3 minutes live pitch. Spoken to, not read from.
3. **Technical Archive:** Single ZIP containing source code, CAD/models, simulation configs, datasets, test logs, and bench data.
4. **README:** File manifest and deterministic reproduction/run instructions.
5. **Judging Priorities:** Novelty of angle, clarity of formulation, and demonstrated technical feasibility/soundness (physics/math backing over shallow wrappers).

---

## 01. Green Corridor (`SDTH/2026/PS/01`)
*Unmanned ground & littoral operations under tropical canopy and extreme terrain.*

### Situation & Bottlenecks
* **Environment:** Closed canopy eliminates GPS/GNSS and satellite comms; only 1–2% ambient light reaches the forest floor. Wind-driven self-similar foliage causes optical flow and visual SLAM to drift rapidly.
* **RF Attenuation:** Dense wet vegetation severely degrades 2.4 GHz and 5.8 GHz links, especially during tropical downpours.
* **Hardware Degradation:** Salt aerosol, daily condensation, and fungal growth (MIL-STD-810) cause insidious electrical/optical failure.
* **Operator Ratio & Attrition:** 1:1 operator-to-platform ratios fail at scale. Platforms must be cheap, expendable, or recoverable without risking human lives.
* **Tidal Transition:** Mudflats and mangroves bog wheeled/tracked vehicles and ground boats.

### Key Focus Areas & Examples
* **Lidar/Radar Structure SLAM:** Using tree trunks and terrain relief rather than vision for localization.
* **Short-Range Fiber-Optic Tethers:** Capitalizing on Singapore's compact operational distances where fiber tethers are viable and immune to RF attenuation/jamming.
* **Substrate Fluidization:** Bio-inspired propulsion (mudskipper oscillation) to change substrate shear strength rather than fighting traction.
* **Autonomous Ground Turrets:** Relocating effectors to ground robotic platforms to engage low-altitude drones beneath the canopy.

---

## 02. Creative Sensing (`SDTH/2026/PS/02`)
*Detecting non-emissive, low-RCS, ambient-temperature threats (e.g. fiber-optic drones).*

### Situation & Bottlenecks
* **The Invisible Target:** Fiber-optic and autonomous pre-programmed drones emit zero RF, use fiberglass/composite airframes with near-zero radar cross section (RCS), and match ambient air temperature in tropical climates.
* **The False Alarm Threshold:** A system generating $\ge 2$ false alarms per hour will be disabled by operators. Dense civilian drone traffic in Singapore makes background rejection critical.
* **Ambient Noise:** Acoustic detection ranges collapse near expressways, maritime ports, and Changi flight corridors.
* **Passive Sensing Geometry:** Passive sensors provide bearing only; determining range requires synchronized multi-node triangulation and complex track association.

### Key Focus Areas & Examples
* **Distributed Low-Cost Acoustic Networks:** Mass arrays of cheap, distributed acoustic nodes (prioritizing coverage economics over single-sensor range).
* **Adjacent Target Signatures:** Detecting the trailing fiber cable along transit corridors or disturbances in ambient signals rather than hunting the airframe itself.
* **Uncued vs. Cued Architecture:** Explicitly defining how broad-area uncued discovery hands off to precision tracking.

---

## 03. Interceptors (`SDTH/2026/PS/03`)
*Autonomous pilotless interceptor swarms defeating high-speed attritable raids (300–600 km/h).*

### Situation & Bottlenecks
* **Pilot Bottleneck:** Manual FPV piloting (1 pilot per drone) cannot scale against mass raids and is unsustainable for small armed forces.
* **Speed Disparity:** Modern jet-powered attack drones cruise at 300–600 km/h, outrunning commercial quadcopters and requiring tail-chase intercept geometry.
* **Latency Budget:** In terminal pursuit, reaction time determines miss distance against jinking/weaving targets.
* **Economic Exchange Ratio:** Interceptor seekers must stay low-cost ($2k airframe cannot rely on a $15k seeker). Expending high-speed rounds on cheap decoys is an economic defeat.
* **Urban Collateral:** Kinetic debris over dense residential estates (HDBs) demands managed interception corridors or net/entanglement capture.

### The Four Sub-Layers (Teams pick one)
1. **Drone & Propulsion Design:** Airframe, thermal limits, time-to-speed, and high-G structural margins for $\ge 500\text{ km/h}$ tail chases (with 3D printed model + simulation).
2. **Terminal Guidance & Seeker:** Millisecond-budget sensor-compute-control loop running against evasive trajectories, rejecting decoys/birds, and executing abort logic.
3. **Onboard Autonomy & Swarm Coordination:** Decentralized peer-to-peer Weapon-Target Assignment (WTA) under total base link denial; dynamic reassignment on intercept failure; self-collision avoidance; leakage metrics against naive baselines.
4. **Autonomous Patrol & Sustainment:** Closed-loop dock-recharge-rotate cycle modeling fleet size requirements to maintain continuous 24/7 airborne CAP.

---

## 04. One Picture, Many Eyes (`SDTH/2026/PS/04`)
*Multi-modal, multi-timescale intelligence and sensor fusion into actionable C2.*

### Situation & Bottlenecks
* **Information Paradox:** Ample data exists across radars, maritime AIS, aviation ADS-B, traffic cams, and OSINT, but resides in disconnected silos with conflicting timestamps, identities, and confidence models.
* **Timescale Disparity:** Strategic warning (weeks/months: logistics patterns, narrative shifts, port abnormalities) vs. Tactical approach (minutes/seconds: inbound kinematic tracks) are rarely unified.
* **ID-Free Association:** Correlating dense swarm tracks based solely on kinematics and geometry without shared platform IDs.
* **Sensor Uncertainty & Adversarial OSINT:** Preventing confident-but-faulty sensors or poisoned open-source feeds from skewing the common picture.
* **Sensor-to-Shooter Actionability:** The bridge from fused situational awareness to automated weapon allocation.

---

## 05. Strategic Context & Venture Lab Blueprint (`Background_ NUS Defense Venture Lab.pdf`)

### 1. The Strategic Imperative
* **National Directive:** PM Lawrence Wong (Mandai Hill Camp, April 2026) highlighted that national resilience requires sovereign technology, agile domestic supply chains, and rapid indigenous capability buildup.
* **Asymmetric Cost-Exchange Inversion:** Cheap off-the-shelf hardware and open CAD files ($2,000 FPVs) render multi-million dollar traditional air defense unviable. 
* **Supply Chain Fragility ("Flow beats Stock"):** Stockpiles deplete in days (e.g. 155mm shell crunches); export controls and foreign hoarding mean overseas supply cannot be relied on during a crisis. True resilience is regenerative domestic production and rapid software adaptation.
* **Regional Context:** Weakening arms control regimes and proliferation of high-end weaponry in the Indo-Pacific (e.g. BrahMos cruise missiles to Indonesia, Philippines, Vietnam).

### 2. Defense Venture Model & Global Benchmarks
* Defense technology is now a massive, investable frontier ($750B market alongside Cloud, Telecom, and EV).
* Startups now build capabilities primes once owned alone:
  - **SpaceX:** Hardened reusable rocket physics + Starshield.
  - **Palantir ($341B):** Gotham/Foundry/AIP hardened against classified adversarial deployment.
  - **Anduril ($61B):** Lattice OS — software-defined operating system for multi-domain autonomous systems.
  - **Helsing ($18B):** European sovereign defense AI.

### 3. Singapore's Ecosystem & The "Missing Feeder"
* **Structure:**
  - *Mission Owners:* MINDEF, SAF.
  - *Depth & Scale:* DSO National Laboratories, DSTA, ST Engineering.
  - *Research Pipeline:* NUS, NTU, A*STAR.
  - *The Missing Feeder:* **NUS Defense Tech Venture Lab (DVL)** under NUS Enterprise — designed to convert top-tier STEM engineering talent into scalable defense tech startups.
* **Themes:**
  - *The Little Red Dome:* Next-gen distributed, low-cost air defense.
  - *The Neo-Battalion:* Evolving ground/littoral robotics and sensing.
  - *The Lord of the Rings Strategy:* Thinking like a prime by integrating modular specialized startups into a cohesive defense capability.

### 4. Judging Panels, Criteria & Incubation Pathway
* **Guest of Honour (GOH):** **MG Kelvin Fan** (Chief of Air Force), presenting prizes on 27 Sep.
* **Distinguished Judges:**
  - **MG Kelvin Fan** (Chief of Air Force)
  - **Prof Quek Tong Boon** (Former Chief Defence Scientist)
  - **Mr Tan Peng Yam** (Chief Defence Scientist)
  - **Mr Daryl Lee** (Head of Engineering, DSTA)
  - **Mr Mui Whye Kee** (Group Technology Officer, DSTA)
  - **Mr Timo Levo** (Global Defence Lead, Accenture)
* **Judging Weightage:**
  - **40% Does it work?** Demonstrated technical proof through software/hardware execution.
  - **30% Does the mission need it?** Operational fit and alignment with SAF/Singapore defense constraints.
  - **30% Can it be incubated?** Team, unit economics, and venture pathway.
* **Incubation Award:** Top 1–3 teams qualify for the 9-month NUS Defence Tech Venture Lab program with **$100,000 in cash and in-kind support**.
* **Prizes:**
  - *2-Day Track Main Prize:* 1st ($8k), 2nd ($4k), 3rd ($2k).
  - *2-Day Lord of the Rings Prize:* 1st ($3k), 2nd ($2k), 3rd ($1k).
  - *3-Month Track Main Prize:* 1st ($10k), 2nd ($5k), 3rd ($3k).
  - *3-Month Lord of the Rings:* 1st ($5k), 2nd ($3k), 3rd ($2k).

---

## Technical Mapping to SalvoCore

| SDTH Challenge Layer | Problem Statement Focus | SalvoCore Technical Implementation |
| :--- | :--- | :--- |
| **Strategic Layer (Ground C2)** | **PS/04 (One Picture, Many Eyes)** & **DVL Little Red Dome** | Multi-source ingest (Radar/ADS-B/CoT), collateral debris calculation around HDB zones, agentic threat evaluation, and 1-click 3-card commander intent gating. |
| **Tactical Layer (Edge Swarm)** | **PS/03 Layer 3 (Onboard Autonomy)** & **DVL Counter-Swarm** | Decentralized P2P auction / consensus engine executing millisecond Weapon-Target Assignment (WTA) under total EW jamming / zero ground telemetry. |
| **Economic & Kinetic Allocation** | **PS/03 Layer 3 & Layer 4** & **DVL Cost-Exchange Inversion** | Cost-aware weapon pairing (preserving high-energy interceptors for high-speed jet threats; filtering low-cost decoys). |
