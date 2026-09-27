# Coverage review

## Pitch alignment, 27 September 2026

- Section I explicitly includes GNSS denial, ground-link denial and unavailable inter-drone radio.
- Section V identifies the independently trained Jev-inspired model and explains the meanings of the three event forecasts at a conceptual level. Forecast evaluation remains separate from application decisions.
- Section IV distinguishes simulator-generated numerical histories from the proposed physical sensing pipeline. Table I is explicitly a category overview. The requested detailed targeting-feature inventory has not been added.
- Section VI now leads with the pitch's independent-greedy comparison: 28.8 percentage points, approximate 95% interval 27.4–30.2, and 53.4% relative reduction. The static comparison and resource qualification remain.
- Added the Apple M3 host, zero recorded collisions/entity drops, and the corrected p95 metric of 19.04 ms normalised per interceptor. The code divides complete scenario elapsed time by 125; this is not complete-scenario latency or an individual decision deadline.
- Section VII describes the proposed five-node HIL, controlled maritime flight and possible SAF integration roadmap, with validation and partner agreement still required.
- AirDnD-pitch-aligned.pdf is a corrected copy of the five-slide source. Naming, the Jev label, the timing value/definition and roadmap status were corrected. The supplied PDF is unchanged.

## Approved ten-point changes

Latest Observer/lifecycle revision: Section III clarifies monitoring both the active interceptor and tracked object and the conceptual backup role. Section IV states that the camera view remains local. Table III lists proposed Docked, Departing, On station, Returning and Landed states; low battery and abort are broad return conditions. Reserve availability and the temporary Observer role are distinguished from flight states. Results are now Table IV. The evidence does not establish pre-miss recognition or immediate physical response; autonomous attack triggers and dispatch-selection procedures remain excluded.

| Change | Current location |
|---|---|
| Explain HUSH directly | Abstract and Sections I-II: incomplete local views, observation history, estimates and preloaded rules. |
| Define HUSH and AirDnD | Section II: concept versus simulation prototype; HUSH expanded once in the abstract. |
| Clarify Figures 2 and 3 | Figure 2 has illustrative counts; Figure 3 explains viewpoint and orientation without assigning a different camera specification. |
| Replace Figure 4 | Separate local records showing visible, remembered and unknown information; input categories moved to Table I. |
| Explain training/runtime separation | Section V-A: reference labels versus local inputs, and the meaning of reduced loss. |
| Clarify probabilities | Section V distinguishes estimates and application scores; V-B covers forecast evaluation with Brier score and proper mathematical notation. |
| Describe frontend contribution | Section IV-B: perspectives, truth masking, frame stepping and comparisons between drones. |
| Correct audience | Section II continuation: government agencies developing defensive systems against threatening drones; intended operation under GNSS denial and unavailable radio links caused by jamming. |
| Improve results | Table IV identifies 30-run means; VI-A adds paired difference and interval, resource qualification and duplicate-event meaning. |
| Consolidate the story | Table II covers the four scenarios; Section VII-B collects validation scope. |

## Organiser requirements

| Required point | Coverage |
|---|---|
| Existing work and proposed contribution | Sections I-II: collective-behaviour research and HUSH's combined concept; no worldwide-first claim. |
| Users and changed task | Sections II and VII-C: intended government users, the jammed operating environment and simulation-based evaluation of local coordination. |
| How it works and what was built | Figure 1 and Sections II-V: simulator, local interpretation, training pipeline and browser replay. |
| Results, limits and next steps | Section VI and Table IV: recorded results; Section VII: validation and continuation. |

## Earlier requests retained

- Big swarm, intelligent friendly coordination, concentrated waves, hit and miss: Table II, with recorded/planned/fixed-example status.
- Same interceptor surviving impact: excluded at the user's request.
- Architecture: Figure 1.
- Sensing and onboard functions: Section III-A, at a conceptual level.
- Local input categories: Table I; the narrower implemented representation is identified in Section IV-A.
- Tie-breaking and three-count switching: purpose in IV-B, implementation status in VII-B.
- Reserve: Section III states 25% of the total friendly fleet initially held available; Observer is temporary. Figure 2's counts are illustrative.
- Altitude, line of sight and memory: Figures 2-4 and Section IV.
- Jev rationale, training and probability checks: Section V.
- Identity and supporting ORCA: Section VII-A.
- Launch, reserve, refill and low-battery return: Section VI lifecycle paragraph; sustained-cycle validation in VII-B.

## Evidence and scope

Compared all 21 repository Markdown files. AIRDND.md describes design intentions; MATHEMATICAL_PROOFS.md limits claims about current execution. Older design/presentation notes are not treated as implementation evidence where they differ from the current specification.

The stored paired comparison in evidence/reports/benchmark.json gives a mean absolute leakage difference of 0.0966666667, with approximate interval [0.0892472183, 0.1040861151]. These become 9.67 percentage points [8.92, 10.41]. The report retains the differing-resource qualification. Duplicate accounting follows Section 7.1 of the implementation audit.

Seven external references remain in first-citation order. Internal audit paths and organiser instructions stay outside the report bibliography. See reference-review.md for verification.

Detailed targeting inputs, ranking procedures, weapon-selection calculations and actionable interceptor hardware design remain outside the report. No application code, model or benchmark was changed.
