from airdnd.core import EntityKind, SimulatorTruth, AgentLocalState, PresentationState, generate_staggered_grid


def test_state_schemas_keep_truth_local_and_presentation_separate():
    truth = SimulatorTruth(time_s=1.0, positions={"H0": (1.0, 2.0, 3.0)})
    local = AgentLocalState(agent_id="I0", estimated_position=(0.0, 0.0, 100.0))
    view = PresentationState(frame=2, selected_agent="I0", evaluator_overlay=False)
    assert truth.positions["H0"] == (1.0, 2.0, 3.0)
    assert not hasattr(local, "positions")
    assert not hasattr(view, "positions")
    assert EntityKind.HOSTILE.value == "hostile"


def test_staggered_grid_has_tiers_and_half_cell_offset():
    cells = generate_staggered_grid(count=7, columns=3, spacing_m=100.0, base_altitude_m=100.0, tier_step_m=75.0)
    assert len(cells) == 7
    assert cells[0].position == (0.0, 0.0, 100.0)
    assert cells[3].position == (50.0, 100.0, 175.0)
    assert len({c.position for c in cells}) == 7
