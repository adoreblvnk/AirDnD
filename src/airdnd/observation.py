from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
import hashlib
import math

import numpy as np

from .core import Vector3


@dataclass(frozen=True)
class LocalTrack:
    local_id: str
    position: Vector3
    velocity: Vector3
    covariance_diag: Vector3
    age_s: float = 0.0


class LocalTracker:
    def __init__(self, agent_id: str, seed: int, noise_std_m: float = 2.0):
        self.agent_id = agent_id
        self.seed = seed
        self.noise_std_m = noise_std_m

    def observe(
        self,
        truth: dict[str, tuple[Vector3, Vector3]],
        observer_position: Vector3,
        sensor_range_m: float,
    ) -> list[LocalTrack]:
        rng = np.random.default_rng(self.seed)
        tracks: list[LocalTrack] = []
        for source_id, (position, velocity) in sorted(truth.items()):
            if math.dist(position, observer_position) > sensor_range_m:
                continue
            digest = hashlib.sha256(f"{self.agent_id}:{source_id}".encode()).hexdigest()[:8]
            noise = rng.normal(0.0, self.noise_std_m, 3)
            noisy_position = tuple(float(position[i] + noise[i]) for i in range(3))
            tracks.append(
                LocalTrack(
                    local_id=f"{self.agent_id}-{digest}",
                    position=noisy_position,
                    velocity=velocity,
                    covariance_diag=(self.noise_std_m**2,) * 3,
                )
            )
        return tracks


@dataclass(frozen=True)
class NavigationState:
    position: Vector3
    velocity: Vector3
    covariance_diag: Vector3


class NavigationFilter:
    """Minimal simulated MEMS INS with a scalar barometric z update."""

    def __init__(self, position: Vector3, accel_bias: Vector3 = (0.0, 0.0, 0.0)):
        self.position = np.array(position, dtype=float)
        self.velocity = np.zeros(3)
        self.accel_bias = np.array(accel_bias, dtype=float)
        self.covariance = np.ones(3)

    def step(self, measured_accel: Vector3, baro_altitude_m: float, dt: float) -> NavigationState:
        acceleration = np.asarray(measured_accel) + self.accel_bias
        self.position += self.velocity * dt + 0.5 * acceleration * dt**2
        self.velocity += acceleration * dt
        self.covariance[:2] += 0.2 * dt
        self.covariance[2] += 0.05 * dt
        baro_gain = 0.8
        self.position[2] += baro_gain * (baro_altitude_m - self.position[2])
        self.covariance[2] *= 1.0 - baro_gain
        return NavigationState(
            tuple(float(x) for x in self.position),
            tuple(float(x) for x in self.velocity),
            tuple(float(x) for x in self.covariance),
        )


@dataclass(frozen=True)
class MemsNavigationState:
    position: Vector3
    velocity: Vector3
    covariance_diag: Vector3
    heading_error_rad: float
    accelerometer_bias: Vector3
    gyroscope_bias_rad_s: float
    barometer_bias_m: float


class MemsNavigationFilter:
    """Strapdown MEMS INS with gyro drift, barometric aid, and reverse-path memory."""

    def __init__(self, position: Vector3, seed: int):
        rng = np.random.default_rng(seed)
        self._rng = rng
        self.position = np.asarray(position, dtype=float)
        self.velocity = np.zeros(3, dtype=float)
        self.accel_bias = rng.normal(0.0, 0.0005, 3)
        self.gyro_bias = float(rng.normal(0.0, math.radians(0.001)))
        self.baro_bias = float(rng.normal(0.0, 0.8))
        self.heading_error = 0.0
        self.covariance = np.asarray((1.0, 1.0, 0.5), dtype=float)
        self.path_memory: list[Vector3] = [position]

    def step(
        self,
        true_acceleration: Vector3,
        true_heading_rate_rad_s: float,
        true_altitude_m: float,
        dt: float,
        remember_path: bool = True,
    ) -> MemsNavigationState:
        accel_noise = self._rng.normal(0.0, 0.003, 3)
        gyro_noise = float(self._rng.normal(0.0, math.radians(0.003)))
        self.accel_bias += self._rng.normal(0.0, 0.00001, 3) * math.sqrt(dt)
        self.gyro_bias += float(self._rng.normal(0.0, math.radians(0.00002))) * math.sqrt(dt)
        self.baro_bias += float(self._rng.normal(0.0, 0.003)) * math.sqrt(dt)
        measured_heading_rate = true_heading_rate_rad_s + self.gyro_bias + gyro_noise
        self.heading_error += (measured_heading_rate - true_heading_rate_rad_s) * dt
        c, s = math.cos(self.heading_error), math.sin(self.heading_error)
        horizontal_rotation = np.asarray(((c, -s), (s, c)))
        measured_acceleration = np.asarray(true_acceleration, dtype=float) + self.accel_bias + accel_noise
        measured_acceleration[:2] = horizontal_rotation @ measured_acceleration[:2]
        self.position += self.velocity * dt + 0.5 * measured_acceleration * dt**2
        self.velocity += measured_acceleration * dt
        self.covariance[:2] += (0.08 + abs(self.heading_error) * 0.4) * dt
        self.covariance[2] += 0.025 * dt
        barometer = true_altitude_m * 1.0004 + self.baro_bias + float(self._rng.normal(0.0, 0.45))
        baro_gain = 0.34
        self.position[2] += baro_gain * (barometer - self.position[2])
        self.covariance[2] *= 1.0 - baro_gain
        if remember_path and (
            len(self.path_memory) == 1
            or np.linalg.norm(self.position - np.asarray(self.path_memory[-1], dtype=float)) >= 12.0
        ):
            self.path_memory.append(tuple(float(value) for value in self.position))
        return self.state

    @property
    def state(self) -> MemsNavigationState:
        return MemsNavigationState(
            tuple(float(value) for value in self.position),
            tuple(float(value) for value in self.velocity),
            tuple(float(value) for value in self.covariance),
            self.heading_error,
            tuple(float(value) for value in self.accel_bias),
            self.gyro_bias,
            self.baro_bias,
        )

    def reverse_waypoints(self, base_altitude_m: float = 4.0, descent_step_m: float = 50.0) -> list[Vector3]:
        """Replay the outbound INS estimate in reverse with barometric step-down gates."""
        if not self.path_memory:
            return []
        descending: list[Vector3] = []
        ceiling = math.ceil(self.position[2] / descent_step_m) * descent_step_m
        for point in reversed(self.path_memory):
            ceiling = max(base_altitude_m, min(ceiling, math.ceil(point[2] / descent_step_m) * descent_step_m))
            descending.append((point[0], point[1], ceiling))
            if len(descending) % 3 == 0:
                ceiling = max(base_altitude_m, ceiling - descent_step_m)
        origin = self.path_memory[0]
        descending.append((origin[0], origin[1], base_altitude_m))
        return descending


class IdentityState(str, Enum):
    CONFIRMED_FRIENDLY = "CONFIRMED FRIENDLY"
    FRIENDLY_LINEAGE = "FRIENDLY LINEAGE"
    UNKNOWN = "UNKNOWN"
    HOSTILE_EVIDENCE = "HOSTILE EVIDENCE"


class IFFMachine:
    def update(
        self,
        *,
        lineage: bool,
        beacon_valid: bool,
        beacon_bound: bool,
        hostile_evidence: bool,
    ) -> IdentityState:
        if beacon_valid and beacon_bound and lineage:
            return IdentityState.CONFIRMED_FRIENDLY
        if hostile_evidence and not lineage:
            return IdentityState.HOSTILE_EVIDENCE
        if lineage:
            return IdentityState.FRIENDLY_LINEAGE
        return IdentityState.UNKNOWN
