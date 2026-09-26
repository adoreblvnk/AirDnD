from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum

Vector3 = tuple[float, float, float]


class EntityKind(str, Enum):
    INTERCEPTOR = "interceptor"
    HOSTILE = "hostile"


@dataclass(frozen=True)
class SimulatorTruth:
    """Evaluator-only world truth; never supplied to an agent policy."""

    time_s: float
    positions: dict[str, Vector3]
    velocities: dict[str, Vector3] = field(default_factory=dict)
    alive: dict[str, bool] = field(default_factory=dict)


@dataclass
class AgentLocalState:
    """One agent's onboard estimate and locally assigned track identities."""

    agent_id: str
    estimated_position: Vector3
    estimated_velocity: Vector3 = (0.0, 0.0, 0.0)
    covariance_diag: Vector3 = (1.0, 1.0, 1.0)
    tracks: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True)
class PresentationState:
    """UI/replay selection state with no simulator world state embedded."""

    frame: int
    selected_agent: str | None = None
    evaluator_overlay: bool = False


@dataclass(frozen=True)
class GridCell:
    cell_id: str
    tier: int
    position: Vector3
    sector_priority: int


def generate_staggered_grid(
    count: int,
    columns: int,
    spacing_m: float,
    base_altitude_m: float,
    tier_step_m: float,
) -> list[GridCell]:
    if count < 0 or columns <= 0 or spacing_m <= 0:
        raise ValueError("count must be non-negative and grid dimensions positive")
    cells: list[GridCell] = []
    for index in range(count):
        tier = index // columns
        column = index % columns
        x = column * spacing_m + (spacing_m / 2 if tier % 2 else 0.0)
        cells.append(
            GridCell(
                cell_id=f"C{tier}-{column}",
                tier=tier,
                position=(x, tier * spacing_m, base_altitude_m + tier * tier_step_m),
                sector_priority=column,
            )
        )
    return cells
