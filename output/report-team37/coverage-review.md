# Coverage review for the revised report

The three-page report follows the information flow from the problem to sensing, local interpretation, model preparation, scenario coverage and evidence. HUSH remains the central concept; ORCA is a supporting component.

## Organiser requirements

| Required point | Explicit coverage |
|---|---|
| What exists today and what is new | Section I relates HUSH to Reynolds's local-perception model, Muro's wolf-pack simulations and Stander's observations of role specialisation, then describes HUSH's proposed combination and its implemented baselines. It makes no claim of a worldwide first. |
| Who uses it and the task it changes | Sections I and VII-B identify autonomy evaluation teams and systems integrators, and explain tracing observations, beliefs and outcomes for communication-loss experiments. |
| How it works and what was built | Section I names the simulator, training pipeline and browser replay. Figure 1 and Sections II–IV explain their relationship. |
| Results, limits and next steps | Sections V–VI cover scenario evidence and measured results. Sections VII-A–B give a concise validation scope and next steps. |

The geometry-mismatch paragraph was removed at the user's request. The probability explanation now uses a rendered hat and subscript on p in the PDF and native Office Math in Word.

| Requested point | Location | Evidence and scope |
|---|---|---|
| Big swarm | Section V-A, page 3 | Stored 100-hostile/125-interceptor benchmark and 20–100 scaling report. |
| Intelligence Swarm | Section V-B, page 3 | User confirmed this means HUSH's friendly coordination. Local views and recorded decisions support the concept; learned and handwritten leakage outcomes match. |
| Concentrated waves | Section V-C, page 3 | Proposed. ScenarioConfig and world generation define one initial population; no dedicated repeated concentrated-wave evidence was found. |
| Hit and Miss | Section V-D, page 3 | success.json forces first success; miss_recovery.json forces the first miss. Both are small fixed examples. |
| Same aircraft survives a hit and returns | Excluded at user's request | The present collision model expends that aircraft and supplies no survival-and-return probability. |
| Architecture | Figure 1, page 1 | Offline preparation, per-aircraft local execution, and evaluator replay; ONNX/INT8 export is shown separately. |
| Sensing and onboard functions | Section II-A, page 1 | Proposed optical camera, inertial sensors, barometer, battery monitoring, onboard computation, flight control and NIR identity. Functional overview only; no validated hardware installation is claimed. |
| Local input categories | Section III-A and Figure 4, page 2 | Observed scene, own state, evidence quality and preloaded context. These describe the proposed local view; the model implements a narrower numerical representation. |
| Tie-breaking | Section III-B, page 2 | Describes its consistency purpose and implementation status at a high level. |
| Three-count switching | Section III-B, page 2 | The rule is specified and a reusable helper exists; the audit says scenario execution does not exercise the full behaviour. |
| Local camera / Observer visibility | Figures 2–3 and Section III | Conceptual depth, LOS, memory and ambiguity. |
| Training and Jev rationale | Section IV, page 2 | Local System One design, independent implementation, synthetic training, held-out counts, losses and export checks. |
| 0–1 values | Section IV-C, page 2 | Named-event estimates, separate application logic, and a LaTeX Brier-score expression. |
| Identity, ORCA and uncertainty | Sections II–III and VII | Proposed identity assumptions, supporting separation function and validation limits. |
| Dispatch, reserve, refill and low-battery return | Section V, page 3 | Connected to maintaining observation across scenarios; complete patrol/recharge performance remains unvalidated. |
| Meaning of the 25% and the airborne Observers | Section II, page 1 | AIRDND.md Section 2.3 defines an initial 25% share of the total friendly fleet as reserve. Sections 5.2–5.3 define Observer as a temporary role. Figure 2 shows the user's airborne-reserve concept; the text distinguishes initial reserve share from the changing count of current Observers. |

The generic probability graphic was removed from the report and replaced with the local information overview. Exact targeting inputs, ranked tie-break procedures, weapon-selection calculations and actionable interceptor hardware design remain outside the report's scope. The report makes no claim to include those omitted details.

Source checks: AIRDND.md, MATHEMATICAL_PROOFS.md, PRODUCT.md, src/airdnd/simulation.py, src/airdnd/model.py, configs/benchmark.json, models/model_report.json, evidence/reports/ and evidence/replays/. The preceding reread also covered all resource documents, repository readmes, frontend design and presentation material. No application code or benchmark was changed.
