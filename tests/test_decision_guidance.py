import math

from airdnd.decision import Candidate, Hysteresis, choose_candidate, claim_delay_s, mission_utility
from airdnd.guidance import GuidanceLimits, official_rvo2_filter, receding_horizon_guidance
from airdnd.model import BeliefOutput


def belief(covered: float = 0.1, success: float = 0.8) -> BeliefOutput:
    return BeliefOutput(0.9, success, covered, 4.0, (100.0, 0.0, 120.0), 4.2, 0.9)


def test_utility_tie_break_prefers_sector_then_lower_coverage_then_track_id():
    a = Candidate("A", belief(0.8), 1.0, True, 6.0, 0.1, 0.1, 0.1, 0.0)
    b = Candidate("B", belief(0.1), 1.0, True, 6.0, 0.1, 0.1, 0.1, 0.0)
    assert mission_utility(a) < mission_utility(b)
    tied_a = Candidate("A", belief(), 1.0, True, 6.0, 0.1, 0.1, 0.1, 0.0)
    tied_b = Candidate("B", belief(), 1.0, True, 6.0, 0.1, 0.1, 0.1, 0.0)
    assert choose_candidate([tied_b, tied_a], epsilon=0.02).track_id == "A"


def test_hysteresis_margin_grows_with_progress_and_hard_release_is_immediate():
    state = Hysteresis(current_track="A")
    assert not state.consider("B", alternate_utility=0.60, current_utility=0.50, progress=0.8, hard_release=False)
    assert state.consider("B", alternate_utility=0.64, current_utility=0.50, progress=0.8, hard_release=False) is False
    assert state.consider("B", 0.64, 0.50, 0.8, False) is False
    assert state.consider("B", 0.64, 0.50, 0.8, False) is True
    assert state.consider("C", 0.0, 1.0, 1.0, True) is True


def test_claim_delay_ranks_complete_priority_not_distance_alone():
    strong = Candidate("far", belief(success=0.9), 1.0, True, 4.0, 0.1, 0.1, 0.05, 0.0, battery=0.9)
    weak = Candidate("near", belief(success=0.6), 1.0, False, 3.0, 0.1, 0.2, 0.2, 0.0, battery=0.5)
    delays = claim_delay_s([weak, strong])
    assert delays["far"] < delays["near"]


def test_receding_horizon_guidance_limits_velocity_and_reports_terminal_transfer():
    limits = GuidanceLimits(max_speed=30.0, max_accel=10.0, max_climb_rate=5.0, terminal_time_s=1.0)
    mid = receding_horizon_guidance((0, 0, 100), (0, 0, 0), (100, 0, 130), 4.0, limits, 0.1)
    terminal = receding_horizon_guidance((0, 0, 100), (20, 0, 0), (10, 10, 100), 0.5, limits, 0.1)
    assert mid.feasible
    assert math.dist((0, 0, 0), mid.preferred_velocity) <= 1.01
    assert abs(mid.preferred_velocity[2]) <= 0.51
    assert terminal.mode == "terminal_proportional_navigation"


def test_official_rvo2_3d_deflects_conflict_for_every_identity():
    safe = official_rvo2_filter(
        position=(0, 0, 100),
        velocity=(10, 0, 0),
        preferred_velocity=(10, 0, 0),
        neighbors=[((5, 0.5, 100), (-10, 0, 0), "UNKNOWN")],
        min_separation_m=3.0,
        horizon_s=1.0,
        time_step_s=0.1,
        max_speed_mps=30.0,
    )
    assert safe.backend_name == "snape/RVO2-3D"
    assert safe.orca_plane_count >= 1
    assert safe.velocity != (10.0, 0.0, 0.0)
    assert safe.override
