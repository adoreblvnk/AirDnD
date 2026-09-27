# Screen scope and document alignment

These seven images are frontend expectations, not screenshots of implemented behaviour. They were generated with the built-in image tool, whose exact model version is not exposed. The original concepts remain unchanged. The final prompts are in `prompts.md`.

## Screens

1. `01-layered-sectors.png`: sector volumes, lower active layer, upper reserve/Observer layer, side elevation, and RF scenario status.
2. `02-camera-perspectives.png`: forward and downward camera perspectives, local detections, visibility and identity state. Boxes denote observations, not proof of hostility.
3. `03-outcome-replay.png`: conceptual contact aftermath and miss comparison. Debris is illustrative; it is not validated debris physics.
4. `04-uncertainty-view.png`: local observation spread, stale observations, occlusion, reacquisition, and recorded speed change. No calibrated confidence level is claimed.
5. `05-identity-view.png`: identical-looking objects with different recorded identity states. Missing identity information remains unknown.
6. `06-separation-view.png`: friendly-only separation intervention, preferred versus applied motion, and an illustrative separation trace.
7. `07-fleet-lifecycle.png`: departure, on-station/reserve states, vacancy, refill, low battery, return and landing.

These are read-only conceptual views. Detailed autonomous weapon-target ranking, strike optimization, and automated re-engagement decision interfaces are outside this deliverable.

## Corrections and distinctions

- **Altitude:** use world-space altitude, not screen position, to distinguish layers. The repository navigation model calls vertical height Z; calling it Y in a visual discussion does not change the intended above/below relationship.
- **Initial formation versus a moment in flight:** AIRDND.md stages interceptors above anticipated hostile altitude. Showing active friendlies and opposing objects at one lower altitude while reserves observe from above is a requested storyboard state, not the documented initial formation in every scenario.
- **Observer:** a temporary role held by a normal interceptor. Neither a separate airframe nor a permanently appointed coordinator is specified.
- **Reserve denominator:** the documented experimental reserve is 25% of the total friendly fleet. Fifteen active plus four reserve makes nineteen total, of which four is approximately 21.1%. The document does not establish 25% as an operationally sufficient or optimal reserve.
- **Sector counts:** more friendly interceptors than hostile objects in every sector is a new requested illustration constraint. The existing documentation does not establish it as a guaranteed invariant. Sector occupancy and visibility also need not remain constant.
- **Organizer geometry:** the organizer specifies pursuit from behind. AIRDND.md's spoken pitch explicitly rejects that geometry. No organizer exception was found in the supplied material; imagery cannot resolve the conflict.
- **Hysteresis versus prediction:** hysteresis suppresses repeated switching. It is not a motion predictor, a miss probability model, or evidence of a particular update frequency. The proof audit says the scenario does not exercise the full multi-tick switching behaviour.
- **Update speed:** isolated neural inference timing is not the end-to-end sensor, tracking, decision, safety and actuation period. These concepts do not invent a millisecond loop rate.
- **Probability:** current engagement outcomes are synthetic random events, not validated physical hit/miss probabilities. No operational probability or confidence percentage is placed on the mockups.
- **Uncertainty:** a drawn envelope or ellipsoid is a conceptual uncertainty visualization. Without calibration it must not be labelled a 95% confidence region.
- **Recovery:** the design describes conditional observation-driven recovery, not instantaneous guaranteed response. The large checked-in benchmark records no Observer recovery events; a separate forced-first-miss replay demonstrates the event sequence.
- **Identity:** silhouette recognition alone cannot confirm friend or foe. The proposal distinguishes confirmed friendly, friendly lineage, unknown and hostile evidence; beacon loss alone is not hostile evidence. The proof audit says realistic beacon/lineage behaviour is not implemented.
- **Communication:** the design disallows RF and assignment messages, but proposes one-way optical identity information. Therefore 'no RF/assignment communication' is more accurate than 'no information exchanged by any means'. Zero software message counters are not a physical RF measurement.
- **Safety:** the vendored RVO2-3D output is on the simulator's motion path, but that is not a guarantee of continuous or physical collision avoidance.
- **Battery and return:** these are specified behaviours and frontend expectations. The current limited simulator does not establish a validated complete patrol, recharge and return cycle.
- **Debris:** there is no validated debris model in the inspected implementation. The illustrated aftermath must not imply a proven safe debris footprint or negligible collateral risk.
- **Hardcoding:** fixed-seed replay and explicitly scripted concept scenes can support a presentation. Scripted camera detections, classifications, motion, recovery, debris and UI values must not be presented as measured autonomous behaviour. The organizer explicitly asks teams to disclose what is stubbed and where the demonstration breaks.

## Additional important presentation features

- Side elevation and ground projections to make altitude unambiguous.
- Visible sector boundaries and empty cells, including after departure.
- Consistent aircraft identity across overview, camera and replay views; role changes should not change aircraft type.
- Explicit separation between local observations and evaluator truth.
- Field of view, occlusion, stale observations and reacquisition.
- Unknown identity and loss of identity information without automatic hostile classification.
- Separation intervention and an observable distinction between intended and applied motion.
- Low-battery status, abort/return status and landing completion.
- Pause, single-frame stepping, event markers and replay reset.
- Non-colour-only symbols and labels, legible contrast, keyboard controls and reduced-motion support.
- Clear scene provenance: conceptual, scripted, or generated from recorded simulator events.
- Explicit degraded-condition examples only when implemented or clearly marked as scripted concepts.
- No claims of measured novelty, reliability, cost, update rate, physical safety or autonomous behaviour inferred from visual polish.

## Sources

- [Organizer Track 3 brief](../../../resources/03_Interceptors.md)
- [Organizer deliverables](../../../resources/deliverables.pdf)
- [Architecture specification](../../../AIRDND.md), especially sections 2, 4, 5, 6, 9 and 12.
- [Mathematical proof audit](../../../MATHEMATICAL_PROOFS.md), especially unresolved obligations in section 14.
- [Stored benchmark](../../../evidence/reports/benchmark.json)
- [Fixed recovery replay](../../../evidence/replays/miss_recovery.json)
