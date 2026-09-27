# HUSH report revision

- Plain-English pass: clarified the initial 25% reserve share and the airborne Observer roles depicted in Figure 2. The percentage describes initial reserve allocation; the current number of Observers depends on temporary roles and visibility. Defined local belief, private coverage window, coverage gap, refill, held-out data, epochs, paired seeds, leakage and duplicates. Expanded MLP/GRU names and clarified proposed sensing and the browser display connection.

- Corrected Figure 2's embedded label to "Position uncertainty" and explained the amber ellipsoid in its caption as schematic uncertainty in the tracked object's estimated position.

- Replaced organiser documents and internal-file bibliography entries with relevant external research and documentation. Added a conceptual related-work comparison in Section I covering Reynolds, Muro and Stander; retained Jev, OR-Tools, Brier and the original reciprocal collision-avoidance publication. See reference-review.md for verification and claim mapping.

- Latest editorial pass: made all four organiser requirements explicit, removed the geometry-mismatch paragraph, shortened validation limits, and replaced the literal "p-hat" with proper inline mathematical notation in PDF and Word.

- Preserved Team 37 and all four authors.
- Reframed the report around HUSH and coordination without coordination messages.
- Reduced ORCA to a supporting paragraph and removed its illustration.
- Expanded Figure 1 to show offline preparation, per-aircraft local execution and evaluator replay; checked every box label against its bounds.
- Retained the conceptual layers and line-of-sight figures. Figure 4 now shows local information roles; the generic probability illustration has been removed from the report.
- Removed contrastive “X, not Y” phrasing and the requested caption wording.
- Shortened results to one table and a brief comparison.
- Added a dedicated training section with source-checked training/held-out counts, recorded losses and export scope.
- Rendered the Brier score from LaTeX syntax; source is in formulas.tex.
- Verified three pages in the PDF and installed Word, and inspected PDF page images.

## Resolved terminology and sources

HUSH is a name coined by the user. The user-suggested backronym "Handoff Under Signal Hostility" appears once, in the abstract.

The user corrected JEF to Jev and supplied https://jevtypesafe.org/. That site identifies itself as an unofficial community host. The report cites TypeSafe's primary documentation at https://docs.typesafe.ai/concepts/system-one and https://docs.typesafe.ai/introduction/quickstart, accessed September 27, 2026. The documented term is System One. Section IV-A explains the conceptual relationship and the rationale for the existing compact numerical prototype. The repository's independent MLP/GRU implementation provides no evidence of Jev weights, a Jev API integration, or inherited Jev performance guarantees. The comparison concerns the design approach.

Figures explain visibility and information availability at a conceptual level. Detailed collision-point updates and attack-recovery guidance are outside this revision's scope.

The probability section distinguishes estimates of named events from a probability of selecting a target. Target-ranking weights, pursuit-selection formulas and implementation instructions are outside the report's scope.

The latest revision integrates four scenarios and a functional sensing overview into the narrative. The user confirmed that Intelligence Swarm means HUSH's friendly coordination and asked to omit same-aircraft survival and return after impact. See coverage-review.md for the requested-point-to-section mapping and evidence limitations.

## Documentation reread

Reviewed the repository's source documentation: all eight files in resources; AIRDND.md; MATHEMATICAL_PROOFS.md; README.md; PRODUCT.md; PROBLEM_STATEMENTS.md; frontend/DESIGN.md; presentation/README.md; and the vendored RVO2-3D README. Also reviewed the presentation HTML's visible content and the prior frontend alignment notes. The two supplied organiser PDFs have the same extracted text as resources/deliverables.pdf and resources/judging_criteria.pdf.

Cross-checked the training section against src/airdnd/model.py and models/model_report.json. The main distinctions carried into the revision are local model inputs versus offline reference labels; PyTorch scenario inference versus the checked ONNX/INT8 export; proposed visibility and hysteresis behaviour versus its current implementation; and event-probability estimates versus application decisions. Figure and page checks cover the document only; no simulator code, model, or benchmark was changed or retrained.
