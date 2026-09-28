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


def test_section_formation_builds_3x3_sections_into_platoons_and_companies():
    from airdnd.core import generate_section_formation

    slots = generate_section_formation(81)
    assert len({slot.section_id for slot in slots}) == 9
    assert len({slot.platoon_id for slot in slots}) == 3
    first_section = [slot for slot in slots if slot.section_id == "A1-1"]
    assert len(first_section) == 9
    assert sorted({slot.row for slot in first_section}) == [0, 1, 2]
    assert all(sum(slot.row == row for slot in first_section) == 3 for row in range(3))
    assert slots[0].callsign == "A1-1-1" and slots[8].callsign == "A1-1-9" and slots[80].callsign == "A3-3-9"
    assert generate_section_formation(82)[81].company == "B"
    positions = [slot.position for slot in slots]
    assert len(set(positions)) == 81
    nearest = min(
        sum((a - b) ** 2 for a, b in zip(p, q)) ** 0.5
        for i, p in enumerate(positions)
        for q in positions[i + 1 :]
    )
    assert nearest >= 20.0
    # With a 1/3 reserve, 6 sections form the screen at y=0..40 and 3 wait 200 m behind.
    staged = generate_section_formation(81, initial_count=54)
    front = {slot.section_id for slot in staged if slot.position[1] >= 0}
    rear = {slot.section_id for slot in staged if slot.position[1] < 0}
    assert len(front) == 6 and len(rear) == 3 and rear == {"A3-1", "A3-2", "A3-3"}
    assert all(0.0 <= slot.position[0] <= 900.0 for slot in staged)
    assert min(s.position[2] for s in staged if s.section_id in rear) > max(s.position[2] for s in staged if s.section_id in front)
