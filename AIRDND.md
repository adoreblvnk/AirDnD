# AirDnD: Autonomous Swarm Coordination Under Total Radio Blackout

## 1. Operational Paradigm & Problem Formulation

AirDnD is a decentralized interceptor-swarm coordination engine designed for prolonged total radio blackout. In high-density electronic warfare environments, adversary or friendly jamming eliminates all satellite navigation (GNSS) and denies all radio-frequency communications—both ground-to-drone links and inter-drone mesh networks.

### 1.1 The Operational Challenge
Under prolonged total radio blackout, conventional centralized and mesh-based coordinators collapse:
- **Ground Link Denial**: Command-and-control links are severed before or at raid ingress; no central coordinator or ground radar updates can reach the swarm.
- **Zero RF Coordination**: Interceptors cannot exchange RF packets, auction targets, or synchronize assignment tables. A one-way NIR identity beacon may confirm friendly identity but carries no tracks, assignments, or intent.
- **Observation Divergence**: Each interceptor operates with an independent, noisy, and delayed local sensory view of the raid.
- **Asymmetric Readiness**: Interceptors possess varying battery reserves, motor wear, and readiness states.
- **Interception Failures**: Engagements carry probabilistic miss rates, demanding dynamic re-engagement without assignment or handoff messages.

Without coordination, uncoordinated drones independently duplicate pursuit on the most prominent targets while flanking threats leak into protected infrastructure. AirDnD solves this challenge by enabling **coordination without a shared truth**: each interceptor observes physical movement, estimates what nearby friendly units intend, predicts coverage gaps, and executes local actions governed by preloaded doctrine.

### 1.2 Why Centralized Coordinators and RF Meshes Are Explicitly Rejected
A common counter-proposal is deploying a dedicated airborne "coordinator/mother drone" or linking the interceptor swarm via a mobile ad-hoc RF mesh (e.g., Wi-SUN, Wi-Fi HaLow, LoRaWAN, or frequency-hopping MANET). AirDnD deliberately rejects all active radio-frequency communication and centralized hierarchies due to five insurmountable physical and operational realities:

1. **The "Shoot the Queen" Vulnerability (Single Point of Failure / HVT)**:
   - Relying on a dedicated airborne observer/coordinator creates an obvious High-Value Target (HVT). 
   - An adversary needs only to neutralize, blind, or spoof that single coordinator platform to decapitate the entire defense cluster, rendering all subordinate interceptors uncoordinated. In contrast, AirDnD enforces true peer decentralization where any node can observe and act without dependencies.

2. **Broadband Barrage Jamming vs. The Power-Aperture Gap**:
   - Low-cost attritable drones transmit at milliwatt-to-watt power levels (100 mW to 1 W). Adversary standoff or shipborne electronic warfare (EW) systems blast multi-hundred-watt to multi-kilowatt broadband barrage, chirp, and swept noise across all common military and ISM bands (433 MHz, 868/915 MHz, 1.2 GHz, 2.4 GHz, 5.8 GHz).
   - In Singapore's narrow 50 km maritime corridor, the Signal-to-Interference-plus-Noise Ratio (SINR) plummets deep below the Shannon limit. No commercial or low-power transceiver can close a link when the entire band is flooded with noise.

3. **Breakdown of Commercial & IoT Mesh Protocols**:
   - **Wi-SUN (IEEE 802.15.4g)**: Uses RPL routing over 6LoWPAN, designed for stationary utility meters on buildings. In high-speed aerial intercepts (100–200 km/h), dynamic topology changes break the Directed Acyclic Graph (DAG); routing recalculation takes tens of seconds to minutes, making it completely useless for 4-second engagements.
   - **Wi-Fi HaLow (IEEE 802.11ah)**: Standard client-to-Access-Point (star) architecture lacking military-grade direct-sequence coding gain or agile hopping. A central AP drone is easily jammed or shot down.
   - **LoRaWAN / LoRa**: Effective throughput is constrained to $<5\text{ kbps}$ with 100–300 ms airtime per packet. A swarm of 20+ drones attempting 10 Hz state updates suffers $>95\%$ packet collisions under pure ALOHA channel breakdown, and chirp patterns are easily defeated by swept jammers.
   - **NB-IoT**: Inherently non-peer-to-peer, routing all packets through civilian telco towers (Singtel, StarHub, M1) that lack maritime littoral coverage, are prone to national crisis grid saturation, and represent civilian infrastructure dependencies.

4. **Limits of Stateless Frequency Hopping (FHSS) & Clock Drift**:
   - While stateless/asynchronous frequency hopping eliminates handshake overhead and bypasses narrowband spot jammers, it provides zero protection against broadband barrage jamming that blankets all hop bins simultaneously.
   - Furthermore, without GNSS 1PPS synchronization, onboard crystal oscillators drift (5–20 ppm), causing hop timing desynchronization within minutes. "Blind rendezvous" schemes suffer low delivery ratios ($<25\%$) under load.

5. **Terminal Latency Budget & CSMA/CA Contention**:
   - Interceptors close at relative velocities exceeding $60\text{ m/s}$, deciding engagements in 3 to 5 seconds. Multi-hop packet routing, channel contention, and distributed auction consensus introduce 200–800 ms of latency jitter.
   - Waiting for a radio handoff or confirmation packet causes target leakage; onboard INT8 neural inference runs locally in $<2\text{ ms}$, delivering a 100× reaction speed advantage.

6. **Strict Emission Control (EMCON) & Anti-Radiation Triangulation**:
   - Any active RF transmission acts as an electromagnetic beacon. Adversary passive Electronic Support Measures (ESM) and direction-finding antennas on naval or offshore platforms can passively detect, classify, and triangulate interceptor staging cells before engagement. Pure visual observation maintains zero RF footprint.

7. **Unit Economics & Attritable Scaling**:
   - The only RF radios capable of surviving high-density EW are tactical military cognitive MANETs (e.g., Silvus MN-MIMO, TrellisWare TSM) costing **$10,000 to $25,000 per radio** and weighing 400–800 grams. A radio costing 10 to 25 times the $1,000 interceptor would defeat the prototype's low-cost attritable premise.

---

## 2. Deployment Architecture: 3D Static Vertical Picket Grid

Interceptors deploy into a pre-positioned 3D vertical picket grid across the primary ingress corridor before hostile swarm arrival.

```text
       [ Corridor Width: Across Ingress Azimuth ]
Tier 3:  [Cell 3-1]   [Cell 3-2]   [Cell 3-3]   [Cell 3-4]  (250 m – 400 m Altitude)
Tier 2:     [Cell 2-1]   [Cell 2-2]   [Cell 2-3]            (Staggered Mid-Tier)
Tier 1:  [Cell 1-1]   [Cell 1-2]   [Cell 1-3]   [Cell 1-4]  (100 m – 200 m Altitude)
                    ▲ Ingress Swarm Azimuth
```

### 2.1 Formation Generator Specifications
The automated grid formation generator establishes the defensive barrier:
- **Inputs**: Corridor geometry, altitude range (100 m to 400 m), sensor horizontal/vertical fields of view, safety separation buffers, and available interceptor fleet size.
- **Outputs**: Staggered 3D cell coordinates, sector ownership priorities, reserve holding lanes, and an initial corridor coverage map.
- **Formation Metrics Tracked**:
  - Initial corridor coverage before engagement (%).
  - Retained coverage following selective interceptor mobilisation (%).
  - Number and duration of uncovered grid cells.
  - Mean time required to refill a vacated cell from reserve.

### 2.2 Tactical High-Ground Doctrine ("Raptor Stoop")
- **Altitude Staging**: Picket grid tiers are stationed at high-ground altitudes (**250 m to 400 m**), positioned above anticipated hostile swarm approach vectors (**100 m to 200 m**).
- **Maritime Optical Contrast**: Looking downward projects targets against the dark maritime background of the Singapore Strait, eliminating upward solar glare and severe tropical sky bloom.
- **Gravity-Assisted Energy Exchange**: Interceptors dive downward onto incoming targets, converting potential energy into rapid closing acceleration while conserving battery reserves.

### 2.3 Initial Reserve Baseline & Selective Mobilisation
- **Experimental Reserve Baseline**: The prototype begins with 25% of the friendly fleet uncommitted in rear echelons. This is an initial simulation parameter, not an established doctrinal constant.
- **Sensitivity Selection**: Final reserve sizing is selected by comparing 10%, 15%, 20%, 25%, 30%, and 33% reserve ratios across identical multi-wave scenarios. The selected ratio is the smallest that satisfies the declared leakage, recovery, and retained-coverage requirements.
- **Grid Preservation**: Only interceptors whose local utility warrants engagement leave their cells. Vacant cells are refilled by the eligible reserve with the best combination of travel time, battery state, and resulting corridor coverage rather than by distance alone.

---

## 3. Local Belief Model: System One Neural Architecture

Each interceptor runs an onboard System One multi-head model performing rapid, structured numerical inference ($<2\text{ ms}$) on local track history.

```text
[Local Sensory & Track History]
  - Estimated state (MEMS INS + Barometer)
  - Locally visible hostile tracks (x, y, z, vx, vy, vz, covariance, age)
  - Locally observed friendly trajectories (closing rates, headings)
  - Preloaded sector ownership & corridor boundaries
                  │
                  ▼
       [Per-Track Numerical Encoder]
                  │
                  ▼
          [Compact GRU Temporal Layer]
                  │
  ┌───────────────┼───────────────┬───────────────┐
  ▼               ▼               ▼               ▼
P(Leak)     P(Success)      P(Friendly)     Predicted Time
[0.0-1.0]   [0.0-1.0]       [0.0-1.0]       & Intercept Point
```

### 3.1 Model Schema & Output Heads
For every candidate target, the System One model outputs:
```text
{
  target_leak_probability:          float (0.0 to 1.0),
  action_success_probability:       float (0.0 to 1.0),
  friendly_coverage_probability:    float (0.0 to 1.0),
  predicted_intercept_time:         float (seconds),
  predicted_intercept_point:        vector3 (local x, y, z),
  predicted_coverage_expiry:        float (seconds),
  confidence:                       float (0.0 to 1.0)
}
```

- `target_leak_probability`: Probability that the hostile breaches the protected boundary if no interceptor acts.
- `action_success_probability`: Direct joint probability that this interceptor successfully reaches and neutralizes the target before boundary penetration.
- `friendly_coverage_probability`: Probability that an observed friendly interceptor will neutralize the threat.
- `predicted_coverage_expiry`: Estimated time window before an observed friendly's pursuit opportunity expires.

### 3.2 Belief Evaluation Example
| Candidate Target | Learned Friendly Coverage | Learned Action Success | Deterministic Result | Operational Action |
|---|---:|---:|---|---|
| Target 7 | 94% | 88% | Do not duplicate | `HOLD` / Preserve Grid |
| Target 8 | 12% | 81% | High return, uncovered | `INTERCEPT` (Commit) |
| Target 9 | 35% | 30% | Low individual efficacy | `REFILL` / Stand by |

### 3.3 Calibration & Prediction Quality
Belief probabilities are evaluated on held-out scenarios using:
- **Brier Score & Calibration Error (ECE)**: Validating that a predicted 80% coverage corresponds to an empirical 80% outcome.
- **Reliability Diagrams**: Verifying monotonic probability calibration across all decile bands.
- **Regression Accuracy**: Mean absolute error (MAE) on predicted intercept times ($<0.3\text{ s}$) and intercept points ($<1.5\text{ m}$).

---

## 4. Deterministic Mission Utility & Decision Engine

System One belief outputs feed into an inspectable, deterministic mission-utility function to select the highest-value action.

### 4.1 Utility Formulation
For interceptor $i$ and candidate target $j$:

$$\text{utility}(i, j) = \text{consequence}(j) \cdot P(\text{leak}_j) \cdot P(\text{success}_{i,j}) \cdot (1 - P(\text{covered}_j)) - C_{\text{expenditure}} - C_{\text{battery}} - C_{\text{coverage\_loss}} - C_{\text{collision}}$$

Where:
- $\text{consequence}(j)$: Operational value of the infrastructure targeted by threat $j$.
- $C_{\text{expenditure}}$: Attritable cost of mobilizing an interceptor round.
- $C_{\text{battery}}$: Remaining energy penalty.
- $C_{\text{coverage\_loss}}$: Security penalty incurred by vacating the assigned grid cell.
- $C_{\text{collision}}$: Proximity penalty derived from local air congestion.

Mission-cost terms are normalized into a common expected-loss scale. Strategic coefficients are fitted against the offline teacher and frozen prior to benchmark runs.

### 4.2 Action Classes
Every decision cycle evaluates five discrete actions:
1. `HOLD`: Remain on station in assigned grid cell.
2. `INTERCEPT`: Depart cell and commit to target pursuit.
3. `LAUNCH`: Scramble from docked or airborne reserve.
4. `REFILL GRID`: Transition to occupy an abandoned adjacent cell.
5. `ABORT`: Disengage and recover when energy or geometry is insufficient.

### 4.3 Deterministic Tie-Breaking Algorithm & Hysteresis

The tie-breaking algorithm is a deterministic post-processing stage applied immediately after mission utility scores each feasible action.

#### 1. Normalized Utility & Epsilon Tolerance Band
Assume normalized utility values scaled from $0.0$ to $1.0$:
```text
INTERCEPT A = 0.71
INTERCEPT B = 0.70
HOLD        = 0.42
```

Two candidate actions are treated as tied when:
$$\left|\text{score}_a - \text{score}_b\right| \le \epsilon$$

- **Initial Frozen Parameter**: $\epsilon = 0.02$.
- **Calibration Rule**: This tolerance margin is tuned on validation scenarios to reflect observation and model uncertainty, then frozen prior to benchmark execution.

#### 2. Eight-Stage Lexicographical Tie-Breaking Cascade
For tied actions within the $\epsilon$ margin, the interceptor resolves the tie by evaluating candidate targets across an ordered lexicographical cascade:
1. **Assigned Sector Ownership**: Prefer the target located within the interceptor’s preloaded assigned sector.
2. **Lower Friendly Coverage**: Prefer the target with lower predicted friendly coverage ($P(\text{covered})$), immediately avoiding redundant pursuit.
3. **Time to Protected Zone**: Prefer the target reaching the protected boundary sooner ($T_{\text{boundary}}$).
4. **Action-Success Probability**: Prefer higher individual action-success probability ($P(\text{success})$).
5. **Earlier Intercept Time**: Prefer earlier predicted intercept time ($T_{\text{intercept}}$).
6. **Corridor Coverage Preservation**: Prefer the action resulting in lower vertical grid coverage loss ($C_{\text{coverage\_loss}}$).
7. **Resource Conservation**: Prefer lower battery consumption and interceptor expenditure.
8. **Deterministic Stable Fallback**: Use the invariant local track ID (lexicographical string/hash comparison) as the final deterministic fallback.

#### 3. Layman's Terms & Worked Example
In intuitive operational terms:
> **Scenario**: Friendly **Drone A** is already diving on Hostile **Target Z**.  
> **The Decision**: Nearby friendly **Drone B** sees Drone A diving on Target Z, but also spots uncovered Hostile **Target Y**. When choosing between Target Z and Target Y (a utility tie), Drone B reasons:  
> *"Drone A already has Target Z handled. If I chase Z too, Target Y gets a free pass into the city."*  
> Therefore, Drone B breaks the tie and commits to **Target Y**.

**Mathematical Representation**:
```text
Target Z utility = 0.71
Target Y utility = 0.70
Difference       = 0.01  (Tied: 0.01 <= epsilon of 0.02)

Stage 1 (Sector Ownership): Both targets in sector (tied)
Stage 2 (Friendly Coverage):
  P(another friendly covers Target Z) = 0.65  (Drone B sees Drone A diving on Z)
  P(another friendly covers Target Y) = 0.12  (Target Y is uncovered)

Resolution: Drone B selects Target Y (chasing the substantially less covered threat).
```

#### 4. The 2nd-Order Effect & Swarm Resilience
A critical operational consequence follows from this decision:  
*Once Drone B turns and dives toward Target Y, Drone B's camera locks forward on Y—meaning **Drone B physically stops observing Drone A**.*

AirDnD prevents the swarm from losing track of Target Z through two built-in mechanisms:
1. **The Internal Stopwatch (Private Coverage Window)**: Before turning away to chase Target Y, Drone B initializes an internal mental countdown: *"I expect Drone A to neutralize Target Z within 4.2 seconds."* Drone B assumes Target Z is covered for those 4.2 seconds without needing to keep its camera turned backward.
2. **A Temporary High-Ground Observer Role (Drone C)**: A normal interceptor currently holding position above the engagement may locally assume the Observer role when it can see both Drone A and Target Z. If Drone A misses, Drone C sees Target Z survive past the intercept basket, expires its private coverage window, and independently evaluates whether to re-engage. Observer is never a dedicated airframe, permanent post, or centrally assigned unit.

#### 5. Progress-Aware Switching Hysteresis
Switching hysteresis prevents rapid target oscillation while still allowing an interceptor to abandon a failing engagement.

For a committed interceptor, define normalized intercept progress:

$$p = \operatorname{clamp}\left(1 - \frac{T_{\text{remaining}}}{T_{\text{commit}}}, 0, 1\right)$$

The utility margin required to switch targets increases as the interceptor approaches its current target:

$$\Delta U_{\text{switch}}(p) = 0.05 + 0.10p$$

- **Early pursuit**: An alternate action must exceed the current commitment by at least $0.05$ for $N = 3$ consecutive decision ticks.
- **Closing pursuit**: The required margin rises continuously toward $0.15$, suppressing increasingly costly course reversals.
- **Terminal commitment**: Once predicted time-to-intercept falls below the frozen terminal-lock threshold $T_{\text{terminal}}$, target switching is disabled and only collision avoidance may override the preferred velocity.
- **Immediate release**: The commitment lock is removed without waiting for 3 ticks if the target is neutralized, the intercept becomes kinematically infeasible, the track is invalidated, the predicted intercept window expires, or a hard safety or battery-abort condition activates.
- **Post-engagement reset**: After success, failure, or abort, progress and hysteresis state reset before the interceptor evaluates its next action.

The coefficients, $N$, and $T_{\text{terminal}}$ are tuned on validation scenarios and frozen before benchmark execution.

### 4.4 Dead-Reckoning Return-to-Base (DR-RTH) SOP
When battery reserve reaches the critical abort threshold ($\le 25\%$), the `ABORT` action triggers an autonomous **DR-RTH SOP**:
- The interceptor disengages from surveillance and reverses heading along pre-cleared recovery corridors.
- Navigating without GNSS, it uses reverse MEMS INS dead reckoning and barometric stepped descent to return to land-based recovery docks.

---

## 5. Observed Intent, Private Coverage Windows & Recovery

In the absence of radio communications, coordination is achieved by observing physical trajectories and applying shared engagement doctrine.

```text
[Friendly Trajectory & Heading] + [Hostile Tracks] + [Shared Doctrine]
                              │
                              ▼
           P(Friendly B is pursuing Target 7)
                              │
                              ▼
        [Private Coverage Window: Valid until T + 4.2s]
                              │
          ┌───────────────────┴───────────────────┐
          ▼                                       ▼
 [Target Neutralized]                   [Target Survives at T + 4.2s]
 Both entities removed                  Coverage window expires
                                        Target rescored as UNCOVERED
                                        Eligible Observer begins local
                                        claim-priority process
```

### 5.1 Private Coverage Windows
- When Interceptor A observes Interceptor B accelerating toward a hostile track, it infers B's commitment geometrically from closing velocity, heading rate, and turn direction.
- Interceptor A generates an internal **private coverage window** specifying the time and 3D basket where B should achieve interception.
- During this window, A scores Target 7 with high $P(\text{covered})$, preventing duplicate pursuit and allowing A to engage alternate targets or hold its grid cell.
- The coverage belief decays if B changes course, disappears, or fails to reach the predicted intercept basket.

### 5.2 Lead-Observer 2-on-1 Cell Doctrine
To resolve the physical limitation of forward-facing optical cameras under blackout:
- **Camera FOV Decoupling**: A forward-looking seeker camera cannot pursue an incoming hostile while looking backward or sideways to monitor neighboring friendly interceptors.
- **Lead Mode**: Once committed, the Lead interceptor locks its camera strictly forward on the target to guide terminal interception.
- **Observer Mode**: A normal interceptor holding a suitable local vantage point may temporarily assume the Observer role while maintaining both the target and Lead within its optical field of view.
- **Seamless Recovery**: If the Lead fails ($T_{\text{intercept}}$ passes without impact), an eligible interceptor currently in the Observer role may execute the next interception attempt.

### 5.3 Observer-Claim Selection Under Zero RF Coordination
No controller assigns an Observer. Every interceptor uses the same hardware and decision stack, and may temporarily enter the Observer role when its local visibility, sector, battery, and feasibility conditions permit. There is no dedicated Observer airframe or permanent Observer allocation.

When a target appears uncovered or survives an interception, each interceptor currently eligible for the Observer role:
1. Confirms that the target lies within its assigned or adjacent sector.
2. Computes its own $P(\text{success})$, predicted intercept time, battery cost, grid-coverage loss, and mission utility.
3. Estimates whether another friendly has already committed from observable heading, turn rate, closing velocity, and acceleration.
4. Computes a deterministic local claim priority in this order: assigned sector ownership, higher mission utility, higher $P(\text{success})$, earlier feasible intercept, lower grid-coverage loss, higher remaining battery, and preloaded home-cell priority as the stable fallback.
5. Applies a priority-dependent claim delay. The strongest claimant has the shortest delay.
6. Cancels its pending commitment if another friendly visibly commits before its delay expires, raising its local $P(\text{covered})$ for that target.

#### Common Misunderstanding: The Closest Observer Does Not Automatically Commit
Distance alone does not determine the next interceptor. A slightly farther Observer may have better geometry, higher action-success probability, more battery, lower corridor-coverage cost, or assigned ownership of the threatened sector. The nearest Observer is selected only when the complete mission-utility and claim-priority evaluation favors it.

Zero RF coordination, noisy observations, and occlusion mean AirDnD cannot guarantee that exactly one interceptor always commits. Two interceptors may occasionally act from inconsistent local views. AirDnD therefore minimizes rather than claims to eliminate duplicate pursuit, and reports the duplicate-pursuit rate as a benchmark metric.

### 5.4 Interception Mechanics & High-Confidence Sequential Recovery
- **Trigger**: An engagement is evaluated when an interceptor enters a defined engagement radius around the target.
- **Success Model**: Success is governed by a seeded probability based on closing speed, relative geometry, local track uncertainty, and shared environmental conditions.
- **Successful Engagement**: Kinetic impact neutralizes both entities, immediately removing both interceptor and hostile from the battlespace.
- **Failed Engagement**: The interceptor is expended and removed, while the hostile target remains active and continues penetrating the corridor.
- **Sequential Recovery**: One Lead intercepts while eligible Observers remain uncommitted. A subsequent Observer commits only after the current private coverage window expires without observed neutralization.

For an illustrative sequence of statistically independent attempts with success probabilities $p_1, p_2, \ldots, p_n$, the cumulative neutralization probability is:

$$P(\text{neutralized by }n) = 1 - \prod_{k=1}^{n}(1-p_k)$$

For example, 3 independent attempts at $p=0.80$ produce an illustrative cumulative probability of $1-(1-0.80)^3=0.992$. This calculation is not treated as operational evidence because real interception failures may be correlated.

#### Correlated-Failure Requirement
Camera glare, rain, navigation drift, sensor degradation, and difficult target manoeuvres may affect several interceptors in the same engagement. The simulator therefore separates:
- **Shared scenario-level factors**: Weather, lighting, visibility, navigation environment, and target manoeuvre class persist across sequential attempts.
- **Attempt-level factors**: Individual geometry, reaction timing, local track error, and seeded engagement noise vary by interceptor.

The authoritative cumulative neutralization probability is measured empirically through multi-seed rollouts that preserve shared scenario-level factors across every attempt in the same engagement. The independence formula is used only as an explanatory reference. AirDnD reports high-confidence sequential interception rather than a guaranteed hit.

### 5.5 Observation-Driven Failure Recovery
When an engagement fails:
1. The hostile target survives past the predicted intercept time and point.
2. The primary friendly vanishes without neutralizing the threat.
3. Nearby Observers detect target survival, and their private coverage windows expire.
4. The surviving threat is rescored as uncovered ($P(\text{covered}) \to 0$).
5. Eligible Observers execute the deterministic local claim-priority and staggered-delay process.
6. The strongest locally perceived claimant mobilizes first, while others cancel if they observe its commitment.
7. Zero assignment or handoff messages occur; recovery is triggered entirely by physical observation and shared doctrine.

### 5.6 Prototype Friend-or-Foe Verification
The prototype uses a simple positive-friendly hybrid:

1. **Geometric Lineage**: A track is treated as potentially friendly when it is continuously observed leaving a preloaded friendly launch cell and its trajectory remains consistent with an assigned sector, altitude lane, and feasible friendly motion.
2. **One-Way NIR Identity Beacon**: Each friendly repeatedly emits a short authenticated near-infrared mission code. Detection of a valid code bound to the same visual track confirms that track as friendly. The prototype simulates beacon detection loss from range, aspect, weather, glare, and occlusion.
3. **Classification States**: Each local track is classified as `CONFIRMED FRIENDLY`, `FRIENDLY LINEAGE`, `UNKNOWN`, or `HOSTILE EVIDENCE`.
4. **Safe Failure Rule**: Failure to observe or decode the beacon results in `UNKNOWN`, not hostile. A track becomes `HOSTILE EVIDENCE` only from separate hostile indicators such as hostile ingress origin, protected-zone approach, and absence of continuous friendly launch lineage.
5. **Universal Collision Avoidance**: RVO2-3D treats every observed track as a collision obstacle regardless of its identity state.

Passive visual or multispectral markings may support track continuity, but they are not accepted as identity proof.

---

## 6. Reciprocal 3D Collision Avoidance (RVO2-3D)

Collision avoidance is maintained as an **absolute, non-negotiable hard constraint** using Optimal Reciprocal Collision Avoidance in 3D (RVO2-3D).

- **Control Separation**: AirDnD determines the target assignment and preferred velocity vector $\mathbf{v}_{\text{pref}}$.
- **Override Authority**: RVO2-3D evaluates the velocities of all observed neighbors within a local radius. If $\mathbf{v}_{\text{pref}}$ leads to a velocity-obstacle conflict, RVO2-3D computes the minimally displaced collision-free velocity $\mathbf{v}_{\text{safe}}$.
- **Decentralized Safety Filter**: RVO2-3D assigns reciprocal avoidance responsibility and selects a locally collision-free velocity when one exists under the modeled constraints. Safety is verified empirically because noisy observations, dynamics limits, and discrete updates prevent an unconditional real-world guarantee.
- **Boundaries**: Hard safety boundaries constrain altitude tiers, protected infrastructure buffers, and minimum separation distances.

### 6.1 Receding-Horizon Intercept Path Generation
AirDnD does not follow a fixed waypoint path to the target's current position. Each committed interceptor continuously generates a dynamically feasible trajectory toward its locally predicted intercept basket $(\mathbf{x}_{\text{int}}, t_{\text{int}})$.

#### 1. Intercept-Basket Update
At every decision tick, the interceptor updates the target track and recomputes:
- Predicted intercept position $\mathbf{x}_{\text{int}}$.
- Predicted time-to-intercept $\tau = t_{\text{int}} - t$.
- Position and time uncertainty around the intercept basket.
- Target line-of-sight direction, closing velocity, and line-of-sight angular rate.

The interceptor therefore pursues where the target is predicted to be rather than its latest observed position.

#### 2. Kinematic Feasibility Gate
Before committing or continuing, the trajectory generator verifies that the intercept basket remains reachable under the interceptor's:
- Maximum and minimum speed.
- Acceleration and deceleration limits.
- Turn-rate and lateral-acceleration limits.
- Climb and descent-rate limits.
- Remaining battery and minimum abort reserve.
- Altitude lanes, geofences, protected-zone exclusions, and minimum-separation constraints.

If no admissible trajectory reaches the uncertainty-expanded intercept basket before boundary penetration, the action is marked infeasible. The interceptor then evaluates another target or executes `ABORT` rather than continuing an impossible pursuit.

#### 3. Midcourse Preferred Velocity
Outside the terminal-guidance region, the controller forms a time-constrained preferred velocity:

$$\mathbf{v}_{\text{pref}} = \operatorname{limit}_{\mathcal{K}}\left(\frac{\mathbf{x}_{\text{int}}-\hat{\mathbf{x}}_i}{\max(\tau,\tau_{\min})}\right)$$

where $\hat{\mathbf{x}}_i$ is the interceptor's locally estimated position and $\operatorname{limit}_{\mathcal{K}}$ projects the command into the interceptor's admissible speed, acceleration, turn-rate, and climb-rate envelope. Pre-cleared altitude lanes and corridor waypoints route the interceptor around static exclusions. The open maritime engagement volume does not require a global grid-search path unless a static exclusion blocks the direct admissible route.

#### 4. Safety Override and Trajectory Rejoining
RVO2-3D receives $\mathbf{v}_{\text{pref}}$ and returns the closest collision-free velocity $\mathbf{v}_{\text{safe}}$. Hard geofence and flight-envelope constraints are then applied before actuation. The avoidance manoeuvre does not create a permanent detour path. At the next control tick, the intercept basket is recomputed from the new state and the interceptor generates a new preferred velocity, naturally rejoining a feasible intercept trajectory.

#### 5. Terminal-Guidance Transfer
When range or predicted time-to-intercept crosses a frozen terminal-entry threshold, control transitions from basket-seeking midcourse guidance to proportional-navigation terminal guidance:

$$\mathbf{a}_{\text{PN}} = N V_c \dot{\boldsymbol{\lambda}}$$

where $N$ is the frozen navigation gain, $V_c$ is closing speed, and $\dot{\boldsymbol{\lambda}}$ is the line-of-sight angular-rate vector. The terminal seeker continuously updates the line of sight while RVO2-3D and hard safety constraints retain override authority.

#### 6. Required Path-Generation Telemetry
Every committed interceptor logs:
- Current and predicted target state.
- Intercept basket, uncertainty, and remaining time.
- Feasibility result and limiting constraint.
- Midcourse $\mathbf{v}_{\text{pref}}$, RVO2-3D $\mathbf{v}_{\text{safe}}$, and applied command.
- Terminal-entry event and proportional-navigation command.
- Replanning count, path length, energy estimate, miss distance, and abort reason.

---

## 7. Navigation Under Prolonged GNSS Denial

Interceptors operate in an initialized local Cartesian frame without external positioning.

- **MEMS Inertial Navigation (INS)**: Integrates 3-axis accelerometer and 3-axis gyroscope data. Bias and random walk noise are modeled to represent physical sensor drift.
- **Barometric Altimetry**: Barometric pressure measurements constrain the vertical Z-axis, preventing vertical divergence while allowing horizontal drift to accumulate naturally.
- **Uncertainty Propagation**: Estimated position, velocity, and covariance are supplied to the belief model and RVO2-3D. Target positions are evaluated relative to local estimates rather than ground truth.
- **Simulated Error Variables**:
  - Accelerometer bias and white noise.
  - Gyroscope bias and angular random walk.
  - Accumulated horizontal dead-reckoning drift.
  - Heading error and velocity uncertainty.
  - Barometric altimeter noise and scale-factor bias.
  - Relative observation noise and optical occlusion.

---

## 8. Offline Optimization & Edge Distillation Pipeline

```text
[Synthetic Scenario Generator]
  - Mass raid trajectories (up to 100 hostiles)
  - MEMS INS drift & sensor noise
  - Observation occlusions & engagement failures
                │
                ▼
   [Omniscient OR-Tools Teacher]
   Solves global joint mobilisation & WTA
                │
                ▼
 [Paired Counterfactual Rollout Engine]
 Generates unbiased P(leak), P(success), P(covered) labels
                │
                ▼
   [PyTorch Student Training]
   Multi-head GRU/MLP trained on local history
                │
                ▼
   [ONNX Runtime INT8 Quantization]
   Exported for sub-2ms edge companion compute
```

### 8.1 Counterfactual Paired Rollouts
To eliminate action leakage in training labels, the simulator executes paired rollouts from identical decision points:
- Rollout A evaluates whether the hostile leaks if this interceptor does not act.
- Rollout B evaluates whether candidate action execution prevents leakage.
- Rollout C evaluates whether other friendlies prevent leakage without this interceptor.

### 8.2 Loss Functions & Edge Quantization
- **Loss Functions**: Binary cross-entropy (BCE) for probability heads; Huber loss for time and position heads.
- **Edge Quantization**: The trained model is exported to ONNX and quantized to INT8 precision via ONNX Runtime:
  - Memory footprint: $<15\text{ MB}$.
  - Inference latency: $<2\text{ ms}$ on edge hardware.
  - Sustainable decision frequency: $\ge 10\text{ Hz}$.

---

## 8A. Deterministic and Probabilistic Architecture Matrix

AirDnD is a hybrid system. Most simulation, navigation, safety, and control logic is deterministic. Machine learning is strictly bounded to the local belief estimator.

### Deterministic Components
| Component | Deterministic Role |
|---|---|
| **Vertical Grid Generator** | Computes 3D coordinates, ownership priorities, and refill order from geometry |
| **Kinematics & Stepping** | Propagates entity motion using fixed equations of motion and time steps |
| **MEMS INS & Barometer** | Propagates dead-reckoned state estimates using deterministic navigation equations |
| **Local Track Association** | Associates friendly and hostile tracks via geometric gates, closing velocity, and intercept proximity |
| **Prototype IFF State Machine** | Fuses geometric lineage, valid one-way NIR confirmation, and separate hostile evidence into 4 explicit identity states |
| **Mission Utility Engine** | Computes normalized expected loss scores across candidate actions |
| **Tie-Breaking & Hysteresis**| Resolves tied scores deterministically and enforces switching margins |
| **Intercept Trajectory Generator** | Recomputes the intercept basket, feasibility gate, constrained preferred velocity, and terminal-guidance transfer |
| **OR-Tools Teacher** | Produces optimal offline assignment labels using global ground truth |
| **RVO2-3D Safety Controller**| Computes collision-free velocity overrides under hard separation constraints |
| **Dead-Reckoning RTH SOP** | Executes autonomous return to base on critical battery abort |

### Probabilistic & Machine-Learning Components
| Component | Probabilistic Role |
|---|---|
| **System One Belief Model** | Encodes local track histories and extracts temporal features via compact GRU |
| **Leakage & Success Heads** | Emits calibrated probabilities for target leakage and action success |
| **Friendly Coverage Head** | Predicts probability that observed friendly motion neutralizes the threat |
| **Time & Position Heads** | Predicts continuous intercept point, intercept time, and coverage expiry |
| **Observation Uncertainty** | Models noisy range, bearing, velocity, and sensor latency |
| **NIR Beacon Observation** | Samples authenticated-beacon detection loss from range, aspect, weather, glare, and occlusion |
| **Sensor Occlusion** | Samples line-of-sight loss and track dropouts |
| **IMU Noise & Drift** | Injects stochastic sensor bias and random walk into navigation |
| **Shared Failure Factors** | Preserves weather, lighting, visibility, navigation environment, and target manoeuvre conditions across sequential attempts within the same engagement |
| **Engagement Outcome** | Samples interception success from both shared scenario-level conditions and attempt-level geometry and uncertainty |

### Runtime Execution Flow
```text
noisy local track history
        ↓
tiny multi-head AirDnD System One model
(leakage, action success, friendly coverage,
 intercept point, time and coverage expiry)
        ↓
deterministic mission-utility function
        ↓
deterministic mobilisation constraints,
tie-breaking and hysteresis
        ↓
receding-horizon intercept trajectory generator
(feasibility gate, v_pref, terminal transfer)
        ↓
deterministic RVO2-3D and hard safety constraints
        ↓
interceptor action
```


## 8B. End-to-End System Architecture & Dataflow

The complete end-to-end software pipeline connects offline optimization, student distillation, real-time edge execution, and live 3D operational visualization:

```text
Scenario Configuration & Threat Seed
        │
        ▼
Python Simulation Engine (AirDnD Core)
  ├── 3D Kinematics & Vertical Picket Grid Generation
  ├── MEMS INS & Barometric Altitude Navigation Model
  ├── 100-Hostile Raid Trajectories & Wave Generator
  ├── Local Observation Uncertainty, Noise & Sensor Occlusion
  └── Engagement Mechanics & Probabilistic Interception Failure
        │
        ├───────────────────────────────┬───────────────────────────────┐
        │                               │                               │
        ▼                               ▼                               ▼
Omniscient OR-Tools Teacher    Paired Counterfactual Rollouts   Evaluation Ground Truth
  ├── Global Joint Mobilisation  ├── P(leak without action)       │ (For Post-Run
  └── Optimal WTA Assignment     ├── P(action prevents leak)      │  Metrics Only)
        │                        └── P(friendly covers)           │
        └───────────────────────────────┼───────────────────────────────┘
                                        │
                                        ▼
                             PyTorch Training Dataset
                                        │
                                        ▼
                         Shared PyTorch System One Model
                           - Structured Track Encoder
                           - Compact GRU Temporal Head
                                        │
                                        ▼
                         ONNX INT8 Export (Per Interceptor)
                           - P(leak), P(success), P(covered)
                           - Intercept Point, Time & Expiry
                                        │
                                        ▼
                         Deterministic Mission Utility
                           - 5 Action Classes (HOLD..ABORT)
                           - Tie-Breaking & Switching Hysteresis
                                        │
                                        ▼
                         Intercept Trajectory Generator
                           - Receding-Horizon Basket Update
                           - Feasibility Gate & Constrained v_pref
                           - Terminal Proportional Navigation
                                        │
                                        ▼
                         RVO2-3D Safety Controller
                           - Override Authority on v_pref
                           - Velocity Obstacle Avoidance
                           - Hard Geofence & Separation Constraints
                                        │
                                        ▼
                            State & Metrics Telemetry Stream
                                        │
                                        ▼
                               FastAPI WebSocket Server
                                        │
                                        ▼
                    Interactive AirDnD Worldview (CesiumJS)
                      - Marina Bay Overview / Sector View Toggle
                      - Hostile, Interceptor & Observer Local Perspectives
                      - Frame-Step Decision Trace & Utility Breakdown
                      - Launch, Grid Formation, Hit/Miss Recovery & RTH
                      - Separate Evidence Page with Replayable Runs
```

---

## 8C. Technology Stack & Implementation Standards

| Layer | Technology | Purpose in AirDnD | Priority |
|---|---|---|---|
| **Frontend Application** | React, TypeScript, Vite | Mission UI, panel state, and interactive controls | Required |
| **3D Geospatial View** | CesiumJS | Photorealistic Singapore terrain, 3D tiles, and entity trajectories | Required |
| **Cesium-React Integration** | Resium | Declarative scene management with direct entity update bypass | Required |
| **Simulation Engine** | Python, NumPy | Kinematics, picket grid, blackout constraints, and metrics | Required |
| **Dead Reckoning Navigation** | MEMS INS & Barometer | Onboard inertial propagation and vertically constrained altitude | Required |
| **Backend Server** | FastAPI | Scenario orchestration and live telemetry endpoints | Required |
| **Live Transport** | WebSockets | High-frequency telemetry stream from simulator to browser | Required |
| **Teacher Optimizer** | Google OR-Tools | Offline global joint mobilisation and weapon-target assignment | Required |
| **System One Belief Model** | PyTorch (MLP + GRU) | Rapid calibrated belief prediction from local track histories | Required |
| **Decision Layer** | Deterministic Mission Utility | Normalized expected-loss action scoring with hysteresis | Required |
| **Guidance Layer** | Receding-horizon intercept guidance + Proportional Navigation | Generates dynamically feasible midcourse motion and terminal commands toward the predicted intercept basket | Required |
| **Edge Deployment Runtime** | ONNX Runtime INT8 | Sub-2ms quantized edge companion neural execution | Required |
| **Collision Avoidance** | RVO2-3D (C++) | Decentralized reciprocal 3D collision avoidance overrides | Required |
| **Hard Safety Constraints** | Altitude lanes, geofences | Hard boundary enforcement surrounding RVO2-3D motion | Required |
| **Telemetry & Logs** | JSONL, CSV | Seed event logs, benchmark outputs, and replay manifests | Required |
| **Regression Suite** | pytest | Deterministic regression and multi-seed reproducibility tests | Required |
| **Demo & Benchmark Host** | Apple MacBook Air M3 (24 GB RAM) | Hardware testbed for 100-drone benchmark and Cesium demo | Required |

### Implementation Standards & Architectural Guidance
- **Resium & CesiumJS Lifecycle**: Avoid recreating Cesium providers, camera controllers, or scene objects on React render cycles. Use the Resium shell for declarative root mount, but stream entity coordinate updates directly via `SampledPositionProperty` to maintain steady 60 FPS rendering.
- **FastAPI Telemetry Stream**: The WebSocket connects the simulation backend to the frontend display only. It represents a ground-station monitoring tap and does **not** represent inter-drone RF communication.
- **Offline Cesium Fallback**: The demo incorporates an offline fallback mode utilizing a local Cesium ellipsoid and pre-cached local scenario geometry. The interactive demonstration does not depend on external hosted tile servers or cloud connectivity to function.

---

## 8D. APIs and Credentials Matrix

| Interface / Service | Status | Operational Role in AirDnD |
|---|---|---|
| **Cesium ion** | Active (`CESIUM_ION_TOKEN`) | Hosted 3D terrain and Singapore OSM architectural context |
| **FastAPI WebSocket** | Internal (`localhost:8000`) | Real-time simulator state, belief vectors, and metrics stream |
| **Offline Local Fallback** | Keyless Built-in | Standalone ellipsoid and procedural 3D grid when offline |
---

## 9. The Product: Interactive AirDnD Worldview

The **Interactive AirDnD Worldview** is a minimal CesiumJS demonstration over Marina Bay. It shows the full interceptor lifecycle and lets evaluators inspect how different drones reach local decisions without an RF assignment network.

### 9.1 Battlespace Views & Timeline
- **Marina Bay Overview / Sector View**: Toggle between the complete protected volume and one selected defensive sector.
- **3D Navigation**: Orbit, pan, and zoom without changing simulation state.
- **Perspective Modes**:
  - `HOSTILE VIEW`: Display the hostile's route, intended protected-zone objective, field of view, and locally visible tracks.
  - `INTERCEPTOR VIEW`: Display only that interceptor's noisy local tracks, predicted intercept basket, preferred path, and selected target.
  - `OBSERVER VIEW`: Display the local view of a normal interceptor temporarily acting as Observer, including the Lead, surviving hostile, private coverage window, and claim delay. The view does not represent a separate Observer airframe class.
- **Timeline Controls**: Pause, resume, scrub, and advance one simulation frame at a time.
- **Local World Masking**: Hide simulator ground truth while a local perspective is active. Ground truth remains available only as an explicit evaluator overlay.

### 9.2 Decision Inspection
Selecting an interceptor opens a compact decision panel showing:
- All locally visible candidate targets.
- $P(\text{leak})$, $P(\text{success})$, $P(\text{covered})$, predicted intercept time, and confidence for each candidate.
- Expenditure, battery, corridor-coverage, and collision cost terms.
- Final mission utility and the reason the selected target outranked alternatives.
- Current hysteresis margin, competing action, and consecutive-tick counter.
- Predicted intercept basket, $\mathbf{v}_{\text{pref}}$, RVO2-3D $\mathbf{v}_{\text{safe}}$, and any active safety override.
- Identity state: `CONFIRMED FRIENDLY`, `FRIENDLY LINEAGE`, `UNKNOWN`, or `HOSTILE EVIDENCE`.

The panel uses progressive disclosure: the selected action and its reason appear first, while detailed probabilities and cost terms expand only when requested.

### 9.3 Three-Drone Pinned Comparison
Operators can pin up to three interceptors side-by-side:

```text
┌─────────────────────────┬─────────────────────────┬─────────────────────────┐
│ Interceptor A           │ Interceptor B           │ Interceptor C           │
├─────────────────────────┼─────────────────────────┼─────────────────────────┤
│ Local Target: A-12      │ Local Target: B-04      │ Local Target: C-09      │
│ P(leak): 82%            │ P(leak): 79%            │ P(leak): 91%            │
│ P(my action): 76%       │ P(my action): 61%       │ P(my action): 48%       │
│ P(friendly cover): 11%  │ P(friendly cover): 87%  │ P(friendly cover): 18%  │
├─────────────────────────┼─────────────────────────┼─────────────────────────┤
│ Decision: INTERCEPT     │ Decision: HOLD          │ Decision: REFILL GRID   │
└─────────────────────────┴─────────────────────────┴─────────────────────────┘
```

Targets `A-12`, `B-04`, and `C-09` represent the same physical hostile under independent local identities and uncertainty. Interceptor A commits, Interceptor B infers A's pursuit and holds, and Interceptor C refills the grid. No RF or target-assignment messages are exchanged.

### 9.4 Fixed-Seed Demo Scenarios
The final demonstration is a hardcoded, fixed-seed replay backed by simulator event logs. It does not implement a heuristic runtime fallback or alter outcomes during the presentation:
1. **Launch & Formation**: Interceptors depart coastal launch points, climb through pre-cleared lanes, and occupy their assigned vertical-grid cells.
2. **Successful Interception**: The Lead reaches the intercept basket and both entities transition to a clearly marked `NEUTRALIZED` event.
3. **Miss & Recovery**: The hostile survives the Lead's intercept window, its coverage expires, and an eligible Observer independently claims and re-engages it.
4. **Return-to-Base**: A low-energy or aborted interceptor follows its pre-cleared recovery corridor toward the coastal recovery point.

The UI may switch directly between the success and miss cases for presentation reliability. Both cases must remain deterministic replays of simulator output rather than manually animated outcomes.

### 9.5 Visible Blackout Evidence
A persistent status strip displays:
```text
RF GROUND LINKS: 0
RF INTER-DRONE MESSAGES: 0
TARGET-ASSIGNMENT MESSAGES: 0
NIR IDENTITY BEACONS: ACTIVE
```

The NIR counter is shown separately because the beacon confirms identity but carries no target, track, assignment, or intent data.

### 9.6 Separate Evidence Page
A separate page keeps proof material out of the live tactical view. Evaluators can select and replay:
- Naive, independent-greedy, deterministic-ablation, AirDnD, and omniscient-teacher comparisons.
- Multi-seed hit, miss, correlated-failure, and Observer recovery runs.
- Reserve-ratio sensitivity results.
- Scaling results from 20 to 100 hostile entities.
- Duplicate-pursuit, leakage, minimum-separation, collision, latency, and reproducibility reports.
- The exact seed, configuration, Git revision, and downloadable JSONL/CSV evidence for each run.

### 9.7 Visual Language
| Element | Visual Representation |
|---|---|
| **Friendly Interceptor** | Blue glyph / 3D multirotor model with heading vector |
| **Hostile Target** | Red point with fading velocity breadcrumbs |
| **Confirmed Friendly** | Solid blue identity ring |
| **Friendly Lineage** | Dashed blue identity ring |
| **Unknown Track** | Amber identity ring |
| **Hostile Evidence** | Solid red identity ring |
| **Selected Drone Local Track** | Solid cyan highlight with local covariance ellipsoid |
| **Stale Local Track** | Fading amber outline with expanding uncertainty boundary |
| **Active Target Commitment** | Solid blue assignment line to predicted intercept basket |
| **Inferred Friendly Intent** | Dotted cyan line with confidence tag and estimated time |
| **Private Coverage Window** | Shrinking ring around predicted intercept coordinates |
| **Neutralization Event** | Brief impact marker followed by `NEUTRALIZED`, without implying unmodeled blast physics |
| **Total Radio Blackout** | Persistent status strip with zero RF counters and separate NIR identity status |
| **Protected Zone** | Translucent red volumetric geofence over key assets |
| **Vertical Picket Grid** | Thin blue 3D lattice across the ingress corridor |
| **RVO2-3D Avoidance Path** | Bright cyan trajectory showing avoidance bends |
| **Minimum Separation** | Green distance bracket, flashing red on a simulated breach |

---

## 10. The Evidence: 100-Hostile Scalability Benchmark

The headless benchmark measures whether AirDnD's decentralized autonomy scales to a 100-hostile raid without computational saturation or entity drops. The smaller interactive worldview explains local decisions, while all performance claims must be supported by recorded benchmark statistics rather than inferred from the architecture.

### 10.1 Benchmark Configuration
- **Hostile Entities**: Exactly 100 hostile drones in coordinated waves.
- **Friendly Fleet**: Interceptor fleet size is evaluated across 10%, 15%, 20%, 25%, 30%, and 33% uncommitted reserve ratios, with 25% used only as the initial baseline.
- **Host Hardware**: Apple MacBook Air M3 (8-core CPU, 10-core GPU, 24 GB Unified Memory).
- **Complexity**: Bounded $O(K)$ local nearest-neighbor interactions ensure per-drone compute time and memory remain constant regardless of global swarm size.

### 10.2 Asymmetric Munition-Cost Comparison
- **Conventional SAM Air Defense (Aster 30 / Patriot)**:
  - 100 rounds $\times$ $\$1.5\text{M}$ per missile = **$\$150,000,000$**.
- **AirDnD Attritable Interceptor Swarm**:
  - 100 rounds $\times$ $\$1,000$ per unit = **$\$100,000$**.
- **Simplified Munition-Cost Ratio**: **1,500:1 in AirDnD's favor**, excluding launch systems, sensors, docks, support equipment, development, and operating costs.

### 10.3 Compared Baselines
All baselines run across identical scenarios, initial states, sensor noise, navigation drift, and paired random seeds:
1. **Naive Static**: Fixed one-round-per-target assignment with no dynamic reassignment.
2. **Independent Greedy**: Range-based greedy assignment without friendly-intent modeling.
3. **Deterministic Belief Ablation**: Hand-written geometric estimates feeding the identical mission utility. This is an evaluation-only baseline, not a coded runtime fallback for the final demo.
4. **AirDnD**: Calibrated learned beliefs feeding deterministic mission utility and RVO2-3D.
5. **Omniscient OR-Tools Teacher**: Offline global reference for the declared optimization model.

### 10.4 Statistical Evidence Standard
Every performance claim must be backed by numeric results generated from the frozen benchmark configuration:
- Run at least **30 paired seeds** per compared method and scenario configuration.
- Report the raw numerator and denominator, mean, median, standard deviation, and **95% confidence interval** for leakage, duplicate pursuit, recovery latency, retained corridor coverage, cumulative neutralization, and minimum separation.
- Report compute latency at **p50, p95, and p99**, alongside peak memory, entity-drop count, and completed-run count.
- Report both absolute and relative differences against Naive Static, Independent Greedy, and the Deterministic Belief Ablation.
- Claim a reduction or improvement only when the paired **95% confidence interval excludes zero** in the favorable direction.
- Claim learned-model value only when AirDnD outperforms the Deterministic Belief Ablation under the same downstream utility, seeds, and scenarios.
- A safety run passes only when `friendly_collisions == 0`, `entity_drops == 0`, and minimum separation remains above the frozen configured threshold.
- Store each seed, resolved configuration, Git revision, raw JSONL/CSV logs, and aggregate report so every displayed statistic is reproducible.

The first development benchmark may establish realistic numeric operating thresholds. Those thresholds must then be declared and frozen before the final evaluation run; they may not be selected after viewing final-test results.

---

## 11. Implementation Beyond This Phase: Venture & Operational Roadmap

AirDnD is architected as the Layer 03 autonomy and swarm coordination brain within Singapore's defense innovation ecosystem.

### 11.1 Hardware-in-the-Loop (HITL) Transition
- **Companion Compute**: Deploy quantized INT8 ONNX models and RVO2-3D on physical flight companion computers (Raspberry Pi 5 / Jetson Orin Nano / edge microcontrollers).
- **Sensor Bus Emulation**: Stream simulated noisy IMU (SPI) and barometric altimeter (I2C) data into onboard flight controllers to validate navigation filters under physical vibration.
- **Actuation Validation**: Interface preferred velocity outputs via MAVLink/PX4 to brushless motor electronic speed controllers (ESCs).

### 11.2 DVL "Lord of the Rings" Prime Integration Strategy
- **Layer 03 Brain**: Under the NUS Defense Tech Venture Lab (DVL) "Little Red Dome" framework, AirDnD provides decentralized orchestration.
- **Layer 01 Airframe Integration**: Interface picket grid spacing and kinematic limits with sovereign attritable airframe startups.
- **Layer 02 Seeker Integration**: AirDnD guides interceptors into the terminal basket, handing off control to optical/infrared terminal guidance seekers.
- **Prime-like Consolidation**: Pre-integrate interfaces across Layers 01, 02, and 03 to deliver a unified, modular counter-drone capability to MINDEF, SAF, and DSTA.

### 11.3 9-Month Incubation Milestones ($100,000 Support)
- **Months 1–3 (Avionics Testbed)**: 5-node benchtop hardware-in-the-loop swarm testbed validating sub-2ms inference and RVO2-3D execution.
- **Months 4–6 (Live Flight Trials)**: Autonomous multi-drone flight trials over designated maritime military test ranges under controlled GPS denial and radio blackout.
- **Months 7–9 (Red-Teaming & SAF Integration)**: Full-scale interdiction trials against red-team drone wave incursions in partnership with DSO National Laboratories, DSTA, and RSAF stakeholders.

### 11.4 Sovereign Manufacturing Economics ("Flow Beats Stock")
- **Target Unit Economics**: Maintain an attritable cost target of $1,000 per interceptor node.
- **Domestic Scalability**: Leverage local 3D additive printing for airframe lattices and commercial off-the-shelf electronics to ensure high-tempo domestic replenishment.

---

## 12. Presentation Architecture: 3.0-Minute Pitch

The presentation strictly adheres to the 3.0-minute slot, organized into an attention-grabbing hook followed by an interactive demonstration:

```text
[0:00 - 0:30]  Phase 1: 30-Second Hook Video
               - Reveal the Marina Bay protected volume and incoming raid.
               - Show zero RF ground, inter-drone, and assignment-message counters.
               - Expose naive duplicate pursuit and an uncovered hostile.
               - Show AirDnD's local decisions, collision avoidance, and miss recovery.
               - Freeze on the comparative metric scoreboard.

[0:30 - 3:00]  Phase 2: 2.5-Minute Interactive Demo
               - 0:00-0:25: Toggle Marina Bay Overview and Sector View.
               - 0:25-0:55: Toggle Hostile, Interceptor, and Observer perspectives.
               - 0:55-1:20: Inspect candidate utilities, chosen action, and hysteresis.
               - 1:20-1:50: Switch between fixed-seed hit and miss-recovery replays.
               - 1:50-2:10: Show coastal launch, grid positioning, and return-to-base.
               - 2:10-2:30: Open the separate Evidence Page and replay benchmark runs.
```

### 12.1 Spoken Pitch Narrative
- **Opening**: *"A conventional swarm assumes every drone shares one assignment table. In modern electronic warfare, radios are gone. Drone A sees one raid, Drone B sees another, and neither can announce its intention. That is how three interceptors pursue the same threat while another hits the target."*
- **The Solution**: *"AirDnD achieves coordination without a shared truth. Each drone carries an onboard System One belief model that watches friendly motion, infers intent geometrically, and fills uncovered corridors without exchanging RF packets or target-assignment messages."*
- **The Formation**: *"We deploy a static 3D vertical picket grid across the approach corridor. We don't chase targets from behind; we interdict them from high ground and benchmark the reserve depth needed for follow-on waves."*
- **Failure Recovery**: *"When an interceptor misses, no handoff message is sent. The surviving threat passes the predicted intercept basket, its private coverage window expires, and an eligible Observer independently re-engages."*
- **Collision Avoidance**: *"When trajectories cross, RVO2-3D locally overrides preferred velocities, and we verify minimum separation across every benchmark seed without radio negotiation."*
- **Closing**: *"AirDnD turns $1,000 attritable drones into a self-healing defensive wall, delivering a 1,500-to-1 simplified munition-cost advantage over traditional air defense."*

---

## 13. Critical Acceptance Matrix

AirDnD is accepted when all criteria below pass with reproducible evidence:

| ID | Requirement | Pass Condition | Required Evidence |
|---|---|---|---|
| **AC-001** | Total Radio Blackout | Zero ground or inter-drone radio messages during engagement | Event log verification (`message_counter == 0`) |
| **AC-002** | Local Observation Limit | Interceptors receive only local sensor tracks and onboard estimated navigation state | Model-input trace audit |
| **AC-003** | Local Track Association | Independent track IDs maintained per drone; friendly and hostile tracks associated geometrically | Association scoring log & sample track telemetry |
| **AC-004** | MEMS INS Navigation | Position, velocity, and attitude propagate from simulated IMU accelerometer/gyroscope integration | Navigation-state drift log |
| **AC-005** | Barometric Altitude | Vertical estimation constrained by simulated noisy barometric altimeter data | Altitude error plot |
| **AC-006** | Vertical Picket Grid | Interceptors initialize in a staggered multi-tier 3D picket formation | Initial state geometry log |
| **AC-007** | Reserve Sizing | Multi-wave sensitivity testing selects the smallest tested reserve ratio that satisfies declared leakage, recovery, and retained-coverage requirements | Reserve-ratio sensitivity report across 10%, 15%, 20%, 25%, 30%, and 33% |
| **AC-008** | Corridor Integrity | AirDnD reports retained corridor coverage following selective interceptor mobilisation | Coverage area plot & event log |
| **AC-009** | Action Selection | Interceptors dynamically evaluate and execute HOLD, INTERCEPT, LAUNCH, REFILL, and ABORT | Action-distribution time series |
| **AC-010** | Deterministic Mission Utility | Utility computes expected loss using calibrated probabilities, frozen coefficients, and switching hysteresis | Utility formulation & sensitivity report |
| **AC-011** | System One Belief Outputs | Model outputs calibrated $P(\text{leak})$, $P(\text{success})$, $P(\text{friendly cover})$, intercept time/point, and coverage expiry | Schema validation & inference logs |
| **AC-012** | Model Calibration | Calibration statistics are reported over at least 30 paired seeds with Brier score, ECE, reliability curves, and 95% confidence intervals; final pass thresholds are frozen before final evaluation | Held-out calibration report and frozen threshold manifest |
| **AC-013** | Observation Failure Recovery | Target survival past the predicted intercept point expires coverage and triggers an eligible Observer's local claim process | Fixed-seed miss-recovery replay and event log |
| **AC-014** | Reciprocal Collision Avoidance | Preferred velocities pass through RVO2-3D controller before actuation | Velocity trace & controller telemetry |
| **AC-015** | Collision Safety | Zero friendly collisions occur across all benchmark seeds | Safety report (`friendly_collisions == 0`) |
| **AC-016** | Minimum Separation | Minimum separation distance is strictly maintained; any breach constitutes run failure | Minimum-separation distance plot |
| **AC-017** | OR-Tools Teacher | Global offline teacher generates joint mobilisation and assignment labels | Teacher dataset manifest |
| **AC-018** | Edge Quantization | PyTorch belief model successfully exported to INT8 ONNX | ONNX model file & export verification |
| **AC-019** | Edge Compute Budget | Model memory $<15\text{ MB}$, inference latency $<2\text{ ms}$, decision loop $\ge 10\text{ Hz}$ on Apple Silicon | Edge benchmark profile report |
| **AC-020** | Baseline Outperformance | Across at least 30 paired seeds, AirDnD reduces leakage and duplicate pursuit against Naive Static and Independent Greedy, with raw counts, absolute and relative deltas, and paired 95% confidence intervals excluding zero in the favorable direction | Comparative benchmark report and raw per-seed metrics |
| **AC-021** | Ablation Value | Across the same paired seeds, learned beliefs outperform the Deterministic Belief Ablation on the frozen primary metric, with the paired 95% confidence interval excluding zero in the favorable direction | Ablation report, raw per-seed metrics, and frozen primary-metric declaration |
| **AC-022** | 100-Hostile Benchmark | Simulation of exactly 100 hostile drones completes without process failure or entity dropping | Uninterrupted benchmark run & metrics report |
| **AC-023** | Bounded Local Compute | Per-drone computation complexity ($O(K)$) remains constant as total swarm scales from 20 to 100 entities | Scaling latency vs. swarm size curve |
| **AC-024** | Interactive AirDnD Worldview | UI supports Overview/Sector toggles, Hostile/Interceptor/Observer perspectives, frame stepping, decision inspection, fixed-seed hit and miss replays, launch, grid positioning, and return-to-base | Recorded end-to-end interactive demo |
| **AC-025** | Three-Drone Comparison | Pinned panel displays divergent local track IDs and decisions for the same physical hostile across 3 interceptors | Dashboard comparison screenshot & telemetry |
| **AC-026** | Hardware Testbed Specs | Benchmark and demo execute on specified host machine (MacBook Air M3, 24 GB RAM) | System hardware configuration log |
| **AC-027** | Seed Reproducibility | Executing a fixed seed produces identical trajectories, metrics, and event logs within numeric tolerance | Multi-run seed reproducibility report |
| **AC-028** | Venture Roadmap | Roadmap documents HITL transition, DVL prime integration, 9-month incubation, and sovereign unit economics | Venture roadmap presentation slide |
| **AC-029** | Technical Archive Integrity | Complete archive includes source code, configs, trained models, logs, reports, and SHA-256 manifest | Archive manifest & verification script |
| **AC-030** | Presentation Alignment | Strict adherence to the 3.0-minute slot (30-second hook video + 2.5-minute interactive live demo) | Video recording & live pitch timing |
| **AC-031** | Observer-Claim Suppression | Across at least 30 paired seeds, Observer claim priority and staggered delays reduce duplicate pursuit against Independent Greedy, with raw counts, absolute and relative deltas, and a paired 95% confidence interval excluding zero in the favorable direction | Claim-timing trace, cancellation log, per-seed metrics, and statistical comparison |
| **AC-032** | Correlated Sequential Reliability | At least 30 paired seeds preserve shared scenario-level failure factors and report empirical cumulative neutralization probability with a 95% confidence interval against the frozen reliability threshold | Multi-seed correlated-failure report, raw attempt outcomes, and threshold manifest |
| **AC-033** | Intercept Path Generation | Every committed interceptor continuously replans a dynamically feasible route to the predicted intercept basket, passes $\mathbf{v}_{\text{pref}}$ through RVO2-3D, and transfers to terminal proportional navigation at the frozen entry threshold | Basket-update trace, feasibility log, $\mathbf{v}_{\text{pref}}/\mathbf{v}_{\text{safe}}$ telemetry, terminal-entry event, and miss-distance report |
| **AC-034** | Prototype Friend-or-Foe Safety | A valid one-way NIR code bound to a continuous geometric track confirms friendly identity, beacon loss results in `UNKNOWN`, hostile classification requires separate hostile evidence, and RVO2-3D applies to every identity state | Identity-state transition log, beacon-loss tests, hostile-evidence trace, and collision-controller telemetry |
| **AC-035** | Evidence Page | Separate proof view replays benchmark runs without crowding the tactical UI and exposes each run's seed, configuration, Git revision, metrics, and raw evidence files | Evidence-page recording and replay-to-log consistency check |

---

## 14. References, Repositories & External Sources

### 14.1 Verified Open-Source Repositories

#### Category 1: Geospatial 3D C2 & Tactical Visualization
- **bilawalsidhu/gods-eye-view**: [https://github.com/bilawalsidhu/gods-eye-view](https://github.com/bilawalsidhu/gods-eye-view) (43.2k ⭐, #1 GitHub Trending) — Primary architectural reference for AirDnD's "Interactive Worldview". Demonstrates an open-source CesiumJS photorealistic 3D globe with tactical heads-up display (Military HUD), 250 km tactical contacts roster, click-to-track with fading velocity trails, cockpit ride-along, and GLSL sensor reskins (CRT/NVG/FLIR).
- **CesiumGS/cesium**: [https://github.com/CesiumGS/cesium](https://github.com/CesiumGS/cesium) (13k ⭐) — Open-source WebGL 3D geospatial engine for entity tracking and battlespace visualization.
- **reearth/resium**: [https://github.com/reearth/resium](https://github.com/reearth/resium) — React component library for declarative CesiumJS integration.

#### Category 2: Decentralized Swarm Coordination & Weapon-Target Assignment (WTA)
- **koesan/ORCUS**: [https://github.com/koesan/ORCUS](https://github.com/koesan/ORCUS) — Fully autonomous swarm kamikaze drone system (v2.3) using ArduPilot SITL, ROS, Gazebo, YOLO, DBSCAN clustering, and Hungarian target assignment. Serves as a peer operational counter-drone reference; AirDnD contrasts its decentralized no-comms visual belief model against ORCUS's leader-fusion architecture.
- **WenJunGaoCalvin/DroneSwarmTaskAssignment**: [https://github.com/WenJunGaoCalvin/DroneSwarmTaskAssignment](https://github.com/WenJunGaoCalvin/DroneSwarmTaskAssignment) — Weapon-Target Assignment (WTA) formulation for counter-drone swarm-vs-swarm engagements.
- **google/or-tools**: [https://github.com/google/or-tools](https://github.com/google/or-tools) (18k ⭐) — Combinatorial optimization and assignment solver used for AirDnD's offline omniscient teacher dataset.

#### Category 3: 3D Collision Avoidance & Multi-Agent Motion Planning
- **snape/RVO2-3D**: [https://github.com/snape/RVO2-3D](https://github.com/snape/RVO2-3D) — Reciprocal Velocity Obstacles library in 3D used as AirDnD's local collision-avoidance safety filter.
- **snape/RVO2**: [https://github.com/snape/RVO2](https://github.com/snape/RVO2) (967 ⭐) — Canonical Optimal Reciprocal Collision Avoidance (ORCA) C++ library by the UNC GAMMA research group.
- **snape/AVO2**: [https://github.com/snape/AVO2](https://github.com/snape/AVO2) — Acceleration-Velocity Obstacles library modeling physical quadrotor acceleration limits.
- **PathPlanning/ORCA-algorithm**: [https://github.com/PathPlanning/ORCA-algorithm](https://github.com/PathPlanning/ORCA-algorithm) — Distributed multi-agent navigation combining ORCA with Theta* global planning and MAPF deadlock resolution (CASE 2021 / ICR 2020).
- **mit-acl/Python-RVO2**: [https://github.com/mit-acl/Python-RVO2](https://github.com/mit-acl/Python-RVO2) — Python bindings for ORCA (MIT Aerospace Controls Lab) accelerating offline simulation and counterfactual paired rollouts.

#### Category 4: Flight Control & Simulation Testbeds (HITL Transition)
- **PX4/PX4-Autopilot**: [https://github.com/PX4/PX4-Autopilot](https://github.com/PX4/PX4-Autopilot) (12.5k ⭐) — Industry-standard flight control stack with MAVLink offboard control and multi-vehicle Gazebo SITL simulation; explicit target for AirDnD's companion compute transition.
- **TannerGilbert/PX4-Multiagent-Simulation**: [https://github.com/TannerGilbert/PX4-Multiagent-Simulation](https://github.com/TannerGilbert/PX4-Multiagent-Simulation) — Multi-agent simulation environment using PX4 + ROS 2 + Gazebo, providing the ready-made scaffold for AirDnD's 5-node benchtop hardware-in-the-loop testbed.

#### Category 5: Edge Neural Inference & Low-Latency Tracking
- **FoundationVision/ByteTrack**: [https://github.com/FoundationVision/ByteTrack](https://github.com/FoundationVision/ByteTrack) (6.7k ⭐, ECCV 2022) — State-of-the-art multi-object tracking associating low-confidence detection boxes, feeding locally visible hostile tracks to System One under blackout.
- **barisparlakk/skyguard-edge-detection**: [https://github.com/barisparlakk/skyguard-edge-detection](https://github.com/barisparlakk/skyguard-edge-detection) — Real-time aerial drone detection pipeline on VisDrone2019 exported to ONNX INT8 with reproducible latency benchmarks, directly grounding the $<2\text{ ms}$ / $<15\text{ MB}$ edge compute claims.
- **microsoft/onnxruntime**: [https://github.com/microsoft/onnxruntime](https://github.com/microsoft/onnxruntime) (16k ⭐) — Cross-platform inference engine with 8-bit quantization for edge deployment.
- **pytorch/pytorch**: [https://github.com/pytorch/pytorch](https://github.com/pytorch/pytorch) (88k ⭐) — Deep learning framework used for training the System One multi-head model.
- **fastapi/fastapi**: [https://github.com/fastapi/fastapi](https://github.com/fastapi/fastapi) (83k ⭐) — Asynchronous backend providing WebSocket streaming to the Cesium frontend.

### 14.2 Technical Documentation & Algorithm References
- **CesiumJS Quickstart**: [https://cesium.com/learn/cesiumjs-learn/cesiumjs-quickstart](https://cesium.com/learn/cesiumjs-learn/cesiumjs-quickstart) — Guide for initializing Cesium viewer, terrain providers, and 3D buildings.
- **Cesium SampledPositionProperty**: [https://cesium.com/learn/cesiumjs/ref-doc/SampledPositionProperty.html](https://cesium.com/learn/cesiumjs/ref-doc/SampledPositionProperty.html) — API for time-sampled kinematic trajectories and real-time interpolation.
- **Google OR-Tools Linear Sum Assignment**: [https://developers.google.com/optimization/assignment/assignment_example](https://developers.google.com/optimization/assignment/assignment_example) — Mathematical formulations for optimal weapon-target assignment.
- **ONNX Runtime Quantization Guide**: [https://onnxruntime.ai/docs/performance/model-optimizations/quantization.html](https://onnxruntime.ai/docs/performance/model-optimizations/quantization.html) — 8-bit static and dynamic quantization procedures for edge neural execution.
- **FastAPI WebSockets**: [https://fastapi.tiangolo.com/advanced/websockets](https://fastapi.tiangolo.com/advanced/websockets) — Real-time bidirectional streaming protocols for high-frequency telemetry.
- **Optimal Reciprocal Collision Avoidance (ORCA)**: [https://gamma-web.iacs.umd.edu/ORCA](https://gamma-web.iacs.umd.edu/ORCA) — Mathematical foundation for decentralized reciprocal collision avoidance.
- **UAV Navigation GNSS-Denied Architecture**: [https://www.uavnavigation.com/gnss-denied-navigation](https://www.uavnavigation.com/gnss-denied-navigation) — Engineering reference for dead reckoning using MEMS INS coupled with air-data/barometer sensors.

### 14.3 Operational, Hardware & Benchmark Sources
- **Military Times (March 2026)**: *"These are Ukraine’s $1,000 interceptor drones the Pentagon wants to buy"*: [https://www.militarytimes.com/news/pentagon-congress/2026/03/11/these-are-ukraines-1000-interceptor-drones-the-pentagon-wants-to-buy](https://www.militarytimes.com/news/pentagon-congress/2026/03/11/these-are-ukraines-1000-interceptor-drones-the-pentagon-wants-to-buy) — Empirical unit cost baseline for attritable counter-drone interceptors.
- **Interesting Engineering**: Wild Hornets *"Sting"* interceptor drone analysis: [https://interestingengineering.com/military/ukraine-sting-interceptor-drone-russian-shaheds](https://interestingengineering.com/military/ukraine-sting-interceptor-drone-russian-shaheds) — Operational performance of mass-produced low-cost interceptor quadcopters.
- **Clika**: Edge video feed and neural network compression: [https://clika.io/](https://clika.io/) — Methods for reducing edge companion compute requirements.
- **AstraNav**: Magnetic field navigation for GPS-denied environments: [https://www.astranav.com/](https://www.astranav.com/) — Alternative non-satellite navigation frameworks.
- **Creomagic**: Jam-resistant tactical communication architectures: [https://creomagic.com/](https://creomagic.com/) — Multi-hop ad-hoc tactical networking solutions.
- **InfiniDome (IraNav)**: Anti-jamming and GNSS-denied navigation protection: [https://infinidome.com/ironav/](https://infinidome.com/ironav/) — Hardware GPS-protection systems.

