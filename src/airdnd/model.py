from __future__ import annotations

from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Callable

import numpy as np
import torch
from torch import nn


@dataclass(frozen=True)
class BeliefOutput:
    target_leak_probability: float
    action_success_probability: float
    friendly_coverage_probability: float
    predicted_intercept_time: float
    predicted_intercept_point: tuple[float, float, float]
    predicted_coverage_expiry: float
    confidence: float


class BeliefModel(nn.Module):
    """Compact per-track MLP encoder followed by a temporal GRU."""

    def __init__(self, feature_dim: int = 12, hidden_dim: int = 24):
        super().__init__()
        self.feature_dim = feature_dim
        self.hidden_dim = hidden_dim
        self.encoder = nn.Sequential(nn.Linear(feature_dim, hidden_dim), nn.ReLU())
        self.temporal = nn.GRU(hidden_dim, hidden_dim, batch_first=True)
        self.head = nn.Linear(hidden_dim, 9)

    def forward(self, history: torch.Tensor) -> torch.Tensor:
        encoded = self.encoder(history)
        sequence, _ = self.temporal(encoded)
        return self.head(sequence[:, -1])


def decode_beliefs(raw: torch.Tensor) -> list[BeliefOutput]:
    values = raw.detach().cpu()
    probabilities = torch.sigmoid(values[:, [0, 1, 2, 8]])
    positive = torch.nn.functional.softplus(values[:, [3, 7]])
    outputs: list[BeliefOutput] = []
    for i in range(values.shape[0]):
        outputs.append(
            BeliefOutput(
                target_leak_probability=float(probabilities[i, 0]),
                action_success_probability=float(probabilities[i, 1]),
                friendly_coverage_probability=float(probabilities[i, 2]),
                predicted_intercept_time=float(positive[i, 0]),
                predicted_intercept_point=tuple(float(x) for x in values[i, 4:7]),
                predicted_coverage_expiry=float(positive[i, 1]),
                confidence=float(probabilities[i, 3]),
            )
        )
    return outputs


@dataclass(frozen=True)
class TrainingReport:
    initial_loss: float
    final_loss: float
    samples: int
    epochs: int
    label_source: str = "paired_local_counterfactual_ortools_teacher"
    teacher_backend: str = "ortools"
    train_samples: int = 0
    heldout_samples: int = 0
    train_seed: int = 0
    heldout_seed: int = 0
    train_stream_ids: tuple[int, ...] = ()
    heldout_stream_ids: tuple[int, ...] = ()
    heldout_initial_loss: float = float("nan")
    heldout_final_loss: float = float("nan")


RUNTIME_FEATURE_NAMES = (
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


@dataclass(frozen=True)
class PairedTeacherDataset:
    histories: torch.Tensor
    targets: torch.Tensor
    paired_future_stream_ids: torch.Tensor
    teacher_backend: str
    paired_future_event_streams: np.ndarray = field(
        default_factory=lambda: np.empty((0, 3, 24, 4), dtype=np.float32)
    )
    counterfactual_outcomes: torch.Tensor = field(default_factory=lambda: torch.empty(0, 3, 3))
    runtime_feature_names: tuple[str, ...] = RUNTIME_FEATURE_NAMES


def _counterfactual_rollout(
    target_position: np.ndarray,
    target_velocity: np.ndarray,
    actor_position: np.ndarray | None,
    future_events: np.ndarray,
) -> tuple[float, float, float]:
    """Roll one action choice through a shared stream of future events."""
    dt = 2.5
    target = target_position.astype(float).copy()
    actor = None if actor_position is None else actor_position.astype(float).copy()
    succeeded = False
    attempted = False
    for wind_x, wind_y, wind_z, engagement_draw in future_events:
        target_velocity_step = target_velocity + np.asarray((wind_x, wind_y, wind_z)) * 3.0
        target += target_velocity_step * dt
        if actor is not None:
            delta = target - actor
            distance = float(np.linalg.norm(delta))
            if distance > 0.0:
                actor += delta / distance * min(distance, 38.0 * dt)
            separation = float(np.linalg.norm(target - actor))
            if separation <= 55.0 and not attempted:
                attempted = True
                succeeded = bool(engagement_draw < 0.70)
                actor = None
                if succeeded:
                    break
        if target[1] <= 0.0:
            break
    leaked = float(not succeeded and target[1] <= 0.0)
    return leaked, float(succeeded), float(succeeded)


def generate_paired_teacher_dataset(seed: int = 17, samples: int = 256) -> PairedTeacherDataset:
    """Build local histories and paired labels from an OR-Tools assignment teacher.

    Each row uses one future-random-event stream for the no-action, focal-action,
    and other-friendly-action counterfactuals.  Omniscient state is used only to
    produce labels; model histories contain focal-agent-relative local features.
    """
    from ortools.graph.python import linear_sum_assignment

    rng = np.random.default_rng(seed)
    histories = np.zeros((samples, 5, 12), dtype=np.float32)
    targets = np.zeros((samples, 9), dtype=np.float32)
    paired_streams = np.zeros((samples, 3, 24, 4), dtype=np.float32)
    counterfactual_outcomes = np.zeros((samples, 3, 3), dtype=np.float32)
    stream_ids = np.arange(samples, dtype=np.int64) + seed * 1_000_000
    for sample in range(samples):
        agents = rng.uniform((-120.0, -80.0, 250.0), (120.0, 80.0, 390.0), size=(3, 3))
        threats = rng.uniform((-180.0, 500.0, 100.0), (180.0, 1400.0, 210.0), size=(3, 3))
        threat_velocity = np.column_stack(
            (rng.uniform(-4.0, 4.0, 3), rng.uniform(-42.0, -24.0, 3), rng.uniform(-2.0, 2.0, 3))
        )
        focal = sample % 3
        candidate = (sample // 3) % 3
        solver = linear_sum_assignment.SimpleLinearSumAssignment()
        for threat_index in range(3):
            for agent_index in range(3):
                intercept_cost = int(np.linalg.norm(threats[threat_index] - agents[agent_index]) * 100.0)
                solver.add_arc_with_cost(threat_index, agent_index, intercept_cost)
        if solver.solve() != solver.OPTIMAL:
            raise RuntimeError("OR-Tools teacher did not solve paired training state")
        assigned_agent = solver.right_mate(candidate)

        relative = threats[candidate] - agents[focal]
        distance = float(np.linalg.norm(relative))
        target_speed = max(1.0, float(-threat_velocity[candidate, 1]))
        time_to_boundary = float(threats[candidate, 1] / target_speed)
        other_agent = int(assigned_agent) if assigned_agent != focal else (focal + 1) % 3
        locally_visible_agents = [index for index in range(3) if index != focal]
        observed_agent = min(
            locally_visible_agents,
            key=lambda index: float(np.linalg.norm(threats[candidate] - agents[index])),
        )
        other_relative = agents[observed_agent] - agents[focal]
        other_distance = float(np.linalg.norm(threats[candidate] - agents[other_agent]))
        observed_other_distance = float(np.linalg.norm(threats[candidate] - agents[observed_agent]))
        # A focal agent can observe nearby friendly geometry and motion, but not
        # the teacher's assignment.  Use a noisy local closing score only.
        observed_other_relative = other_relative + rng.normal(0.0, 4.0, 3)
        observed_target_relative = relative + rng.normal(0.0, 3.0, 3)
        closing_cosine = -float(
            np.dot(observed_other_relative, observed_target_relative)
            / max(np.linalg.norm(observed_other_relative) * np.linalg.norm(observed_target_relative), 1.0)
        )
        observed_closing_score = float(np.clip(0.5 + 0.45 * closing_cosine, 0.01, 0.99))
        battery_fraction = float(rng.uniform(0.35, 1.0))
        track_uncertainty = float(rng.uniform(0.01, 0.15))
        base = np.asarray(
            [
                relative[0] / 1000.0,
                relative[1] / 1500.0,
                relative[2] / 300.0,
                threat_velocity[candidate, 0] / 50.0,
                threat_velocity[candidate, 1] / 50.0,
                threat_velocity[candidate, 2] / 50.0,
                distance / 1500.0,
                time_to_boundary / 60.0,
                observed_closing_score,
                observed_other_distance / 1500.0,
                battery_fraction,
                track_uncertainty,
            ],
            dtype=np.float32,
        )
        for tick in range(5):
            history_noise = rng.normal(0.0, 0.006, 12).astype(np.float32)
            histories[sample, tick] = base + history_noise
            histories[sample, tick, 8] = np.clip(histories[sample, tick, 8], 0.001, 0.999)

        # All three worlds receive byte-identical weather, manoeuvre, and
        # engagement draws.  Only the chosen action differs.
        future_events = np.column_stack(
            (
                rng.normal(0.0, 1.0, (24, 3)),
                rng.random(24),
            )
        ).astype(np.float32)
        paired_streams[sample] = np.repeat(future_events[None, :, :], 3, axis=0)
        no_action = _counterfactual_rollout(threats[candidate], threat_velocity[candidate], None, future_events)
        focal_action = _counterfactual_rollout(
            threats[candidate], threat_velocity[candidate], agents[focal], future_events
        )
        other_action = _counterfactual_rollout(
            threats[candidate],
            threat_velocity[candidate],
            agents[other_agent] if assigned_agent != focal else None,
            future_events,
        )
        counterfactual_outcomes[sample] = (no_action, focal_action, other_action)
        leak_without_action = no_action[0]
        focal_action_success = focal_action[1]
        covered_by_other = other_action[2]
        intercept_time = distance / 30.0
        intercept_point = threats[candidate] + threat_velocity[candidate] * min(intercept_time, time_to_boundary)
        targets[sample] = np.asarray(
            [
                leak_without_action,
                focal_action_success,
                covered_by_other,
                intercept_time,
                intercept_point[0],
                intercept_point[1],
                intercept_point[2],
                min(time_to_boundary, intercept_time + 4.2),
                1.0 - track_uncertainty,
            ],
            dtype=np.float32,
        )
    return PairedTeacherDataset(
        torch.from_numpy(histories),
        torch.from_numpy(targets),
        torch.from_numpy(stream_ids),
        "ortools",
        paired_streams,
        torch.from_numpy(counterfactual_outcomes),
        RUNTIME_FEATURE_NAMES,
    )


def train_belief_model(
    seed: int = 17,
    samples: int = 256,
    epochs: int = 30,
    epoch_callback: Callable[[int, float, float], None] | None = None,
) -> tuple[BeliefModel, TrainingReport]:
    """Train deterministically on paired local counterfactual/teacher labels."""
    torch.manual_seed(seed)
    model = BeliefModel()
    dataset = generate_paired_teacher_dataset(seed, samples)
    heldout_seed = seed + 1_000_003
    heldout = generate_paired_teacher_dataset(heldout_seed, max(1, samples // 4))
    history = dataset.histories
    targets = dataset.targets

    def loss_fn(raw: torch.Tensor, expected: torch.Tensor) -> torch.Tensor:
        binary = torch.nn.functional.binary_cross_entropy_with_logits(raw[:, [0, 1, 2, 8]], expected[:, [0, 1, 2, 8]])
        decoded_regression = torch.cat(
            (
                torch.nn.functional.softplus(raw[:, 3:4]) / 60.0,
                raw[:, 4:5] / 1000.0,
                raw[:, 5:6] / 1500.0,
                raw[:, 6:7] / 300.0,
                torch.nn.functional.softplus(raw[:, 7:8]) / 60.0,
            ),
            dim=1,
        )
        target_regression = torch.cat(
            (
                expected[:, 3:4] / 60.0,
                expected[:, 4:5] / 1000.0,
                expected[:, 5:6] / 1500.0,
                expected[:, 6:7] / 300.0,
                expected[:, 7:8] / 60.0,
            ),
            dim=1,
        )
        regression = torch.nn.functional.smooth_l1_loss(decoded_regression, target_regression)
        return binary + regression

    optimizer = torch.optim.Adam(model.parameters(), lr=0.02)
    initial = float(loss_fn(model(history), targets).detach())
    heldout_initial = float(loss_fn(model(heldout.histories), heldout.targets).detach())
    for epoch in range(1, epochs + 1):
        optimizer.zero_grad()
        loss = loss_fn(model(history), targets)
        loss.backward()
        optimizer.step()
        if epoch_callback is not None:
            with torch.no_grad():
                epoch_callback(
                    epoch,
                    float(loss_fn(model(history), targets)),
                    float(loss_fn(model(heldout.histories), heldout.targets)),
                )
    final = float(loss_fn(model(history), targets).detach())
    heldout_final = float(loss_fn(model(heldout.histories), heldout.targets).detach())
    model.eval()
    return model, TrainingReport(
        initial,
        final,
        samples,
        epochs,
        teacher_backend=dataset.teacher_backend,
        train_samples=samples,
        heldout_samples=len(heldout.histories),
        train_seed=seed,
        heldout_seed=heldout_seed,
        train_stream_ids=tuple(int(value) for value in dataset.paired_future_stream_ids),
        heldout_stream_ids=tuple(int(value) for value in heldout.paired_future_stream_ids),
        heldout_initial_loss=heldout_initial,
        heldout_final_loss=heldout_final,
    )


@lru_cache(maxsize=4)
def trained_runtime_model(seed: int = 17, samples: int = 256, epochs: int = 30) -> BeliefModel:
    model, _ = train_belief_model(seed=seed, samples=samples, epochs=epochs)
    return model


@dataclass(frozen=True)
class ExportResult:
    onnx_path: Path
    quantized_path: Path | None
    runtime_verified: bool
    onnx_max_abs_error: float = float("inf")
    quantized_max_abs_error: float = float("inf")
    onnx_tolerance: float = 1e-5
    quantized_tolerance: float = 6e-2
    verification_batch_size: int = 0


def export_onnx_int8(model: BeliefModel, onnx_path: Path, quantized_path: Path) -> ExportResult:
    """Export ONNX and apply ORT dynamic INT8 quantization when available."""
    onnx_path.parent.mkdir(parents=True, exist_ok=True)
    model.eval()
    example = torch.zeros(1, 5, model.feature_dim)
    torch.onnx.export(
        model,
        example,
        onnx_path,
        input_names=["history"],
        output_names=["beliefs"],
        dynamic_axes={"history": {0: "batch", 1: "time"}, "beliefs": {0: "batch"}},
        opset_version=17,
        dynamo=False,
    )
    from onnxruntime.quantization import QuantType, quantize_dynamic

    quantize_dynamic(onnx_path, quantized_path, weight_type=QuantType.QInt8)
    import onnxruntime as ort

    verification_batch = np.linspace(
        -1.0,
        1.0,
        num=4 * 5 * model.feature_dim,
        dtype=np.float32,
    ).reshape(4, 5, model.feature_dim)
    with torch.inference_mode():
        torch_output = model(torch.from_numpy(verification_batch)).cpu().numpy()
    onnx_session = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    quantized_session = ort.InferenceSession(str(quantized_path), providers=["CPUExecutionProvider"])
    onnx_output = onnx_session.run(None, {"history": verification_batch})[0]
    quantized_output = quantized_session.run(None, {"history": verification_batch})[0]
    onnx_error = float(np.max(np.abs(onnx_output - torch_output)))
    quantized_error = float(np.max(np.abs(quantized_output - torch_output)))
    onnx_tolerance = 1e-5
    quantized_tolerance = 6e-2
    verified = (
        onnx_output.shape == torch_output.shape
        and quantized_output.shape == torch_output.shape
        and onnx_error <= onnx_tolerance
        and quantized_error <= quantized_tolerance
    )
    return ExportResult(
        onnx_path,
        quantized_path,
        verified,
        onnx_error,
        quantized_error,
        onnx_tolerance,
        quantized_tolerance,
        len(verification_batch),
    )
