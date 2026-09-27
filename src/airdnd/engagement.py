"""Time-stepped intercept engine for the section (9 shooters + 1 observer) doctrine.

Every drone flies continuously. A hostile is neutralized only when a friendly interceptor
physically reaches it: the closest approach during a physics step (a continuous segment test,
so fast closures are never skipped) falls inside the threat's kill radius. The interceptor is
expended in the collision. An interceptor that passes without contact has missed.

Coordination is by observation only (no messages). A shooter claims a hostile only if it
does not see another friendly already on a collision course with it (AIRDND.md 5.1), so each
hostile normally has one shooter at a time. Each section's observer hovers above the section,
watches the incoming tracks and takes the backup shot when its section misses (5.2, 5.4).

Local frame: x across the defended front, y out to sea along the threat axis, z up. The
launch pads sit at y = -700 (Marina East open field; see configs/theatre.json for the map).
"""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import math
from pathlib import Path
from typing import Any

import numpy as np

from .guidance import official_rvo2_filter
from .simulation import EvidenceEvent, SimulationMetrics, SimulationResult

CONFIGS = Path(__file__).resolve().parents[2] / "configs"
THREATS: dict[str, Any] = json.loads((CONFIGS / "threats.json").read_text(encoding="utf-8"))
THREAT_TYPES = {entry["id"]: entry for entry in THREATS["threat_types"]}
FORMATIONS = tuple(entry["id"] for entry in THREATS["formations"])
SIZING = THREATS["sizing"]

PHYSICS_DT_S = 0.1
RECORD_EVERY = 5  # one swarm_step frame per 0.5 s of flight
MAX_TIME_S = 300.0
INTERCEPTOR_SPEED_MPS = 45.0
INTERCEPTOR_ACCEL_MPS2 = 25.0
TRANSIT_SPEED_MPS = 18.0
MIN_SEPARATION_M = 8.0  # breach threshold between friendlies
RVO_SEPARATION_M = 10.0  # RVO2 keeps a margin above the breach threshold
RVO_NEIGHBORS = 8
RVO_RANGE_M = 80.0
SECTION_SPACING_M = 20.0  # 3x3 shooter spacing
OBSERVER_CLIMB_M = 40.0  # observer hovers this far above its section's top row
FRONT_WIDTH_M = 900.0
SCREEN_Y_M = 0.0
SCREEN_ALTITUDE_M = 150.0
RESERVE_Y_M = -250.0
RESERVE_ALTITUDE_M = 220.0
PAD_Y_M = -700.0
RESERVE_PAD_Y_M = -860.0
PAD_SPACING_M = 40.0
LAUNCH_STAGGER_S = 1.0
HOSTILE_START_Y_M = 3200.0
SECOND_WAVE_OFFSET_M = 1800.0
SECOND_WAVE_RELEASE_S = 60.0
DEFENDED_POINT = np.array([450.0, -900.0, 0.0])
LEAK_Y_M = -600.0  # a hostile that crosses the pads' line has leaked
COVERAGE_TOLERANCE_M = 15.0  # a friend "covers" a track if its course passes this close
# AIRDND.md 5.3 claim priority: each drone ranks itself against the friends it can SEE by
# distance to the track; rank k waits k * CLAIM_STEP_S before committing and cancels if it sees
# a friend start the attack first. The step must exceed the time a friend needs to become
# visibly committed (about 0.2 s at 25 m/s^2 reaching 5 m/s).
CLAIM_STEP_S = 0.3
MAX_CLAIM_WAIT_S = 1.5  # stop deferring to a closer friend that never goes
VISIBLE_COMMIT_SPEED_MPS = 1.0  # a drone leaving the hover is visible within one step
COMMIT_HEADING_TOLERANCE_DEG = 12.0
# Synthetic terminal guidance error (seeker noise, target jink). Drawn once per shot so hits
# and misses come from physical contact, with roughly this hit rate. Not a validated model.
NOMINAL_HIT_RATE = 0.75
ABORT_BATTERY = 0.25  # AIRDND.md 4.4: at or below this an interceptor returns to base
TRACK_NOISE_M = 1.0


@dataclass(frozen=True)
class ThreatConfig:
    threat_type: str = "medium"
    count: int = 12
    formation: str = "wedge"
    seed: int = 7
    method: str = "airdnd"  # "airdnd" (observed coverage) or "independent_greedy" (no coverage)

    def validate(self) -> None:
        if self.threat_type not in THREAT_TYPES:
            raise ValueError(f"threat_type must be one of {sorted(THREAT_TYPES)}")
        if self.formation not in FORMATIONS:
            raise ValueError(f"formation must be one of {FORMATIONS}")
        if not 1 <= self.count <= SIZING["max_hostiles"]:
            raise ValueError(f"count must be between 1 and {SIZING['max_hostiles']}")
        if self.method not in ("airdnd", "independent_greedy"):
            raise ValueError("method must be airdnd or independent_greedy")


@dataclass(frozen=True)
class ForcePlan:
    screen_sections: int
    reserve_sections: int

    @property
    def sections(self) -> int:
        return self.screen_sections + self.reserve_sections

    @property
    def shooters(self) -> int:
        return self.sections * SIZING["shooters_per_section"]

    @property
    def observers(self) -> int:
        return self.sections * SIZING["observers_per_section"]

    def to_dict(self) -> dict[str, int]:
        return {"screen_sections": self.screen_sections, "reserve_sections": self.reserve_sections, "sections": self.sections, "shooters": self.shooters, "observers": self.observers, "drones": self.shooters + self.observers}


def plan_force(hostiles: int) -> ForcePlan:
    """Activate the right size: one shooter per hostile in whole sections, plus a reserve."""
    shooters_needed = hostiles * SIZING["shooters_per_hostile"]
    screen = max(1, math.ceil(shooters_needed / SIZING["shooters_per_section"]))
    reserve = math.ceil(screen / SIZING["screen_sections_per_reserve_section"])
    return ForcePlan(screen, reserve)


def _section_ids(section_index: int) -> tuple[str, str]:
    platoon, section = divmod(section_index, 3)
    company, platoon = divmod(platoon, 3)
    letter = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"[company % 26]
    return f"{letter}{platoon + 1}-{section + 1}", f"{letter}{platoon + 1}"


def _section_xs(count: int) -> list[float]:
    width = 3 * PAD_SPACING_M  # widest footprint (the pads)
    if count == 1:
        return [(FRONT_WIDTH_M - width) / 2]
    pitch = (FRONT_WIDTH_M - width) / (count - 1)
    if pitch < width + PAD_SPACING_M:
        raise ValueError("front is too narrow for this many sections")
    return [i * pitch for i in range(count)]


def build_force(plan: ForcePlan) -> list[dict[str, Any]]:
    """Screen sections spread across the front; reserve sections behind and higher."""
    layout = [(x, SCREEN_Y_M, SCREEN_ALTITUDE_M, PAD_Y_M, "screen") for x in _section_xs(plan.screen_sections)]
    layout += [(x, RESERVE_Y_M, RESERVE_ALTITUDE_M, RESERVE_PAD_Y_M, "reserve") for x in _section_xs(plan.reserve_sections)]
    drones: list[dict[str, Any]] = []
    for section_index, (x0, y0, z0, pad_y, echelon) in enumerate(layout):
        section_id, platoon_id = _section_ids(section_index)
        base = len(drones)
        for slot in range(9):
            row, column = divmod(slot, 3)
            cell = np.array([x0 + column * SECTION_SPACING_M, y0 + row * SECTION_SPACING_M, z0 + row * 10.0])
            pad = np.array([x0 + column * PAD_SPACING_M, pad_y + row * PAD_SPACING_M, 2.0])
            drones.append({"index": base + slot, "id": f"I{base + slot:03d}", "callsign": f"{section_id}-{slot + 1}", "section": section_id, "platoon": platoon_id, "role": "shooter", "echelon": echelon, "cell": cell, "pad": pad})
        observer_cell = np.array([x0 + SECTION_SPACING_M, y0 + SECTION_SPACING_M, z0 + 20.0 + OBSERVER_CLIMB_M])
        observer_pad = np.array([x0 + 3 * PAD_SPACING_M, pad_y + PAD_SPACING_M, 2.0])
        drones.append({"index": base + 9, "id": f"I{base + 9:03d}", "callsign": f"{section_id}-OBS", "section": section_id, "platoon": platoon_id, "role": "observer", "echelon": echelon, "cell": observer_cell, "pad": observer_pad})
    return drones


def build_threat(config: ThreatConfig, rng: np.random.Generator) -> tuple[np.ndarray, np.ndarray, list[int]]:
    """Hostile start positions out at sea; every hostile flies at the defended point."""
    kind = THREAT_TYPES[config.threat_type]
    low, high = kind["altitude_m"]
    n = config.count
    starts = np.zeros((n, 3))
    waves = [0] * n
    spacing = 40.0 + 10.0 * kind["size_m"]
    per_wave = math.ceil(n / 2)
    for i in range(n):
        if config.formation == "line":
            offset = ((i - (n - 1) / 2) * 3 * spacing, 0.0)
        elif config.formation == "wedge":
            rank, side = (i + 1) // 2, (-1 if i % 2 else 1)
            offset = (side * rank * 2 * spacing, rank * 1.5 * spacing)
        elif config.formation == "column":
            offset = (0.0, i * 2 * spacing)
        elif config.formation == "cluster":
            offset = tuple(rng.normal(0.0, spacing * math.sqrt(n) / 2, 2))
        else:  # waves: two lines abreast, the second far behind and released later
            wave, slot = divmod(i, per_wave)
            waves[i] = wave
            offset = ((slot - (per_wave - 1) / 2) * 3 * spacing, wave * SECOND_WAVE_OFFSET_M)
        starts[i] = [450.0 + offset[0], HOSTILE_START_Y_M + offset[1], rng.uniform(low, high)]
    velocities = np.zeros((n, 3))
    for i in range(n):
        heading = DEFENDED_POINT - starts[i]
        heading[2] = 0.0
        velocities[i] = heading / np.linalg.norm(heading) * kind["speed_mps"]
    return starts, velocities, waves


def _local_id(agent_id: str, hostile_id: str) -> str:
    return f"{agent_id}-{hashlib.sha256(f'{agent_id}:{hostile_id}'.encode()).hexdigest()[:8]}"


def _closest_approach(a0: np.ndarray, a1: np.ndarray, b0: np.ndarray, b1: np.ndarray) -> float:
    """Minimum distance between two points moving linearly over one step."""
    d0 = a0 - b0
    dv = (a1 - a0) - (b1 - b0)
    denominator = float(dv @ dv)
    t = 0.0 if denominator == 0.0 else float(np.clip(-(d0 @ dv) / denominator, 0.0, 1.0))
    return float(np.linalg.norm(d0 + dv * t))


def collision_course(position: np.ndarray, target: np.ndarray, target_velocity: np.ndarray, speed: float) -> tuple[np.ndarray, float | None]:
    """Aim point and time for a constant-bearing intercept at ``speed`` (None if unreachable)."""
    d = target - position
    a = float(target_velocity @ target_velocity) - speed * speed
    b = 2.0 * float(d @ target_velocity)
    c = float(d @ d)
    if abs(a) < 1e-9:
        t = -c / b if b < 0 else None
    else:
        disc = b * b - 4 * a * c
        if disc < 0:
            return target, None
        roots = [r for r in ((-b - math.sqrt(disc)) / (2 * a), (-b + math.sqrt(disc)) / (2 * a)) if r > 0]
        t = min(roots) if roots else None
    return (target + target_velocity * t, t) if t is not None else (target, None)


def _cpa(position: np.ndarray, velocity: np.ndarray, target: np.ndarray, target_velocity: np.ndarray, horizon_s: float = 120.0) -> float:
    """Predicted closest approach if both keep their current velocity."""
    rel_p = target - position
    rel_v = target_velocity - velocity
    speed2 = float(rel_v @ rel_v)
    t = 0.0 if speed2 == 0.0 else float(np.clip(-(rel_p @ rel_v) / speed2, 0.0, horizon_s))
    return float(np.linalg.norm(rel_p + rel_v * t))


def run_engagement(config: ThreatConfig) -> SimulationResult:
    config.validate()
    kind = THREAT_TYPES[config.threat_type]
    rng = np.random.default_rng(config.seed)
    plan = plan_force(config.count)
    force = build_force(plan)
    hostile_pos, hostile_vel, waves = build_threat(config, rng)
    n = len(force)
    pads = np.array([d["pad"] for d in force], dtype=float)
    cells = np.array([d["cell"] for d in force], dtype=float)
    pos = pads.copy()
    vel = np.zeros((n, 3))
    battery = np.ones(n)
    state = ["pad"] * n  # pad, launching, station, committed, returning (to cell), rtb (to pad), docked, expended
    target: list[int | None] = [None] * n
    aim_bias: list[np.ndarray] = [np.zeros(3)] * n
    hostile_ids = [f"H{i:03d}" for i in range(config.count)]
    h_state = ["pending" if w > 0 else "inbound" for w in waves]
    release_s = [0.0 if w == 0 else SECOND_WAVE_RELEASE_S for w in waves]
    attempts: dict[int, list[int]] = {h: [] for h in range(config.count)}
    launch_at = [(d["index"] // 10) * LAUNCH_STAGGER_S for d in force]
    detection = float(kind["detection_range_m"])
    kill_radius = float(kind["kill_radius_m"])
    sigma = kill_radius / math.sqrt(-2.0 * math.log(1.0 - NOMINAL_HIT_RATE))
    track_rng = np.random.default_rng(config.seed + 1_000)
    shot_rng = np.random.default_rng(config.seed + 2_000)
    events: list[EvidenceEvent] = []
    counters = {"duplicate": 0, "backup": 0, "collision": 0, "miss": 0}
    min_separation = math.inf

    def emit(time_s: float, kind_name: str, truth: dict[str, Any], local: dict[str, Any], label: str) -> None:
        events.append(EvidenceEvent(round(time_s, 6), kind_name, truth, local, {"frame": len(events), "label": label}))

    emit(0.0, "swarm_initialized", {
        "formation": "sections_9_plus_observer",
        "threat": {"type": config.threat_type, "title": kind["title"], "count": config.count, "formation": config.formation, "speed_mps": kind["speed_mps"], "kill_radius_m": kill_radius, "detection_range_m": detection},
        "force_plan": plan.to_dict(),
        "interceptors": [
            {"interceptor_id": d["id"], "callsign": d["callsign"], "company": d["platoon"][0], "platoon": d["platoon"], "section": d["section"], "role": d["role"],
             "phase": "reserve" if d["echelon"] == "reserve" else "initial", "position": d["pad"].round(3).tolist(), "cell": d["cell"].round(3).tolist(), "battery": 1.0}
            for d in force
        ],
        "hostiles": [{"hostile_id": hostile_ids[h], "position": hostile_pos[h].round(3).tolist(), "wave": waves[h]} for h in range(config.count)],
    }, {}, f"Activate {plan.sections} sections: {plan.shooters} shooters + {plan.observers} observers vs {config.count} {kind['title'].lower()}")

    def track(h: int) -> np.ndarray:
        return hostile_pos[h] + track_rng.normal(0.0, TRACK_NOISE_M, 3)

    def seen_covering_friend(i: int, h: int, estimate: np.ndarray) -> int | None:
        """Does drone i SEE another friend on a collision course with hostile h? No messages."""
        cos_limit = math.cos(math.radians(COMMIT_HEADING_TOLERANCE_DEG))
        for j in range(n):
            speed = float(np.linalg.norm(vel[j]))
            if j == i or state[j] != "committed" or speed < VISIBLE_COMMIT_SPEED_MPS:
                continue
            # 5.1: heading consistent with a collision course on this track, as i sees it.
            aim, t_hit = collision_course(pos[j], estimate, hostile_vel[h], INTERCEPTOR_SPEED_MPS)
            if t_hit is None:
                continue
            course = aim - pos[j]
            if float(course @ vel[j]) / max(1e-6, float(np.linalg.norm(course)) * speed) >= cos_limit:
                return j
            if _cpa(pos[j], vel[j], estimate, hostile_vel[h]) <= COVERAGE_TOLERANCE_M:
                return j
        return None

    def disengage(i: int, now: float) -> None:
        """After a miss or stand-down: back to the home cell, or home to base if battery is low."""
        target[i] = None
        if battery[i] <= ABORT_BATTERY:
            state[i] = "rtb"
            emit(now, "abort", {"interceptor_id": force[i]["id"], "battery": round(float(battery[i]), 4)}, {"agent_id": force[i]["id"], "action": "ABORT", "battery": round(float(battery[i]), 4), "lifecycle_state": "returning"}, f"{force[i]['callsign']} ABORT ? battery {battery[i]:.0%}")
        else:
            state[i] = "returning"

    def current_shooters(h: int) -> list[int]:
        return [j for j in range(n) if state[j] == "committed" and target[j] == h]

    def commit(i: int, h: int, now: float, trigger: str) -> None:
        others = current_shooters(h)
        state[i], target[i] = "committed", h
        attempts[h].append(i)
        los = hostile_pos[h] - pos[i]
        los /= max(1e-6, float(np.linalg.norm(los)))
        side = np.cross(los, [0.0, 0.0, 1.0])
        side /= max(1e-6, float(np.linalg.norm(side)))
        up = np.cross(side, los)
        error = shot_rng.normal(0.0, sigma, 2)
        aim_bias[i] = side * error[0] + up * error[1]
        backup = force[i]["role"] == "observer"
        counters["backup"] += backup
        emit(now, "observer_claim" if backup else "policy_decision", {"hostile_id": hostile_ids[h], "interceptor_id": force[i]["id"]},
             {"agent_id": force[i]["id"], "local_track_id": _local_id(force[i]["id"], hostile_ids[h]), "trigger": trigger, "battery": round(float(battery[i]), 4)},
             f"{force[i]['callsign']} {'backs up on' if backup else 'commits to'} {hostile_ids[h]}")
        if others:
            counters["duplicate"] += 1
            emit(now, "duplicate_pursuit", {"hostile_id": hostile_ids[h], "interceptor_id": force[i]["id"], "already_committed": [force[j]["id"] for j in others]},
                 {"agent_id": force[i]["id"], "cause": "commitment_not_observed" if config.method == "airdnd" else "independent_local_choice"}, f"{force[i]['callsign']} duplicates on {hostile_ids[h]}")

    pending: dict[int, tuple[int, float, str]] = {}  # drone -> (hostile, commit time, trigger)
    pending_since: dict[int, float] = {}

    def looks_available(j: int) -> bool:
        """What another drone can see: hovering, or committed but not yet visibly moving."""
        return state[j] == "station" or (state[j] == "committed" and float(np.linalg.norm(vel[j])) < VISIBLE_COMMIT_SPEED_MPS)

    def claim_rank(i: int, h: int, estimate: np.ndarray, role: str) -> int:
        """Drone i's own priority for h: how many closer friends still look available."""
        mine = float(np.linalg.norm(estimate - pos[i]))
        return sum(
            1 for j in range(n)
            if j != i and force[j]["role"] == role and looks_available(j)
            and float(np.linalg.norm(estimate - pos[j])) < min(mine, detection)
        )

    def propose(i: int, h: int, now: float, trigger: str, estimate: np.ndarray) -> None:
        rank = claim_rank(i, h, estimate, force[i]["role"])
        pending[i] = (h, now + rank * CLAIM_STEP_S, trigger)
        pending_since[i] = now

    def resolve_pending(now: float) -> None:
        for i, (h, due, trigger) in list(pending.items()):
            if state[i] != "station" or h_state[h] != "inbound":
                pending.pop(i)
                continue
            estimate = track(h)
            if config.method == "airdnd" and seen_covering_friend(i, h, estimate) is not None:
                pending.pop(i)  # a friend visibly committed first: stand down, stay on station
                continue
            if now >= due:
                # Re-check priority: a closer friend that still looks available goes first,
                # unless it has been given MAX_CLAIM_WAIT_S and still has not moved.
                waited = now - pending_since.get(i, now)
                if claim_rank(i, h, estimate, force[i]["role"]) > 0 and waited < MAX_CLAIM_WAIT_S and force[i]["role"] == "shooter":
                    pending[i] = (h, now + CLAIM_STEP_S, trigger)
                    continue
                pending.pop(i)
                pending_since.pop(i, None)
                commit(i, h, now, trigger)

    observers_available = lambda: any(force[j]["role"] == "observer" and state[j] == "station" for j in range(n))  # noqa: E731
    launched_sections: set[str] = set()
    time_s = 0.0
    for step in range(int(MAX_TIME_S / PHYSICS_DT_S)):
        time_s = round(step * PHYSICS_DT_S, 6)
        for h in range(config.count):
            if h_state[h] == "pending" and time_s >= release_s[h]:
                h_state[h] = "inbound"
        released = {waves[h] for h in range(config.count) if h_state[h] != "pending"}
        for wave in sorted(released):
            if wave > 0 and not any(e.kind == "wave_detected" and e.truth["wave"] == wave + 1 for e in events):
                emit(time_s, "wave_detected", {"wave": wave + 1, "hostile_ids": [hostile_ids[h] for h in range(config.count) if waves[h] == wave], "scheduled_time_s": release_s[waves.index(wave)], "delayed_by_s": 0.0}, {}, f"WAVE {wave + 1} DETECTED")

        for i, drone in enumerate(force):
            if state[i] == "pad" and time_s >= launch_at[i]:
                state[i] = "launching"
                if drone["section"] not in launched_sections:
                    launched_sections.add(drone["section"])
                    emit(time_s, "section_launch", {"section": drone["section"], "interceptor_ids": [f["id"] for f in force if f["section"] == drone["section"]]}, {"agent_id": drone["id"], "action": "LAUNCH"}, f"{drone['section']} launches from Marina East")

        inbound = [h for h in range(config.count) if h_state[h] == "inbound"]
        # Shooters on station: nearest uncovered track in sensor range. Tracks that have
        # already been shot at are left to the observers while any observer is on station.
        for i, drone in enumerate(force):
            if drone["role"] != "shooter" or state[i] != "station" or i in pending:
                continue
            choices = []
            for h in inbound:
                if i in attempts[h] or (attempts[h] and observers_available()):
                    continue
                estimate = track(h)
                distance = float(np.linalg.norm(estimate - pos[i]))
                if distance > detection:
                    continue
                if config.method == "airdnd" and seen_covering_friend(i, h, estimate) is not None:
                    continue
                choices.append((distance, h))
            if choices:
                distance, h = min(choices)
                if config.method == "airdnd":
                    propose(i, h, time_s, "locally_observed_uncovered_track", track(h))
                else:
                    commit(i, h, time_s, "independent_local_choice")
        # Observers: back up a track their own section shot at and missed.
        for i, drone in enumerate(force):
            if drone["role"] != "observer" or state[i] != "station" or i in pending:
                continue
            for h in inbound:
                if not any(force[j]["section"] == drone["section"] for j in attempts[h]) or i in attempts[h]:
                    continue
                estimate = track(h)
                if float(np.linalg.norm(estimate - pos[i])) > detection:
                    continue
                if seen_covering_friend(i, h, estimate) is not None or current_shooters(h):
                    continue
                pending[i] = (h, time_s, "observed_section_miss")  # own section's backup goes first
                break
        # Tracks still unclaimed after a miss (section observer gone): any observer may take them.
        for h in inbound:
            if attempts[h] and not current_shooters(h) and not any(p[0] == h for p in pending.values()):
                for i, drone in enumerate(force):
                    if drone["role"] == "observer" and state[i] == "station" and i not in attempts[h] and i not in pending:
                        estimate = track(h)
                        if float(np.linalg.norm(estimate - pos[i])) <= detection and seen_covering_friend(i, h, estimate) is None:
                            propose(i, h, time_s + CLAIM_STEP_S, "observed_uncovered_after_miss", estimate)
        resolve_pending(time_s)

        new_pos = pos.copy()
        for i in range(n):
            if state[i] in ("pad", "docked", "expended"):
                continue
            if state[i] == "committed":
                h = target[i]
                aim, _t = collision_course(pos[i], track(h) + aim_bias[i], hostile_vel[h], INTERCEPTOR_SPEED_MPS)
                direction = aim - pos[i]
                preferred = direction / max(1e-6, float(np.linalg.norm(direction))) * INTERCEPTOR_SPEED_MPS
            else:
                goal = pads[i] if state[i] == "rtb" else cells[i]
                offset = goal - pos[i]
                distance = float(np.linalg.norm(offset))
                preferred = np.zeros(3) if distance < 0.3 else offset / distance * min(TRANSIT_SPEED_MPS, distance / PHYSICS_DT_S)
            delta = preferred - vel[i]
            limit = INTERCEPTOR_ACCEL_MPS2 * PHYSICS_DT_S
            if float(np.linalg.norm(delta)) > limit:
                preferred = vel[i] + delta * (limit / float(np.linalg.norm(delta)))
            # RVO2-3D keeps friendlies apart; the hostile is deliberately not an obstacle.
            distances = np.linalg.norm(pos - pos[i], axis=1)
            near = [int(j) for j in np.argsort(distances) if int(j) != i and state[int(j)] not in ("pad", "docked", "expended") and distances[int(j)] < RVO_RANGE_M][:RVO_NEIGHBORS]
            safety = official_rvo2_filter(tuple(pos[i]), tuple(vel[i]), tuple(preferred), [(tuple(pos[j]), tuple(vel[j]), "FRIENDLY") for j in near], RVO_SEPARATION_M, 2.0, PHYSICS_DT_S, INTERCEPTOR_SPEED_MPS)
            vel[i] = np.asarray(safety.velocity)
            new_pos[i] = pos[i] + vel[i] * PHYSICS_DT_S
            battery[i] = max(0.0, battery[i] - (0.0003 if state[i] == "station" else 0.001))

        new_hostile = hostile_pos.copy()
        for h in inbound:
            new_hostile[h] = hostile_pos[h] + hostile_vel[h] * PHYSICS_DT_S

        for i in range(n):
            if state[i] != "committed":
                continue
            h = target[i]
            if h_state[h] != "inbound":
                disengage(i, time_s)
                continue
            miss_distance = _closest_approach(pos[i], new_pos[i], hostile_pos[h], new_hostile[h])
            if miss_distance <= kill_radius:
                contact = (new_pos[i] + new_hostile[h]) / 2.0
                h_state[h], state[i] = "neutralized", "expended"
                new_pos[i] = new_hostile[h] = contact
                vel[i] = 0.0
                emit(time_s + PHYSICS_DT_S, "neutralized", {"hostile_id": hostile_ids[h], "interceptor_id": force[i]["id"], "contact_point": contact.round(3).tolist(), "miss_distance_m": round(miss_distance, 3), "kill_radius_m": kill_radius},
                     {"agent_id": force[i]["id"], "track_status": "removed", "lifecycle_state": "expended"}, f"{force[i]['callsign']} intercepts {hostile_ids[h]}")
                for j in current_shooters(h):
                    disengage(j, time_s + PHYSICS_DT_S)
                    emit(time_s + PHYSICS_DT_S, "claim_cancelled", {"hostile_id": hostile_ids[h], "interceptor_id": force[j]["id"]}, {"agent_id": force[j]["id"], "trigger": "observed_intercept"}, f"{force[j]['callsign']} stands down")
                continue
            rel = new_hostile[h] - new_pos[i]
            opening = float(rel @ (hostile_vel[h] - vel[i])) > 0.0
            if opening and float(np.linalg.norm(rel)) < 80.0:
                counters["miss"] += 1
                disengage(i, time_s + PHYSICS_DT_S)
                closest = min(miss_distance, float(np.linalg.norm(rel)))
                emit(time_s + PHYSICS_DT_S, "engagement_attempt", {"hostile_id": hostile_ids[h], "interceptor_id": force[i]["id"], "outcome": False, "miss_distance_m": round(closest, 3), "kill_radius_m": kill_radius},
                     {"agent_id": force[i]["id"], "lifecycle_state": "returning"}, f"{force[i]['callsign']} misses {hostile_ids[h]} by {closest:.1f} m")
                if not current_shooters(h):
                    emit(time_s + PHYSICS_DT_S, "coverage_expired", {"hostile_id": hostile_ids[h]}, {}, f"{hostile_ids[h]} survives · coverage expired")

        pos, hostile_pos = new_pos, new_hostile
        for i in range(n):
            if state[i] == "launching" and float(np.linalg.norm(pos[i] - cells[i])) < 1.0:
                state[i] = "station"
            elif state[i] == "returning" and float(np.linalg.norm(pos[i] - cells[i])) < 1.0:
                state[i] = "station"
            elif state[i] == "rtb" and float(np.linalg.norm(pos[i] - pads[i])) < 1.0:
                state[i], vel[i] = "docked", 0.0
                emit(time_s, "rth_docked", {"interceptor_id": force[i]["id"], "docking_error_m": round(float(np.linalg.norm(pos[i] - pads[i])), 3)}, {"agent_id": force[i]["id"], "lifecycle_state": "docked"}, f"{force[i]['callsign']} docked")
        for h in range(config.count):
            if h_state[h] == "inbound" and hostile_pos[h][1] <= LEAK_Y_M:
                h_state[h] = "leaked"
                for j in current_shooters(h):
                    disengage(j, time_s)
                emit(time_s, "hostile_leaked", {"hostile_id": hostile_ids[h], "position": hostile_pos[h].round(3).tolist()}, {}, f"{hostile_ids[h]} LEAKED")

        airborne = [i for i in range(n) if state[i] not in ("pad", "docked", "expended")]
        separation = math.inf
        if len(airborne) > 1:
            points = pos[airborne]
            diff = points[:, None, :] - points[None, :, :]
            distances = np.sqrt((diff**2).sum(-1))
            np.fill_diagonal(distances, np.inf)
            separation = float(distances.min())
            min_separation = min(min_separation, separation)
            if separation < MIN_SEPARATION_M:
                counters["collision"] += 1
                emit(time_s, "friendly_collision", {"separation_m": separation}, {"safety_breach_observed": True}, "minimum separation breach")
        if step % RECORD_EVERY == 0:
            emit(time_s, "swarm_step", {
                "positions": {force[i]["id"]: pos[i].round(2).tolist() for i in airborne},
                "hostiles": {hostile_ids[h]: hostile_pos[h].round(2).tolist() for h in range(config.count) if h_state[h] == "inbound"},
                "states": {force[i]["id"]: state[i] for i in airborne},
                "targets": {force[i]["id"]: hostile_ids[target[i]] for i in airborne if target[i] is not None},
                "nearest_friendly_separation_m": None if not math.isfinite(separation) else round(separation, 3),
            }, {}, "flight")
        done = all(s in ("neutralized", "leaked") for s in h_state)
        if done and all(state[i] in ("station", "docked", "expended") for i in range(n)):
            break

    for h in range(config.count):
        if h_state[h] in ("inbound", "pending"):
            h_state[h] = "leaked"
            emit(time_s, "hostile_leaked", {"hostile_id": hostile_ids[h]}, {}, f"{hostile_ids[h]} LEAKED (time limit)")
    neutralized = h_state.count("neutralized")
    emit(time_s, "simulation_completed", {"processed_hostiles": config.count, "expected_hostiles": config.count, "neutralized": neutralized, "misses": counters["miss"], "backups": counters["backup"]}, {}, "simulation completed")
    metrics = SimulationMetrics(
        hostiles_total=config.count,
        neutralized=neutralized,
        leaked=config.count - neutralized,
        duplicate_pursuits=counters["duplicate"],
        recovery_count=counters["backup"],
        cumulative_neutralization=neutralized / config.count,
        retained_coverage=sum(s == "station" for s in state) / n,
        minimum_separation_m=min_separation,
        friendly_collisions=counters["collision"],
        entity_drops=0,
        completed=True,
        rf_ground_messages=0,
        rf_interdrone_messages=0,
        target_assignment_messages=0,
        safety_filter="snape/RVO2-3D",
    )
    return SimulationResult(config, metrics, tuple(events))  # type: ignore[arg-type]
