import hashlib
import json

from airdnd.benchmark import generate_evidence, paired_interval, run_benchmark
from airdnd.simulation import BASELINES


def test_paired_interval_reports_mean_and_95_percent_ci():
    stats = paired_interval([1.0, 2.0, 3.0, 4.0])
    assert stats["n"] == 4
    assert stats["mean"] == 2.5
    assert stats["ci95_low"] < 2.5 < stats["ci95_high"]


def test_benchmark_runs_paired_methods_and_marks_claims_contingent_on_results():
    result = run_benchmark(seeds=[1, 2, 3], hostiles=20, interceptors=25)
    assert set(result["methods"]) == set(BASELINES)
    assert result["paired_seed_count"] == 3
    assert result["statistics"]["airdnd"]["leakage"]["denominator"] == 60
    assert {"p50_ms", "p95_ms", "p99_ms"} <= result["statistics"]["airdnd"]["latency"].keys()
    assert result["learned_model_runtime_used"] is True
    assert result["claims"]["ac_020"] in {"pass", "fail", "insufficient_evidence"}
    assert result["claims"]["note"] == "AC pass claims are contingent on generated simulation results"


def test_evidence_generation_writes_replay_raw_reports_models_and_valid_manifest(tmp_path):
    result = generate_evidence(tmp_path, seeds=[1, 2, 3], hostiles=20, interceptors=25)
    required = {
        "raw/benchmark.jsonl",
        "raw/benchmark.csv",
        "reports/benchmark.json",
        "replays/success.json",
        "replays/miss_recovery.json",
        "models/belief.pt",
        "models/belief.onnx",
        "models/belief.int8.onnx",
        "models/training_dataset_manifest.json",
        "reports/reserve_sensitivity.json",
        "reports/scaling.json",
        "reports/system_profile.json",
        "final-report.json",
        "manifest.sha256",
    }
    assert required <= set(result["files"])
    lines = (tmp_path / "manifest.sha256").read_text().splitlines()
    for line in lines:
        digest, relative = line.split("  ", 1)
        assert hashlib.sha256((tmp_path / relative).read_bytes()).hexdigest() == digest
    report = json.loads((tmp_path / "reports/benchmark.json").read_text())
    final_report = json.loads((tmp_path / "final-report.json").read_text())
    model_report = json.loads((tmp_path / "models/model_report.json").read_text())
    dataset_manifest = json.loads((tmp_path / "models/training_dataset_manifest.json").read_text())
    assert final_report["paired_seeds"] == 3
    assert final_report["final"] is False
    assert final_report["acceptance"]["AC-021"]["passed"] is False
    assert model_report["onnx_runtime_verified"]
    assert dataset_manifest["label_source"] == "paired_local_counterfactual_ortools_teacher"
    assert dataset_manifest["teacher_backend"] == "ortools"
    assert dataset_manifest["paired_future_streams"] == 256
    assert model_report["onnx_int8_size_bytes"] > 0
    assert {"p50", "p95", "p99"} <= set(model_report["onnx_int8_latency_ms"])
    assert report["evidence_class"] == "simulation_evidence"
    assert report["state_schema_separation"] == ["simulator_truth", "agent_local", "presentation"]
