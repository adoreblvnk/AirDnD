from __future__ import annotations

from dataclasses import asdict, dataclass
import hashlib
import math
from typing import Any

import numpy as np
import torch

from .core import generate_section_formation, generate_staggered_grid
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
    # "staggered_grid" is the benchmark picket; "sections" organises the swarm as
    # 3x3 sections -> platoons of 3 sections -> companies of 3 platoons.
    formation: str = "staggered_grid"
    # The options below require formation="sections"; their defaults leave runs unchanged.
    launch_from_coast: bool = False  # sections launch from coastal pads and fly to their cells
    waves: int = 1  # hostiles arrive in this many waves (hostile h belongs to wave h % waves)
    wave_interval_s: float = 30.0
    recover_engaged: bool = False  # engaged drones return to base after each wave, vacating cells
    low_battery_sections: tuple[str, ...] = ()  # sections that start the sortie at LOW_BATTERY_START
    friendly_crossers: int = 0  # friendly transit tracks crossing the front with an NIR beacon


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


FORMATIONS = ("staggered_grid", "sections")


def _world(config: ScenarioConfig) -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(config.seed)
    hostile_x = np.linspace(0.0, 900.0, config.hostiles)
    hostile = np.column_stack((hostile_x, 1400.0 + rng.normal(0, 20, config.hostiles), rng.uniform(100, 200, config.hostiles)))
    if config.formation == "sections":
        slots = generate_section_formation(config.interceptors, _initial_active(config))
        interceptors = np.asarray([slot.position for slot in slots], dtype=float)
        return hostile, interceptors
    cells = generate_staggered_grid(config.interceptors, max(1, math.ceil(math.sqrt(config.interceptors))), 60.0, 250.0, 40.0)
    interceptors = np.asarray([cell.position for cell in cells], dtype=float)
    return hostile, interceptors


def _initial_active(config: ScenarioConfig) -> int:
    return max(0, min(config.interceptors, int(round(config.interceptors * (1.0 - config.reserve_ratio)))))


# ---- Section-formation scenario mechanics ---------------------------------------------
ABORT_BATTERY = 0.25  # AIRDND.md §4.4 critical abort threshold (<= 25%)
LOW_BATTERY_START = 0.28  # sections flagged low_battery_sections start the sortie here
PAD_SETBACK_M = 650.0  # coastal launch/recovery pads sit this far behind each cell
PAD_ALTITUDE_M = 15.0
PAD_SPREAD = 2.0  # pads are 2x the in-section spacing (40 m) so docking drift cannot close them up
LAUNCH_SPEED_MPS = 18.0
LAUNCH_STAGGER_S = 2.0  # one section leaves its pads every 2 s
FLIGHT_TICK_S = 2.0  # sample interval for launch / refill / RTH flights
TRANSIT_SPEED_MPS = 15.0
VERTICAL_RATE_MPS = 10.0
LANE_BASE_M = 400.0  # pre-cleared transit lanes start 30 m above the highest reserve row (370 m)
LANE_STEP_M = 12.0  # one lane per mover, comfortably above the 8 m minimum separation
STEPPED_DESCENT_M = 50.0  # barometric stepped descent on DR-RTH
DR_ACCEL_BIAS_STD = 0.0001  # m/s^2 MEMS accelerometer bias used during dead-reckoning return
CROSSER_SPEED_MPS = 20.0
LINEAGE_RANGE_M = 900.0  # continuous-track lineage is only held within this range
BEACON_RANGE_M = 1500.0


def _nearest_separation(points: np.ndarray) -> float:
    if len(points) < 2:
        return math.inf
    diff = points[:, None, :] - points[None, :, :]
    distances = np.sqrt((diff**2).sum(-1))
    np.fill_diagonal(distances, np.inf)
    return float(distances.min())


def _pad_positions(slots: list, cells: np.ndarray) -> np.ndarray:
    """Ground pad for every drone: its section's 3x3 pattern spread 2x, set back on the coast."""
    pads = cells.copy()
    anchors: dict[str, np.ndarray] = {}
    for slot in slots:
        anchors.setdefault(slot.section_id, cells[slot.agent_index].copy())
    for slot in slots:
        anchor = anchors[slot.section_id]
        offset = cells[slot.agent_index] - anchor
        pads[slot.agent_index] = [anchor[0] + PAD_SPREAD * offset[0], anchor[1] - PAD_SETBACK_M + PAD_SPREAD * offset[1], PAD_ALTITUDE_M]
    return pads


def _crosser_state(index: int, start_time_s: float) -> tuple[np.ndarray, np.ndarray, float]:
    """Constant-velocity truth of friendly transit track F{index}, crossing mid-field.

    Even-numbered crossers fly east from x=250 m, odd-numbered fly west from x=650 m, so both
    are over the front while the engagement is running.
    """
    eastbound = index % 2 == 0
    start = np.array([250.0 if eastbound else 650.0, 700.0 + 60.0 * index, 200.0 + 20.0 * index])
    velocity = np.array([CROSSER_SPEED_MPS if eastbound else -CROSSER_SPEED_MPS, 0.0, 0.0])
    return start, velocity, start_time_s


def _crosser_position(index: int, start_time_s: float, time_s: float) -> np.ndarray:
    start, velocity, t0 = _crosser_state(index, start_time_s)
    return start + velocity * max(0.0, time_s - t0)


def _swarm_initialized_event(
    config: ScenarioConfig,
    slots: list,
    hostiles: np.ndarray,
    cells: np.ndarray,
    positions: np.ndarray,
    battery: dict[str, float],
    engagement_start_s: float,
) -> EvidenceEvent:
    """Frame-0 evaluator snapshot of both swarms so a display can draw every drone."""
    initial_active = _initial_active(config)
    return EvidenceEvent(
        0.0,
        "swarm_initialized",
        {
            "formation": config.formation,
            "waves": config.waves,
            "interceptors": [
                {
                    "interceptor_id": f"I{slot.agent_index:03d}",
                    "callsign": slot.callsign,
                    "company": slot.company,
                    "platoon": slot.platoon_id,
                    "section": slot.section_id,
                    "phase": "initial" if slot.agent_index < initial_active else "reserve",
                    "position": positions[slot.agent_index].round(6).tolist(),
                    "cell": cells[slot.agent_index].round(6).tolist(),
                    "battery": battery[f"I{slot.agent_index:03d}"],
                }
                for slot in slots
            ],
            "hostiles": [
                {"hostile_id": f"H{index:03d}", "position": position.round(6).tolist(), "wave": index % config.waves}
                for index, position in enumerate(hostiles)
            ],
            "friendlies": [
                {
                    "friendly_id": f"F{index:03d}",
                    "start": _crosser_state(index, engagement_start_s)[0].tolist(),
                    "velocity": _crosser_state(index, engagement_start_s)[1].tolist(),
                    "start_time_s": engagement_start_s,
                }
                for index in range(config.friendly_crossers)
            ],
        },
        {},
        {"frame": 0, "label": "swarms initialized"},
    )


def _launch_events(
    slots: list,
    cells: np.ndarray,
    pads: np.ndarray,
    battery: dict[str, float],
    frame_offset: int,
    minimum_separation_m: float,
) -> tuple[list[EvidenceEvent], float]:
    """Sections leave their coastal pads one at a time and fly their pre-cleared lane.

    Every drone of a section flies a straight pad->cell line over the same duration, so the
    section's 3x3 pattern shrinks smoothly from pad spacing (40 m) to cell spacing (20 m) and
    never closes below it; sections launch in order in lanes more than a section apart.
    """
    positions = pads.copy()
    members: dict[str, list[int]] = {}
    for slot in slots:
        members.setdefault(slot.section_id, []).append(slot.agent_index)
    launch_at = {section: order * LAUNCH_STAGGER_S for order, section in enumerate(members)}
    duration = max(float(np.linalg.norm(cells[i] - pads[i])) for i in range(len(cells))) / LAUNCH_SPEED_MPS
    end = max(launch_at.values(), default=0.0) + duration
    events: list[EvidenceEvent] = []
    arrived: set[str] = set()

    def emit(time_s: float, kind: str, truth: dict[str, Any], local: dict[str, Any], label: str) -> None:
        events.append(EvidenceEvent(time_s, kind, truth, local, {"frame": frame_offset + len(events), "label": label}))

    tick = 0
    while True:
        time_s = tick * FLIGHT_TICK_S
        for section, t0 in launch_at.items():
            if t0 <= time_s < t0 + FLIGHT_TICK_S:
                lead = f"I{members[section][0]:03d}"
                emit(time_s, "section_launch", {"section": section, "interceptor_ids": [f"I{i:03d}" for i in members[section]]}, {"agent_id": lead, "action": "LAUNCH", "trigger": "preloaded_launch_slot", "battery": battery[lead], "lifecycle_state": "departing"}, f"{section} launch")
        moved: dict[str, list[float]] = {}
        for section, indices in members.items():
            if section in arrived:
                continue
            progress = float(np.clip((time_s - launch_at[section]) / duration, 0.0, 1.0))
            if progress <= 0.0:
                continue
            for index in indices:
                positions[index] = pads[index] + (cells[index] - pads[index]) * progress
                moved[f"I{index:03d}"] = positions[index].round(6).tolist()
        if moved:
            separation = _nearest_separation(positions)
            emit(time_s, "formation_step", {"positions": moved, "nearest_friendly_separation_m": separation}, {}, "climbing through pre-cleared lanes")
            if separation < minimum_separation_m:
                emit(time_s, "friendly_collision", {"phase": "launch", "separation_m": separation}, {"safety_breach_observed": True}, "minimum separation breach")
        for section, indices in members.items():
            if section not in arrived and time_s >= launch_at[section] + duration:
                arrived.add(section)
                lead = f"I{indices[0]:03d}"
                emit(time_s, "section_on_station", {"section": section}, {"agent_id": lead, "battery": battery[lead], "lifecycle_state": "on_station"}, f"{section} on station")
        if time_s >= end:
            break
        tick += 1
    emit(time_s, "grid_set", {"sections": len(members)}, {}, "GRID SET · formation complete")
    return events, time_s


def _fly_lanes(
    kind: str,
    label: str,
    movers: list[int],
    goals: dict[int, np.ndarray],
    interceptors: np.ndarray,
    navigation: dict[int, NavigationFilter],
    battery_by_agent: dict[str, float],
    events: list[EvidenceEvent],
    time_s: float,
    stepped_descent: bool,
    minimum_separation_m: float,
) -> float:
    """Fly movers to goals through pre-cleared lanes in three synchronized phases.

    Phase 1 climbs vertically to a private lane altitude (one lane per mover, LANE_STEP_M
    apart), phase 2 transits level to above the goal, phase 3 descends vertically. Nobody
    enters the next phase until every mover has finished the current one, so movers never
    share an altitude while moving horizontally and never share a column while moving
    vertically. Steering uses each drone's onboard navigation estimate; the simulator
    integrates the resulting truth motion.
    """
    if not movers:
        return time_s
    lanes = {index: LANE_BASE_M + LANE_STEP_M * order for order, index in enumerate(movers)}
    velocities = {index: np.zeros(3) for index in movers}
    phase = 0
    hold: dict[int, int] = {index: 0 for index in movers}
    for _tick in range(2_000):
        done_phase = True
        moved: dict[str, list[float]] = {}
        for index in movers:
            estimate = navigation[index].position.copy()
            goal = goals[index]
            command = np.zeros(3)
            if phase == 0:
                gap = lanes[index] - estimate[2]
                if abs(gap) > 0.5:
                    command[2] = float(np.clip(gap / FLIGHT_TICK_S, -VERTICAL_RATE_MPS, VERTICAL_RATE_MPS))
                    done_phase = False
            elif phase == 1:
                offset = goal[:2] - estimate[:2]
                distance = float(np.linalg.norm(offset))
                if distance > 0.5:
                    command[:2] = offset / distance * min(TRANSIT_SPEED_MPS, distance / FLIGHT_TICK_S)
                    done_phase = False
            else:
                command[:2] = np.clip((goal[:2] - estimate[:2]) / FLIGHT_TICK_S, -2.0, 2.0)
                gap = goal[2] - estimate[2]
                if abs(gap) > 0.5:
                    done_phase = False
                    if stepped_descent and hold[index] > 0:
                        hold[index] -= 1
                    else:
                        step_floor = goal[2] + STEPPED_DESCENT_M * math.floor((estimate[2] - goal[2] - 0.5) / STEPPED_DESCENT_M) if stepped_descent else goal[2]
                        target = max(goal[2], step_floor)
                        command[2] = float(np.clip((target - estimate[2]) / FLIGHT_TICK_S, -VERTICAL_RATE_MPS, VERTICAL_RATE_MPS))
                        if stepped_descent and abs(target - (estimate[2] + command[2] * FLIGHT_TICK_S)) < 0.5 and target > goal[2]:
                            hold[index] = 1  # level off one tick at each barometric step
            if not np.any(command) and not np.any(velocities[index]):
                continue
            previous_velocity = velocities[index]
            measured_accel = tuple(float(x) for x in (command - previous_velocity) / FLIGHT_TICK_S)
            velocities[index] = command
            # Constant acceleration over the tick: truth and the INS integrate the same motion,
            # so the estimate only departs from truth through its accelerometer bias.
            interceptors[index] = interceptors[index] + 0.5 * (previous_velocity + command) * FLIGHT_TICK_S
            navigation[index].step(measured_accel, float(interceptors[index][2]), FLIGHT_TICK_S)
            agent_id = f"I{index:03d}"
            battery_by_agent[agent_id] = max(0.05, battery_by_agent[agent_id] - 0.002)
            moved[agent_id] = interceptors[index].round(6).tolist()
        if moved:
            separation = _nearest_separation(interceptors)
            events.append(
                EvidenceEvent(
                    time_s,
                    kind,
                    {"positions": moved, "nearest_friendly_separation_m": separation, "phase": ("climb", "transit", "descend")[phase]},
                    {},
                    {"frame": len(events), "label": label},
                )
            )
            if separation < minimum_separation_m:
                events.append(EvidenceEvent(time_s, "friendly_collision", {"phase": kind, "separation_m": separation}, {"safety_breach_observed": True}, {"frame": len(events), "label": "minimum separation breach"}))
            time_s += FLIGHT_TICK_S
        if done_phase:
            phase += 1
            if phase == 3:
                break
    return time_s


def _wave_event(wave: int, hostile_indices: list[int], hostiles: np.ndarray, time_s: float, frame: int, scheduled_time_s: float | None = None) -> EvidenceEvent:
    scheduled = time_s if scheduled_time_s is None else scheduled_time_s
    return EvidenceEvent(
        time_s,
        "wave_detected",
        {
            "wave": wave + 1,
            "scheduled_time_s": scheduled,
            # > 0 only if recovery/refill ran past the wave's arrival time in this sequential model.
            "delayed_by_s": round(max(0.0, time_s - scheduled), 6),
            "hostile_ids": [f"H{index:03d}" for index in hostile_indices],
            "centroid": hostiles[hostile_indices].mean(axis=0).round(6).tolist(),
        },
        {},
        {"frame": frame, "label": f"WAVE {wave + 1} DETECTED · {len(hostile_indices)} hostiles"},
    )


def _iff_events(config: ScenarioConfig, slots: list, interceptors: np.ndarray, time_s: float, frame_offset: int) -> list[EvidenceEvent]:
    """Each drone classifies each friendly crosser from its own geometry and beacon reception.

    Lineage holds only while the drone keeps a continuous track of the crosser inside its
    pre-cleared friendly lane (range-limited). The one-way NIR beacon is received with a
    range-dependent probability; beacon loss leaves the track UNKNOWN or FRIENDLY LINEAGE,
    never hostile, because the crosser shows no hostile indicator (it flies a friendly lane
    and never ingresses from the hostile side).
    """
    rng = np.random.default_rng(config.seed + 70_000)
    members: dict[str, list[int]] = {}
    for slot in slots:
        members.setdefault(slot.section_id, []).append(slot.agent_index)
    events: list[EvidenceEvent] = []
    for crosser in range(config.friendly_crossers):
        friendly_id = f"F{crosser:03d}"
        start, velocity, _t0 = _crosser_state(crosser, time_s)
        for section, indices in members.items():
            states: dict[str, str] = {}
            receptions: dict[str, bool] = {}
            for index in indices:
                relative = interceptors[index] - start
                closest = start + velocity * max(0.0, float(relative @ velocity) / float(velocity @ velocity))
                distance = float(np.linalg.norm(interceptors[index] - closest))
                lineage = distance <= LINEAGE_RANGE_M
                beacon_valid = bool(rng.random() < float(np.clip(0.95 - distance / BEACON_RANGE_M, 0.05, 0.9)))
                state = IFFMachine().update(lineage=lineage, beacon_valid=beacon_valid, beacon_bound=beacon_valid and lineage, hostile_evidence=False)
                states[f"I{index:03d}"] = state.value
                receptions[f"I{index:03d}"] = beacon_valid
            lead = f"I{indices[0]:03d}"
            events.append(
                EvidenceEvent(
                    time_s,
                    "iff_classification",
                    {"friendly_id": friendly_id, "section": section, "identity_states": states, "engaged": False},
                    {
                        "agent_id": lead,
                        "local_track_id": _local_id(lead, friendly_id),
                        "identity_state": states[lead],
                        "beacon_detected": receptions[lead],
                        "action": "HOLD",
                        "trigger": "identity_not_hostile",
                        "rvo2_obstacle": True,
                    },
                    {"frame": frame_offset + len(events), "label": f"{section} holds fire on {friendly_id}"},
                )
            )
    return events


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
    *,
    interceptor_indices: list[int] | None = None,
    hostile_indices: list[int] | None = None,
    battery: dict[str, float] | None = None,
    time_s: float = 0.0,
    frame_offset: int = 0,
) -> tuple[dict[int, list[int]], list[EvidenceEvent]]:
    """Run independent policies over local tracks; assignment is evaluator output only.

    ``interceptor_indices``/``hostile_indices`` restrict the decision to the drones still
    available and the tracks of the current wave; with the defaults every drone decides over
    every hostile exactly as in the single-wave benchmark.
    """
    hostile_ids = list(range(config.hostiles)) if hostile_indices is None else sorted(hostile_indices)
    agent_indices = list(range(config.interceptors)) if interceptor_indices is None else list(interceptor_indices)
    evaluator_attempts: dict[int, list[int]] = {h: [] for h in hostile_ids}
    decisions: list[EvidenceEvent] = []
    model = trained_runtime_model() if config.method == "airdnd" else None
    belief_source = "trained_multihead_model" if model is not None else "handwritten_local_belief"
    if interceptor_indices is None:
        initial_active = _initial_active(config)
    else:
        initial_active = max(0, min(len(agent_indices), int(round(len(agent_indices) * (1.0 - config.reserve_ratio)))))
    hostile_truth = {
        f"H{index:03d}": (tuple(float(x) for x in hostiles[index]), (0.0, -30.0, 0.0))
        for index in hostile_ids
    }
    # These are observable kinematics, not shared claims or target assignments.
    friendly_motion: list[tuple[np.ndarray, np.ndarray]] = []

    for position_in_order, interceptor_index in enumerate(agent_indices):
        phase = "initial" if position_in_order < initial_active else "reserve"
        agent_id = f"I{interceptor_index:03d}"
        own_position = interceptors[interceptor_index]
        tracks = LocalTracker(agent_id, config.seed + interceptor_index, noise_std_m=2.0).observe(
            hostile_truth,
            tuple(float(x) for x in own_position),
            sensor_range_m=5_000.0,
        )
        local_targets = [
            (hostile_ids[track_order], track, np.asarray(track.position, dtype=float))
            for track_order, track in enumerate(tracks)
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
        # Separately seeded per interceptor so the ledger's identity classification never
        # perturbs LocalTracker's own noise draws (which reuse config.seed + interceptor_index).
        ledger_rng = np.random.default_rng(config.seed + 50_000 + interceptor_index)
        candidates: list[Candidate] = []
        visible_tracks: list[dict[str, str]] = []
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
                    battery=1.0 if battery is None else battery[agent_id],
                )
            )
            track_distance = float(np.linalg.norm(local_position - own_position))
            identification_probability = float(np.clip(1.0 - track_distance / 3_000.0, 0.05, 0.97))
            track_identity = IFFMachine().update(
                lineage=False,
                beacon_valid=False,
                beacon_bound=False,
                hostile_evidence=bool(ledger_rng.random() < identification_probability),
            )
            visible_tracks.append({"track_id": track.local_id, "identity_state": track_identity.value})
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
                time_s,
                readiness_kind,
                {"interceptor_id": agent_id, "phase": phase},
                {
                    "agent_id": agent_id,
                    "trigger": trigger,
                    "battery": 1.0 if battery is None else battery[agent_id],
                    "lifecycle_state": "on_station" if pending_reserve else "departing",
                },
                {"frame": frame_offset + len(decisions), "label": "reserve observer ready" if pending_reserve else f"{phase} mobilization"},
            )
        )
        decisions.append(
            EvidenceEvent(
                time_s,
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
                    "visible_tracks": visible_tracks,
                    "downstream_policy": "mission_utility+deterministic_mobilization_v1",
                },
                {"frame": frame_offset + len(decisions), "label": "local policy decision"},
            )
        )
    return evaluator_attempts, decisions


def _assign(
    config: ScenarioConfig,
    hostiles: np.ndarray,
    interceptors: np.ndarray,
    **policy_options: Any,
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
        policy_assignments, decisions = _policy_assign(config, hostiles, interceptors, **policy_options)
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
    if config.formation not in FORMATIONS:
        raise ValueError(f"formation must be one of {FORMATIONS}")
    sections = config.formation == "sections"
    uses_scenario_options = (
        config.launch_from_coast or config.waves != 1 or config.recover_engaged
        or bool(config.low_battery_sections) or config.friendly_crossers > 0
    )
    if uses_scenario_options and not sections:
        raise ValueError("launch, waves, recovery, battery and friendly-crosser options require formation='sections'")
    if config.waves < 1 or config.waves > config.hostiles:
        raise ValueError("waves must be between 1 and the number of hostiles")
    if config.waves > 1 and config.method not in ("airdnd", "deterministic_ablation"):
        raise ValueError("multi-wave scenarios require a local-policy method (airdnd or deterministic_ablation)")
    hostiles, interceptors = _world(config)
    initial_interceptor_positions = interceptors.copy()
    home_cells = interceptors.copy()  # a refill moves a drone's home cell to the one it claimed
    slots = generate_section_formation(config.interceptors, _initial_active(config)) if sections else []
    section_of = {slot.agent_index: slot.section_id for slot in slots}
    battery_by_agent = {
        f"I{index:03d}": LOW_BATTERY_START if section_of.get(index) in config.low_battery_sections else 1.0
        for index in range(config.interceptors)
    }
    unknown_sections = set(config.low_battery_sections) - set(section_of.values())
    if unknown_sections:
        raise ValueError(f"unknown low_battery_sections: {sorted(unknown_sections)}")
    wave_hostiles = [[h for h in range(config.hostiles) if h % config.waves == wave] for wave in range(config.waves)]
    prelude: list[EvidenceEvent] = []
    engagement_start_s = 0.0
    if sections:
        launch_events: list[EvidenceEvent] = []
        pads = _pad_positions(slots, initial_interceptor_positions)
        if config.launch_from_coast:
            launch_events, engagement_start_s = _launch_events(slots, initial_interceptor_positions, pads, battery_by_agent, frame_offset=1, minimum_separation_m=config.minimum_separation_m)
        start_positions = pads if config.launch_from_coast else initial_interceptor_positions
        prelude = [_swarm_initialized_event(config, slots, hostiles, initial_interceptor_positions, start_positions, battery_by_agent, engagement_start_s), *launch_events]
        if config.waves > 1:
            prelude.append(_wave_event(0, wave_hostiles[0], hostiles, engagement_start_s, len(prelude)))
    policy_options: dict[str, Any] = {}
    if sections:
        policy_options = {"battery": battery_by_agent, "time_s": engagement_start_s, "frame_offset": len(prelude)}
        if config.waves > 1:
            policy_options["hostile_indices"] = wave_hostiles[0]
    assignments, teacher_backend, policy_events = _assign(config, hostiles, interceptors, **policy_options)
    policy_events = prelude + policy_events
    if config.friendly_crossers:
        policy_events += _iff_events(config, slots, interceptors, engagement_start_s, len(policy_events))
    rng = np.random.default_rng(config.seed + 20_000)
    shared_factors = rng.uniform(0.72, 1.02, config.hostiles)
    attempt_noise = rng.random((config.hostiles, max(1, config.interceptors)))
    # Separately seeded so IFF identification draws never shift the shared-factor/attempt
    # RNG streams above (which several tests pin exact values against).
    iff_rng = np.random.default_rng(config.seed + 40_000)
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
    time_s = engagement_start_s
    interceptor_velocities = np.zeros_like(interceptors)
    navigation_filters = [
        NavigationFilter(tuple(float(x) for x in position)) for position in interceptors
    ]
    if not sections:
        pads = initial_interceptor_positions.copy()
    engaged_ever: set[int] = set()
    engaged_this_wave: list[int] = []
    aborted: set[int] = set()
    awaiting_rth: list[int] = []
    returned: set[int] = set()

    def return_to_base(now: float) -> float:
        movers = sorted((set(awaiting_rth) | (set(engaged_this_wave) if config.recover_engaged else set())) - returned)
        if not movers:
            return now
        recovering = [index for index in movers if index not in aborted]
        if recovering:
            events.append(EvidenceEvent(now, "recovery_departure", {"interceptor_ids": [f"I{i:03d}" for i in recovering]}, {}, {"frame": len(events), "label": f"{len(recovering)} engaged drones returning to rearm"}))
        # Dead reckoning: each drone steers from its own INS estimate, which starts where the
        # engagement left it and drifts through a seeded accelerometer bias.
        bias_rng = np.random.default_rng(config.seed + 60_000)
        biases = {index: bias_rng.normal(0.0, DR_ACCEL_BIAS_STD, 3) for index in range(config.interceptors)}
        dr_filters = {
            index: NavigationFilter(tuple(float(x) for x in navigation_filters[index].position), accel_bias=(float(biases[index][0]), float(biases[index][1]), 0.0))
            for index in movers
        }
        now = _fly_lanes("rth_step", "dead-reckoning return to base", movers, {index: pads[index] for index in movers}, interceptors, dr_filters, battery_by_agent, events, now, stepped_descent=True, minimum_separation_m=config.minimum_separation_m)
        for index in movers:
            agent_id = f"I{index:03d}"
            navigation_filters[index] = dr_filters[index]
            interceptor_velocities[index] = 0.0
            events.append(EvidenceEvent(now, "rth_docked", {"interceptor_id": agent_id, "dock_position": pads[index].round(6).tolist(), "docking_error_m": float(np.linalg.norm(interceptors[index] - pads[index]))}, {"agent_id": agent_id, "navigation_position": list(dr_filters[index].position), "battery": battery_by_agent[agent_id], "lifecycle_state": "docked"}, {"frame": len(events), "label": f"{agent_id} docked at coastal recovery point"}))
        returned.update(movers)
        awaiting_rth.clear()
        return now

    def refill_vacated_cells(now: float) -> float:
        vacated = [index for index in sorted(returned) if not any(np.allclose(home_cells[other], initial_interceptor_positions[index]) for other in range(config.interceptors) if other not in returned)]
        reserves = [index for index in range(config.interceptors) if index not in engaged_ever and index not in aborted and index not in returned and home_cells[index][1] < -100.0]
        if not vacated or not reserves:
            return now

        def cost(reserve: int, cell_owner: int) -> float:
            travel_time = float(np.linalg.norm(initial_interceptor_positions[cell_owner] - interceptors[reserve])) / TRANSIT_SPEED_MPS
            return travel_time + (1.0 - battery_by_agent[f"I{reserve:03d}"]) * 20.0

        # Each reserve sees the empty cells and computes its own best cost; a lower cost means
        # a shorter claim delay, and later claimants skip cells they watched a friend take.
        order = sorted(reserves, key=lambda reserve: (min(cost(reserve, cell) for cell in vacated), reserve))
        claims: dict[int, int] = {}
        for reserve in order:
            open_cells = [cell for cell in vacated if cell not in claims.values()]
            if not open_cells:
                break
            cell_owner = min(open_cells, key=lambda cell: (cost(reserve, cell), cell))
            claims[reserve] = cell_owner
            # The delay is set by the reserve's best cost when it first saw the empty cells, which
            # is also the order key, so claim times never go backwards.
            delay = round(0.1 + 0.02 * min(cost(reserve, cell) for cell in vacated), 6)
            agent_id = f"I{reserve:03d}"
            events.append(EvidenceEvent(now + delay, "cell_refill_claim", {"interceptor_id": agent_id, "vacated_by": f"I{cell_owner:03d}", "cell_position": initial_interceptor_positions[cell_owner].round(6).tolist()}, {"agent_id": agent_id, "action": "REFILL", "trigger": "observed_vacated_cell", "claim_delay_s": delay, "travel_time_s": round(cost(reserve, cell_owner), 6), "battery": battery_by_agent[agent_id], "lifecycle_state": "departing"}, {"frame": len(events), "label": f"{agent_id} claims vacated cell"}))
        now = max(now, events[-1].time_s)
        movers = list(claims)
        now = _fly_lanes("refill_step", "reserve refilling vacated cells", movers, {index: initial_interceptor_positions[claims[index]] for index in movers}, interceptors, {index: navigation_filters[index] for index in movers}, battery_by_agent, events, now, stepped_descent=False, minimum_separation_m=config.minimum_separation_m)
        for reserve, cell_owner in claims.items():
            home_cells[reserve] = initial_interceptor_positions[cell_owner].copy()
            interceptor_velocities[reserve] = 0.0
        events.append(EvidenceEvent(now, "refill_complete", {"refilled": {f"I{r:03d}": f"I{c:03d}" for r, c in claims.items()}}, {}, {"frame": len(events), "label": f"{len(claims)} vacated cells refilled"}))
        return now

    wave_first = {wave[0]: number for number, wave in enumerate(wave_hostiles) if number > 0 and wave}
    hostile_order = [h for wave in wave_hostiles for h in wave]
    for h in hostile_order:
        if h in wave_first:
            wave = wave_first[h]
            time_s = return_to_base(time_s)
            time_s = refill_vacated_cells(time_s)
            scheduled_s = engagement_start_s + wave * config.wave_interval_s
            time_s = max(time_s, scheduled_s)
            events.append(_wave_event(wave, wave_hostiles[wave], hostiles, time_s, len(events), scheduled_s))
            available = [i for i in range(config.interceptors) if i not in engaged_ever and i not in aborted and i not in returned]
            available.sort(key=lambda i: (-home_cells[i][1], i))  # screen line decides first, rear echelon last
            available_ids = {f"I{i:03d}" for i in available}
            wave_assignments, _backend, wave_events = _assign(
                config, hostiles, interceptors,
                interceptor_indices=available, hostile_indices=wave_hostiles[wave],
                battery=battery_by_agent, time_s=time_s, frame_offset=len(events),
            )
            assignments.update(wave_assignments)
            events.extend(wave_events)
            pending_observers = (pending_observers - available_ids) | {str(e.truth["interceptor_id"]) for e in wave_events if e.kind == "observer_ready"}
            upfront_mobilized = (upfront_mobilized - available_ids) | {str(e.truth["interceptor_id"]) for e in wave_events if e.kind == "mobilized"}
            engaged_this_wave = []
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
        # Built for every attempt (not just recovery backups) so the hysteresis state
        # machine below can compare a newly-arriving claimant's utility against the
        # incumbent's, using the same local-track construction used for ranking.
        candidate_by_agent: dict[str, Candidate] = {}
        for interceptor_index in attempts:
            claimant_agent = f"I{interceptor_index:03d}"
            claimant_track = LocalTracker(
                claimant_agent,
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
            local_intercept = np.asarray(claimant_track.position, dtype=float)
            local_distance = float(np.linalg.norm(local_intercept - interceptors[interceptor_index]))
            candidate_by_agent[claimant_agent] = Candidate(
                track_id=claimant_track.local_id,
                belief=BeliefOutput(
                    0.9,
                    float(np.clip(1.0 - local_distance / 2_000.0, 0.05, 0.95)),
                    0.0,
                    local_distance / 30.0,
                    claimant_track.position,
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
                battery=battery_by_agent[claimant_agent],
            )
        recovery_candidates = [candidate_by_agent[f"I{index:03d}"] for index in attempts[1:]]
        recovery_delays = claim_delay_s(recovery_candidates)
        utility_by_track = {candidate.track_id: mission_utility(candidate) for candidate in candidate_by_agent.values()}
        hysteresis = Hysteresis()
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
            if order == 0:
                primary_track_id = _local_id(agent_id, hostile_id)
                hysteresis.consider(primary_track_id, utility_by_track[primary_track_id], 0.0, 0.0, True)
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
                            {
                                "agent_id": agent_id,
                                "trigger": "locally_observed_coverage_expiry",
                                "battery": battery_by_agent[agent_id],
                                "lifecycle_state": "departing",
                            },
                            {"frame": len(events), "label": "reserve mobilization"},
                        )
                    )
                    pending_observers.remove(agent_id)
                # Progress-aware switching hysteresis (AIRDND.md §4.3): weigh the newly
                # arriving claimant's utility against the incumbent's before confirming
                # the handoff, rather than accepting every claim immediately.
                progress = float(np.clip(time_s / 8.0, 0.0, 1.0))
                hysteresis_confirmed = hysteresis.consider(
                    local_track_id,
                    utility_by_track[local_track_id],
                    utility_by_track.get(hysteresis.current_track, 0.0),
                    progress,
                    hard_release=False,
                )
                events.append(EvidenceEvent(time_s, "observer_claim", {"hostile_id": hostile_id}, {"agent_id": agent_id, "local_track_id": local_track_id, "claim_delay_s": delay, "priority_rank": int(round(delay / 0.15)), "trigger": "locally_observed_coverage_expiry", "hysteresis_confirmed": hysteresis_confirmed, "hysteresis_track": hysteresis.current_track}, {"frame": len(events), "label": "observation-driven recovery"}))

            probability = float(np.clip(0.80 * shared_factors[h], 0.05, 0.95))
            outcome = attempt_noise[h, order] < probability
            if h == 0 and order == 0 and config.force_first_miss:
                outcome = False
            if h == 0 and order == 0 and config.force_first_success:
                outcome = True
            # Optical-only hostile classification degrades with range/occlusion instead of
            # being unconditionally certain; the one-way NIR beacon never fires here because
            # these are genuine hostiles, not friendlies presenting a beacon.
            engagement_distance = float(np.linalg.norm(hostiles[h] - interceptors[interceptor_index]))
            identification_probability = float(np.clip(1.0 - engagement_distance / 3_000.0, 0.05, 0.97))
            identity_state = IFFMachine().update(
                lineage=False,
                beacon_valid=False,
                beacon_bound=False,
                hostile_evidence=bool(iff_rng.random() < identification_probability),
            )
            guidance = None
            safety = None
            for trajectory_tick in range(3):
                own_array = interceptors[interceptor_index].copy()
                # Guidance and the safety filter act on the interceptor's own INS/barometer
                # estimate, not simulator ground truth; only the physical motion integration
                # below remains authoritative ground truth.
                estimated_position = navigation_filters[interceptor_index].position.copy()
                estimated_velocity = navigation_filters[interceptor_index].velocity.copy()
                own_position = tuple(float(x) for x in estimated_position)
                own_velocity = tuple(float(x) for x in estimated_velocity)
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
                # RVO2-3D treats every observed track as an obstacle, whatever its identity state.
                for crosser in range(config.friendly_crossers):
                    crosser_position = _crosser_position(crosser, engagement_start_s, time_s)
                    if float(np.linalg.norm(crosser_position - own_array)) <= 300.0:
                        neighbor_tracks.append((tuple(float(x) for x in crosser_position), (CROSSER_SPEED_MPS, 0.0, 0.0), "UNKNOWN"))
                time_to_intercept = max(0.3, float(np.linalg.norm(hostiles[h] - estimated_position)) / 30.0)
                guidance = receding_horizon_guidance(
                    own_position,
                    own_velocity,
                    tuple(float(x) for x in hostiles[h]),
                    time_to_intercept,
                    GuidanceLimits(30.0, 10.0, 5.0, 1.0),
                    0.1,
                    target_velocity=(0.0, -30.0, 0.0),
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
                battery_by_agent[agent_id] = max(0.05, battery_by_agent[agent_id] - 0.01)
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
                            "predicted_min_separation_m": (
                                safety.predicted_min_separation_m
                                if math.isfinite(safety.predicted_min_separation_m)
                                else None
                            ),
                            "battery": battery_by_agent[agent_id],
                            "lifecycle_state": "on_station",
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
            battery_by_agent[agent_id] = max(0.05, battery_by_agent[agent_id] - 0.02)
            events.append(
                EvidenceEvent(
                    time_s,
                    "engagement_attempt",
                    {"hostile_id": hostile_id, "interceptor_id": agent_id, "shared_failure_factor": round(float(shared_factors[h]), 8), "success_probability": round(probability, 8), "outcome": bool(outcome)},
                    {"agent_id": agent_id, "local_track_id": _local_id(agent_id, hostile_id), "identity_state": "HOSTILE EVIDENCE", "preferred_velocity": list(preferred_velocity), "safe_velocity": list(safety.velocity), "safety_override": safety.override, "orca_plane_count": safety.orca_plane_count, "safety_filter": safety.backend_name, "battery": battery_by_agent[agent_id], "lifecycle_state": "returning"},
                    {"frame": len(events), "label": "simulated engagement"},
                )
            )
            engaged_ever.add(interceptor_index)
            engaged_this_wave.append(interceptor_index)
            if battery_by_agent[agent_id] <= ABORT_BATTERY and interceptor_index not in aborted:
                aborted.add(interceptor_index)
                awaiting_rth.append(interceptor_index)
                events.append(
                    EvidenceEvent(
                        time_s,
                        "abort",
                        {"interceptor_id": agent_id, "battery": battery_by_agent[agent_id]},
                        {"agent_id": agent_id, "action": "ABORT", "trigger": "battery_at_or_below_abort_threshold", "battery": battery_by_agent[agent_id], "abort_threshold": ABORT_BATTERY, "lifecycle_state": "returning"},
                        {"frame": len(events), "label": f"{agent_id} ABORT · battery {battery_by_agent[agent_id]:.0%}"},
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
    time_s = return_to_base(time_s)
    for interceptor_index in range(config.interceptors):
        agent_id = f"I{interceptor_index:03d}"
        retained = float(np.linalg.norm(interceptors[interceptor_index] - home_cells[interceptor_index])) <= 0.25
        events.append(
            EvidenceEvent(
                time_s,
                "coverage_status",
                {"interceptor_id": agent_id, "retained": retained},
                {
                    "agent_id": agent_id,
                    "in_home_cell": retained,
                    "battery": battery_by_agent[agent_id],
                    "lifecycle_state": "docked",
                },
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
        if event.kind in ("trajectory_step", "formation_step", "refill_step", "rth_step")
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


# One id per scenario, used unchanged for the replay file name, API id, frontend key and
# button test id. Display titles live in configs/scenarios.json (kept in sync by tests).
FIXED_REPLAYS = (
    "launch_formation",
    "intercept_success",
    "miss_recovery",
    "multi_wave",
    "return_to_base",
    "friend_or_foe",
    "naive_baseline",
)


def fixed_replay_config(scenario_id: str) -> ScenarioConfig:
    company = {"formation": "sections", "reserve_ratio": 1 / 3}  # 81 drones: 2 platoons screen, 1 in reserve
    if scenario_id == "launch_formation":
        # 9.4-1: nine sections launch from coastal pads, climb their lanes and set the grid.
        return ScenarioConfig(9, 81, 3, "airdnd", launch_from_coast=True, **company)
    if scenario_id == "intercept_success":
        # 9.4-2: 1st platoon (27) against 9 hostiles; the first engagement is forced to hit.
        return ScenarioConfig(9, 27, 101, "airdnd", reserve_ratio=0.0, force_first_success=True, formation="sections")
    if scenario_id == "miss_recovery":
        # 9.4-3: company against 27 hostiles; 1st platoon screens, 2nd and 3rd hold in reserve
        # and recover after the forced first miss.
        return ScenarioConfig(27, 81, 23, "airdnd", reserve_ratio=2 / 3, force_first_miss=True, formation="sections")
    if scenario_id == "multi_wave":
        # 2.3: two waves of 12, seven minutes apart; engaged drones return to rearm and the
        # reserve platoon refills their cells before the second wave arrives.
        return ScenarioConfig(24, 81, 5, "airdnd", waves=2, wave_interval_s=420.0, recover_engaged=True, **company)
    if scenario_id == "return_to_base":
        # 9.4-4 / 4.4: 1st platoon starts low on battery, aborts after engaging, DR-RTH home.
        return ScenarioConfig(18, 81, 7, "airdnd", low_battery_sections=("A1-1", "A1-2", "A1-3"), **company)
    if scenario_id == "friend_or_foe":
        # 5.6 / AC-034: two friendly transit tracks cross the front while hostiles attack.
        return ScenarioConfig(9, 81, 11, "airdnd", friendly_crossers=2, **company)
    if scenario_id == "naive_baseline":
        # Same company, hostiles and seed as miss_recovery, but independent greedy choices.
        return ScenarioConfig(27, 81, 23, "independent_greedy", reserve_ratio=2 / 3, formation="sections")
    raise ValueError(f"fixed replay must be one of {FIXED_REPLAYS}")


def run_fixed_replay(scenario_id: str) -> SimulationResult:
    return run_scenario(fixed_replay_config(scenario_id))
