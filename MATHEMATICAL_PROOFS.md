# AirDnD Mathematical Proof Audit

## 1. Scope, notation, and proof classes

This document audits the algorithms actually executed by the current code in `src/airdnd/` and `frontend/src/worldview.ts`. `AIRDND.md` is a specification, not proof that a mechanism is on the runtime path. Source locations below refer to the current files and symbols rather than unstable line numbers.

| Class | Meaning |
|---|---|
| **P** | Proved from AirDnD code under the stated assumptions |
| **D** | Conditional on a named dependency satisfying its contract or theorem |
| **S** | Statistical approximation whose coverage or interpretation needs assumptions |
| **E** | Empirical obligation requiring executed evidence |
| **U** | Not mathematically established, not implemented in the claimed strength, or physical/hardware work still outstanding |

Notation: `I` is interceptor count, `H` is hostile count, `r` is `reserve_ratio`, `dt` is a discrete time step, and `clip(x,a,b)=min(b,max(a,x))`.

### 1.1 Global assumptions

Direct proofs assume:

1. Numeric inputs are finite; dimensions and counts satisfy function preconditions.
2. Time steps, ranges, separation limits, speed/acceleration limits, and noise standard deviations are nonnegative, with strict positivity where the code checks it.
3. A fixed software/dependency environment gives deterministic floating-point and pseudorandom behavior for a fixed seed. Equality claims are implementation equality, not exact-real equality.
4. PyTorch, NumPy, OR-Tools, ONNX Runtime, and vendored `snape/RVO2-3D` satisfy their documented contracts.
5. Cryptographic hash collisions, dependency defects, malformed replay JSON, NaN, infinity, and adversarial mutation outside the exported APIs are excluded unless explicitly discussed.

No theorem below converts a software simulation result into a flight, sensor, cryptographic, engagement, or hardware guarantee.

## 2. State-plane and local-input separation

Implementation: `core.py` (`SimulatorTruth`, `AgentLocalState`, `PresentationState`), `simulation.py` (`_policy_assign`, `_local_history`), and `api.py` (`_sanitize_local`, replay endpoints).

### Theorem 2.1 — policy decisions do not read the evaluator assignment accumulator (**P**)

For the `airdnd` and `deterministic_ablation` methods, each selected candidate is computed before and independently of writes to `evaluator_attempts`.

**Proof.** `_policy_assign` constructs a local tracker output, observed-friendly-motion coverage flags, local histories, beliefs, and `Candidate` values; it then calls `choose_candidate`. Only after selection does it execute `evaluator_attempts[selected_hostile].append(interceptor_index)`. No candidate feature, utility term, tie key, model input, or reserve predicate reads `evaluator_attempts`. Thus the assignment dictionary is an evaluator-side record of local decisions, not an input to those decisions. ∎

### Theorem 2.2 — runtime model features are local-form features (**P**, syntactic noninterference)

The 12 runtime inputs are functions only of the focal interceptor's position, a noisy local target track, the fixed locally assumed target velocity, estimated boundary time, observed friendly-motion geometry, local battery, local uncertainty, and deterministic local history noise. They contain no teacher assignment bit, global assignment table, physical hostile ID, or evaluator outcome.

**Proof.** `_local_history` constructs exactly the features named by `RUNTIME_FEATURE_NAMES`. `_policy_assign` supplies `LocalTracker.position`, the focal position, nearest previously observed friendly-motion distance, and `visibly_covered`; the teacher is not called on this path. The opaque `local_track_id` seeds history noise but is not itself a model feature. The `policy_decision.agent_local` payload contains that local ID, beliefs, utility, hysteresis state, and policy label, while physical hostile ID and truth target position remain in the separate `truth` plane. ∎

This is a code-level separation theorem, not an information-theoretic privacy theorem. Sensor range is 5,000 m in this simulator, source IDs deterministically influence opaque 32-bit local hashes, focal own-position comes from simulator state, and the simulator constructs the observations from truth.

### Theorem 2.3 — agent-specific local IDs (**P**, collision-conditional)

For agent `a` and source `h`, the local ID is `a || first32bits(SHA256(a:h))`. Different agent prefixes produce different complete IDs. For a fixed agent, uniqueness across distinct sources is conditional on no collision in the truncated 32-bit digest.

### Theorem 2.4 — local API sanitization (**P**)

For any finite tree of dictionaries, lists, and scalar leaves, `_sanitize_local` removes every dictionary entry at every depth whose key is in `_LOCAL_FORBIDDEN_KEYS`.

**Proof.** Structural induction: scalar leaves are unchanged; list elements are recursively sanitized; dictionaries omit forbidden keys and recursively sanitize every retained value. ∎

The sanitizer is key-name based. Semantically equivalent truth under an unlisted key is not detected. Truth is returned only as overview data or as a separately named `evaluator_overlay` when explicitly requested.

## 3. Grid, sensing, navigation, and IFF

### Theorem 3.1 — staggered-grid cardinality, identity, and separation (**P**)

Implementation: `core.py::generate_staggered_grid`.

For `count=n≥0`, `columns=m>0`, and spacing `s>0`, cell `i` has

\[
r_i=\lfloor i/m\rfloor,\quad c_i=i\bmod m,
\]

\[
(x_i,y_i,z_i)=\left(c_i s+\tfrac{s}{2}(r_i\bmod2),\ r_i s,\ z_0+r_i h\right).
\]

The function returns exactly `n` uniquely named cells; odd tiers are shifted by `s/2`; any two distinct initial cells have Euclidean separation at least `s`.

**Proof.** The loop visits each `i` exactly once. Euclidean division uniquely determines `(r_i,c_i)`, hence `C{r_i}-{c_i}` is unique. Same-tier cells differ in x by at least `s`; different-tier cells differ in y by at least `s`. ∎

This proves initial point separation, not optical coverage or safe subsequent motion.

### Theorem 3.2 — deterministic range-gated Gaussian observations (**P/S**)

Implementation: `observation.py::LocalTracker.observe`.

For fixed truth, observer position, agent, seed, range, and noise standard deviation, repeated calls return the same ordered tracks. A source is included iff its truth distance is at most sensor range. For included source position `x`, the generator model is

\[
\tilde x=x+\epsilon,\qquad \epsilon\sim N(0,\sigma^2I_3),
\]

so under the ideal PRNG distribution, `E[tilde x]=x` and `Cov(tilde x)=σ²I`.

**Proof.** Sources are sorted, a fresh identically seeded generator is consumed in the same order, and one independent normal vector is added per included source. The moment result is the standard Gaussian moment calculation. ∎

The moments are an **S** model statement about the generator, not a measured sensor model. Noise resets each call, velocity is copied exactly, and age remains zero.

### Theorem 3.3 — navigation step and vertical-only barometer correction (**P**)

Implementation: `observation.py::NavigationFilter.step`.

With `a=measured_accel+bias`, the pre-baro update is

\[
x^-_{k+1}=x_k+v_kdt+\tfrac12a dt^2,\qquad v_{k+1}=v_k+a dt.
\]

For constant acceleration this is exact over one interval. With barometer gain `K=0.8`,

\[
z_{k+1}=0.2z^-_{k+1}+0.8z_b.
\]

The barometer changes only z, not x, y, or velocity. For `dt≥0` and initially nonnegative diagonal covariance,

\[
P'_{x,y}=P_{x,y}+0.2dt\ge0,\qquad P'_z=0.2(P_z+0.05dt)\ge0.
\]

The simulator now invokes this update after every safe-velocity actuation and logs the resulting navigation state. It does **not** use the navigation estimate to close the guidance loop; guidance still receives simulator position and velocity. This is a minimal translational model, not a complete MEMS INS.

### Theorem 3.4 — four-state IFF priority and safe beacon failure (**P**)

Implementation: `observation.py::IFFMachine.update`, invoked by `run_scenario` before trajectory steps.

For lineage `L`, valid beacon `V`, bound beacon `B`, and hostile evidence `Q`,

\[
f(L,V,B,Q)=
\begin{cases}
\text{CONFIRMED FRIENDLY},&L\land V\land B,\\
\text{HOSTILE EVIDENCE},&\neg L\land Q,\\
\text{FRIENDLY LINEAGE},&L,\\
\text{UNKNOWN},&\text{otherwise}.
\end{cases}
\]

Thus beacon validity without binding cannot confirm friendliness; beacon loss alone cannot create hostility; and separate hostile evidence with no lineage is required for `HOSTILE EVIDENCE`. In the current simulator every engagement trajectory calls the machine with `(L,V,B,Q)=(false,false,false,true)`, so the integrated logged state is always `HOSTILE EVIDENCE`. Beacon detection/loss physics, lineage continuity, and track binding are not simulated.

## 4. Belief model, labels, and training

### Theorem 4.1 — output shape and decoded domains (**P**)

Implementation: `model.py::BeliefModel`, `decode_beliefs`.

For a floating-point history tensor with compatible rank-three shape `(B,T,F)`, `F=model.feature_dim`, and `T≥1`, the encoder and GRU produce `(B,T,H)`, the last slice is `(B,H)`, and the head returns `(B,9)`. In exact real arithmetic, sigmoid values lie in `(0,1)` and softplus values are positive. In the implemented finite-precision PyTorch arithmetic, saturation and underflow weaken these guarantees to inclusive `[0,1]` for sigmoid-decoded leak, action-success, coverage, and confidence values, and nonnegative values for softplus-decoded intercept time and coverage expiry. Intercept coordinates are floating-point head outputs. Finite outputs require finite inputs and finite model parameters.

No architecture theorem implies calibration, accuracy, epistemic uncertainty, or out-of-distribution generalization.

### Dependency result 4.2 — teacher assignment scope (**D**)

Conditional on OR-Tools returning `OPTIMAL`, the three-by-three dataset teacher minimizes integer-truncated Euclidean assignment cost

\[
\min_{\pi\in S_3}\sum_j \left\lfloor100\|h_j-a_{\pi(j)}\|_2\right\rfloor.
\]

This is optimal only for that declared linear assignment problem. It is not a proof of globally optimal mobilisation, mission utility, stochastic engagement planning, or weapon-target allocation in the full simulator.

### Theorem 4.3 — common-random-number counterfactual streams (**P**)

Implementation: `model.py::generate_paired_teacher_dataset`, `_counterfactual_rollout`.

For each sample, one `(24,4)` `future_events` array is generated and copied byte-for-byte into all three stored branch slots. The exact same array object value is passed to the no-action, focal-action, and other-friendly-action rollouts. Consequently, branch differences arise from `actor_position` and resulting state/control flow, not from different sampled weather, manoeuvre, or engagement arrays.

**Proof.** `np.repeat(future_events[None,:,:],3,axis=0)` stores three equal copies; all three rollout calls receive `future_events`. `_counterfactual_rollout` has no random generator and is deterministic for its arguments. ∎

This proves common random numbers, not unbiased causal estimation of real engagements. Branches may reach an engagement draw at different steps or never use one, and the rollout is a simplified synthetic model.

### Theorem 4.4 — label extraction and local/teacher separation (**P**)

The three binary target heads are exactly:

\[
y_{leak}=O_{no\ action}[0],\quad y_{success}=O_{focal}[1],\quad y_{covered}=O_{other}[2].
\]

Offline truth and OR-Tools determine labels and which other actor defines the coverage branch. They do not enter `histories`: history feature 8 is a noisy geometric closing score strictly clipped into `(0,1)`, not the teacher assignment. Thus the implemented student input/label boundary is local-feature input with omniscient offline labels.

### Theorem 4.5 — held-out stream-ID disjointness (**P**, domain-qualified)

Training IDs are

\[
T=\{10^6s+k:0\le k<n\},
\]

while held-out IDs, with seed `s+1,000,003` and `m=max(1,⌊n/4⌋)`, are

\[
V=\{10^6(s+1{,}000{,}003)+j:0\le j<m\}.
\]

For positive sample counts satisfying `n < 1,000,003,000,000`, and provided every generated expression `1,000,000*seed + index` remains representable in NumPy `int64` without overflow, `max(T) < min(V)`, hence `T∩V=∅`. The current default and tested seeds and sample counts satisfy both conditions by many orders of magnitude. Different seeds also initialize separate pseudorandom streams. Mathematical independence of a deterministic PRNG is not claimed.

### Theorem 4.6 — loss nonnegativity; no optimizer guarantee (**P/E**)

The training objective is BCE-with-logits over four binary heads plus Smooth-L1 over normalized time, position, and expiry outputs. Both summands are nonnegative, so total loss is nonnegative. Adam is executed for the requested epochs, and initial/final training and held-out losses are measured. Loss reduction, calibration, convergence, and held-out superiority are empirical outcomes, not theorems.

### Dependency result 4.7 — ONNX/INT8 verification scope (**D/E**)

`export_onnx_int8` exports ONNX, applies ONNX Runtime dynamic QInt8 weight quantization, and compares PyTorch, ONNX, and INT8 raw outputs on one deterministic `(4,5,F)` verification batch. `runtime_verified` is true iff shapes match, ONNX maximum absolute error is at most `1e-5`, and INT8 error is at most `0.06`. This proves only that the recorded finite batch passed those dependency-backed checks. It does not prove equivalence for all inputs, model calibration after quantization, memory/latency thresholds, or flight-computer performance.

## 5. Utility, tie handling, hysteresis, and claim priority

### Theorem 5.1 — mission utility and conditional expected-loss interpretation (**P/S**)

Implementation: `decision.py::mission_utility`.

\[
U=Cp_Lp_S(1-p_C)-C_E-C_B-C_G-C_R.
\]

If leak, action success, and absence of friendly coverage are conditionally independent given the belief state, the first term is expected avoided consequence. Without that assumption it is a modeling approximation. For nonnegative `C,pL,pS` and `pC∈[0,1]`, `U` is nondecreasing in `C,pL,pS`, nonincreasing in `pC`, and decreases one-for-one with each cost, as follows from its partial derivatives.

### Theorem 5.2 — epsilon-band deterministic selection (**P**)

For a finite nonempty candidate set, finite utilities, and `epsilon≥0`, `choose_candidate` returns a candidate `c` satisfying

\[
U(c)\ge U_{max}-\epsilon.
\]

Among that band it returns the lexicographic minimum of: assigned sector first, lower coverage, earlier boundary time, higher action success, earlier intercept time, lower coverage loss, lower battery-plus-expenditure cost, then local track ID.

**Proof.** The exact maximizer belongs to the band. Python `min` over the displayed finite tuple ordering returns its deterministic lexicographic minimum. ∎

This is intentionally not exact argmax when candidates lie within epsilon.

### Theorem 5.3 — hysteresis bounds and integrated initialization (**P**)

`Hysteresis.consider` uses

\[
m(p)=0.05+0.10\,clip(p,0,1),
\]

so `0.05≤m≤0.15`. Without hard release, the same alternate must exceed current utility by at least `m` on three consecutive calls; a failed margin or different alternate resets the counter. Hard release changes `current_track` immediately and clears pending state.

The simulator invokes hysteresis once per policy selection with `hard_release=True`. Therefore the integrated invariant is only that the selected local track is immediately copied into logged `hysteresis_track`. Multi-tick switching and terminal locking are implemented only as a reusable state machine (terminal lock is not represented) and are not exercised by scenario evolution.

### Theorem 5.4 — claim-delay ordering (**P**)

For `n` candidates with unique local track IDs and interval `δ≥0`, `claim_delay_s` returns delays `0,δ,…,(n−1)δ` in lexicographic order: assigned sector, higher utility, higher action success, earlier predicted intercept, lower coverage loss, higher battery, then track ID. Distance is not a direct priority key. Duplicate IDs would overwrite dictionary entries and are outside this result.

## 6. Reserve phase, Observer readiness, and coverage-expiry recovery

Implementation: `simulation.py::_policy_assign`, `run_scenario`.

### Theorem 6.1 — reserve partition (**P**)

The number of initial-screen interceptors is

\[
A=clip(\operatorname{round}(I(1-r)),0,I),
\]

using Python's rounding semantics. Indices `<A` are `initial`; all remaining indices are `reserve`. Every interceptor evaluates its own local tracks.

A reserve agent filters its candidates to locally uncovered targets when any exist and emits `mobilized` with trigger `locally_observed_uncovered_track`. If all locally visible targets are covered, it keeps the full local set for an evaluator-recorded prospective selection, does not append its motion to `friendly_motion`, enters `pending_observers`, and emits `observer_ready` with trigger `observed_friendly_coverage`.

Thus reserve ratio now changes runtime phase behavior. It does not guarantee retained coverage, adequate reserve depth, or optimal reserve sizing.

### Theorem 6.2 — coverage-expiry mobilization order (**P**)

For a non-greedy attempt after the first whose agent is in `pending_observers`, `run_scenario` increments simulation time by exactly `4.2 s`, emits `coverage_expired`, adds the candidate's ranked delay, emits `mobilized` with trigger `locally_observed_coverage_expiry`, removes the agent from `pending_observers`, and then emits `observer_claim`.

A reserve that already emitted `mobilized` before engagement is not in `pending_observers`. It is treated as an up-front local commitment, not as a later recovery claimant. If an earlier attempt succeeds, the loop breaks before later pending attempts, so no later expiry or claim is emitted. It instead emits `claim_cancelled` for all remaining assignments with trigger `observed_friendly_commitment`.

This proves event-order and trigger invariants. The 4.2-second window is a fixed simulator parameter, not a learned expiry on this engagement path. Cancellation is generated after observed simulated success, not from a continuously simulated optical classifier.

### Theorem 6.3 — fixed miss-recovery replay contains pending-Observer recovery events (**P**)

`run_fixed_replay("miss_recovery")` uses seed 1, one hostile, three interceptors, `reserve_ratio=0.67`, and forces the first attempt to miss. Under that fixed generated local geometry, the phase partition gives one initial agent and both reserve agents emit `observer_ready` before engagement. The forced first miss then causes a pending reserve assignment to emit `coverage_expired`, `mobilized`, and `observer_claim` in that order. The fixed replay test verifies that every claimant belongs to the prior `observer_ready` set. This is deterministic simulator event logic, not a claim that a continuous optical coverage estimator or physical failure detector has been validated.

## 7. Duplicate-event and engagement accounting

### Theorem 7.1 — duplicate event rule and exact metric reduction (**P**)

For each hostile assignment list `attempts`, the simulator considers every element after the first. It emits one `duplicate_pursuit` event exactly when either (a) the method is `independent_greedy`, or (b) that interceptor appears in the `upfront_mobilized` set derived from earlier `mobilized` policy events. Therefore

\[
D=\sum_h\sum_{j=1}^{|attempts_h|-1}
\mathbf1[method=greedy\ \lor\ attempts_{h,j}\in upfront\_mobilized].
\]

`metrics.duplicate_pursuits` is exactly the count of those events. AirDnD duplicates are no longer fixed to zero: simultaneous local initial or uncovered-reserve commitments are counted. Pending Observer attempts are deliberately not labeled duplicates. An emitted duplicate represents simultaneous assignment/pursuit accounting and may remain even if an earlier engagement later succeeds before that agent's trajectory is executed.

### Theorem 7.2 — engagement probability and shared factor (**P/S**)

For hostile `h`, all attempts use the same sampled floating-point factor `F_h`. Under the ideal continuous-uniform model, `F_h∈[0.72,1.02)`. For the implemented finite-precision generator, use the conservative bound `F_h∈[0.72,1.02]`. With

\[
p_h=clip(0.8F_h,0.05,0.95),
\]

this gives the implementation-safe bound `0.576≤p_h≤0.816`. Attempt draws are separate entries in `attempt_noise`. Conditional on the shared factor under the ideal generator model, outcomes are independent Bernoulli comparisons. Marginally they are dependent through `F_h`. Forced first outcomes override the first comparison.

Conditional independence would yield cumulative success `1−∏(1−p_j)`. That formula is explanatory only; empirical multi-seed simulation is authoritative for this implementation, and neither establishes physical interception probability.

### Theorem 7.3 — neutralization conservation (**P**)

At most one `neutralized` event is emitted per hostile because success immediately breaks the attempt loop. Thus `0≤N≤H`, `leaked=H−N`, and

\[
N+leaked=H,\qquad cumulative\_neutralization=N/H.
\]

`leaked` means not neutralized by this finite simulation, not a physically modeled protected-zone crossing.

## 8. Guidance, RVO2-3D, and actuation

### Theorem 8.1 — guidance command bounds (**P**)

Implementation: `guidance.py::receding_horizon_guidance`.

For positive intercept time, desired velocity is `(basket−position)/max(τ,0.05)`, radially clipped to `max_speed`, z-clipped to `±max_climb_rate`, then changed from current velocity by at most `max_accel·dt`. Therefore the intermediate desired vector obeys speed and climb bounds, and the returned preferred velocity obeys

\[
\|v_{pref}-v\|_2\le a_{max}dt.
\]

If current velocity already violates the speed/climb envelope, acceleration clipping can leave the returned command outside those envelopes. `min_speed` is unused. Feasibility checks only `distance≤1.1·max_speed·τ`; it is necessary only under the code's relaxed rule, not sufficient for full dynamic feasibility. `terminal_proportional_navigation` is a mode label selected when `τ≤terminal_time_s`; no proportional-navigation acceleration law is computed.

### Theorem 8.2 — identity-independent RVO neighbor inclusion and closest approach (**P/D**)

Implementation: `guidance.py::official_rvo2_filter`.

Every supplied neighbor is passed to vendored RVO2-3D after discarding only its identity string; no identity class is filtered. For returned safe velocity and constant neighbor velocity over horizon `T`, reported closest approach minimizes

\[
f(t)=\|r+wt\|^2,
\]

at

\[
t^*=clip\left(-\frac{r\cdot w}{\|w\|^2},0,T\right)
\]

when `w≠0`, and at zero when `w=0`. Convexity of `f` proves the result.

The collision-free interpretation is conditional on the RVO2-3D/ORCA dependency theorem and its exact-state, reciprocal, holonomic, feasible-velocity, and horizon assumptions. AirDnD's noisy, discrete, acceleration-limited setting does not inherit an unconditional physical safety theorem.

### Theorem 8.3 — guidance/RVO safe velocity is actuated (**P**)

For every engagement attempt, the simulator performs exactly three trajectory ticks unless an exception aborts execution. On each tick it:

1. computes `guidance.preferred_velocity`;
2. supplies that command and up to eight nearest interceptor states, all labeled `UNKNOWN`, to `official_rvo2_filter`;
3. sets `safe_array=safety.velocity`;
4. updates position by `x_{k+1}=x_k+0.1·safe_array`;
5. updates stored velocity to `safe_array`; and
6. logs from/to positions, preferred velocity, safe velocity, override status, navigation update, and IFF state.

Thus the RVO result is now on the actuation path rather than merely telemetry. The update is sequential/asynchronous across attempts and agents. No theorem proves that the returned RVO velocity also satisfies the guidance acceleration bound, geofences, static-obstacle constraints, or real vehicle dynamics.

### Theorem 8.4 — measured separation and breach events (**P**)

After each discrete actuation, the simulator computes Euclidean distance from the moved interceptor to every other current interceptor position. It logs the nearest value and emits `friendly_collision` iff that measured value is strictly below the configured threshold. The metric minimum is exactly the minimum logged post-step nearest separation, and collision count is exactly the number of breach events.

These events are threshold breaches sampled after sequential discrete updates; they are not continuous-time collision proofs and may count repeated breaches of one pair.

## 9. State-derived metrics and completion

Implementation: final reduction in `simulation.py::run_scenario`.

### Theorem 9.1 — event/state reducer identities (**P**)

For a completed function return:

- `neutralized = count(kind=="neutralized")`;
- `duplicate_pursuits = count("duplicate_pursuit")`;
- `recovery_count = count("observer_claim")`;
- `friendly_collisions = count("friendly_collision")`;
- `entity_drops = count("entity_drop")`;
- each RF/assignment message metric is the count of its corresponding event kind;
- `retained_coverage` is the fraction of `coverage_status` events whose truth field `retained` is true; and
- `completed` is true iff exactly one `simulation_completed` event exists.

These are direct reductions, not constants.

### Theorem 9.2 — retained-home-cell predicate (**P**)

An interceptor is retained iff its final Euclidean displacement from its own initial grid position is at most `0.25 m`. Exactly one `coverage_status` event is emitted per interceptor, so `retained_coverage∈[0,1]`. This metric is a point-displacement proxy, not an optical corridor-coverage area calculation.

### Theorem 9.3 — entity-drop and completion predicate (**P**)

An `entity_drop` event is emitted for each final interceptor or hostile position containing a nonfinite component. `processed_hostiles` is the count of `track_observed` events. `simulation_completed` is emitted exactly when this count equals `H` and there is no entity-drop event; otherwise `simulation_incomplete` is emitted. This proves finite-state/event completion under the code's predicate, not absence of all possible dropped internal state or process failure before return.

### Theorem 9.4 — software blackout counters (**P**, scoped)

No current scenario path emits `rf_ground_message`, `rf_interdrone_message`, or `target_assignment_message`; the corresponding state-derived counts are therefore zero for successful returns. This proves absence of those software event types. It does not measure electromagnetic emissions or prove a physical radio blackout. The one-way NIR concept is not physically simulated.

## 10. Baselines and dependency-limited optimality

### Dependency result 10.1 — padded OR-Tools baseline (**D**)

Conditional on OR-Tools returning `OPTIMAL`, `_ortools_assign` minimizes total integer-scaled Euclidean distance over a square one-to-one assignment padded with zero-cost dummy nodes. It does not optimize stochastic success, reserve behavior, utility, sequential recovery, collision cost, or retained coverage and is not a global optimum for the AirDnD mission.

`naive_static` assigns available interceptor `i` to hostile `i` up to the smaller count. `independent_greedy` independently chooses the minimum of distance plus seeded Gaussian perturbation. Both use only `round(I(1-r))` available interceptors. The AirDnD and ablation methods evaluate all interceptors but distinguish initial versus reserve behavior as proved in Section 6.

## 11. Statistical approximations and empirical evidence

Implementation: `benchmark.py`.

### Statistical result 11.1 — paired normal interval (**S**)

For values `x_1,…,x_n`, `paired_interval` reports sample mean, median, sample standard deviation, and

\[
\bar x\pm1.96\frac{s}{\sqrt n}.
\]

Approximate 95% coverage requires representative independent paired differences, finite variance, and a sufficiently regular or large-sample distribution. It is not an exact finite-sample interval. For `n=1`, the returned zero-width interval has no 95% coverage justification.

### Theorem 11.2 — Brier and ECE ranges (**P**)

For binary outcomes and predictions in `[0,1]`, Brier score is a mean of squared errors in `[0,1]`, hence lies in `[0,1]`. Implemented ECE is a weighted sum of nonempty-bin absolute prediction/frequency gaps in `[0,1]`; bin weights sum to one, so ECE lies in `[0,1]`.

The benchmark currently calibrates action-success only and does not attach confidence intervals to Brier, ECE, or reliability bins.

### Theorem 11.3 — paired benchmark stream alignment (**P**)

`run_benchmark` iterates the same ordered seed list for every method and preserves result order by method. Pairwise deltas use `zip` over those ordered lists, so each delta compares equal seeds and common scenario counts. Common seeds do not guarantee that every method consumes identical random numbers internally; they guarantee paired scenario seeds.

### Theorem 11.4 — acceptance statuses are result-contingent (**P**)

AC-020, AC-021, and AC-031 cannot report `pass` unless there are at least 30 seeds. Their additional code predicates require favorable lower normal-interval bounds; AC-021 also requires logged learned-model inference on every AirDnD result. These predicates define report status only. Statistical superiority remains **E/S**, dependent on generated values, frozen thresholds, model validity, and interval assumptions.

### Theorem 11.5 — manifest completeness at generation time (**P**)

At manifest construction, every regular file recursively under the output directory except `manifest.sha256` is hashed with SHA-256 and listed. Recomputing those digests detects later byte changes conditional on trusting the manifest. The manifest is not a signature and does not authenticate its author.

## 12. Replay authority, immutability, API bounds, and frontend reducers

### Theorem 12.1 — fixed replay derivation, conditional on artifact integrity (**P/E**)

`run_fixed_replay` returns `run_scenario` results with fixed configurations, and `generate_evidence` serializes those results. Given an unchanged replay artifact generated by the current code, the API converts each stored event record into a frame without recomputing outcomes. `loadReplay('hit'|'recovery')` fetches overview and local streams from those API replay IDs and derives display labels from event presentation/outcome data, not from frame thresholds. The checked-in naive replay is imported from `frontend/src/replays/naive.json`.

This establishes simulator/event-artifact derivation for the loaded paths conditional on file integrity and provenance. Replay JSON files are ordinary mutable files. The code does not prove they are fresh, unchanged, or generated from the current Git revision. Manifest verification and regeneration are empirical integrity obligations.

### Theorem 12.2 — replay freeze strength (**P**, exact scope)

`freezeReplay` freezes each top-level local-view object, the `localViews` map, top-level `overview`, top-level `event`, each frame, the frames array, and the replay object. Therefore these top-level structures cannot be added to, deleted from, or reassigned in strict-mode JavaScript, and the frame array cannot be pushed to.

It is **not a recursive deep freeze**: nested `belief` objects and nested arrays such as positions and velocities remain mutable if a caller retains a reference. `replayAt` also returns a new mutable wrapper with shallow-merged overview/local-view maps. Full transitive replay immutability remains unresolved.

### Theorem 12.3 — API replay index bound (**P**)

For nonempty frames and initial index zero, websocket automatic playback increments only when `index<N−1`; `step` assigns `min(index+1,N−1)`; `seek` assigns only an enumerated matching position; play and pause do not change index. Therefore `0≤index≤N−1` is invariant.

### Theorem 12.4 — evidence path containment (**P**)

A download succeeds only for a nonabsolute path with no `..` component, listed in the manifest, resolving to a regular file whose resolved path remains under the evidence root. Every condition is checked before `FileResponse`.

### Theorem 12.5 — reducer frame bounds (**P**, conditional)

Implementation: `frontend/src/worldview.ts::reducer`.

Assume `maxFrame` is a nonnegative integer, current `frame` is an integer in `[0,maxFrame]`, and scrub/step values are finite. Then:

- `scrub` and `step` return an integer in `[0,maxFrame]` and stop playback;
- `tick` increments by one below `maxFrame`, and at `maxFrame` preserves the frame and stops playback;
- `scenario` resets frame to zero and stops playback; and
- `replay-loaded` resets frame to zero and stops playback.

**Proof.** `clamp` rounds then applies `max(0,min(maxFrame,…))`; the tick branches preserve the stated interval. ∎

`replay-loaded` does not validate `maxFrame`; negative, noninteger, or NaN values violate the theorem's premise.

### Theorem 12.6 — pin and truth-mask bounds (**P**, conditional)

Starting from unique `pinned` IDs with length at most three, `pin` preserves uniqueness and length at most three: existing IDs and a full list are unchanged, otherwise exactly one absent ID is appended. Every `perspective` action sets `groundTruth=false`; only a subsequent explicit `toggle-truth` can enable the evaluator overlay state.

## 13. Proof ledger

| Implemented claim | Class | Result |
|---|---:|---|
| Staggered grid cardinality and initial separation | P | Proven |
| Agent-specific noisy local observations | P/S | Proven for generator; not sensor validation |
| Local-input separation from evaluator assignments | P | Proven syntactically on policy call path |
| Barometer changes z only | P | Proven and integrated into telemetry |
| Four-state IFF logic | P | Proven and invoked; beacon physics absent |
| Belief output schema/ranges | P | Proven |
| Common-random-number counterfactual branches | P | Proven byte-identical per sample |
| Student-input/teacher-label separation | P | Proven for dataset construction |
| Held-out stream-ID disjointness | P | Proven in stated sample-count domain |
| Training loss reduction/generalization/calibration | E | Must be measured |
| OR-Tools optimality | D | Only declared integer distance assignment |
| Mission utility/tie cascade | P/S | Formula and deterministic selection proven; probability product conditional |
| Multi-tick runtime hysteresis | U | Helper proven; scenario uses immediate initialization only |
| Reserve phase affects behavior | P | Proven |
| Observer-ready and expiry mobilization | P | Event order and triggers proven |
| Duplicate-pursuit accounting | P | Exact event rule and reduction proven |
| Shared engagement factor | P/S | Code invariant; probability interpretation model-dependent |
| Guidance preferred-command bounds | P | Proven with stated limitations |
| RVO2-3D result | D | Conditional dependency result |
| Guidance → RVO → position actuation | P | Proven integrated call path |
| Continuous/physical collision safety | U/E | Not mathematically established |
| State-derived metrics | P | Reducer identities proven |
| Software RF event counts | P | Proven event absence, not physical EMCON |
| Approximate paired 95% intervals | S | Formula proven; coverage assumption-dependent |
| Brier/ECE arithmetic | P | Proven |
| Statistical/baseline superiority | E/S | Requires frozen, executed evidence |
| Fixed replay from simulation artifacts | P | Proven for current load paths |
| Replay immutability | P/U | Top-level freeze proven; transitive deep freeze absent |
| API and reducer bounds | P | Proven under stated domains |
| Hardware, field, and physical performance | U/E | Requires dedicated validation |

## 14. Exact unresolved obligations

The following claims are **not** discharged by mathematics in this repository:

1. **Independent proof review:** a second reviewer must check this source-to-theorem mapping and assumptions; this document is not self-authenticating.
2. **Probability quality:** execute held-out Brier, ECE, reliability, regression-error, and confidence-interval evidence for every claimed belief head; current architecture and loss do not prove calibration or generalization.
3. **Statistical superiority:** run the frozen final benchmark with at least 30 paired seeds and report raw values and valid paired uncertainty. No reduction, ablation value, reserve optimum, or reliability threshold may be claimed before results support it.
4. **Counterfactual validity:** common random numbers are proved, but the simplified synthetic rollout's fidelity, causal adequacy, and representativeness of real engagements are empirical/model-validation obligations.
5. **Global optimality:** OR-Tools is optimal only for its declared integer distance assignment. Global mission, reserve, WTA, and stochastic-policy optimality remain unproved.
6. **Runtime hysteresis/terminal control:** scenario execution does not exercise three-tick target switching or a terminal target lock, and the terminal guidance mode does not implement proportional navigation.
7. **Dynamic feasibility:** the current reachability gate omits turn rate, battery, geofence, static obstacles, uncertainty-expanded baskets, and full acceleration-aware reachability; `min_speed` is unused.
8. **Safety:** RVO2-3D actuation is integrated, but continuous-time minimum separation, reciprocal execution under asynchronous updates, noisy-state robustness, geofence compliance, and physical collision avoidance require simulation stress tests, SITL/HITL, and flight evidence.
9. **Navigation realism:** the minimal translational INS/barometer helper lacks attitude, gyro integration, gravity compensation, stochastic bias/random walk, cross-covariance, and closed-loop use of the estimated state.
10. **IFF/identity realism:** authenticated NIR generation/verification, range/aspect/weather/glare/occlusion loss, geometric lineage continuity, spatial-temporal beacon binding, spoof resistance, and safe airborne behavior require implementation and hardware/field validation.
11. **Engagement physics:** neutralization outcomes are seeded Bernoulli events; miss distance, seeker behavior, target manoeuvre realism, kinetic effects, and correlated real-world failure rates are not physically validated.
12. **Coverage meaning:** `retained_coverage` is a home-cell displacement fraction, not proven corridor sensing coverage or protected-volume integrity.
13. **Completion/drop meaning:** entity-drop detection checks final position finiteness only; it does not prove absence of omitted state, numerical transients, dropped telemetry, or process failure before a result is returned.
14. **Physical blackout:** zero software message events do not prove RF silence, jamming survivability, EMCON, NIR noninterference, or absence of hidden hardware communications.
15. **Replay immutability/integrity:** nested frontend replay objects are not transitively frozen; checked-in replay freshness and provenance require regeneration plus a trusted manifest/signature workflow.
16. **ONNX/INT8 universality and edge claims:** one verification batch does not prove all-input numerical equivalence, calibration preservation, `<15 MB`, `<2 ms`, `≥10 Hz`, power, thermal, or declared flight-computer performance.
17. **Bounded-compute claim:** the simulator uses broad local sensing, candidate sorting, nearest-neighbor sorting, and global-sized arrays; an `O(K)` per-agent bound independent of total swarm size is not established by the current implementation.
18. **Physical/hardware/economic claims:** airframe feasibility, battery endurance, acceleration/turn performance, sensor range/FOV, maritime optical contrast, gravity-assisted energy benefit, weather tolerance, $1,000 unit cost, manufacturing scale, and field interception effectiveness require external evidence.

## 15. Proof gate

**Mathematical gate result: PASS WITH EXPLICIT LIMITS.** The mechanisms previously reported absent—local policy separation, reserve phases, Observer readiness and coverage-expiry mobilization, duplicate-event accounting, integrated guidance/RVO actuation, state-derived metrics, common-random-number counterfactual streams, held-out split IDs, simulator-backed replay loading, and bounded reducers—are now present and have code-scoped proofs above. Their stronger physical, statistical, optimality, calibration, and deep-immutability interpretations remain explicitly unproved.

- **May non-browser evidence proceed? Yes.** Unit/property tests, deterministic replay regeneration, benchmark runs, statistical analysis, manifests, ONNX checks, and host measurements are the required next evidence layer.
- **Is Playwright mathematically unblocked? Yes, conditionally on the non-browser suite and independent proof review passing.** Playwright may then verify only UI behavior, replay presentation, masking, and interaction. It cannot discharge any unresolved obligation in Section 14 and must not be cited as physical, statistical, calibration, safety, or optimality proof.
