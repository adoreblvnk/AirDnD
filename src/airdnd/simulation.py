from __future__ import annotations

from dataclasses import asdict, dataclass
import hashlib
import math
from typing import Any

import numpy as np
import torch

from .core import generate_staggered_grid
from .decision import Candidate, Hysteresis, choose_candidate, claim_delay_s, mission_utility
from .guidance import GuidanceLimits, official_rvo2_filter, receding_horizon_guidance
from .model import BeliefOutput, decode_beliefs, trained_runtime_model
from .observation import IFFMachine, LocalTracker, NavigationFilter

BASELINES = ("naive_static", "independent_greedy", "deterministic_ablation", "airdnd", "ortools_teacher")


@dataclass(frozen=True)
class ScenarioConfig:
    hostiles: int
    interceptors: int
    seed: int
    method: str
    reserve_ratio: float = 0.25
    force_first_miss: bool = False
    force_first_success: bool = False
    minimum_separation_m: float = 8.0


@dataclass(frozen=True)
class EvidenceEvent:
    time_s: float
    kind: str
    truth: dict[str, Any]
    agent_local: dict[str, Any]
    presentation: dict[str, Any]


@dataclass(frozen=True)
class SimulationMetrics:
    hostiles_total: int
    neutralized: int
    leaked: int
    duplicate_pursuits: int
    recovery_count: int
    cumulative_neutralization: float
    retained_coverage: float
    minimum_separation_m: float
    friendly_collisions: int
    entity_drops: int
    completed: bool
    rf_ground_messages: int
    rf_interdrone_messages: int
    target_assignment_messages: int
    safety_filter: str


@dataclass(frozen=True)
class SimulationResult:
    config: ScenarioConfig
    metrics: SimulationMetrics
    events: tuple[EvidenceEvent, ...]
    teacher_backend: str | None = None
    schema_version: str = "1.0"
    evidence_class: str = "simulation_evidence"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _local_id(agent_id: str, hostile_id: str) -> str:
    return f"{agent_id}-{hashlib.sha256(f'{agent_id}:{hostile_id}'.encode()).hexdigest()[:8]}"


def _world(config: ScenarioConfig) -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(config.seed)
    hostile_x = np.linspace(0.0, 900.0, config.hostiles)
    hostile = np.column_stack((hostile_x, 1400.0 + rng.normal(0, 20, config.hostiles), rng.uniform(100, 200, config.hostiles)))
    cells = generate_staggered_grid(config.interceptors, max(1, math.ceil(math.sqrt(config.interceptors))), 60.0, 250.0, 40.0)
    interceptors = np.asarray([cell.position for cell in cells], dtype=float)
    return hostile, interceptors


def _ortools_assign(hostiles: np.ndarray, interceptors: np.ndarray) -> tuple[dict[int, list[int]], str]:
    from ortools.graph.python import linear_sum_assignment

    solver = linear_sum_assignment.SimpleLinearSumAssignment()
    # Pad the smaller partition with zero-cost dummy threats; this solver is square.
    size = max(len(hostiles), len(interceptors))
    for h in range(size):
        for i in range(size):
            cost = int(np.linalg.norm(interceptors[i] - hostiles[h]) * 100) if h < len(hostiles) and i < len(interceptors) else 0
            solver.add_arc_with_cost(h, i, cost)
    status = solver.solve()
    if status != solver.OPTIMAL:
        raise RuntimeError("OR-Tools assignment did not solve")
    assignment: dict[int, list[int]] = {h: [] for h in range(len(hostiles))}
    for h in range(len(hostiles)):
        i = solver.right_mate(h)
        if 0 <= i < len(interceptors):
            assignment[h].append(i)
    return assignment, "ortools"


def _local_history(
    config: ScenarioConfig,
    interceptor_index: int,
    local_track_id: str,
    observer_position: np.ndarray,
    local_position: np.ndarray,
    nearest_friendly_distance: float,
    visibly_covered: bool,
) -> np.ndarray:
    seed_material = f"{config.seed}:{interceptor_index}:{local_track_id}".encode()
    seed = int(hashlib.sha256(seed_material).hexdigest()[:16], 16)
    rng = np.random.default_rng(seed)
    relative = local_position - observer_position
    target_velocity = np.asarray((0.0, -30.0, 0.0))
    distance = float(np.linalg.norm(relative))
    time_to_boundary = float(max(0.0, local_position[1]) / 30.0)
    base = np.asarray(
        (
            relative[0] / 1000.0,
            relative[1] / 1500.0,
            relative[2] / 300.0,
            target_velocity[0] / 50.0,
            target_velocity[1] / 50.0,
            target_velocity[2] / 50.0,
            distance / 1500.0,
            time_to_boundary / 60.0,
            float(visibly_covered),
            nearest_friendly_distance / 1500.0,
            0.85,
            0.05,
        ),
        dtype=np.float32,
    )
    return np.stack([base + rng.normal(0.0, 0.006, 12).astype(np.float32) for _ in range(5)])


def _handwritten_belief(history: np.ndarray, hostile_position: np.ndarray) -> BeliefOutput:
    features = history[-1]
    distance = max(0.0, float(features[6]) * 1500.0)
    time_to_boundary = max(0.1, float(features[7]) * 60.0)
    covered = bool(features[8] > 0.5)
    intercept_time = distance / 30.0
    return BeliefOutput(
        target_leak_probability=float(np.clip(0.25 + 0.55 / (1.0 + time_to_boundary / 12.0), 0.05, 0.95)),
        action_success_probability=float(np.clip(1.05 - distance / 1700.0, 0.05, 0.95)),
        friendly_coverage_probability=0.85 if covered else 0.10,
        predicted_intercept_time=intercept_time,
        predicted_intercept_point=(
            float(hostile_position[0]),
            float(hostile_position[1]),
            float(hostile_position[2]),
        ),
        predicted_coverage_expiry=min(time_to_boundary, intercept_time + 4.2),
        confidence=0.75,
    )


def _policy_assign(
    config: ScenarioConfig,
    hostiles: np.ndarray,
    interceptors: np.ndarray,
) -> tuple[dict[int, list[int]], list[EvidenceEvent]]:
    """Run independent policies over local tracks; assignment is evaluator output only."""
    evaluator_attempts: dict[int, list[int]] = {h: [] for h in range(config.hostiles)}
    decisions: list[EvidenceEvent] = []
    model = trained_runtime_model() if config.method == "airdnd" else None
    belief_source = "trained_multihead_model" if model is not None else "handwritten_local_belief"
    initial_active = max(0, min(config.interceptors, int(round(config.interceptors * (1.0 - config.reserve_ratio)))))
    hostile_truth = {
        f"H{index:03d}": (tuple(float(x) for x in position), (0.0, -30.0, 0.0))
        for index, position in enumerate(hostiles)
    }
    # These are observable kinematics, not shared claims or target assignments.
    friendly_motion: list[tuple[np.ndarray, np.ndarray]] = []

    for interceptor_index in range(config.interceptors):
        phase = "initial" if interceptor_index < initial_active else "reserve"
        agent_id = f"I{interceptor_index:03d}"
        own_position = interceptors[interceptor_index]
        tracks = LocalTracker(agent_id, config.seed + interceptor_index, noise_std_m=2.0).observe(
            hostile_truth,
            tuple(float(x) for x in own_position),
            sensor_range_m=5_000.0,
        )
        local_targets = [
            (hostile_index, track, np.asarray(track.position, dtype=float))
            for hostile_index, track in enumerate(tracks)
        ]
        def visibly_covered(local_position: np.ndarray) -> bool:
            for position, velocity in friendly_motion:
                speed_squared = float(velocity @ velocity)
                if speed_squared == 0.0:
                    continue
                lookahead = float(np.clip(((local_position - position) @ velocity) / speed_squared, 0.0, 100.0))
                if float(np.linalg.norm(local_position - (position + velocity * lookahead))) <= 6.0:
                    return True
            return False

        covered = [
            visibly_covered(local_position)
            for _hostile_index, _track, local_position in local_targets
        ]
        pending_reserve = False
        if phase == "reserve":
            uncovered_targets = [target for target, is_covered in zip(local_targets, covered) if not is_covered]
            if uncovered_targets:
                local_targets = uncovered_targets
                covered = [False] * len(local_targets)
            else:
                pending_reserve = True
        if not local_targets:
            continue

        local_targets.sort(key=lambda item: (item[2][0], item[1].local_id))
        home_rank = interceptor_index % len(local_targets)
        nearest_friendly_distance = min(
            (float(np.linalg.norm(position - own_position)) for position, _velocity in friendly_motion),
            default=5_000.0,
        )
        histories = [
            _local_history(
                config,
                interceptor_index,
                track.local_id,
                own_position,
                local_position,
                nearest_friendly_distance,
                visibly_covered=is_covered,
            )
            for (hostile_index, track, local_position), is_covered in zip(local_targets, covered)
        ]
        if model is not None:
            with torch.inference_mode():
                beliefs = decode_beliefs(model(torch.from_numpy(np.stack(histories))))
        else:
            beliefs = [
                _handwritten_belief(history, local_position)
                for history, (_hostile_index, _track, local_position) in zip(histories, local_targets)
            ]
        candidates: list[Candidate] = []
        for rank, ((hostile_index, track, local_position), belief) in enumerate(zip(local_targets, beliefs)):
            candidates.append(
                Candidate(
                    track_id=track.local_id,
                    belief=belief,
                    consequence=1.0,
                    assigned_sector=rank == home_rank,
                    time_to_boundary_s=float(max(0.0, local_position[1]) / 30.0),
                    expenditure_cost=0.05,
                    battery_cost=0.03,
                    coverage_loss_cost=0.02 if rank == home_rank else 0.42,
                    collision_cost=0.0,
                    battery=0.85,
                )
            )
        selected = choose_candidate(candidates)
        selected_index = candidates.index(selected)
        selected_hostile, _selected_track, selected_local_position = local_targets[selected_index]
        hysteresis = Hysteresis()
        hysteresis.consider(selected.track_id, mission_utility(selected), 0.0, 0.0, True)

        evaluator_attempts[selected_hostile].append(interceptor_index)
        direction = selected_local_position - own_position
        norm = float(np.linalg.norm(direction))
        observed_velocity = np.zeros(3) if norm == 0.0 else direction * (20.0 / norm)
        if not pending_reserve:
            friendly_motion.append((own_position.copy(), observed_velocity))
        readiness_kind = "observer_ready" if pending_reserve else "mobilized"
        trigger = (
            "observed_friendly_coverage"
            if pending_reserve
            else ("preloaded_initial_screen" if phase == "initial" else "locally_observed_uncovered_track")
        )
        decisions.append(
            EvidenceEvent(
                0.0,
                readiness_kind,
                {"interceptor_id": agent_id, "phase": phase},
                {
                    "agent_id": agent_id,
                    "trigger": trigger,
                },
                {"frame": len(decisions), "label": "reserve observer ready" if pending_reserve else f"{phase} mobilization"},
            )
        )
        decisions.append(
            EvidenceEvent(
                0.0,
                "policy_decision",
                {
                    "hostile_id": f"H{selected_hostile:03d}",
                    "interceptor_id": agent_id,
                    "target_position": hostiles[selected_hostile].round(6).tolist(),
                },
                {
                    "agent_id": agent_id,
                    "local_track_id": selected.track_id,
                    "belief_source": belief_source,
                    "inference_executed": model is not None,
                    "belief": asdict(selected.belief),
                    "utility": mission_utility(selected),
                    "hysteresis_track": hysteresis.current_track,
                    "downstream_policy": "mission_utility+deterministic_mobilization_v1",
                },
                {"frame": len(decisions), "label": "local policy decision"},
            )
        )
    return evaluator_attempts, decisions


def _assign(
    config: ScenarioConfig,
    hostiles: np.ndarray,
    interceptors: np.ndarray,
) -> tuple[dict[int, list[int]], str | None, list[EvidenceEvent]]:
    assigned: dict[int, list[int]] = {h: [] for h in range(config.hostiles)}
    available = max(0, int(round(config.interceptors * (1.0 - config.reserve_ratio))))
    if config.method == "naive_static":
        for i in range(min(available, config.hostiles)):
            assigned[i].append(i)
    elif config.method == "independent_greedy":
        rng = np.random.default_rng(config.seed + 10_000)
        for i in range(available):
            distances = np.linalg.norm(hostiles - interceptors[i], axis=1) + rng.normal(0, 180, config.hostiles)
            assigned[int(np.argmin(distances))].append(i)
    elif config.method in ("deterministic_ablation", "airdnd"):
        policy_assignments, decisions = _policy_assign(config, hostiles, interceptors)
        return policy_assignments, None, decisions
    elif config.method == "ortools_teacher":
        teacher_assignments, backend = _ortools_assign(hostiles, interceptors)
        return teacher_assignments, backend, []
    else:
        raise ValueError(f"unknown baseline: {config.method}")
    return assigned, None, []


def run_scenario(config: ScenarioConfig) -> SimulationResult:
    if config.hostiles <= 0 or config.interceptors <= 0:
        raise ValueError("hostiles and interceptors must be positive")
    if config.method not in BASELINES:
        raise ValueError(f"method must be one of {BASELINES}")
    hostiles, interceptors = _world(config)
    initial_interceptor_positions = interceptors.copy()
    assignments, teacher_backend, policy_events = _assign(config, hostiles, interceptors)
    rng = np.random.default_rng(config.seed + 20_000)
    shared_factors = rng.uniform(0.72, 1.02, config.hostiles)
    attempt_noise = rng.random((config.hostiles, max(1, config.interceptors)))
    events: list[EvidenceEvent] = list(policy_events)
    pending_observers = {
        str(event.truth["interceptor_id"])
        for event in policy_events
        if event.kind == "observer_ready"
    }
    upfront_mobilized = {
        str(event.truth["interceptor_id"])
        for event in policy_events
        if event.kind == "mobilized"
    }
    time_s = 0.0
    interceptor_velocities = np.zeros_like(interceptors)
    navigation_filters = [
        NavigationFilter(tuple(float(x) for x in position)) for position in interceptors
    ]
    for h in range(config.hostiles):
        hostile_id = f"H{h:03d}"
        attempts = assignments[h]

        first_agent = f"I{attempts[0]:03d}" if attempts else "UNOBSERVED"
        events.append(
            EvidenceEvent(
                time_s,
                "track_observed",
                {"hostile_id": hostile_id, "position": hostiles[h].round(6).tolist()},
                {"agent_id": first_agent, "local_track_id": _local_id(first_agent, hostile_id), "noisy_position": (hostiles[h] + rng.normal(0, 2, 3)).round(6).tolist()},
                {"frame": len(events), "evaluator_overlay": False, "label": "local observation"},
            )
        )
        recovery_candidates: list[Candidate] = []
        for interceptor_index in attempts[1:]:
            recovery_agent = f"I{interceptor_index:03d}"
            recovery_track = LocalTracker(
                recovery_agent,
                config.seed + interceptor_index,
                noise_std_m=2.0,
            ).observe(
                {
                    hostile_id: (
                        tuple(float(x) for x in hostiles[h]),
                        (0.0, -30.0, 0.0),
                    )
                },
                tuple(float(x) for x in interceptors[interceptor_index]),
                sensor_range_m=5_000.0,
            )[0]
            local_intercept = np.asarray(recovery_track.position, dtype=float)
            local_distance = float(np.linalg.norm(local_intercept - interceptors[interceptor_index]))
            recovery_candidates.append(
                Candidate(
                    track_id=recovery_track.local_id,
                    belief=BeliefOutput(
                        0.9,
                        float(np.clip(1.0 - local_distance / 2_000.0, 0.05, 0.95)),
                        0.0,
                        local_distance / 30.0,
                        recovery_track.position,
                        4.2,
                        0.75,
                    ),
                    consequence=1.0,
                    assigned_sector=False,
                    time_to_boundary_s=float(max(0.0, local_intercept[1]) / 30.0),
                    expenditure_cost=0.05,
                    battery_cost=0.03,
                    coverage_loss_cost=0.02,
                    collision_cost=0.0,
                    battery=0.85,
                )
            )
        recovery_delays = claim_delay_s(recovery_candidates)
        for duplicate_index in attempts[1:]:
            duplicate_agent = f"I{duplicate_index:03d}"
            if config.method == "independent_greedy" or duplicate_agent in upfront_mobilized:
                cause = (
                    "independent_local_choice"
                    if config.method == "independent_greedy"
                    else "simultaneous_local_commitment"
                )
                events.append(
                    EvidenceEvent(
                        time_s,
                        "duplicate_pursuit",
                        {"hostile_id": hostile_id, "interceptor_id": duplicate_agent},
                        {"agent_id": duplicate_agent, "cause": cause},
                        {"frame": len(events), "label": "duplicate pursuit"},
                    )
                )
        for order, interceptor_index in enumerate(attempts):
            agent_id = f"I{interceptor_index:03d}"
            if order > 0 and config.method != "independent_greedy" and agent_id in pending_observers:
                time_s += 4.2
                events.append(EvidenceEvent(time_s, "coverage_expired", {"hostile_id": hostile_id}, {"coverage_probability": 0.0}, {"frame": len(events), "label": "coverage expired"}))
                local_track_id = _local_id(agent_id, hostile_id)
                delay = recovery_delays[local_track_id]
                time_s += delay
                if agent_id in pending_observers:
                    events.append(
                        EvidenceEvent(
                            time_s,
                            "mobilized",
                            {"interceptor_id": agent_id, "phase": "reserve"},
                            {"agent_id": agent_id, "trigger": "locally_observed_coverage_expiry"},
                            {"frame": len(events), "label": "reserve mobilization"},
                        )
                    )
                    pending_observers.remove(agent_id)
                events.append(EvidenceEvent(time_s, "observer_claim", {"hostile_id": hostile_id}, {"agent_id": agent_id, "local_track_id": local_track_id, "claim_delay_s": delay, "priority_rank": int(round(delay / 0.15)), "trigger": "locally_observed_coverage_expiry"}, {"frame": len(events), "label": "observation-driven recovery"}))

            probability = float(np.clip(0.80 * shared_factors[h], 0.05, 0.95))
            outcome = attempt_noise[h, order] < probability
            if h == 0 and order == 0 and config.force_first_miss:
                outcome = False
            if h == 0 and order == 0 and config.force_first_success:
                outcome = True
            identity_state = IFFMachine().update(
                lineage=False,
                beacon_valid=False,
                beacon_bound=False,
                hostile_evidence=True,
            )
            guidance = None
            safety = None
            for trajectory_tick in range(3):
                own_array = interceptors[interceptor_index].copy()
                own_position = tuple(float(x) for x in own_array)
                own_velocity = tuple(float(x) for x in interceptor_velocities[interceptor_index])
                distances_to_others = np.linalg.norm(interceptors - own_array, axis=1)
                nearest_indices = [int(index) for index in np.argsort(distances_to_others) if int(index) != interceptor_index][:8]
                neighbor_tracks = [
                    (
                        tuple(float(x) for x in interceptors[index]),
                        tuple(float(x) for x in interceptor_velocities[index]),
                        "UNKNOWN",
                    )
                    for index in nearest_indices
                ]
                time_to_intercept = max(0.3, float(np.linalg.norm(hostiles[h] - own_array)) / 30.0)
                guidance = receding_horizon_guidance(
                    own_position,
                    own_velocity,
                    tuple(float(x) for x in hostiles[h]),
                    time_to_intercept,
                    GuidanceLimits(30.0, 10.0, 5.0, 1.0),
                    0.1,
                )
                safety = official_rvo2_filter(
                    position=own_position,
                    velocity=own_velocity,
                    preferred_velocity=guidance.preferred_velocity,
                    neighbors=neighbor_tracks,
                    min_separation_m=config.minimum_separation_m,
                    horizon_s=3.0,
                    time_step_s=0.1,
                    max_speed_mps=30.0,
                )
                safe_array = np.asarray(safety.velocity, dtype=float)
                interceptors[interceptor_index] = own_array + safe_array * 0.1
                current_distances = [
                    (index, float(np.linalg.norm(interceptors[index] - interceptors[interceptor_index])))
                    for index in range(config.interceptors)
                    if index != interceptor_index
                ]
                nearest_index, nearest_separation = min(
                    current_distances,
                    key=lambda item: item[1],
                    default=(-1, math.inf),
                )
                measured_accel = tuple(float(x) for x in (safe_array - interceptor_velocities[interceptor_index]) / 0.1)
                interceptor_velocities[interceptor_index] = safe_array
                nav_state = navigation_filters[interceptor_index].step(
                    measured_accel,
                    float(interceptors[interceptor_index, 2]),
                    0.1,
                )
                events.append(
                    EvidenceEvent(
                        time_s,
                        "trajectory_step",
                        {
                            "interceptor_id": agent_id,
                            "from_position": own_array.round(6).tolist(),
                            "to_position": interceptors[interceptor_index].round(6).tolist(),
                            "nearest_friendly_separation_m": nearest_separation,
                        },
                        {
                            "agent_id": agent_id,
                            "local_track_id": _local_id(agent_id, hostile_id),
                            "identity_state": identity_state.value,
                            "iff_evaluated": True,
                            "navigation_updated": True,
                            "navigation_position": list(nav_state.position),
                            "guidance_mode": guidance.mode,
                            "preferred_velocity": list(guidance.preferred_velocity),
                            "safe_velocity": list(safety.velocity),
                            "safety_override": safety.override,
                            "safety_filter": safety.backend_name,
                        },
                        {"frame": len(events), "label": "actuated safe trajectory"},
                    )
                )
                if nearest_separation < config.minimum_separation_m:
                    events.append(
                        EvidenceEvent(
                            time_s,
                            "friendly_collision",
                            {
                                "interceptor_ids": [agent_id, f"I{nearest_index:03d}"],
                                "separation_m": nearest_separation,
                            },
                            {"agent_id": agent_id, "safety_breach_observed": True},
                            {"frame": len(events), "label": "minimum separation breach"},
                        )
                    )
                time_s += 0.1
            assert guidance is not None and safety is not None
            preferred_velocity = guidance.preferred_velocity
            events.append(
                EvidenceEvent(
                    time_s,
                    "engagement_attempt",
                    {"hostile_id": hostile_id, "interceptor_id": agent_id, "shared_failure_factor": round(float(shared_factors[h]), 8), "success_probability": round(probability, 8), "outcome": bool(outcome)},
                    {"agent_id": agent_id, "local_track_id": _local_id(agent_id, hostile_id), "identity_state": "HOSTILE EVIDENCE", "preferred_velocity": list(preferred_velocity), "safe_velocity": list(safety.velocity), "safety_override": safety.override, "orca_plane_count": safety.orca_plane_count, "safety_filter": safety.backend_name},
                    {"frame": len(events), "label": "simulated engagement"},
                )
            )
            time_s += 0.1
            if outcome:
                events.append(EvidenceEvent(time_s, "neutralized", {"hostile_id": hostile_id, "interceptor_id": agent_id}, {"agent_id": agent_id, "track_status": "removed"}, {"frame": len(events), "label": "NEUTRALIZED"}))
                if config.method != "independent_greedy":
                    for cancelled_index in attempts[order + 1 :]:
                        cancelled_agent = f"I{cancelled_index:03d}"
                        events.append(
                            EvidenceEvent(
                                time_s,
                                "claim_cancelled",
                                {"hostile_id": hostile_id, "interceptor_id": cancelled_agent},
                                {"agent_id": cancelled_agent, "local_track_id": _local_id(cancelled_agent, hostile_id), "trigger": "observed_friendly_commitment"},
                                {"frame": len(events), "label": "duplicate pursuit suppressed"},
                            )
                        )
                break
        time_s += 0.1
    for interceptor_index in range(config.interceptors):
        retained = float(np.linalg.norm(interceptors[interceptor_index] - initial_interceptor_positions[interceptor_index])) <= 0.25
        events.append(
            EvidenceEvent(
                time_s,
                "coverage_status",
                {"interceptor_id": f"I{interceptor_index:03d}", "retained": retained},
                {"agent_id": f"I{interceptor_index:03d}", "in_home_cell": retained},
                {"frame": len(events), "label": "final coverage state"},
            )
        )
    for interceptor_index, position in enumerate(interceptors):
        if not np.isfinite(position).all():
            events.append(EvidenceEvent(time_s, "entity_drop", {"entity_id": f"I{interceptor_index:03d}"}, {}, {"frame": len(events), "label": "entity state missing"}))
    for hostile_index, position in enumerate(hostiles):
        if not np.isfinite(position).all():
            events.append(EvidenceEvent(time_s, "entity_drop", {"entity_id": f"H{hostile_index:03d}"}, {}, {"frame": len(events), "label": "entity state missing"}))
    processed_hostiles = sum(event.kind == "track_observed" for event in events)
    completion_kind = (
        "simulation_completed"
        if processed_hostiles == config.hostiles and not any(event.kind == "entity_drop" for event in events)
        else "simulation_incomplete"
    )
    events.append(
        EvidenceEvent(
            time_s,
            completion_kind,
            {"processed_hostiles": processed_hostiles, "expected_hostiles": config.hostiles},
            {},
            {"frame": len(events), "label": completion_kind.replace("_", " ")},
        )
    )
    kinds = [event.kind for event in events]
    trajectory_separations = [
        float(event.truth["nearest_friendly_separation_m"])
        for event in events
        if event.kind == "trajectory_step"
    ]
    min_separation = min(trajectory_separations, default=math.inf)
    neutralized = kinds.count("neutralized")
    duplicates = kinds.count("duplicate_pursuit")
    recoveries = kinds.count("observer_claim")
    retained_count = sum(
        bool(event.truth["retained"]) for event in events if event.kind == "coverage_status"
    )
    metrics = SimulationMetrics(
        hostiles_total=config.hostiles,
        neutralized=neutralized,
        leaked=config.hostiles - neutralized,
        duplicate_pursuits=duplicates,
        recovery_count=recoveries,
        cumulative_neutralization=neutralized / config.hostiles,
        retained_coverage=retained_count / config.interceptors,
        minimum_separation_m=min_separation,
        friendly_collisions=kinds.count("friendly_collision"),
        entity_drops=kinds.count("entity_drop"),
        completed=kinds.count("simulation_completed") == 1,
        rf_ground_messages=kinds.count("rf_ground_message"),
        rf_interdrone_messages=kinds.count("rf_interdrone_message"),
        target_assignment_messages=kinds.count("target_assignment_message"),
        safety_filter="snape/RVO2-3D",
    )
    return SimulationResult(config, metrics, tuple(events), teacher_backend)


def run_fixed_replay(kind: str) -> SimulationResult:
    if kind == "success":
        return run_scenario(ScenarioConfig(1, 2, 101, "airdnd", reserve_ratio=0.0, force_first_success=True))
    if kind == "miss_recovery":
        return run_scenario(ScenarioConfig(1, 3, 1, "airdnd", reserve_ratio=0.67, force_first_miss=True))
    raise ValueError("fixed replay must be success or miss_recovery")
