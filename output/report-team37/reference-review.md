# Research reference review

The report bibliography now contains external research and directly relevant technical documentation. Organiser instructions and internal source paths have been removed from the bibliography. Internal records remain the basis for reporting our own measurements; their audit locations are retained in coverage-review.md and revision-notes.md.

| Reference | What it supports | Verified source |
|---|---|---|
| Reynolds, 1987 | Collective motion emerging from locally perceived information in a distributed simulation. | [Author's publication page](https://www.red3d.com/cwr/papers/1987/boids.html) |
| Muro et al., 2011 | A computational wolf-pack model in which collective behaviour emerges without explicit communication or hierarchy. This is a model result; it does not establish that real wolves never communicate. | [Published article abstract and metadata](https://pubmed.ncbi.nlm.nih.gov/21963347/) |
| Stander, 1992 | Field observations of complementary and individually differentiated roles in lion group hunts. | [Publisher's article page](https://link.springer.com/article/10.1007/BF00170175) |
| TypeSafe AI, System One | Jev's structured judgments and probabilities as a conceptual reference. | [Official documentation](https://docs.typesafe.ai/concepts/system-one) |
| Google OR-Tools | Assignment optimisation used in the existing offline reference-data process. | [Official documentation](https://developers.google.com/optimization/assignment/assignment_example) |
| Brier, 1950 | Probability forecast evaluation; the report displays the common binary mean-squared-error form. | [Original journal publication](https://journals.ametsoc.org/doi/abs/10.1175/1520-0493%281950%29078%3C0001%3AVOFEIT%3E2.0.CO%3B2) |
| van den Berg et al., 2011 | Reciprocal collision avoidance as a supporting function. | [Authors' project page and publication metadata](https://gamma-web.iacs.umd.edu/ORCA/) |

## Relationship to the repository research

Reviewed AIRDND.md Section 14 in full, including the external repositories, algorithm documentation, simulation tools, tracking, inference and operational sources. OR-Tools and ORCA are retained where they support the actual report. The three-page bibliography selects sources used in the text instead of reproducing the entire software catalogue.

Searched the current checkout's design/research Markdown and presentation text for wolf, hunting, herding, animal, isolation, role specialisation and related terms. No pre-existing wolf-pack research passage was located there. Reynolds, Muro and Stander are newly verified additions for the biological comparison requested by the user.

The comparison remains conceptual: local observation, emergent collective behaviour and complementary roles. The report does not claim that HUSH implements animal herding or isolation, that biological studies validate the aircraft simulation, or that these prior studies are direct performance baselines. No attack procedures or weapon-control implementation details were added.

Verified on 27 September 2026. Citation numbering follows first appearance, and every bibliography entry has an in-text citation.
