import numpy as np
import torch

from airdnd.model import (
    BeliefModel,
    BeliefOutput,
    decode_beliefs,
    export_onnx_int8,
    generate_paired_teacher_dataset,
    train_belief_model,
)


def test_mlp_gru_emits_typed_belief_schema_in_valid_ranges():
    torch.manual_seed(2)
    model = BeliefModel(feature_dim=12, hidden_dim=16)
    history = torch.zeros(3, 5, 12)
    raw = model(history)
    beliefs = decode_beliefs(raw)
    assert raw.shape == (3, 9)
    assert len(beliefs) == 3
    assert isinstance(beliefs[0], BeliefOutput)
    assert 0.0 <= beliefs[0].target_leak_probability <= 1.0
    assert 0.0 <= beliefs[0].action_success_probability <= 1.0
    assert 0.0 <= beliefs[0].friendly_coverage_probability <= 1.0
    assert 0.0 <= beliefs[0].confidence <= 1.0
    assert len(beliefs[0].predicted_intercept_point) == 3


def test_training_uses_paired_counterfactual_ortools_labels_and_reduces_multihead_loss():
    dataset = generate_paired_teacher_dataset(seed=11, samples=64)
    assert dataset.histories.shape == (64, 5, 12)
    assert dataset.targets.shape == (64, 9)
    assert dataset.teacher_backend == "ortools"
    assert dataset.paired_future_stream_ids.unique().numel() == 64
    assert dataset.paired_future_event_streams.shape == (64, 3, 24, 4)
    np.testing.assert_array_equal(
        dataset.paired_future_event_streams[:, 0],
        dataset.paired_future_event_streams[:, 1],
    )
    np.testing.assert_array_equal(
        dataset.paired_future_event_streams[:, 1],
        dataset.paired_future_event_streams[:, 2],
    )
    assert dataset.counterfactual_outcomes.shape == (64, 3, 3)
    torch.testing.assert_close(dataset.targets[:, 0], dataset.counterfactual_outcomes[:, 0, 0])
    torch.testing.assert_close(dataset.targets[:, 1], dataset.counterfactual_outcomes[:, 1, 1])
    torch.testing.assert_close(dataset.targets[:, 2], dataset.counterfactual_outcomes[:, 2, 2])
    assert 0 < int(dataset.targets[:, 1].sum()) < 64
    assert 0 < int(dataset.targets[:, 2].sum()) < 64
    assert dataset.runtime_feature_names == (
        "target_relative_x",
        "target_relative_y",
        "target_relative_z",
        "observed_target_velocity_x",
        "observed_target_velocity_y",
        "observed_target_velocity_z",
        "observed_target_range",
        "estimated_time_to_boundary",
        "observed_friendly_closing_score",
        "observed_nearest_friendly_range",
        "local_battery_fraction",
        "local_track_uncertainty",
    )
    # Runtime inputs must be noisy local observations, never binary teacher assignment state.
    assert torch.all((dataset.histories[:, :, 8] > 0.0) & (dataset.histories[:, :, 8] < 1.0))
    assert dataset.targets[:, 8].unique().numel() > 2

    model, report = train_belief_model(seed=11, samples=64, epochs=10)
    assert isinstance(model, BeliefModel)
    assert report.final_loss < report.initial_loss
    assert report.samples == 64
    assert report.label_source == "paired_local_counterfactual_ortools_teacher"
    assert report.teacher_backend == "ortools"


def test_training_reports_a_disjoint_held_out_dataset():
    _, report = train_belief_model(seed=19, samples=48, epochs=8)

    assert report.train_samples == 48
    assert report.heldout_samples == 12
    assert report.train_seed == 19
    assert report.heldout_seed != report.train_seed
    train_ids = set(report.train_stream_ids)
    heldout_ids = set(report.heldout_stream_ids)
    assert train_ids.isdisjoint(heldout_ids)
    assert len(train_ids) == report.train_samples
    assert len(heldout_ids) == report.heldout_samples
    assert np.isfinite(report.heldout_initial_loss)
    assert np.isfinite(report.heldout_final_loss)


def test_training_reports_each_epoch_with_train_and_heldout_loss():
    progress = []

    _, report = train_belief_model(
        seed=23,
        samples=12,
        epochs=3,
        epoch_callback=lambda epoch, train_loss, heldout_loss: progress.append(
            (epoch, train_loss, heldout_loss)
        ),
    )

    assert [epoch for epoch, _, _ in progress] == [1, 2, 3]
    assert all(np.isfinite(train_loss) for _, train_loss, _ in progress)
    assert all(np.isfinite(heldout_loss) for _, _, heldout_loss in progress)
    assert progress[-1][1] == report.final_loss
    assert progress[-1][2] == report.heldout_final_loss


def test_model_exports_runnable_onnx_and_dynamic_int8_when_supported(tmp_path):
    torch.manual_seed(3)
    model = BeliefModel(feature_dim=12, hidden_dim=8)
    result = export_onnx_int8(model, tmp_path / "belief.onnx", tmp_path / "belief.int8.onnx")
    assert result.onnx_path.exists()
    assert result.onnx_path.stat().st_size > 0
    assert result.quantized_path is not None
    assert result.quantized_path.exists()
    assert result.runtime_verified
    assert result.onnx_max_abs_error <= result.onnx_tolerance
    assert result.quantized_max_abs_error <= result.quantized_tolerance
    assert result.verification_batch_size >= 2
