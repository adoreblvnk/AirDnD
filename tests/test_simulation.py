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
        assert local["identity_state"] == "HOSTILE EVIDENCE"
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


def test_all_five_baselines_execute_and_teacher_uses_ortools_when_installed():
    assert BASELINES == ("naive_static", "independent_greedy", "deterministic_ablation", "airdnd", "ortools_teacher")
    results = [run_scenario(ScenarioConfig(10, 14, 3, method)) for method in BASELINES]
    assert all(result.metrics.completed for result in results)
    assert results[-1].teacher_backend == "ortools"


def test_fixed_success_and_miss_recovery_replays_are_simulator_outputs():
    success = run_fixed_replay("success")
    miss = run_fixed_replay("miss_recovery")
    ready_agents = {
        event.truth["interceptor_id"]
        for event in miss.events
        if event.kind == "observer_ready"
    }
    claim_agents = {
        event.agent_local["agent_id"]
        for event in miss.events
        if event.kind == "observer_claim"
    }
    assert any(event.kind == "neutralized" for event in success.events)
    assert ready_agents == {"I001", "I002"}
    assert claim_agents <= ready_agents
    assert any(event.kind == "coverage_expired" for event in miss.events)
    assert any(event.kind == "observer_claim" for event in miss.events)
    assert success.config.seed != miss.config.seed
