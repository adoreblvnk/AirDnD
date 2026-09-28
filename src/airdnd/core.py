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


SECTION_ROWS = 3
SECTION_COLUMNS = 3
SECTION_SIZE = SECTION_ROWS * SECTION_COLUMNS  # 9 drones: 3 rows of 3
SECTIONS_PER_PLATOON = 3  # 27 drones
PLATOONS_PER_COMPANY = 3  # 81 drones
COMPANY_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"


@dataclass(frozen=True)
class FormationSlot:
    """One drone's place in the section -> platoon -> company order of battle."""

    agent_index: int
    company: str
    platoon: int
    section: int
    row: int
    column: int
    position: Vector3

    @property
    def callsign(self) -> str:
        # e.g. "A1-2-5": company A, 1st platoon, 2nd section, 5th drone of that section.
        return f"{self.company}{self.platoon}-{self.section}-{self.row * SECTION_COLUMNS + self.column + 1}"

    @property
    def section_id(self) -> str:
        return f"{self.company}{self.platoon}-{self.section}"

    @property
    def platoon_id(self) -> str:
        return f"{self.company}{self.platoon}"


def generate_section_formation(
    count: int,
    initial_count: int | None = None,
    front_width_m: float = 900.0,
    drone_spacing_m: float = 20.0,
    rear_offset_m: float = 200.0,
    base_altitude_m: float = 250.0,
    row_step_m: float = 10.0,
    reserve_climb_m: float = 100.0,
) -> list[FormationSlot]:
    """Lay drones out as 3x3 sections, 3 sections per platoon, 3 platoons per company.

    Sections holding the first ``initial_count`` drones form the screen line at y=0; the
    remaining (reserve) sections wait in a rear echelon ``rear_offset_m`` behind it and
    ``reserve_climb_m`` above it, so reserves observe the active layer from a higher plane.
    Each echelon's sections are spread evenly across the defended front (x). Inside a section
    the three rows are stacked in depth (y) and stepped up in altitude so neighbouring rows
    never share a flight level. Partial units fill in order, so any count is valid.
    """
    if count < 0 or min(front_width_m, drone_spacing_m, rear_offset_m) <= 0:
        raise ValueError("count must be non-negative and dimensions positive")
    initial = count if initial_count is None else max(0, min(count, initial_count))
    section_width = (SECTION_COLUMNS - 1) * drone_spacing_m
    per_platoon = SECTION_SIZE * SECTIONS_PER_PLATOON
    per_company = per_platoon * PLATOONS_PER_COMPANY
    section_count = -(-count // SECTION_SIZE)
    # A section belongs to the screen if its first drone is an initial (non-reserve) drone.
    front_sections = [s for s in range(section_count) if s * SECTION_SIZE < initial]
    rear_sections = [s for s in range(section_count) if s * SECTION_SIZE >= initial]

    def section_x(section_index: int) -> float:
        echelon = front_sections if section_index in front_sections else rear_sections
        position = echelon.index(section_index)
        if len(echelon) == 1:
            return (front_width_m - section_width) / 2.0
        pitch = (front_width_m - section_width) / (len(echelon) - 1)
        if pitch < section_width + drone_spacing_m:
            raise ValueError("front is too narrow for this many sections")
        return position * pitch

    slots: list[FormationSlot] = []
    for index in range(count):
        company, remainder = divmod(index, per_company)
        platoon, remainder = divmod(remainder, per_platoon)
        section, slot = divmod(remainder, SECTION_SIZE)
        row, column = divmod(slot, SECTION_COLUMNS)
        section_index = index // SECTION_SIZE
        echelon_y = 0.0 if section_index in front_sections else -rear_offset_m
        x = section_x(section_index) + column * drone_spacing_m
        y = echelon_y + row * drone_spacing_m
        z = base_altitude_m + row * row_step_m + (0.0 if section_index in front_sections else reserve_climb_m)
        slots.append(
            FormationSlot(
                agent_index=index,
                company=COMPANY_LETTERS[company % len(COMPANY_LETTERS)],
                platoon=platoon + 1,
                section=section + 1,
                row=row,
                column=column,
                position=(float(x), float(y), float(z)),
            )
        )
    return slots
