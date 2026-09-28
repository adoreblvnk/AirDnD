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
