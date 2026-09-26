from __future__ import annotations

from dataclasses import dataclass
import math

import numpy as np

from .core import Vector3


@dataclass(frozen=True)
class GuidanceLimits:
    max_speed: float
    max_accel: float
    max_climb_rate: float
    terminal_time_s: float
    min_speed: float = 0.0


@dataclass(frozen=True)
class GuidanceCommand:
    feasible: bool
    limiting_constraint: str | None
    intercept_basket: Vector3
    preferred_velocity: Vector3
    mode: str


def _tuple3(array: np.ndarray) -> Vector3:
    return (float(array[0]), float(array[1]), float(array[2]))


def receding_horizon_guidance(
    position: Vector3,
    velocity: Vector3,
    intercept_basket: Vector3,
    time_to_intercept_s: float,
    limits: GuidanceLimits,
    dt: float,
) -> GuidanceCommand:
    if time_to_intercept_s <= 0.0:
        return GuidanceCommand(False, "expired_intercept_window", intercept_basket, velocity, "infeasible")
    pos = np.asarray(position, dtype=float)
    vel = np.asarray(velocity, dtype=float)
    basket = np.asarray(intercept_basket, dtype=float)
    desired = (basket - pos) / max(time_to_intercept_s, 0.05)
    speed = float(np.linalg.norm(desired))
    feasible = float(np.linalg.norm(basket - pos)) <= limits.max_speed * time_to_intercept_s * 1.1
    limiting = None if feasible else "max_speed"
    if speed > limits.max_speed:
        desired *= limits.max_speed / speed
    desired[2] = np.clip(desired[2], -limits.max_climb_rate, limits.max_climb_rate)
    delta = desired - vel
    max_delta = limits.max_accel * dt
    delta_norm = float(np.linalg.norm(delta))
    if delta_norm > max_delta:
        delta *= max_delta / delta_norm
    preferred = vel + delta
    mode = "terminal_proportional_navigation" if time_to_intercept_s <= limits.terminal_time_s else "midcourse_basket"
    return GuidanceCommand(feasible, limiting, intercept_basket, _tuple3(preferred), mode)


@dataclass(frozen=True)
class SafetyFilterResult:
    velocity: Vector3
    override: bool
    predicted_min_separation_m: float
    orca_plane_count: int
    backend_name: str = "snape/RVO2-3D"


def official_rvo2_filter(
    position: Vector3,
    velocity: Vector3,
    preferred_velocity: Vector3,
    neighbors: list[tuple[Vector3, Vector3, str]],
    min_separation_m: float,
    horizon_s: float,
    time_step_s: float,
    max_speed_mps: float,
) -> SafetyFilterResult:
    """Run one authoritative snape/RVO2-3D step over every observed track."""
    from . import _rvo3d

    if min_separation_m <= 0.0:
        raise ValueError("min_separation_m must be positive")
    if not neighbors:
        return SafetyFilterResult(preferred_velocity, False, math.inf, 0)

    position_array = np.asarray(position, dtype=float)
    neighbor_distance = max(
        min_separation_m * 2.0,
        max(float(np.linalg.norm(np.asarray(neighbor_pos, dtype=float) - position_array)) for neighbor_pos, _velocity, _identity in neighbors) + min_separation_m,
    )
    result = _rvo3d.step(
        position,
        velocity,
        preferred_velocity,
        [(neighbor_pos, neighbor_velocity) for neighbor_pos, neighbor_velocity, _identity in neighbors],
        time_step_s,
        neighbor_distance,
        len(neighbors),
        horizon_s,
        min_separation_m / 2.0,
        max_speed_mps,
    )
    safe_velocity = tuple(float(component) for component in result["velocity"])
    safe = np.asarray(safe_velocity, dtype=float)
    minimum = math.inf
    for neighbor_pos, neighbor_velocity, _identity_state in neighbors:
        relative_pos = np.asarray(neighbor_pos, dtype=float) - position_array
        relative_vel = np.asarray(neighbor_velocity, dtype=float) - safe
        speed_squared = float(relative_vel @ relative_vel)
        closest_time = 0.0 if speed_squared == 0.0 else float(np.clip(-(relative_pos @ relative_vel) / speed_squared, 0.0, horizon_s))
        minimum = min(minimum, float(np.linalg.norm(relative_pos + relative_vel * closest_time)))
    override = not np.allclose(safe, np.asarray(preferred_velocity, dtype=float), atol=1e-6)
    return SafetyFilterResult(_tuple3(safe), override, minimum, int(result["orca_plane_count"]))
