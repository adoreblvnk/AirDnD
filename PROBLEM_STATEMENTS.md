# Singapore Defense Tech Hackathon (SDTH 2026) — Overview, Briefs & Problem Statements

---

## 📢 Participant Announcement & Submission Guide (September 2026)

### Key Dates & Timeline
- **Main Hackathon Event:** **25–27 September 2026** at NUS Enterprise @ i3 (Singapore).
- **Format:** 48-hour build challenge. Pure software simulation is fully valid; hardware bench rigs serve as credibility anchors.

### Judging Values & Build Support
- **Judging Focus:** Creativity and technical/scientific feasibility. A working proof of concept tackling a hard problem beats a safe, superficial demo.
- **Special Challenge ("Lord of the Rings"):** Integrating specialized autonomous capabilities into a cohesive defense capability under DVL's "Little Red Dome" framework.

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
