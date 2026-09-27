# AirDnD: Autonomous Swarm Coordination Under Total Radio Blackout

**Proposal & Technical Report · Singapore Defense Tech Hackathon 2026 (SDTH 2026)**  
**Challenge Track:** 03 Interceptors (Layer 03: Onboard Autonomy and Swarm Deployment)  
**Authors:** AirDnD Team · **Target:** NUS Defense Venture Lab / MINDEF / DSTA  

---

## 1. What Exists Today & What Is New About AirDnD

Air defense economics are inverted: forces expend $\$1.5\text{M}$ to $\$4\text{M}$ surface-to-air missiles against loitering munitions costing under $\$2,000$. While 1-to-1 FPV drone pilots solved this in Ukraine, Singapore lacks a 100,000-pilot mobilization reserve.

Autonomous swarm proposals collapse under electronic warfare (EW) along five physical boundaries:
1. **"Shoot the Queen" Fragility**: Centralized airborne coordinators ("mother drones") create an obvious single point of failure; blinding one node decapitates the entire swarm.
2. **Broadband Barrage Jamming**: Low-cost drone transceivers ($100\text{ mW}$ to $1\text{ W}$) are overwhelmed by multi-kilowatt standoff noise across 433 MHz to 5.8 GHz; SINR drops far below the Shannon limit.
3. **IoT Mesh Breakdown**: Dynamic aerial topologies break Directed Acyclic Graphs in Wi-SUN/RPL (routing recalculation takes tens of seconds for 4-second engagements), LoRa suffers $>95\%$ packet collision under load, and Wi-Fi HaLow lacks military coding gain.
4. **Clock Drift Under GNSS Denial**: Without 1PPS satellite timing, crystal drift (5–20 ppm) desynchronizes frequency-hopping (FHSS) bins within minutes, destroying rendezvous.
5. **Unit Economics**: Tactical military MANET radios cost $\$10,000$ to $\$25,000$ each—defeating the premise of $\$1,000$ attritable airframes.

**What AirDnD Does**: AirDnD enforces **Coordination Without a Shared Truth**. The swarm operates under **total radio blackout**: zero ground links, zero inter-drone RF packets, and zero shared assignment tables. Interceptors physically observe neighboring aircraft trajectories, infer friendly intent locally via an onboard sub-millisecond INT8 neural belief model, predict coverage gaps, and execute preloaded doctrine. When radios vanish, physical motion becomes the message.

## 2. Operational Context, Target User, & Task Transformation

* **Operational End-User**: RSAF **Air Defence and Operations Command (ADOC)**, specifically the **Air Surveillance and Control Group (ASCG)** and coastal air defense batteries defending Jurong Island, Changi approaches, and Marina Bay.
* **Singapore's Tactical Constraints**: In a 50 km corridor with no strategic depth, jet drones cruising at $400\text{--}600\text{ km/h}$ cross into critical infrastructure in under 45 seconds, with terminal engagements deciding interdiction in 3 to 5 seconds.
* **The Single Task Changed: Autonomous Saturation Interdiction**:
  * *Today*: Operators manually allocate missile batteries, or radio C2 links attempt to task individual drones. Under heavy jamming, links sever; drones enter fail-safe loiters or crash while hostiles penetrate.
  * *With AirDnD*: Operators define coastal engagement corridors and launch an attritable 100-drone swarm. From launch onward, **zero human intervention and zero RF emissions occur**. The swarm autonomously self-organizes into a 3D picket wall, arbitrates target allocation, executes 2-on-1 backup recovery when rounds miss, and enforces collision safety.

## 3. How It Works: System Architecture & Mathematical Foundations

AirDnD couples a bounded neural belief estimator with inspectable deterministic flight control:

**3D Vertical Picket Grid ("Raptor Stoop")**: Interceptors pre-position in a staggered 3D grid at high altitudes ($250\text{ m to }400\text{ m}$), above hostile ingress ($100\text{ m to }200\text{ m}$). Downward optical seekers project targets against dark maritime water, eliminating tropical sun glare, while gravity accelerates terminal dive attacks.

**System One Neural Belief Engine**: Each drone runs an onboard PyTorch GRU/MLP model quantized to INT8 ONNX ($20.2\text{ KB}$ footprint, $0.0093\text{ ms}$ p95 latency). Taking noisy local track history as input, it emits calibrated probabilities and spatial predictions: $\mathbf{b}_j = [ P(\text{leak}_j),\, P(\text{success}_{i,j}),\, P(\text{covered}_j),\, \hat{\mathbf{x}}_{\text{int},j},\, \hat{t}_{\text{int},j},\, \hat{\tau}_{\text{expiry},j} ]$.

**Deterministic Mission Utility & 8-Stage Tie-Breaking**: Beliefs feed an expected-loss objective:
$$\text{utility}(i, j) = \text{consequence}(j) \cdot P(\text{leak}_j) \cdot P(\text{success}_{i,j}) \cdot (1 - P(\text{covered}_j)) - C_{\text{exp}} - C_{\text{batt}} - C_{\text{cov}} - C_{\text{col}}$$
Actions tied within $\epsilon = 0.02$ ($|\text{score}_a - \text{score}_b| \le \epsilon$) resolve via an 8-stage lexicographical cascade: sector ownership $\to$ lower friendly coverage ($1 - P(\text{covered})$) $\to$ boundary urgency ($T_{\text{boundary}}$) $\to$ action success ($P(\text{success})$) $\to$ earlier intercept time ($T_{\text{intercept}}$) $\to$ corridor preservation ($C_{\text{cov}}$) $\to$ resource conservation $\to$ stable track ID hash.

**Progress-Aware Switching Hysteresis**: Target switching requires an increasing utility margin proportional to normalized intercept progress $p$: $p = \operatorname{clamp}(1 - T_{\text{remaining}}/T_{\text{commit}},\, 0,\, 1)$, with margin $\Delta U_{\text{switch}}(p) = 0.05 + 0.10p$ required for $N = 3$ consecutive ticks. Once within $T_{\text{terminal}}$, switching is locked.

**Lead-Observer 2-on-1 Cell Recovery Doctrine**: Forward optical seekers cannot monitor neighboring friendlies. When Interceptor A dives on Hostile 7, nearby Interceptor B observes A's trajectory, infers commitment geometrically, generates an internal **private coverage window** ($T + 4.2\text{ s}$), and scores Target 7 as covered ($P(\text{covered}) \to 1$). Interceptor B temporarily assumes the Observer role from high ground. If A neutralizes the target, both entities are removed. If A misses, the private window expires silently at $T + 4.2\text{ s}$; B immediately rescores Target 7 as uncovered ($P(\text{covered}) \to 0$), evaluates deterministic claim delay, and commits to secondary interdiction—**with zero radio handoff messages**. Cumulative neutralization across sequential attempts separates shared environmental factors from attempt noise: $P(\text{neutralized by } n) = 1 - \prod_{k=1}^{n} (1 - p_k(\mathbf{x}_{\text{scenario}}, \mathbf{x}_{\text{attempt},k}))$.

**Receding-Horizon Guidance & Reciprocal Collision Avoidance (RVO2-3D)**: Midcourse guidance drives the interceptor toward predicted basket $(\hat{\mathbf{x}}_{\text{int}}, \hat{t}_{\text{int}})$ via $\mathbf{v}_{\text{pref}} = \operatorname{limit}_{\mathcal{K}}((\hat{\mathbf{x}}_{\text{int}} - \hat{\mathbf{x}}_i)/\max(\tau, \tau_{\min}))$, transferring to proportional navigation $\mathbf{a}_{\text{PN}} = N V_c \dot{\boldsymbol{\lambda}}$ at terminal gate. Velocity $\mathbf{v}_{\text{pref}}$ is strictly filtered through official vendored `snape/RVO2-3D`: $\mathbf{v}_{\text{safe}} = \arg\min_{\mathbf{v} \notin \bigcup_j \text{VO}_{i|j}} \|\mathbf{v} - \mathbf{v}_{\text{pref}}\|$ subject to hard barrier $\|\mathbf{x}_i - \mathbf{x}_j\| \ge r_{\text{safe}} = 8.0\text{ m}$.

## 4. Empirical Evaluation & Stated Baseline Comparison

AirDnD was benchmarked across **30 paired random seeds** (3,000 sorties) against a mass raid of **100 incoming hostile drones** penetrating a 1.5 km corridor, opposed by 125 friendly interceptors (25% initial reserve). Simulations incorporated 6-axis MEMS INS drift, barometric altimeter noise, bearing uncertainty, optical occlusions, and correlated weather miss factors.

| Benchmark Metric | Greedy Baseline | Naive Static (1:1) | AirDnD (Ours) | Operational Impact |
|:---|:---:|:---:|:---:|:---|
| **RF / C2 Dependency** | Blind Local | Ground C2 Prior | **ZERO RF (Silent)** | Immune to broadband EW barrage jamming |
| **Corridor Leakage (Mean)** | 53.93% | 34.80% | **25.13%** | **53.4% relative reduction vs Greedy** ($p < 10^{-6}$) |
| **95% Confidence Interval** | [52.70%, 55.16%] | [33.50%, 36.10%] | **[23.75%, 26.52%]** | Statistically verified across 30 paired seeds |
| **Duplicate Pursuits / Raid**| 36.10 | 0.00 (Rigid) | **25.23** | **10.87 duplicate pursuits cut** vs Greedy |
| **Friendly Mid-Air Collisions**| 0 | 0 | **0** | Perfect RVO2-3D flight safety (mean sep: 59.58 m) |
| **Neural Latency / Model Size**| N/A | N/A | **0.0093 ms / 20.2 KB** | Fits companion MCU SRAM; >100 kHz on M3 |

*Key Result*: AirDnD even outperforms the omniscient global OR-Tools teacher (30.57% leakage) because OR-Tools makes a static pre-allocation that breaks on stochastic misses, whereas AirDnD's decentralized Observers dynamically restrike surviving hostiles in real time.

## 5. Owned Operational Limits, Failure Modes, & Technical Doubts

* **Simulation vs. Flight Validation**: All results are closed-loop software simulations. No physical drones were flown in Singapore airspace. Aerodynamic ground-effect, prop wash, and hardware actuator lag remain unvalidated.
* **Stubbed Subsystems**: Optical NIR identity beacon decoding loss and MEMS IMU random walk are mathematically sampled from stochastic distributions rather than measured on hardware bench rigs. Debris dispersion is illustrative and lacks hydrodynamic fragment modeling.
* **Failure Modes**: (1) *Dense Aerosol Obscurants*: If an adversary screens ingress with heavy phosphorus or aerosol smoke, drones lose visual sight of peer roll/pitch angles, causing intent inference to degrade to blind dead reckoning. (2) *Extreme Saturation Bandwidth*: Ingress densities exceeding 200 hostiles across a narrow 500m aperture saturate local reserve replenishment rates, leading to perimeter leakage.
* **Our Biggest Technical Doubt & Failed Acceptance Criterion**: Acceptance criterion **AC-021 (Zero Leakage) was not passed**. Under a 100-drone mass raid, 25.1% of hostiles still penetrated. We do not claim 100% defense; we deliver a measurable 53% improvement over uncoordinated autonomy. Our primary engineering doubt is optical track stability when observing friendly airframes at oblique rear aspects through heavy tropical rain.

## 6. Venture Potential, Unit Economics, & 9-Month Roadmap

* **The Sovereign Buyer**: DSTA, DSO National Laboratories, and MINDEF under the **Little Red Dome** counter-UAS initiative. AirDnD is structured as a **software-defined autonomy payload** licensable to sovereign primes (e.g., ST Engineering) to integrate into local attritable airframes.
* **Unit Economics**: Off-the-shelf attritable airframe + motor + battery: $\$1,000$. Companion AI compute board + dual optical seekers: $\$150$. Total unit cost per AirDnD interceptor round: **$\approx \$1,150$** (1,500:1 cost advantage over $\$1.5\text{M}$ Aster-30 missile rounds).
* **9-Month Incubation Roadmap (Funded via NUS DVL S$100K Grant)**: **Months 1–3 (Avionics HITL)**: Flash INT8 ONNX model onto 5 companion SBCs; emulate seeker bus; validate latency. **Months 4–6 (Controlled EW Flight Trials)**: Multi-drone outdoor flight interdiction in offshore maritime test area under active GNSS spoofing and broadband jamming. **Months 7–9 (Red-Team Integration)**: Swarm engagement trials against fast jet surrogates with RSAF ADOC operational doctrine evaluation.
