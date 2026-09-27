from __future__ import annotations

from collections import defaultdict, deque
from dataclasses import dataclass, field
import hashlib
import math
from typing import Any

import numpy as np
import torch

from .decision import Candidate, Hysteresis, choose_candidate, mission_utility
from .guidance import (
    GuidanceLimits,
    official_rvo2_filter,
    proportional_navigation_guidance,
    receding_horizon_guidance,
)
from .model import BeliefOutput, decode_beliefs, trained_runtime_model
from .observation import IFFMachine, MemsNavigationFilter

DT = 0.1
INGRESS_TIME = 32.0
BOUNDARY_Y = 0.0
SENSOR_RANGE_M = 4_800.0
MIN_SEPARATION_M = 8.0
MAX_INTERCEPTOR_SPEED_MPS = 90.0
RETURN_SPEED_MPS = 80.0


def _v3(value: np.ndarray | tuple[float, float, float]) -> list[float]:
    return [round(float(component), 4) for component in value]


def _local_id(agent_id: str, hostile_id: str) -> str:
    digest = hashlib.sha256(f"{agent_id}:{hostile_id}".encode()).hexdigest()[:8]
    return f"{agent_id}-{digest}"


@dataclass
class MissionAgent:
    index: int
    position: np.ndarray
    base: np.ndarray
    grid: np.ndarray
    battery: float
    navigator: MemsNavigationFilter
    velocity: np.ndarray = field(default_factory=lambda: np.zeros(3))
    state: str = "DOCKED"
    alive: bool = True
    target_id: str | None = None
    target_local_id: str | None = None
    current_belief: BeliefOutput | None = None
    current_utility: float = 0.0
    committed_at: float | None = None
    current_cost_terms: dict[str, float] = field(default_factory=dict)
    path_length_m: float = 0.0
    replanning_count: int = 0
    energy_used: float = 0.0
    rth_waypoints: list[tuple[float, float, float]] = field(default_factory=list)
    rth_index: int = 0
    last_guidance_mode: str = "hold"
    last_preferred_velocity: np.ndarray = field(default_factory=lambda: np.zeros(3))
    last_safe_velocity: np.ndarray = field(default_factory=lambda: np.zeros(3))
    last_safety_override: bool = False
    last_min_separation: float = math.inf
    last_observed_target: np.ndarray | None = None
    last_intercept_basket: np.ndarray | None = None

    hysteresis: Hysteresis = field(default_factory=Hysteresis)
    pending_target_id: str | None = None
    pending_ready_at: float | None = None
    last_hysteresis_margin: float | None = None
    competing_action: str | None = None
    @property
    def id(self) -> str:
        return f"I{self.index:03d}"


@dataclass
class MissionThreat:
    index: int
    position: np.ndarray
    velocity: np.ndarray
    shared_condition: float
    active: bool = False
    alive: bool = True
    neutralized: bool = False
    leaked: bool = False
    attempt_count: int = 0
    covered_by: str | None = None
    coverage_expiry: float | None = None
    miss_position: np.ndarray | None = None

    @property
    def id(self) -> str:
        return f"H{self.index:03d}"


@dataclass(frozen=True)
class MissionReplay:
    events: list[dict[str, Any]]
    metrics: dict[str, Any]


class FullMissionSimulator:
    def __init__(self, seed: int = 2026):
        self.seed = seed
        self.rng = np.random.default_rng(seed)
        self.events: list[dict[str, Any]] = []
        self.histories: dict[tuple[str, str], deque[np.ndarray]] = defaultdict(lambda: deque(maxlen=5))
        self.model = trained_runtime_model()
        self.iff = IFFMachine()
        self.minimum_separation = math.inf
        self.friendly_collisions = 0
        self.recovery_count = 0
        self.duplicate_pursuits = 0
        self.last_time = 0.0
        self._completed_announced = False
        self.decision_ticks = 0
        self.belief_inferences = 0
        self.agents = self._build_agents()
        self.threats = self._build_threats()

    def _build_agents(self) -> list[MissionAgent]:
        agents: list[MissionAgent] = []
        for index in range(24):
            column = index % 8
            tier = index // 8
            x = -350.0 + column * 100.0 + (50.0 if tier % 2 else 0.0)
            base = np.asarray((-430.0 + index * 37.5, 1_200.0 + (index % 3) * 24.0, 4.0))
            grid = np.asarray((x, -1_200.0 - tier * 100.0, 250.0 + tier * 75.0))
            if index == 23:
                battery = 0.305
            else:
                battery = 0.84 + 0.14 * ((index * 17) % 23) / 22.0
            agents.append(
                MissionAgent(
                    index=index,
                    position=base.copy(),
                    base=base,
                    grid=grid,
                    battery=battery,
                    navigator=MemsNavigationFilter(tuple(base), self.seed * 100 + index),
                )
            )
        return agents

    def _build_threats(self) -> list[MissionThreat]:
        threats: list[MissionThreat] = []
        for index, x in enumerate(np.linspace(-440.0, 440.0, 20)):
            velocity = np.asarray((self.rng.normal(0.0, 0.85), 48.0 + (index % 4) * 1.3, self.rng.normal(0.0, 0.08)))
            threats.append(
                MissionThreat(
                    index=index,
                    position=np.asarray((x, -5_200.0 + self.rng.normal(0.0, 22.0), 105.0 + (index % 5) * 20.0)),
                    velocity=velocity,
                    shared_condition=float(self.rng.normal(0.0, 0.045)),
                )
            )
        return threats

    def add_event(
        self,
        time_s: float,
        kind: str,
        truth: dict[str, Any],
        label: str,
        agent_local: dict[str, Any] | None = None,
    ) -> None:
        self.events.append(
            {
                "time_s": round(time_s, 2),
                "kind": kind,
                "truth": truth,
                "agent_local": agent_local or {},
                "presentation": {"frame": 0, "label": label},
            }
        )

    def _candidate_batches(self, agents: list[MissionAgent], time_s: float) -> dict[str, list[tuple[MissionThreat, Candidate]]]:
        observations: list[tuple[MissionAgent, MissionThreat, str, np.ndarray, np.ndarray, float, bool, float]] = []
        sequences: list[np.ndarray] = []
        for agent in agents:
            estimated_position = np.asarray(agent.navigator.state.position)
            nav = agent.navigator.state
            for threat in self.threats:
                if not threat.active or not threat.alive:
                    continue
                relative_truth = threat.position - agent.position
                range_m = float(np.linalg.norm(relative_truth))
                if range_m > SENSOR_RANGE_M:
                    continue
                local_id = _local_id(agent.id, threat.id)
                noise_std = 1.5 + 0.004 * range_m
                observed_relative = relative_truth + self.rng.normal(0.0, noise_std, 3)
                local_position = estimated_position + observed_relative
                observed_velocity = threat.velocity + self.rng.normal(0.0, 0.35 + range_m / 4_000.0, 3)
                occluded = bool(self.rng.random() < 0.015 + 0.03 * (range_m / SENSOR_RANGE_M))
                committed = [
                    other
                    for other in self.agents
                    if other.alive
                    and other.target_id == threat.id
                    and other.id != agent.id
                    and other.state in {"INTERCEPTING", "RECOVERY_INTERCEPT"}
                ]
                visibly_covered = bool(committed) and not occluded
                nearest_committed = min(
                    (float(np.linalg.norm(other.position - threat.position)) for other in committed),
                    default=SENSOR_RANGE_M,
                )
                time_to_boundary = max(0.0, -local_position[1]) / max(1.0, observed_velocity[1])
                feature = np.asarray(
                    (
                        observed_relative[0] / 1000.0,
                        observed_relative[1] / 1500.0,
                        observed_relative[2] / 300.0,
                        observed_velocity[0] / 50.0,
                        observed_velocity[1] / 50.0,
                        observed_velocity[2] / 50.0,
                        range_m / 1500.0,
                        time_to_boundary / 60.0,
                        float(visibly_covered),
                        nearest_committed / 1500.0,
                        agent.battery,
                        math.sqrt(sum(nav.covariance_diag)) / 100.0,
                    ),
                    dtype=np.float32,
                )
                history = self.histories[(agent.id, local_id)]
                history.append(feature)
                while len(history) < 5:
                    history.appendleft(feature.copy())
                sequences.append(np.stack(history))
                observations.append((agent, threat, local_id, local_position, observed_velocity, range_m, visibly_covered, time_to_boundary))
        if not observations:
            return {agent.id: [] for agent in agents}
        with torch.inference_mode():
            learned_batch = decode_beliefs(self.model(torch.from_numpy(np.stack(sequences))))
        self.belief_inferences += len(observations)
        self.decision_ticks += len(agents)
        result: dict[str, list[tuple[MissionThreat, Candidate]]] = {agent.id: [] for agent in agents}
        for observation, learned in zip(observations, learned_batch, strict=True):
            agent, threat, local_id, local_position, observed_velocity, range_m, visibly_covered, time_to_boundary = observation
            closing_speed = MAX_INTERCEPTOR_SPEED_MPS + min(50.0, float(np.linalg.norm(observed_velocity)))
            intercept_time = min(time_to_boundary, range_m / closing_speed)
            intercept_point = local_position + observed_velocity * intercept_time
            belief = BeliefOutput(
                learned.target_leak_probability,
                learned.action_success_probability,
                max(learned.friendly_coverage_probability, 0.88 if visibly_covered else 0.04),
                intercept_time,
                tuple(float(value) for value in intercept_point),
                min(time_to_boundary, intercept_time + 4.2),
                learned.confidence * math.exp(-range_m / 5_000.0),
            )
            candidate = Candidate(
                track_id=local_id,
                belief=belief,
                consequence=1.0 + 0.08 * (threat.index % 3),
                assigned_sector=abs(float(threat.position[0] - agent.grid[0])) <= 70.0,
                time_to_boundary_s=time_to_boundary,
                expenditure_cost=0.025,
                battery_cost=(1.0 - agent.battery) * 0.07,
                coverage_loss_cost=0.04 if agent.index < 18 else 0.01,
                collision_cost=0.015 * sum(
                    np.linalg.norm(other.position - agent.position) < 70.0
                    for other in self.agents
                    if other.alive and other.id != agent.id
                ),
                battery=agent.battery,
            )
            result[agent.id].append((threat, candidate))
        return result

    def _commit(
        self,
        agent: MissionAgent,
        threat: MissionThreat,
        candidate: Candidate,
        time_s: float,
        recovery: bool,
    ) -> None:
        agent.target_id = threat.id
        agent.target_local_id = candidate.track_id
        agent.current_belief = candidate.belief
        agent.current_utility = mission_utility(candidate)
        agent.committed_at = time_s
        agent.pending_target_id = None
        agent.pending_ready_at = None
        agent.hysteresis.current_track = candidate.track_id
        agent.state = "RECOVERY_INTERCEPT" if recovery else "INTERCEPTING"
        threat.covered_by = agent.id
        threat.coverage_expiry = time_s + max(8.0, candidate.belief.predicted_coverage_expiry)
        agent.current_cost_terms = {
            "expenditure": candidate.expenditure_cost,
            "battery": candidate.battery_cost,
            "coverage_loss": candidate.coverage_loss_cost,
            "collision": candidate.collision_cost,
        }
        local = {
            "agent_id": agent.id,
            "local_track_id": candidate.track_id,
            "identity_state": "HOSTILE EVIDENCE",
            "belief": candidate.belief.__dict__,
            "utility": agent.current_utility,
            "cost_terms": agent.current_cost_terms,
            "trigger": "locally observed target survival" if recovery else "local mission utility",
            "decision": "INTERCEPT",
            "selection_reason": "all local candidates scored; sector and uncovered-target tie-breaks applied",
            "rf_messages": 0,
        }
        if recovery:
            self.recovery_count += 1
            self.add_event(
                time_s,
                "observer_claim",
                {"interceptor_id": agent.id, "hostile_id": threat.id, "phase": "sequential_recovery"},
                "observation-driven recovery",
                local,
            )
        self.add_event(
            time_s,
            "mobilized",
            {"interceptor_id": agent.id, "hostile_id": threat.id, "phase": "recovery" if recovery else "intercept"},
            "interceptor committed",
            local,
        )

    def _decision_cycle(self, time_s: float) -> None:
        if time_s < INGRESS_TIME:
            return
        observer_available = any(
            agent.alive and agent.battery > 0.25 and agent.state in {"ON_STATION", "RESERVE"}
            for agent in self.agents
        )
        eligible = [
            agent
            for agent in self.agents
            if agent.alive
            and agent.battery > 0.25
            and agent.state in {"ON_STATION", "RESERVE", "RETURNING", "INTERCEPTING", "RECOVERY_INTERCEPT"}
            and (agent.state != "RETURNING" or not observer_available)
        ]
        evaluations = self._candidate_batches(eligible, time_s)
        for agent in eligible:
            options = evaluations[agent.id]
            if agent.target_id:
                current = next((item for item in options if item[0].id == agent.target_id), None)
                if current is None:
                    self._start_rth(agent, time_s, "local_target_track_lost")
                    continue
                current_threat, current_candidate = current
                agent.current_belief = current_candidate.belief
                agent.current_utility = mission_utility(current_candidate)
                agent.target_local_id = current_candidate.track_id
                current_threat.covered_by = agent.id
                current_threat.coverage_expiry = time_s + max(4.2, current_candidate.belief.predicted_coverage_expiry)
                alternatives = [item for item in options if item[0].id != current_threat.id]
                if not alternatives:
                    agent.competing_action = "HOLD"
                    agent.last_hysteresis_margin = None
                    continue
                best_alternate = choose_candidate([candidate for _, candidate in alternatives])
                alternate_pair = next(item for item in alternatives if item[1].track_id == best_alternate.track_id)
                competing_threat, competing_candidate = alternate_pair
                progress = min(
                    1.0,
                    max(0.0, (time_s - (agent.committed_at or time_s)) / max(current_candidate.belief.predicted_intercept_time, 0.1)),
                )
                agent.last_hysteresis_margin = 0.05 + 0.10 * progress
                agent.competing_action = f"INTERCEPT {competing_threat.id}"
                terminal_lock = current_candidate.belief.predicted_intercept_time <= 3.2
                should_switch = False if terminal_lock else agent.hysteresis.consider(
                    competing_candidate.track_id,
                    mission_utility(competing_candidate),
                    agent.current_utility,
                    progress,
                    False,
                )
                if should_switch:
                    if current_threat.covered_by == agent.id:
                        current_threat.covered_by = None
                        current_threat.coverage_expiry = None
                    self.add_event(
                        time_s,
                        "target_switched",
                        {"interceptor_id": agent.id, "from_hostile_id": current_threat.id, "hostile_id": competing_threat.id},
                        "three-tick utility hysteresis satisfied",
                        {
                            "agent_id": agent.id,
                            "local_track_id": competing_candidate.track_id,
                            "hysteresis_margin": agent.last_hysteresis_margin,
                            "hysteresis_ticks": 3,
                        },
                    )
                    self._commit(agent, competing_threat, competing_candidate, time_s, competing_threat.attempt_count > 0)
                continue
            if agent.state == "RESERVE" and time_s < INGRESS_TIME + 2.0:
                continue
            if not options:
                continue
            threat, candidate = next(
                item for item in options if item[1].track_id == choose_candidate([value for _, value in options]).track_id
            )
            if mission_utility(candidate) <= 0.0 or candidate.belief.friendly_coverage_probability >= 0.5:
                agent.pending_target_id = None
                agent.pending_ready_at = None
                continue
            if agent.pending_target_id != threat.id:
                if agent.pending_target_id is not None:
                    self.add_event(
                        time_s,
                        "claim_cancelled",
                        {"interceptor_id": agent.id, "hostile_id": agent.pending_target_id},
                        "visible commitment changes local preference",
                        {"agent_id": agent.id, "trigger": "observed_friendly_commitment"},
                    )
                agent.pending_target_id = threat.id
                agent.pending_ready_at = time_s + 0.15 * (agent.index // 8) + 0.01 * (agent.index % 8)
                continue
            if agent.pending_ready_at is None or time_s < agent.pending_ready_at:
                continue
            if threat.covered_by is not None:
                agent.pending_target_id = None
                agent.pending_ready_at = None
                continue
            self._commit(agent, threat, candidate, time_s, threat.attempt_count > 0)

    def _start_rth(self, agent: MissionAgent, time_s: float, reason: str) -> None:
        if agent.state in {"RETURNING", "LANDED"} or not agent.alive:
            return
        if agent.target_id:
            target = next((item for item in self.threats if item.id == agent.target_id), None)
            if target and target.covered_by == agent.id:
                target.covered_by = None
                target.coverage_expiry = time_s
        agent.target_id = None
        agent.state = "RETURNING"
        agent.rth_waypoints = agent.navigator.reverse_waypoints(base_altitude_m=float(agent.base[2]))
        agent.rth_index = 0
        self.add_event(
            time_s,
            "return_to_base",
            {"interceptor_id": agent.id, "phase": "recovery", "reason": reason},
            "reverse-INS return",
            {
                "agent_id": agent.id,
                "trigger": reason,
                "navigation_mode": "reverse_mems_ins_dead_reckoning",
                "waypoint_count": len(agent.rth_waypoints),
                "battery": agent.battery,
            },
        )

    def _target_for_agent(self, agent: MissionAgent) -> MissionThreat | None:
        return next((threat for threat in self.threats if threat.id == agent.target_id and threat.alive), None)

    def _command(self, agent: MissionAgent, time_s: float) -> np.ndarray:
        estimate = agent.navigator.state
        estimated_position = np.asarray(estimate.position)
        estimated_velocity = np.asarray(estimate.velocity)
        limits = GuidanceLimits(MAX_INTERCEPTOR_SPEED_MPS, 28.0, 30.0, 3.2, min_speed=12.0)
        target_position: np.ndarray | None = None
        target_velocity = np.zeros(3)
        remaining_time = 12.0
        if agent.state == "DEPLOYING":
            target_position = agent.grid
            remaining_time = max(1.0, INGRESS_TIME - time_s - 1.0)
            limits = GuidanceLimits(MAX_INTERCEPTOR_SPEED_MPS, 55.0, 32.0, 3.2)
        elif agent.state in {"INTERCEPTING", "RECOVERY_INTERCEPT"}:
            threat = self._target_for_agent(agent)
            if threat is None:
                agent.state = "ON_STATION"
                agent.target_id = None
                return np.zeros(3)
            relative_observation = threat.position - agent.position
            local_noise = self.rng.normal(0.0, 1.2 + 0.002 * np.linalg.norm(relative_observation), 3)
            observed_target = estimated_position + relative_observation + local_noise
            agent.last_observed_target = observed_target.copy()
            distance = float(np.linalg.norm(observed_target - estimated_position))
            target_velocity = threat.velocity
            remaining_time = max(0.2, distance / 84.0)
            target_position = observed_target + target_velocity * remaining_time
            agent.last_intercept_basket = target_position.copy()
            if distance < 170.0 or remaining_time <= limits.terminal_time_s:
                command = proportional_navigation_guidance(
                    tuple(estimated_position), tuple(estimated_velocity), tuple(observed_target), tuple(target_velocity), limits, DT
                )
                agent.replanning_count += 1
                agent.last_guidance_mode = command.mode
                agent.last_preferred_velocity = np.asarray(command.preferred_velocity)
                return agent.last_preferred_velocity
        elif agent.state == "RETURNING":
            relative_dock = agent.base - agent.position
            dock_range = float(np.linalg.norm(relative_dock))
            if dock_range <= 180.0:
                target_position = estimated_position + relative_dock + self.rng.normal(0.0, 0.45, 3)
                guidance_mode = "terminal_optical_dock"
            else:
                if not agent.rth_waypoints:
                    agent.rth_waypoints = agent.navigator.reverse_waypoints(base_altitude_m=float(agent.base[2]))
                if agent.rth_index < len(agent.rth_waypoints):
                    remaining_waypoints = np.asarray(agent.rth_waypoints[agent.rth_index:])
                    agent.rth_index += int(np.argmin(np.linalg.norm(remaining_waypoints - estimated_position, axis=1)))
                while agent.rth_index < len(agent.rth_waypoints) and np.linalg.norm(estimated_position - np.asarray(agent.rth_waypoints[agent.rth_index])) < 250.0:
                    agent.rth_index += 1
                if agent.rth_index >= len(agent.rth_waypoints):
                    target_position = np.asarray(agent.navigator.path_memory[0])
                else:
                    target_position = np.asarray(agent.rth_waypoints[agent.rth_index])
                guidance_mode = "reverse_ins_waypoint"
            displacement = target_position - estimated_position
            distance_to_waypoint = float(np.linalg.norm(displacement))
            preferred = np.zeros(3) if distance_to_waypoint < 1e-6 else displacement * (min(75.0, distance_to_waypoint / 1.5) / distance_to_waypoint)
            preferred[2] = float(np.clip(preferred[2], -16.0, 16.0))
            agent.replanning_count += 1
            agent.last_guidance_mode = guidance_mode
            agent.last_preferred_velocity = preferred
            return preferred
        else:
            return np.zeros(3)
        assert target_position is not None
        command = receding_horizon_guidance(
            tuple(estimated_position), tuple(estimated_velocity), tuple(target_position), remaining_time, limits, DT
        )
        agent.replanning_count += 1
        agent.last_guidance_mode = command.mode
        agent.last_preferred_velocity = np.asarray(command.preferred_velocity)
        return agent.last_preferred_velocity

    def _safe_command(self, agent: MissionAgent, preferred: np.ndarray) -> np.ndarray:
        neighbors: list[tuple[tuple[float, float, float], tuple[float, float, float], str]] = []
        estimated_position = np.asarray(agent.navigator.state.position)
        estimated_velocity = np.asarray(agent.navigator.state.velocity)
        for other in self.agents:
            if not other.alive or other.id == agent.id:
                continue
            relative_truth = other.position - agent.position
            distance = float(np.linalg.norm(relative_truth))
            if distance <= 230.0:
                beacon_valid = bool(self.rng.random() > 0.04 + distance / 5_000.0)
                identity = self.iff.update(lineage=True, beacon_valid=beacon_valid, beacon_bound=beacon_valid, hostile_evidence=False)
                observed_position = estimated_position + relative_truth + self.rng.normal(0.0, 0.7 + distance / 400.0, 3)
                observed_velocity = other.velocity + self.rng.normal(0.0, 0.22, 3)
                neighbors.append((tuple(observed_position), tuple(observed_velocity), identity.value))
        for threat in self.threats:
            relative_truth = threat.position - agent.position
            distance = float(np.linalg.norm(relative_truth))
            if threat.active and threat.alive and distance <= 230.0:
                observed_position = estimated_position + relative_truth + self.rng.normal(0.0, 1.2 + distance / 300.0, 3)
                observed_velocity = threat.velocity + self.rng.normal(0.0, 0.3, 3)
                neighbors.append((tuple(observed_position), tuple(observed_velocity), "HOSTILE EVIDENCE"))
        result = official_rvo2_filter(
            tuple(estimated_position), tuple(estimated_velocity), tuple(preferred), neighbors,
            MIN_SEPARATION_M, 4.0, DT, MAX_INTERCEPTOR_SPEED_MPS,
        )
        agent.last_safety_override = result.override
        agent.last_min_separation = result.predicted_min_separation_m
        agent.last_safe_velocity = np.asarray(result.velocity)
        return agent.last_safe_velocity

    def _move_agent(self, agent: MissionAgent, time_s: float) -> None:
        if not agent.alive or agent.state in {"DOCKED", "LANDED", "EXPENDED"}:
            return
        old_position = agent.position.copy()
        old_velocity = agent.velocity.copy()
        preferred = self._command(agent, time_s)
        if agent.state == "RETURNING":
            velocity_delta = preferred - agent.velocity
            delta_norm = float(np.linalg.norm(velocity_delta))
            if delta_norm > 12.0:
                preferred = agent.velocity + velocity_delta * (12.0 / delta_norm)
            agent.last_preferred_velocity = preferred
        safe = self._safe_command(agent, preferred)
        max_speed = RETURN_SPEED_MPS if agent.state == "RETURNING" else MAX_INTERCEPTOR_SPEED_MPS
        speed = float(np.linalg.norm(safe))
        if speed > max_speed:
            safe *= max_speed / speed
        next_position = agent.position + safe * DT
        next_position[0] = float(np.clip(next_position[0], -700.0, 700.0))
        next_position[1] = float(np.clip(next_position[1], -5_500.0, 1_280.0))
        next_position[2] = float(np.clip(next_position[2], 4.0, 420.0))
        agent.position = next_position
        agent.velocity = safe
        travelled = float(np.linalg.norm(agent.position - old_position))
        acceleration = (safe - old_velocity) / DT
        energy = travelled * 0.000085 + float(np.linalg.norm(acceleration)) * DT * 0.000018 + DT * 0.000018
        agent.path_length_m += travelled
        agent.energy_used += energy
        agent.battery = max(0.0, agent.battery - energy)
        previous_heading = math.atan2(old_velocity[0], old_velocity[1]) if np.linalg.norm(old_velocity[:2]) > 0.1 else 0.0
        current_heading = math.atan2(safe[0], safe[1]) if np.linalg.norm(safe[:2]) > 0.1 else previous_heading
        heading_rate = math.atan2(math.sin(current_heading - previous_heading), math.cos(current_heading - previous_heading)) / DT
        nav = agent.navigator.step(
            tuple(acceleration), heading_rate, float(agent.position[2]), DT,
            remember_path=agent.state == "DEPLOYING",
        )
        self.add_event(
            time_s,
            "trajectory_step",
            {
                "interceptor_id": agent.id,
                "from_position": _v3(old_position),
                "to_position": _v3(agent.position),
                "state": agent.state,
                "battery": round(agent.battery, 5),
            },
            agent.state.replace("_", " ").lower(),
            {
                "agent_id": agent.id,
                "identity_state": "CONFIRMED FRIENDLY",
                "estimated_position": _v3(nav.position),
                "estimated_velocity": _v3(nav.velocity),
                "covariance_diag": _v3(nav.covariance_diag),
                "heading_error_rad": round(nav.heading_error_rad, 7),
                "accelerometer_bias": _v3(nav.accelerometer_bias),
                "gyroscope_bias_rad_s": round(nav.gyroscope_bias_rad_s, 8),
                "barometer_bias_m": round(nav.barometer_bias_m, 5),
                "guidance_mode": agent.last_guidance_mode,
                "preferred_velocity": _v3(agent.last_preferred_velocity),
                "safe_velocity": _v3(agent.last_safe_velocity),
                "safety_override": agent.last_safety_override,
                "neighbor_source": "noisy_local_tracks",
                "safety_filter": "snape/RVO2-3D",
                "predicted_min_separation_m": None if math.isinf(agent.last_min_separation) else round(agent.last_min_separation, 4),
                "replanning_count": agent.replanning_count,
                "path_length_m": round(agent.path_length_m, 3),
                "energy_used": round(agent.energy_used, 6),
                "target_id": agent.target_id,
                "local_track_id": agent.target_local_id,
                "local_target_position": _v3(agent.last_observed_target) if agent.last_observed_target is not None and agent.target_id else None,
                "intercept_basket": _v3(agent.last_intercept_basket) if agent.last_intercept_basket is not None and agent.target_id else None,
                "belief": agent.current_belief.__dict__ if agent.current_belief is not None and agent.target_id else None,
                "utility": round(agent.current_utility, 6) if agent.target_id else None,
                "battery": round(agent.battery, 5),
                "cost_terms": agent.current_cost_terms if agent.target_id else None,
                "selection_reason": "all local candidates scored; sector and uncovered-target tie-breaks applied" if agent.target_id else None,
                "hysteresis_margin": round(agent.last_hysteresis_margin, 5) if agent.target_id and agent.last_hysteresis_margin is not None else None,
                "competing_action": agent.competing_action if agent.target_id else None,
                "hysteresis_ticks": agent.hysteresis.consecutive_ticks if agent.target_id else None,
                "recovery_waypoint": _v3(agent.rth_waypoints[min(agent.rth_index, len(agent.rth_waypoints) - 1)]) if agent.state == "RETURNING" and agent.rth_waypoints else None,
            },
        )

    def _update_separation(self) -> None:
        alive = [agent for agent in self.agents if agent.alive]
        for index, first in enumerate(alive):
            for second in alive[index + 1:]:
                separation = float(np.linalg.norm(first.position - second.position))
                self.minimum_separation = min(self.minimum_separation, separation)
                if separation < MIN_SEPARATION_M:
                    self.friendly_collisions += 1

    def _engagements(self, time_s: float) -> None:
        for agent in self.agents:
            if not agent.alive or agent.state not in {"INTERCEPTING", "RECOVERY_INTERCEPT"}:
                continue
            threat = self._target_for_agent(agent)
            if threat is None:
                continue
            separation = float(np.linalg.norm(agent.position - threat.position))
            if separation > 11.0:
                continue
            threat.attempt_count += 1
            closing = float(np.linalg.norm(agent.velocity - threat.velocity))
            nav_uncertainty = math.sqrt(sum(agent.navigator.state.covariance_diag))
            geometry = max(0.0, 1.0 - separation / 11.0)
            probability = float(np.clip(0.91 + 0.025 * geometry + 0.0004 * min(closing, 60.0) + threat.shared_condition - 0.001 * nav_uncertainty, 0.86, 0.97))
            draw_digest = hashlib.sha256(f"n19:{self.seed}:{threat.index}:{threat.attempt_count}".encode()).hexdigest()
            draw = int(draw_digest[:16], 16) / 2**64
            success = draw < probability
            position = (agent.position + threat.position) / 2.0
            self.add_event(
                time_s,
                "engagement_attempt",
                {
                    "interceptor_id": agent.id,
                    "hostile_id": threat.id,
                    "position": _v3(position),
                    "outcome": success,
                    "success_probability": round(probability, 5),
                    "seeded_draw": round(draw, 5),
                    "closing_speed_mps": round(closing, 3),
                    "miss_distance_m": round(separation, 3),
                },
                "kinetic impact" if success else "interception missed",
                {
                    "agent_id": agent.id,
                    "local_track_id": agent.target_local_id,
                    "belief": agent.current_belief.__dict__ if agent.current_belief else None,
                    "utility": agent.current_utility,
                    "shared_failure_factor": threat.shared_condition,
                },
            )
            agent.alive = False
            agent.state = "EXPENDED"
            agent.velocity[:] = 0.0
            if success:
                threat.alive = False
                threat.neutralized = True
                threat.covered_by = None
                self.add_event(
                    time_s,
                    "neutralized",
                    {"interceptor_id": agent.id, "hostile_id": threat.id, "position": _v3(position)},
                    "NEUTRALIZED",
                    {"agent_id": agent.id, "track_status": "removed"},
                )
            else:
                threat.covered_by = agent.id
                threat.coverage_expiry = time_s + 4.2
                threat.miss_position = position.copy()
                self.add_event(
                    time_s,
                    "expended",
                    {"interceptor_id": agent.id, "position": _v3(agent.position)},
                    "lead expended",
                    {"agent_id": agent.id, "track_status": "removed"},
                )

    def _move_threats(self, time_s: float) -> None:
        for threat in self.threats:
            if not threat.active or not threat.alive:
                continue
            old = threat.position.copy()
            lateral = 0.18 * math.sin(time_s * 0.45 + threat.index)
            threat.velocity[0] += lateral * DT
            threat.velocity[0] = float(np.clip(threat.velocity[0], -2.5, 2.5))
            threat.position += threat.velocity * DT
            self.add_event(
                time_s,
                "hostile_trajectory_step",
                {"hostile_id": threat.id, "from_position": _v3(old), "to_position": _v3(threat.position), "state": "INGRESS"},
                "hostile ingress",
            )
            if threat.position[1] >= BOUNDARY_Y:
                threat.leaked = True
                threat.alive = False
                self.add_event(time_s, "leaked", {"hostile_id": threat.id, "position": _v3(threat.position)}, "protected boundary breached")

    def _phase_transitions(self, time_s: float) -> None:
        if time_s == 0.0:
            self.add_event(0.0, "demo_started", {"summary": "Twenty-hostile physical mission simulation"}, "mission start")
            for agent in self.agents:
                agent.state = "DEPLOYING"
                self.add_event(0.0, "launched", {"interceptor_id": agent.id, "phase": "deployment"}, "coastal launch", {"agent_id": agent.id, "rf_messages": 0})
        for agent in self.agents:
            if agent.state == "DEPLOYING" and np.linalg.norm(agent.position - agent.grid) < 20.0:
                agent.state = "ON_STATION" if agent.index < 18 else "RESERVE"
                self.add_event(
                    time_s,
                    "formation_occupied",
                    {"interceptor_id": agent.id, "position": _v3(agent.position), "state": agent.state},
                    "picket grid occupied",
                    {"agent_id": agent.id, "battery": agent.battery, "estimated_position": _v3(agent.navigator.state.position)},
                )
        if time_s == INGRESS_TIME:
            for threat in self.threats:
                threat.active = True
                self.add_event(time_s, "threat_ingress", {"hostile_id": threat.id, "position": _v3(threat.position)}, "hostile ingress")
        for threat in self.threats:
            if threat.alive and threat.coverage_expiry is not None and time_s >= threat.coverage_expiry:
                previous = threat.covered_by
                lead = next((agent for agent in self.agents if agent.id == previous and agent.alive), None)
                if lead is not None and lead.state in {"INTERCEPTING", "RECOVERY_INTERCEPT"}:
                    self._start_rth(lead, time_s, "expired_intercept_window")
                threat.covered_by = None
                threat.coverage_expiry = None
                self.add_event(
                    time_s,
                    "coverage_expired",
                    {"hostile_id": threat.id, "previous_interceptor_id": previous},
                    "private coverage window expired",
                    {"trigger": "surviving hostile observed"},
                )
        for agent in self.agents:
            if agent.alive and agent.state not in {"RETURNING", "LANDED", "DEPLOYING", "INTERCEPTING", "RECOVERY_INTERCEPT"} and agent.battery <= 0.25:
                self._start_rth(agent, time_s, "critical_battery_abort")
        threats_resolved = all(not threat.alive for threat in self.threats)
        if threats_resolved:
            for agent in self.agents:
                if agent.alive and agent.state in {"ON_STATION", "RESERVE"}:
                    self._start_rth(agent, time_s, "mission_complete")
        for agent in self.agents:
            if agent.alive and agent.state == "RETURNING":
                estimated_position = np.asarray(agent.navigator.state.position)
                estimated_base = np.asarray(agent.navigator.path_memory[0])
                estimated_distance = float(np.linalg.norm(estimated_position - estimated_base))
                true_distance = float(np.linalg.norm(agent.position - agent.base))
                if estimated_distance <= 180.0 and true_distance <= 8.0 and np.linalg.norm(agent.velocity) <= 2.5:
                    agent.velocity[:] = 0.0
                    agent.state = "LANDED"
                    self.add_event(
                        time_s,
                        "landed",
                        {"interceptor_id": agent.id, "position": _v3(agent.position), "battery": round(agent.battery, 5)},
                        "recovered at coastal base",
                        {
                            "agent_id": agent.id,
                            "navigation_mode": "reverse_mems_ins_dead_reckoning",
                            "estimated_position": _v3(agent.navigator.state.position),
                            "estimated_dock_error_m": round(estimated_distance, 4),
                            "physical_dock_error_m": round(true_distance, 4),
                        },
                    )
    def run(self) -> MissionReplay:
        for tick in range(1_501):
            time_s = round(tick * DT, 1)
            self.last_time = time_s
            self._phase_transitions(time_s)
            self._move_threats(time_s)
            self._decision_cycle(time_s)
            for agent in self.agents:
                self._move_agent(agent, time_s)
            self._update_separation()
            self._engagements(time_s)
            if time_s > INGRESS_TIME and all(not threat.alive for threat in self.threats) and all(
                not agent.alive or agent.state == "LANDED" for agent in self.agents
            ):
                break
        neutralized = sum(threat.neutralized for threat in self.threats)
        leaked = sum(threat.leaked for threat in self.threats)
        recovered = sum(agent.state == "LANDED" for agent in self.agents)
        expended = sum(not agent.alive for agent in self.agents)
        completed = neutralized + leaked == len(self.threats)
        self.add_event(
            self.last_time,
            "simulation_completed",
            {"summary": {"hostiles": len(self.threats), "neutralized": neutralized, "leaked": leaked, "recovered": recovered, "expended": expended}},
            "mission complete",
        )
        self.events.sort(key=lambda event: event["time_s"])
        for frame, event in enumerate(self.events):
            event["presentation"]["frame"] = frame
        metrics = {
            "hostiles_total": len(self.threats),
            "neutralized": neutralized,
            "leaked": leaked,
            "duplicate_pursuits": self.duplicate_pursuits,
            "recovery_count": self.recovery_count,
            "cumulative_neutralization": neutralized / len(self.threats),
            "retained_coverage": sum(agent.alive and agent.state in {"ON_STATION", "RESERVE", "RETURNING", "LANDED"} for agent in self.agents) / len(self.agents),
            "minimum_separation_m": self.minimum_separation,
            "friendly_collisions": self.friendly_collisions,
            "entity_drops": 0,
            "completed": completed,
            "rf_ground_messages": 0,
            "rf_interdrone_messages": 0,
            "decision_ticks": self.decision_ticks,
            "belief_inferences": self.belief_inferences,
            "target_assignment_messages": 0,
            "safety_filter": "snape/RVO2-3D",
        }
        return MissionReplay(self.events, metrics)


def run_full_mission(seed: int = 2033) -> MissionReplay:
    return FullMissionSimulator(seed).run()
