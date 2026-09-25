# AirDnD wildcard mechanisms for Layer 3

## Scope reset

Layer 3 controls **which interceptors mobilize, where they deploy, and how the swarm degrades when its members disagree**. The design environment is an outnumbered defensive swarm, intermittent peer links, stale local state, silent attrition, and no assumption of a globally correct picture. The ideas below intentionally do **not** make trajectory exchange or auctions the invention.

All three proposals are **hypotheses**, not demonstrated capabilities. Their value is that each names a failure mode absent from the current auction-centric concept and can be disproved in simulation.

## Ranking

1. **EscrowCore — partition-safe commitment credits**: strongest software novelty and clearest distributed-systems proof.
2. **SeedBank — staggered mobilization against bait-and-follow salvos**: strongest operational story and simplest visual demo.
3. **GhostCover — suspicion-weighted spatial succession**: strongest answer to silent attrition and inconsistent roster knowledge.

---

## 1. EscrowCore — partition-safe commitment credits

### New problem: split-brain overkill

When the mesh partitions, two groups can independently believe a threat or approach corridor is uncovered. Both mobilize scarce interceptors. When state eventually merges, the decision is physically irreversible: several rounds have been spent on one problem while another threat leaks. Eventual consistency reconciles the database but cannot recover fuel, time, or expended interceptors.

This is not an auction-convergence problem. It is a **safety-invariant problem under partition**: preserve a bound such as “no more than `K` simultaneous commitment slots may be spent on one threat fingerprint/corridor-time cell” without requiring live global consensus.

### Source mechanism

Escrow transactions and bounded-counter CRDTs partition a finite right among replicas. A replica may operate locally using only the rights it owns; asynchronous merges preserve the numeric invariant even with stale views and network partitions.[1]

### Concrete AirDnD mechanism

- Represent each locally stable threat fingerprint or corridor-time cell as a **bounded commitment-credit CRDT** with `K` rights. `K` encodes desired redundancy, not price.
- Pre-distribute rights among spatially relevant interceptor clusters. A disconnected component may commit only rights already in its local escrow.
- A commitment consumes one right through a monotonic, idempotent operation. Duplicate messages cannot mint a right; merge is deterministic.
- When links exist, components transfer unused rights toward the component with better geometry. Transfers are signed/sequence-numbered and cannot be spent at both ends.
- Expiry is tied to a physical event window. Expired rights return only through a deterministic epoch transition, never a local clock rollback.
- If local aliases later prove to be the same physical threat, fingerprint reconciliation merges their ledgers and exposes any alias-created overcommit as a measured failure mode. The first prototype should therefore use corridor-time cells before claiming target-level identity safety.

**Hard limitation:** availability is deliberately sacrificed when a partition owns no relevant rights. EscrowCore can prevent overspending, but may withhold a feasible interceptor. That is the exact safety–availability trade to measure rather than hide.

### Falsifiable simulation experiment

**Scenario:** 24 defenders versus 40 inbound threats through four corridors. At `t=20 s`, divide defenders into 2–4 communication components for 2–20 seconds. Give components 10–40% disagreement in threat identity and inject delayed duplicate observations.

**Baselines:**
1. current decentralized auction/eventual state merge;
2. local greedy duplicate suppression with timeout;
3. oracle centralized allocator with perfect state as an upper bound.

**Independent variables:** partition duration, component count, fingerprint collision/split rate, credit cap `K`, initial credit placement, and transfer latency.

**Primary metrics:** irreversible overcommitments per true threat, interceptor expenditure, leakage, feasible commitments refused for lack of local credits, and merge time. Also report the Pareto curve between prevented overkill and availability loss.

**Disproof condition:** EscrowCore is not useful if, over the intended operating region, rights stranded in the wrong component increase weighted leakage more than prevented overkill decreases it. A strong result is not “zero overkill”; it is a region where leakage falls despite the availability penalty.

### Prior-art flag

- **Common elsewhere:** escrow transactions, CRDTs, and bounded counters are established distributed-systems ideas.[1]
- **Common in swarms:** distributed task allocation is common.
- **Potentially new translation:** treating irreversible interceptor commitments as partitioned invariant-preserving rights, rather than bids or eventually reconciled assignments. A focused search found no obvious robot-swarm bounded-counter implementation; that is not a patentability conclusion.

---

## 2. SeedBank — staggered mobilization against bait-and-follow salvos

### New problem: temporal reserve collapse

A snapshot optimizer can be locally correct and still lose the engagement. An attacker sends a cheap or slow first wave to trigger every visible defender, then reveals a faster or higher-value second wave after the swarm has committed. Outnumbered defenders cannot solve this by assigning the first wave more efficiently; they need a policy for **how much capability not to reveal yet when the future is unobserved**.

### Source mechanism

Seed dormancy spreads germination across time in unpredictable environments, trading immediate growth for lower variation in long-term survival.[3] The immune repertoire makes a related finite-resource trade: large clones respond strongly to known threats, while diversity preserves coverage of rare or unseen threats.[2]

### Concrete AirDnD mechanism

- Give each docked or loitering interceptor a persistent **activation phenotype**: a release threshold, evidence time constant, and protected-reserve class.
- Compute a local danger scalar from observable Layer 3 inputs: confirmed inbound count, confidence, speed class, asset time-to-impact, recent misses, and fraction of nearby defenders already committed. Do not require a shared trajectory.
- Use a deliberately dispersed threshold distribution, so the same imperfect evidence releases cohorts rather than the whole fleet at once.
- “Fast-germinating” units respond to the first credible wave; “deep-dormant” units require either stronger evidence, a miss/leak signal, or elapsed uncertainty. A small exploration cohort remains protected from copying the current majority policy.
- After an engagement, update phenotype weights slowly from mission outcomes, but constrain minimum threshold diversity so one successful raid does not create a monoculture.
- Couple release to a hard time-to-impact override: dormancy cannot block the last physically feasible intercept.

**Hard limitation:** holding reserve necessarily risks extra first-wave leakage. The mechanism is justified only where hidden follow-on raids or classification uncertainty are plausible.

### Falsifiable simulation experiment

**Scenario:** 24 defenders face two waves totaling 30–50 threats. The first wave varies from genuine to 80% decoys; the second varies in delay, speed, value, and approach corridor. Each defender receives noisy local wave-size estimates, with optional 30–80% packet loss.

**Baselines:**
1. all-in mobilization plus the best target allocator;
2. fixed 20% reserve;
3. deterministic common release threshold;
4. centralized receding-horizon controller given the same noisy observations.

**Independent variables:** second-wave probability, inter-wave delay, decoy fraction, numerical disadvantage, threshold dispersion, override horizon, and evidence noise.

**Primary metrics:** value-weighted leakage, first-wave leakage, second-wave leakage, defenders expended before wave two, and worst-decile mission loss across random seeds. Plot the operating boundary where reserve insurance changes from beneficial to harmful.

**Disproof condition:** SeedBank fails if dispersed cohorts do not outperform a tuned fixed reserve on worst-decile value-weighted leakage, or if the first-wave penalty dominates across plausible second-wave probabilities.

### Prior-art flag

- **Common biology:** dormancy/bet hedging and immune repertoire diversity are established.[2][3]
- **Common swarm prior art:** heterogeneous response thresholds and self-organized task specialization are already common in swarm robotics.[7]
- **Potentially new translation:** using persistent, deliberately dispersed mobilization thresholds as adversarial reserve insurance against multi-wave baiting—not generic insect-inspired task allocation. Novelty rests on the threat model and falsified trade boundary, not on “bio-inspired thresholds.”

---

## 3. GhostCover — suspicion-weighted spatial succession

### New problem: ghost defenders create invisible holes

After attrition or link loss, each interceptor has a different roster. A fixed timeout forces a bad binary choice: wait too long and dead defenders remain counted as covering a corridor; time out too quickly and temporary packet loss triggers mass backfill, collisions, and wasted energy. In an asynchronous network, silence alone does not distinguish destruction from delay.

### Source mechanism

Phi-accrual failure detectors convert heartbeat inter-arrival history into a continuous suspicion value rather than a binary alive/dead answer, adapting sensitivity to observed network conditions.[4] Active fault detection and recovery are established needs in robot swarms, and recent immune-inspired work confirms that individual failures can materially disrupt collective performance.[5]

### Concrete AirDnD mechanism

- Each interceptor maintains a local phi score for peers it can observe directly or hear through sparse status beacons.
- Convert peer `j`'s claimed coverage contribution into `c_j × exp(-phi_j)` rather than counting it as fully present or absent.
- Airspace is represented as coarse defended corridors/sectors, not exchanged trajectories. A local controller expands its patrol or launch responsibility only by the expected deficit between sector demand and suspicion-weighted coverage.
- Backfill is **continuous and proportional**: low suspicion nudges a boundary; high suspicion causes full succession. This avoids a synchronized timeout stampede.
- Give every sector a deterministic succession order derived from interceptor ID and sector epoch. If a “dead” peer reappears, lower-priority successors shrink back instead of negotiating a new auction.
- Separate two evidence streams: communication silence and physical absence from expected local sensor windows. Correlated RF blackout should raise communication suspicion slowly; confirmed missing passage raises operational suspicion quickly.

**Hard limitation:** phi is not a probability of destruction unless calibrated to the scenario. The first build should call it a suspicion score and test calibration explicitly.

### Falsifiable simulation experiment

**Scenario:** 30 defenders cover six approach sectors. Inject 0–40% actual attrition and independent or spatially correlated 1–15 second blackouts. Some “failed” units retain communications but lose propulsion; others are healthy but silent.

**Baselines:**
1. fixed heartbeat timeout;
2. always assume silent peers are alive;
3. immediate backfill on one missed heartbeat;
4. oracle knowledge of health state.

**Independent variables:** blackout correlation, heartbeat jitter, attrition rate, phi threshold/slope, physical-observation reliability, and sector overlap cost.

**Primary metrics:** time-integrated uncovered threat lanes, leakage through ghost-covered sectors, unnecessary backfill distance/energy, interceptor–interceptor conflicts, and recovery time after partition healing. Include calibration curves between suspicion and actual peer unavailability.

**Disproof condition:** GhostCover is not better if a tuned fixed timeout matches its leakage/energy Pareto frontier, or if correlated blackouts create broad false succession that increases collision and depletion.

### Prior-art flag

- **Common elsewhere:** heartbeat failure detection, phi accrual, leases, and deterministic failover are established distributed-systems tools.[4]
- **Common in robotics:** fault detection/diagnosis/recovery and replacement of failed robots are established research areas.[5]
- **Potentially new translation:** mapping continuous peer suspicion directly into proportional spatial coverage debt and deterministic sector succession. The novelty is not failure detection alone.

---

## Analogies screened out as weak wildcard claims

- **Ant pheromones/stigmergy:** already canonical swarm prior art. High-density robot experiments also show simple pheromone avoidance can become worse than non-interacting random walks when the shared field saturates.[6]
- **Generic clonal selection/artificial immune systems:** already used for swarm behavior arbitration and fault detection; without a new operational failure mode this is relabeling, not invention.[5]
- **Epidemic gossip:** useful implementation plumbing, but fundamentally a communication mechanism and therefore outside the requested wildcard.
- **Quorum sensing/consensus:** too close to current agreement/auction framing.

## Recommendation

Build **EscrowCore** as the technical wildcard and pair it with **SeedBank** only if the demo can afford a second experimental axis. EscrowCore has the cleanest one-sentence claim:

> AirDnD prevents disconnected swarm fragments from irreversibly overspending the same scarce defensive capacity by turning commitment authority into escrowed, merge-safe credits.

The demo should not claim globally optimal allocation, zero leakage, or guaranteed target identity. It should show a measurable safety–availability frontier under partitions and identify where the mechanism loses.

## Sources

[1] https://arxiv.org/html/1503.09052v1 — Extending Eventually Consistent Cloud Databases for Enforcing Numeric Invariants
[2] https://pmc.ncbi.nlm.nih.gov/articles/PMC4434741 — How a well-adapted immune system is organized
[3] https://pmc.ncbi.nlm.nih.gov/articles/PMC9825997 — Bet-hedging and best-bet strategies shape seed dormancy
[4] https://doc.akka.io/libraries/akka-core/current/typed/failure-detector.html — Phi Accrual Failure Detector
[5] https://pmc.ncbi.nlm.nih.gov/articles/PMC12520779 — Detecting and diagnosing faults in autonomous robot swarms
[6] https://pmc.ncbi.nlm.nih.gov/articles/PMC6894587 — Testing the limits of pheromone stigmergy in high-density robot swarms
[7] https://pmc.ncbi.nlm.nih.gov/articles/PMC4527708 — Evolution of Self-Organized Task Specialization in Robot Swarms
