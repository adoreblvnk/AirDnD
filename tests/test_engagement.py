import functools

from fastapi.testclient import TestClient
import pytest

from airdnd.api import create_app
from airdnd.engagement import THREAT_TYPES, ThreatConfig, build_force, plan_force, run_engagement


@functools.lru_cache(maxsize=None)
def _run(threat_type="medium", count=12, formation="wedge", seed=7, method="airdnd"):
    return run_engagement(ThreatConfig(threat_type, count, formation, seed, method))


def test_force_plan_activates_whole_sections_with_one_shooter_per_hostile_and_a_reserve():
    assert plan_force(1).to_dict() == {"screen_sections": 1, "reserve_sections": 1, "sections": 2, "shooters": 18, "observers": 2, "drones": 20}
    plan = plan_force(12)
    assert (plan.screen_sections, plan.reserve_sections, plan.shooters, plan.observers) == (2, 1, 27, 3)
    assert plan_force(28).screen_sections == 4


def test_each_section_is_nine_shooters_plus_one_observer_hovering_above():
    force = build_force(plan_force(12))
    sections = {}
    for drone in force:
        sections.setdefault(drone["section"], []).append(drone)
    assert len(sections) == 3
    for members in sections.values():
        shooters = [d for d in members if d["role"] == "shooter"]
        observers = [d for d in members if d["role"] == "observer"]
        assert len(shooters) == 9 and len(observers) == 1
        assert observers[0]["callsign"].endswith("-OBS")
        assert observers[0]["cell"][2] >= max(d["cell"][2] for d in shooters) + 40.0
    assert all(d["pad"][1] < -600 for d in force)  # everyone launches from the coastal pads


def test_hostiles_are_neutralized_only_by_physical_contact_and_the_interceptor_is_expended():
    result = _run()
    kills = [e for e in result.events if e.kind == "neutralized"]
    assert kills and len(kills) == result.metrics.neutralized
    for kill in kills:
        assert kill.truth["miss_distance_m"] <= kill.truth["kill_radius_m"] == THREAT_TYPES["medium"]["kill_radius_m"]
        shooter = kill.truth["interceptor_id"]
        later = [e for e in result.events if e.time_s > kill.time_s and e.agent_local.get("agent_id") == shooter]
        assert not later  # the interceptor was destroyed in the collision
    misses = [e for e in result.events if e.kind == "engagement_attempt"]
    assert all(e.truth["outcome"] is False and e.truth["miss_distance_m"] > e.truth["kill_radius_m"] for e in misses)


def test_one_shooter_per_hostile_with_observers_backing_up_misses():
    airdnd = _run()
    greedy = _run(method="independent_greedy")
    assert airdnd.metrics.duplicate_pursuits <= 2
    assert greedy.metrics.duplicate_pursuits > 3 * max(1, airdnd.metrics.duplicate_pursuits)
    backups = [e for e in airdnd.events if e.kind == "observer_claim"]
    assert backups and all(e.truth["interceptor_id"] in {d["interceptor_id"] for d in airdnd.events[0].truth["interceptors"] if d["role"] == "observer"} for e in backups)
    first_miss = {}
    for e in airdnd.events:
        if e.kind == "engagement_attempt":
            first_miss.setdefault(e.truth["hostile_id"], e.time_s)
    assert all(e.truth["hostile_id"] in first_miss and e.time_s >= first_miss[e.truth["hostile_id"]] for e in backups)
    assert airdnd.metrics.neutralized == airdnd.config.count


def test_engagement_is_collision_free_silent_and_reproducible():
    result = _run("small", 6, "line", 3)
    assert result.metrics.friendly_collisions == 0
    assert result.metrics.minimum_separation_m >= 8.0
    assert result.metrics.rf_ground_messages == result.metrics.rf_interdrone_messages == result.metrics.target_assignment_messages == 0
    assert run_engagement(ThreatConfig("small", 6, "line", 3)).to_dict() == result.to_dict()
    frames = [e.presentation["frame"] for e in result.events]
    assert frames == list(range(len(frames)))


def test_threat_config_rejects_unknown_types_and_out_of_range_counts():
    with pytest.raises(ValueError):
        run_engagement(ThreatConfig("tank", 4))
    with pytest.raises(ValueError):
        run_engagement(ThreatConfig("small", 0))


def test_api_runs_a_simulation_and_serves_it_through_the_replay_endpoint(tmp_path):
    client = TestClient(create_app(data_root=tmp_path))
    assert {t["id"] for t in client.get("/api/threats").json()["threat_types"]} == {"small", "medium", "large"}
    assert client.get("/api/force-plan", params={"hostiles": 12}).json()["shooters"] == 27
    assert client.post("/api/simulations", json={"threat_type": "tank"}).status_code == 422
    created = client.post("/api/simulations", json={"threat_type": "small", "count": 3, "formation": "line", "seed": 3})
    assert created.status_code == 201
    run = created.json()
    assert run["force_plan"]["observers"] == 2 and run["metrics"]["friendly_collisions"] == 0
    overview = client.get(f"/api/scenarios/{run['id']}/replay", params={"perspective": "overview"}).json()
    locals_ = client.get(f"/api/scenarios/{run['id']}/replay", params={"perspective": "locals"})
    assert overview["frames"][0]["event_kind"] == "swarm_initialized"
    assert locals_.status_code == 200 and "hostile_id" not in locals_.text
    assert client.get("/api/scenarios/sim-" + "0" * 32 + "/replay").status_code == 404
