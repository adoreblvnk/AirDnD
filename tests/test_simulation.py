from airdnd.simulation import BASELINES, ScenarioConfig, run_fixed_replay, run_scenario

import numpy as np


def test_scenario_is_seed_reproducible_and_separates_evidence_layers():
    config = ScenarioConfig(hostiles=12, interceptors=16, seed=41, method="airdnd")
    first = run_scenario(config)
    second = run_scenario(config)
    assert first.to_dict() == second.to_dict()
    assert first.schema_version == "1.0"
    assert first.evidence_class == "simulation_evidence"
    assert first.events[0].truth is not None
    assert first.events[0].agent_local is not None
    assert first.events[0].presentation is not None
    assert "global_target_id" not in first.events[0].agent_local


def test_exact_100_hostile_run_completes_without_entity_drops_or_rf_messages():
    result = run_scenario(ScenarioConfig(hostiles=100, interceptors=125, seed=7, method="airdnd"))
    assert result.metrics.hostiles_total == 100
    assert result.metrics.completed
    assert result.metrics.entity_drops == 0
    assert result.metrics.friendly_collisions == 0
    assert result.metrics.rf_ground_messages == 0
    assert result.metrics.rf_interdrone_messages == 0
    assert result.metrics.target_assignment_messages == 0
    assert result.metrics.safety_filter == "snape/RVO2-3D"


def test_metrics_are_reducible_from_runtime_events_and_final_state():
    result = run_scenario(ScenarioConfig(6, 9, 13, "independent_greedy", reserve_ratio=0.0))
    kinds = [event.kind for event in result.events]
    trajectory_separations = [
        event.truth["nearest_friendly_separation_m"]
        for event in result.events
        if event.kind == "trajectory_step"
    ]
    retained = [
        event for event in result.events
        if event.kind == "coverage_status" and event.truth["retained"]
    ]

    assert result.metrics.duplicate_pursuits == kinds.count("duplicate_pursuit")
    assert result.metrics.friendly_collisions == kinds.count("friendly_collision")
    assert result.metrics.entity_drops == kinds.count("entity_drop")
    assert result.metrics.rf_ground_messages == kinds.count("rf_ground_message")
    assert result.metrics.rf_interdrone_messages == kinds.count("rf_interdrone_message")
    assert result.metrics.target_assignment_messages == kinds.count("target_assignment_message")
    assert result.metrics.minimum_separation_m == min(trajectory_separations)
    assert result.metrics.retained_coverage == len(retained) / result.config.interceptors
    assert result.metrics.completed == (kinds.count("simulation_completed") == 1)


def test_separation_breaches_create_collision_events_and_metric_counts():
    result = run_scenario(
        ScenarioConfig(1, 2, 43, "naive_static", reserve_ratio=0.0, minimum_separation_m=100.0)
    )
    collisions = [event for event in result.events if event.kind == "friendly_collision"]

    assert collisions
    assert result.metrics.friendly_collisions == len(collisions)
    assert all(event.truth["separation_m"] < 100.0 for event in collisions)


def test_airdnd_counts_simultaneous_local_duplicate_commitments_from_events():
    result = run_scenario(ScenarioConfig(1, 4, 47, "deterministic_ablation", reserve_ratio=0.0))
    duplicates = [event for event in result.events if event.kind == "duplicate_pursuit"]
    initial_agents = {
        event.truth["interceptor_id"]
        for event in result.events
        if event.kind == "mobilized" and event.truth["phase"] == "initial"
    }

    assert len(initial_agents) == 4
    assert len(duplicates) == 3
    assert result.metrics.duplicate_pursuits == len(duplicates)
    assert all(event.agent_local["cause"] == "simultaneous_local_commitment" for event in duplicates)


def test_airdnd_reserve_covers_unobserved_threats_before_duplicate_recovery():
    result = run_scenario(ScenarioConfig(100, 125, 11, "airdnd", reserve_ratio=0.25))
    engaged_targets = {
        event.truth["hostile_id"]
        for event in result.events
        if event.kind == "engagement_attempt"
    }
    assert len(engaged_targets) == 100


def test_reserve_ratio_sets_initial_active_count_and_reserves_mobilize_from_local_observation():
    result = run_scenario(ScenarioConfig(12, 12, 17, "deterministic_ablation", reserve_ratio=0.25))
    launches = [event for event in result.events if event.kind == "mobilized"]
    initial = [event for event in launches if event.truth["phase"] == "initial"]
    reserves = [event for event in launches if event.truth["phase"] == "reserve"]

    assert len(initial) == 9
    assert len(reserves) == 3
    assert all(event.agent_local["trigger"] == "locally_observed_uncovered_track" for event in reserves)
    assert all("hostile_id" not in event.agent_local for event in launches)


def test_local_policy_payloads_contain_only_noisy_local_track_geometry():
    result = run_scenario(ScenarioConfig(3, 4, 29, "deterministic_ablation", reserve_ratio=0.0))
    decisions = [event for event in result.events if event.kind == "policy_decision"]

    assert decisions
    forbidden = {"hostile_id", "global_id", "global_assignments", "assignments", "truth"}
    for event in decisions:
        assert forbidden.isdisjoint(event.agent_local)
        assert event.agent_local["belief"]["predicted_intercept_point"] != event.truth["target_position"]


def test_policy_decision_lists_every_visible_track_not_only_the_chosen_one():
    result = run_scenario(ScenarioConfig(3, 4, 29, "deterministic_ablation", reserve_ratio=0.0))
    decisions = [event for event in result.events if event.kind == "policy_decision"]
    assert decisions
    for event in decisions:
        visible = event.agent_local["visible_tracks"]
        assert visible
        track_ids = {entry["track_id"] for entry in visible}
        assert event.agent_local["local_track_id"] in track_ids
        for entry in visible:
            assert entry["identity_state"] in {"CONFIRMED FRIENDLY", "FRIENDLY LINEAGE", "UNKNOWN", "HOSTILE EVIDENCE"}


def test_airdnd_runtime_logs_actual_multihead_inference_outputs():
    result = run_scenario(ScenarioConfig(8, 12, 19, "airdnd"))
    decisions = [event for event in result.events if event.kind == "policy_decision"]
    assert decisions
    assert all(event.agent_local["belief_source"] == "trained_multihead_model" for event in decisions)
    assert all(event.agent_local["inference_executed"] is True for event in decisions)
    belief = decisions[0].agent_local["belief"]
    assert {
        "target_leak_probability",
        "action_success_probability",
        "friendly_coverage_probability",
        "predicted_intercept_time",
        "predicted_intercept_point",
        "predicted_coverage_expiry",
        "confidence",
    } == set(belief)
    assert "hostile_id" not in decisions[0].agent_local


def test_learned_and_ablation_policies_share_identical_downstream_utility_and_mobilization():
    learned = run_scenario(ScenarioConfig(8, 12, 23, "airdnd"))
    ablation = run_scenario(ScenarioConfig(8, 12, 23, "deterministic_ablation"))
    learned_decisions = [event for event in learned.events if event.kind == "policy_decision"]
    ablation_decisions = [event for event in ablation.events if event.kind == "policy_decision"]
    assert learned_decisions and ablation_decisions
    assert {event.agent_local["downstream_policy"] for event in learned_decisions} == {
        "mission_utility+deterministic_mobilization_v1"
    }
    assert {event.agent_local["downstream_policy"] for event in ablation_decisions} == {
        "mission_utility+deterministic_mobilization_v1"
    }
    assert {event.agent_local["belief_source"] for event in ablation_decisions} == {"handwritten_local_belief"}


def test_runtime_actuates_guidance_rvo_navigation_and_iff_in_discrete_steps():
    result = run_scenario(ScenarioConfig(2, 3, 31, "deterministic_ablation", reserve_ratio=0.0))
    steps = [event for event in result.events if event.kind == "trajectory_step"]

    assert steps
    for event in steps:
        local = event.agent_local
        assert local["guidance_mode"] in {"midcourse_basket", "terminal_proportional_navigation"}
        # Range-dependent optical classification: HOSTILE EVIDENCE is the likely outcome
        # but not certain, and UNKNOWN is the only other reachable state here since these
        # engagements never present a friendly beacon or lineage.
        assert local["identity_state"] in {"HOSTILE EVIDENCE", "UNKNOWN"}
        assert local["iff_evaluated"] is True
        assert local["navigation_updated"] is True
        assert local["safety_filter"] == "snape/RVO2-3D"
        expected = np.asarray(event.truth["from_position"]) + 0.1 * np.asarray(local["safe_velocity"])
        assert np.allclose(event.truth["to_position"], expected)


def test_engagement_attempts_share_scenario_factor_and_recovery_waits_for_expiry():
    result = run_scenario(ScenarioConfig(hostiles=1, interceptors=3, seed=5, method="airdnd", reserve_ratio=0.67, force_first_miss=True))
    attempts = [event for event in result.events if event.kind == "engagement_attempt" and event.truth["hostile_id"] == "H000"]
    assert len(attempts) >= 2
    assert len({event.truth["shared_failure_factor"] for event in attempts}) == 1
    kinds = [event.kind for event in result.events]
    assert kinds.index("coverage_expired") < kinds.index("observer_claim")


def test_recovery_claim_delay_is_ranked_and_later_claimants_cancel_from_observed_motion():
    result = run_scenario(ScenarioConfig(1, 5, 37, "deterministic_ablation", reserve_ratio=0.8, force_first_miss=True))
    claims = [event for event in result.events if event.kind == "observer_claim"]
    cancellations = [event for event in result.events if event.kind == "claim_cancelled"]

    assert claims
    assert claims[0].agent_local["claim_delay_s"] == claims[0].agent_local["priority_rank"] * 0.15
    assert claims[0].agent_local["trigger"] == "locally_observed_coverage_expiry"
    assert cancellations
    assert all(event.agent_local["trigger"] == "observed_friendly_commitment" for event in cancellations)


def test_recovery_claims_carry_real_hysteresis_state_not_a_hardcoded_hard_release():
    result = run_scenario(ScenarioConfig(1, 5, 37, "deterministic_ablation", reserve_ratio=0.8, force_first_miss=True))
    claims = [event for event in result.events if event.kind == "observer_claim"]
    assert claims
    for claim in claims:
        confirmed = claim.agent_local["hysteresis_confirmed"]
        assert isinstance(confirmed, bool)
        # A claimant only becomes the tracked incumbent once hysteresis actually confirms
        # the switch; otherwise the incumbent track must be left unchanged.
        if confirmed:
            assert claim.agent_local["hysteresis_track"] == claim.agent_local["local_track_id"]
        else:
            assert claim.agent_local["hysteresis_track"] != claim.agent_local["local_track_id"]


def test_fleet_lifecycle_progresses_docked_departing_on_station_returning_docked_and_battery_drains():
    result = run_scenario(ScenarioConfig(1, 3, 5, "airdnd", reserve_ratio=0.67, force_first_miss=True))
    by_agent: dict[str, list[tuple[float, str, float]]] = {}
    for event in result.events:
        local = event.agent_local
        if "lifecycle_state" not in local:
            continue
        by_agent.setdefault(local["agent_id"], []).append((event.time_s, local["lifecycle_state"], local["battery"]))

    assert by_agent
    for agent_id, entries in by_agent.items():
        entries.sort(key=lambda item: item[0])
        states = [state for _time, state, _battery in entries]
        assert set(states) <= {"departing", "on_station", "returning", "docked"}
        assert states[-1] == "docked"
        batteries = [battery for _time, _state, battery in entries]
        assert all(0.05 <= value <= 1.0 for value in batteries)
        # Battery must never increase - it only drains until the mission ends.
        assert all(later <= earlier + 1e-9 for earlier, later in zip(batteries, batteries[1:]))


def test_all_five_baselines_execute_and_teacher_uses_ortools_when_installed():
    assert BASELINES == ("naive_static", "independent_greedy", "deterministic_ablation", "airdnd", "ortools_teacher")
    results = [run_scenario(ScenarioConfig(10, 14, 3, method)) for method in BASELINES]
    assert all(result.metrics.completed for result in results)
    assert results[-1].teacher_backend == "ortools"


import functools
import json
from pathlib import Path

from airdnd.simulation import ABORT_BATTERY, FIXED_REPLAYS


@functools.lru_cache(maxsize=None)
def _replay(scenario_id):
    return run_fixed_replay(scenario_id)


def _kinds(result, hostile_id=None):
    return [e.kind for e in result.events if hostile_id is None or e.truth.get("hostile_id") == hostile_id]


def test_scenario_catalogue_names_every_fixed_replay_exactly_once():
    catalogue = json.loads((Path(__file__).resolve().parents[1] / "configs" / "scenarios.json").read_text(encoding="utf-8"))
    ids = [entry["id"] for entry in catalogue["scenarios"]]
    assert ids == list(FIXED_REPLAYS)
    titles = [entry["title"] for entry in catalogue["scenarios"]]
    assert len(set(titles)) == len(titles)
    assert all(entry["summary"] and entry["force"] for entry in catalogue["scenarios"])


def test_every_fixed_replay_is_a_safe_contiguous_section_swarm():
    for scenario_id in FIXED_REPLAYS:
        result = _replay(scenario_id)
        init = result.events[0]
        assert init.kind == "swarm_initialized", scenario_id
        assert len(init.truth["interceptors"]) == result.config.interceptors
        assert len({d["section"] for d in init.truth["interceptors"]}) == result.config.interceptors // 9
        frames = [e.presentation["frame"] for e in result.events]
        assert frames == list(range(len(frames))), scenario_id
        times = [e.time_s for e in result.events]
        assert all(b >= a - 1e-9 for a, b in zip(times, times[1:])), scenario_id
        assert result.metrics.friendly_collisions == 0, scenario_id
        assert result.metrics.minimum_separation_m >= result.config.minimum_separation_m, scenario_id
        assert result.metrics.completed, scenario_id
        assert result.metrics.rf_ground_messages == result.metrics.rf_interdrone_messages == result.metrics.target_assignment_messages == 0


def test_launch_formation_flies_sections_from_pads_into_the_grid():
    result = _replay("launch_formation")
    init = result.events[0].truth["interceptors"]
    assert all(d["position"][2] == 15.0 and d["position"][1] < d["cell"][1] - 500 for d in init)
    kinds = _kinds(result)
    assert kinds.count("section_launch") == 9 and kinds.count("section_on_station") == 9
    assert kinds.index("grid_set") < kinds.index("policy_decision")
    grid_time = next(e.time_s for e in result.events if e.kind == "grid_set")
    assert all(e.time_s >= grid_time for e in result.events if e.kind in ("policy_decision", "engagement_attempt"))


def test_intercept_success_lead_hits_first_and_duplicates_stand_down():
    result = _replay("intercept_success")
    assert (result.config.interceptors, result.config.hostiles) == (27, 9)
    h000 = [e for e in result.events if e.truth.get("hostile_id") == "H000"]
    assert ("neutralized", "I000") in [(e.kind, e.truth.get("interceptor_id")) for e in h000]
    assert "claim_cancelled" in [e.kind for e in h000]


def test_miss_recovery_reserve_observer_recovers_the_forced_miss():
    result = _replay("miss_recovery")
    ready = {e.truth["interceptor_id"] for e in result.events if e.kind == "observer_ready"}
    claims = {e.agent_local["agent_id"] for e in result.events if e.kind == "observer_claim"}
    assert ready and all(27 <= int(agent[1:]) < 81 for agent in ready)
    assert claims and claims <= ready
    kinds = _kinds(result, "H000")
    assert kinds.index("coverage_expired") < kinds.index("observer_claim") < kinds.index("neutralized")


def test_multi_wave_recovers_engaged_drones_and_refills_cells_before_wave_two():
    result = _replay("multi_wave")
    waves = [e for e in result.events if e.kind == "wave_detected"]
    assert [w.truth["wave"] for w in waves] == [1, 2]
    assert waves[1].truth["delayed_by_s"] == 0.0 and waves[1].time_s == waves[1].truth["scheduled_time_s"]
    index = {id(e): i for i, e in enumerate(result.events)}
    refill_done = next(e for e in result.events if e.kind == "refill_complete")
    first_return = next(e for e in result.events if e.kind == "rth_docked")
    assert index[id(first_return)] < index[id(refill_done)] < index[id(waves[1])]
    claimers = [e for e in result.events if e.kind == "cell_refill_claim"]
    assert claimers and all(e.agent_local["trigger"] == "observed_vacated_cell" for e in claimers)
    assert len({e.truth["vacated_by"] for e in claimers}) == len(claimers)  # one reserve per empty cell
    wave2 = set(waves[1].truth["hostile_ids"])
    assert all(e.truth["hostile_id"] in wave2 for e in result.events if e.kind == "engagement_attempt" and e.time_s > waves[1].time_s)
    assert result.metrics.leaked == 0


def test_return_to_base_aborts_at_threshold_and_docks_by_dead_reckoning():
    result = _replay("return_to_base")
    aborts = [e for e in result.events if e.kind == "abort"]
    assert aborts and all(e.truth["battery"] <= ABORT_BATTERY for e in aborts)
    assert all(e.truth["interceptor_id"] in {f"I{i:03d}" for i in range(27)} for e in aborts)  # platoon A1 only
    docked = {e.truth["interceptor_id"]: e for e in result.events if e.kind == "rth_docked"}
    assert set(docked) == {e.truth["interceptor_id"] for e in aborts}
    errors = [e.truth["docking_error_m"] for e in docked.values()]
    assert 0.0 < max(errors) < 20.0  # INS bias gives a real, bounded dead-reckoning error
    descent = [e for e in result.events if e.kind == "rth_step" and e.truth["phase"] == "descend"]
    assert descent


def test_friend_or_foe_never_engages_or_calls_friendlies_hostile():
    result = _replay("friend_or_foe")
    iff = [e for e in result.events if e.kind == "iff_classification"]
    states = [state for e in iff for state in e.truth["identity_states"].values()]
    assert len(iff) == 2 * 9
    assert "HOSTILE EVIDENCE" not in states
    assert {"CONFIRMED FRIENDLY", "UNKNOWN"} <= set(states)
    assert all(e.truth["engaged"] is False for e in iff)
    assert not any(str(e.truth.get("hostile_id", "")).startswith("F") for e in result.events)


def test_naive_baseline_matches_miss_recovery_world_but_not_its_policy():
    naive, airdnd = _replay("naive_baseline"), _replay("miss_recovery")
    assert (naive.config.seed, naive.config.hostiles, naive.config.interceptors) == (airdnd.config.seed, airdnd.config.hostiles, airdnd.config.interceptors)
    assert naive.events[0].truth["hostiles"] == airdnd.events[0].truth["hostiles"]
    assert naive.config.method == "independent_greedy" and "observer_claim" not in _kinds(naive)
    assert naive.metrics.leaked > airdnd.metrics.leaked
