import numpy as np

from airdnd.observation import IFFMachine, IdentityState, LocalTracker, NavigationFilter


def test_local_track_ids_are_agent_specific_and_noisy_but_deterministic():
    truth = {"H0": ((100.0, 20.0, 120.0), (-10.0, 0.0, 0.0))}
    a = LocalTracker("I0", seed=9, noise_std_m=1.0).observe(truth, (0.0, 0.0, 100.0), 500.0)
    b = LocalTracker("I1", seed=9, noise_std_m=1.0).observe(truth, (0.0, 0.0, 100.0), 500.0)
    again = LocalTracker("I0", seed=9, noise_std_m=1.0).observe(truth, (0.0, 0.0, 100.0), 500.0)
    assert a[0].local_id != b[0].local_id
    assert a == again
    assert a[0].position != truth["H0"][0]
    assert not hasattr(a[0], "global_id")


def test_navigation_models_horizontal_ins_drift_and_barometer_only_corrects_z():
    nav = NavigationFilter(position=(0.0, 0.0, 100.0), accel_bias=(0.1, 0.0, 0.0))
    for _ in range(10):
        state = nav.step(measured_accel=(0.0, 0.0, 0.0), baro_altitude_m=100.0, dt=1.0)
    assert state.position[0] > 4.0
    assert abs(state.position[2] - 100.0) < 0.1
    assert state.covariance_diag[0] > state.covariance_diag[2]


def test_iff_beacon_loss_is_unknown_and_hostility_needs_separate_evidence():
    iff = IFFMachine()
    assert iff.update(lineage=True, beacon_valid=False, beacon_bound=False, hostile_evidence=False) is IdentityState.FRIENDLY_LINEAGE
    assert iff.update(lineage=False, beacon_valid=False, beacon_bound=False, hostile_evidence=False) is IdentityState.UNKNOWN
    assert iff.update(lineage=False, beacon_valid=True, beacon_bound=False, hostile_evidence=False) is IdentityState.UNKNOWN
    assert iff.update(lineage=True, beacon_valid=True, beacon_bound=True, hostile_evidence=False) is IdentityState.CONFIRMED_FRIENDLY
    assert iff.update(lineage=False, beacon_valid=False, beacon_bound=False, hostile_evidence=True) is IdentityState.HOSTILE_EVIDENCE
