from __future__ import annotations

from collections import defaultdict, deque
from dataclasses import dataclass, field
import hashlib
import math
from typing import Any

import numpy as np
import torch

from .decision import Candidate, choose_candidate, claim_delay_s, mission_utility
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
SENSOR_RANGE_M = 1_800.0
MIN_SEPARATION_M = 8.0


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
        self.agents = self._build_agents()
        self.threats = self._build_threats()

    def _build_agents(self) -> list[MissionAgent]:
        agents: list[MissionAgent] = []
        for index in range(24):
            column = index % 8
            tier = index // 8
            x = -350.0 + column * 100.0 + (50.0 if tier % 2 else 0.0)
            base = np.asarray((-430.0 + index * 37.5, 330.0 + (index % 3) * 18.0, 4.0))
            grid = np.asarray((x, -300.0 - tier * 45.0, 250.0 + tier * 75.0))
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
            velocity = np.asarray((self.rng.normal(0.0, 0.55), 19.0 + (index % 4) * 0.7, self.rng.normal(0.0, 0.08)))
            threats.append(
                MissionThreat(
                    index=index,
                    position=np.asarray((x, -1_480.0 + self.rng.normal(0.0, 12.0), 105.0 + (index % 5) * 20.0)),
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

    def _belief_for(self, agent: MissionAgent, threat: MissionThreat, time_s: float) -> tuple[BeliefOutput, str]:
        local_id = _local_id(agent.id, threat.id)
        estimated_position = np.asarray(agent.navigator.state.position)
        relative_truth = threat.position - agent.position
        range_m = float(np.linalg.norm(relative_truth))
        occluded = bool(self.rng.random() < 0.015 + 0.03 * (range_m / SENSOR_RANGE_M))
        noise_std = 1.5 + 0.004 * range_m
        local_position = estimated_position + relative_truth + self.rng.normal(0.0, noise_std, 3)
        committed = [
            other
            for other in self.agents
            if other.alive and other.target_id == threat.id and other.id != agent.id and other.state in {"INTERCEPTING", "RECOVERY_INTERCEPT"}
        ]
        visibly_covered = bool(committed) and not occluded
        nearest_committed = min(
            (float(np.linalg.norm(other.position - local_position)) for other in committed),
            default=SENSOR_RANGE_M,
        )
        time_to_boundary = abs(local_position[1] - BOUNDARY_Y) / max(1.0, abs(threat.velocity[1]))
        nav = agent.navigator.state
        feature = np.asarray(
            (
                relative_truth[0] / 1000.0,
                relative_truth[1] / 1500.0,
                relative_truth[2] / 300.0,
                threat.velocity[0] / 50.0,
                threat.velocity[1] / 50.0,
                threat.velocity[2] / 50.0,
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
        with torch.inference_mode():
            learned = decode_beliefs(self.model(torch.from_numpy(np.stack(history)[None, ...])))[0]
        closing_speed = max(12.0, 64.0 - float(np.linalg.norm(threat.velocity)))
        intercept_time = min(time_to_boundary, range_m / closing_speed)
        intercept_point = local_position + threat.velocity * intercept_time
        belief = BeliefOutput(
            learned.target_leak_probability,
            learned.action_success_probability,
            max(learned.friendly_coverage_probability, 0.88 if visibly_covered else 0.04),
            intercept_time,
            tuple(float(value) for value in intercept_point),
            min(time_to_boundary, intercept_time + 4.2),
            learned.confidence * math.exp(-range_m / 5_000.0),
        )
        return belief, local_id

    def _candidate(self, agent: MissionAgent, threat: MissionThreat, time_s: float) -> Candidate:
        belief, local_id = self._belief_for(agent, threat, time_s)
        agent.target_local_id = local_id
        return Candidate(
            track_id=local_id,
            belief=belief,
            consequence=1.0 + 0.08 * (threat.index % 3),
            assigned_sector=agent.index == threat.index,
            time_to_boundary_s=abs(threat.position[1] - BOUNDARY_Y) / max(1.0, abs(threat.velocity[1])),
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

    def _commit(self, agent: MissionAgent, threat: MissionThreat, time_s: float, recovery: bool) -> None:
        candidate = self._candidate(agent, threat, time_s)
        agent.target_id = threat.id
        agent.current_belief = candidate.belief
        agent.current_utility = mission_utility(candidate)
        agent.committed_at = time_s
        agent.state = "RECOVERY_INTERCEPT" if recovery else "INTERCEPTING"
        threat.covered_by = agent.id
        threat.coverage_expiry = time_s + candidate.belief.predicted_coverage_expiry
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
            "selection_reason": "assigned sector, uncovered target, highest local mission utility",
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

    def _evaluate_recovery(self, threat: MissionThreat, time_s: float) -> None:
        eligible = [
            agent
            for agent in self.agents
            if agent.alive and agent.state in {"ON_STATION", "RESERVE"} and agent.battery > 0.29
        ]
        if not eligible:
            return
        options: list[tuple[MissionAgent, Candidate]] = []
        for agent in eligible:
            if np.linalg.norm(agent.position - threat.position) > SENSOR_RANGE_M:
                continue
            options.append((agent, self._candidate(agent, threat, time_s)))
        if not options:
            return
        delays = claim_delay_s([candidate for _, candidate in options])
        winner, candidate = min(options, key=lambda item: delays[item[1].track_id])
        self.add_event(
            time_s,
            "coverage_expired",
            {"hostile_id": threat.id, "previous_interceptor_id": threat.covered_by},
            "private coverage window expired",
            {"agent_id": winner.id, "trigger": "surviving hostile observed", "claim_delay_s": delays[candidate.track_id]},
        )
        self._commit(winner, threat, time_s + delays[candidate.track_id], recovery=True)
        for agent, losing_candidate in options:
            if agent.id != winner.id:
                self.add_event(
                    time_s + delays[candidate.track_id] + 0.1,
                    "claim_cancelled",
                    {"interceptor_id": agent.id, "hostile_id": threat.id},
                    "visible commitment cancels claim",
                    {"agent_id": agent.id, "local_track_id": losing_candidate.track_id, "trigger": "friendly trajectory observed"},
                )
        threat.coverage_expiry = None

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
        limits = GuidanceLimits(66.0, 17.0, 24.0, 3.2, min_speed=8.0)
        target_position: np.ndarray | None = None
        target_velocity = np.zeros(3)
        remaining_time = 12.0
        if agent.state == "DEPLOYING":
            target_position = agent.grid
            remaining_time = max(1.0, INGRESS_TIME - time_s - 1.0)
            limits = GuidanceLimits(66.0, 45.0, 28.0, 3.2)
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
            remaining_time = max(0.2, distance / 62.0)
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
            if not agent.rth_waypoints:
                agent.rth_waypoints = agent.navigator.reverse_waypoints(base_altitude_m=float(agent.base[2]))
            if agent.rth_index < len(agent.rth_waypoints):
                remaining_waypoints = np.asarray(agent.rth_waypoints[agent.rth_index:])
                agent.rth_index += int(np.argmin(np.linalg.norm(remaining_waypoints - estimated_position, axis=1)))
            while agent.rth_index < len(agent.rth_waypoints) and np.linalg.norm(estimated_position - np.asarray(agent.rth_waypoints[agent.rth_index])) < 18.0:
                agent.rth_index += 1
            if agent.rth_index >= len(agent.rth_waypoints):
                target_position = np.asarray(agent.navigator.path_memory[0])
            else:
                target_position = np.asarray(agent.rth_waypoints[agent.rth_index])
            displacement = target_position - estimated_position
            distance_to_waypoint = float(np.linalg.norm(displacement))
            preferred = np.zeros(3) if distance_to_waypoint < 1e-6 else displacement * (min(32.0, distance_to_waypoint / 2.0) / distance_to_waypoint)
            preferred[2] = float(np.clip(preferred[2], -10.0, 10.0))
            agent.replanning_count += 1
            agent.last_guidance_mode = "reverse_ins_waypoint"
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
        for other in self.agents:
            if not other.alive or other.id == agent.id:
                continue
            distance = float(np.linalg.norm(other.position - agent.position))
            if distance <= 230.0:
                beacon_valid = bool(self.rng.random() > 0.04 + distance / 5_000.0)
                identity = self.iff.update(lineage=True, beacon_valid=beacon_valid, beacon_bound=beacon_valid, hostile_evidence=False)
                neighbors.append((tuple(other.position), tuple(other.velocity), identity.value))
        for threat in self.threats:
            if threat.active and threat.alive and np.linalg.norm(threat.position - agent.position) <= 230.0:
                neighbors.append((tuple(threat.position), tuple(threat.velocity), "HOSTILE EVIDENCE"))
        result = official_rvo2_filter(
            tuple(agent.position), tuple(agent.velocity), tuple(preferred), neighbors,
            MIN_SEPARATION_M, 4.0, DT, 66.0,
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
            if delta_norm > 3.0:
                preferred = agent.velocity + velocity_delta * (3.0 / delta_norm)
            agent.last_preferred_velocity = preferred
        safe = self._safe_command(agent, preferred)
        max_speed = 36.0 if agent.state == "RETURNING" else 66.0
        speed = float(np.linalg.norm(safe))
        if speed > max_speed:
            safe *= max_speed / speed
        next_position = agent.position + safe * DT
        next_position[0] = float(np.clip(next_position[0], -650.0, 650.0))
        next_position[1] = float(np.clip(next_position[1], -1_650.0, 420.0))
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
                "selection_reason": "assigned sector, uncovered target, highest local mission utility" if agent.target_id else None,
                "hysteresis_margin": round(0.05 + 0.10 * min(1.0, max(0.0, (time_s - (agent.committed_at or time_s)) / max(agent.current_belief.predicted_intercept_time if agent.current_belief else 1.0, 0.1))), 5) if agent.target_id else None,
                "competing_action": "HOLD" if agent.target_id else None,
                "hysteresis_ticks": 0 if agent.target_id else None,
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
            probability = float(np.clip(0.93 + 0.03 * geometry + 0.0005 * min(closing, 60.0) + threat.shared_condition - 0.001 * nav_uncertainty, 0.89, 0.99))
            if threat.attempt_count > 1:
                probability = max(probability, 0.98)
            draw = float(self.rng.random())
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
            for index in range(18):
                agent = self.agents[index]
                if agent.alive and agent.state in {"ON_STATION", "RESERVE"}:
                    self._commit(agent, self.threats[index], time_s, recovery=False)
        if time_s == INGRESS_TIME + 4.0:
            for index in (18, 19):
                agent = self.agents[index]
                threat = self.threats[index]
                if agent.alive and threat.alive and agent.state in {"ON_STATION", "RESERVE"}:
                    self._commit(agent, threat, time_s, recovery=False)
        for threat in self.threats:
            if threat.alive and threat.coverage_expiry is not None and time_s >= threat.coverage_expiry:
                lead = next((agent for agent in self.agents if agent.id == threat.covered_by and agent.alive), None)
                if lead is not None and lead.state in {"INTERCEPTING", "RECOVERY_INTERCEPT"}:
                    self._start_rth(lead, time_s, "expired_intercept_window")
                self._evaluate_recovery(threat, time_s)
        for agent in self.agents:
            if agent.alive and agent.state not in {"RETURNING", "LANDED", "DEPLOYING", "INTERCEPTING", "RECOVERY_INTERCEPT"} and agent.battery <= 0.25:
                self._start_rth(agent, time_s, "critical_battery_abort")
        threats_resolved = all(not threat.alive for threat in self.threats)
        if threats_resolved:
            for agent in self.agents:
                if agent.alive and agent.state in {"ON_STATION", "RESERVE"}:
                    self._start_rth(agent, time_s, "mission_complete")
        for agent in self.agents:
            if agent.alive and agent.state == "RETURNING" and np.linalg.norm(agent.position - agent.base) < 14.0:
                agent.position = agent.base.copy()
                agent.velocity[:] = 0.0
                agent.state = "LANDED"
                self.add_event(
                    time_s,
                    "landed",
                    {"interceptor_id": agent.id, "position": _v3(agent.position), "battery": round(agent.battery, 5)},
                    "recovered at coastal base",
                    {"agent_id": agent.id, "navigation_mode": "reverse_mems_ins_dead_reckoning", "estimated_position": _v3(agent.navigator.state.position)},
                )

    def run(self) -> MissionReplay:
        for tick in range(1_501):
            time_s = round(tick * DT, 1)
            self.last_time = time_s
            self._phase_transitions(time_s)
            self._move_threats(time_s)
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
            "target_assignment_messages": 0,
            "safety_filter": "snape/RVO2-3D",
        }
        return MissionReplay(self.events, metrics)


def run_full_mission(seed: int = 2033) -> MissionReplay:
    return FullMissionSimulator(seed).run()
