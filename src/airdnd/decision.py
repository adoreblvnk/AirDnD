from __future__ import annotations

from dataclasses import dataclass

from .model import BeliefOutput


@dataclass(frozen=True)
class Candidate:
    track_id: str
    belief: BeliefOutput
    consequence: float
    assigned_sector: bool
    time_to_boundary_s: float
    expenditure_cost: float
    battery_cost: float
    coverage_loss_cost: float
    collision_cost: float
    battery: float = 1.0


def mission_utility(candidate: Candidate) -> float:
    b = candidate.belief
    benefit = (
        candidate.consequence
        * b.target_leak_probability
        * b.action_success_probability
        * (1.0 - b.friendly_coverage_probability)
    )
    return benefit - candidate.expenditure_cost - candidate.battery_cost - candidate.coverage_loss_cost - candidate.collision_cost


def choose_candidate(candidates: list[Candidate], epsilon: float = 0.02) -> Candidate:
    if not candidates:
        raise ValueError("at least one candidate is required")
    best_score = max(mission_utility(c) for c in candidates)
    tied = [c for c in candidates if best_score - mission_utility(c) <= epsilon]
    return min(
        tied,
        key=lambda c: (
            not c.assigned_sector,
            c.belief.friendly_coverage_probability,
            c.time_to_boundary_s,
            -c.belief.action_success_probability,
            c.belief.predicted_intercept_time,
            c.coverage_loss_cost,
            c.battery_cost + c.expenditure_cost,
            c.track_id,
        ),
    )


@dataclass
class Hysteresis:
    current_track: str | None = None
    pending_track: str | None = None
    consecutive_ticks: int = 0

    def consider(
        self,
        alternate_track: str,
        alternate_utility: float,
        current_utility: float,
        progress: float,
        hard_release: bool,
    ) -> bool:
        if hard_release:
            self.current_track = alternate_track
            self.pending_track = None
            self.consecutive_ticks = 0
            return True
        margin = 0.05 + 0.10 * min(1.0, max(0.0, progress))
        if alternate_utility - current_utility < margin:
            self.pending_track = None
            self.consecutive_ticks = 0
            return False
        if self.pending_track != alternate_track:
            self.pending_track = alternate_track
            self.consecutive_ticks = 1
        else:
            self.consecutive_ticks += 1
        if self.consecutive_ticks >= 3:
            self.current_track = alternate_track
            self.pending_track = None
            self.consecutive_ticks = 0
            return True
        return False


def claim_delay_s(candidates: list[Candidate], interval_s: float = 0.15) -> dict[str, float]:
    ranked = sorted(
        candidates,
        key=lambda c: (
            not c.assigned_sector,
            -mission_utility(c),
            -c.belief.action_success_probability,
            c.belief.predicted_intercept_time,
            c.coverage_loss_cost,
            -c.battery,
            c.track_id,
        ),
    )
    return {candidate.track_id: rank * interval_s for rank, candidate in enumerate(ranked)}
