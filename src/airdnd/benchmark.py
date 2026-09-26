from __future__ import annotations

import csv
from dataclasses import asdict
import hashlib
import json
import math
from pathlib import Path
import platform
import statistics
import subprocess
import time
from typing import Iterable

import numpy as np
import torch

from .model import export_onnx_int8, train_belief_model
from .simulation import BASELINES, ScenarioConfig, run_fixed_replay, run_scenario


def _system_profile() -> dict:
    profile = {"model": platform.machine(), "memory_gb": None, "artifact": "reports/system_profile.json"}
    if platform.system() != "Darwin":
        return profile
    try:
        raw = subprocess.check_output(["system_profiler", "SPHardwareDataType", "-json"], text=True)
        hardware = json.loads(raw)["SPHardwareDataType"][0]
        memory_text = str(hardware.get("physical_memory", ""))
        profile.update({
            "model": f"{hardware.get('machine_name', 'Mac')} {hardware.get('chip_type', '')}".strip(),
            "machine_model": hardware.get("machine_model"),
            "memory_gb": int(memory_text.split()[0]) if memory_text else None,
            "processor_layout": hardware.get("number_processors"),
            "privacy": "Serial number, platform UUID, and device identifiers intentionally omitted",
        })
    except (KeyError, ValueError, subprocess.CalledProcessError, FileNotFoundError, json.JSONDecodeError):
        pass
    return profile


def paired_interval(values: Iterable[float]) -> dict[str, float | int]:
    data = [float(value) for value in values]
    if not data:
        raise ValueError("at least one value is required")
    mean = statistics.fmean(data)
    std = statistics.stdev(data) if len(data) > 1 else 0.0
    half_width = 1.96 * std / math.sqrt(len(data)) if len(data) > 1 else 0.0
    return {
        "n": len(data),
        "mean": mean,
        "median": statistics.median(data),
        "std": std,
        "ci95_low": mean - half_width,
        "ci95_high": mean + half_width,
    }


def _percentile(values: list[float], percentile: float) -> float:
    return float(np.percentile(np.asarray(values), percentile)) if values else 0.0


def _calibration(records: list[dict]) -> dict:
    probabilities: list[float] = []
    outcomes: list[float] = []
    for record in records:
        if record["method"] != "airdnd":
            continue
        attempts = {
            (event["truth"]["hostile_id"], event["truth"]["interceptor_id"]): event
            for event in record["events"]
            if event["kind"] == "engagement_attempt"
        }
        for event in record["events"]:
            if event["kind"] != "policy_decision" or event["agent_local"].get("belief_source") != "trained_multihead_model":
                continue
            key = (event["truth"]["hostile_id"], event["truth"]["interceptor_id"])
            if key in attempts:
                probabilities.append(float(event["agent_local"]["belief"]["action_success_probability"]))
                outcomes.append(float(attempts[key]["truth"]["outcome"]))
    if not probabilities:
        return {"brier_score": None, "ece": None, "reliability_bins": []}
    probs = np.asarray(probabilities)
    actual = np.asarray(outcomes)
    bins: list[dict] = []
    ece = 0.0
    for lower in np.linspace(0.0, 0.9, 10):
        upper = lower + 0.1
        mask = (probs >= lower) & (probs < upper if upper < 1.0 else probs <= upper)
        count = int(mask.sum())
        if count:
            predicted = float(probs[mask].mean())
            observed = float(actual[mask].mean())
            ece += count / len(probs) * abs(predicted - observed)
            bins.append({"lower": float(lower), "upper": float(upper), "count": count, "mean_prediction": predicted, "observed_frequency": observed})
    return {"brier_score": float(np.mean((probs - actual) ** 2)), "ece": ece, "reliability_bins": bins, "samples": len(probs)}


def run_benchmark(seeds: Iterable[int], hostiles: int = 100, interceptors: int = 125) -> dict:
    seed_list = list(seeds)
    if not seed_list:
        raise ValueError("at least one seed is required")
    records: list[dict] = []
    latencies: dict[str, list[float]] = {method: [] for method in BASELINES}
    by_method: dict[str, list] = {method: [] for method in BASELINES}
    for seed in seed_list:
        for method in BASELINES:
            started = time.perf_counter_ns()
            result = run_scenario(ScenarioConfig(hostiles, interceptors, seed, method))
            elapsed_ms = (time.perf_counter_ns() - started) / 1_000_000
            per_agent_ms = elapsed_ms / interceptors
            latencies[method].append(per_agent_ms)
            by_method[method].append(result)
            record = result.to_dict()
            record.update({"method": method, "seed": seed, "per_agent_compute_ms": per_agent_ms})
            records.append(record)
    statistics_by_method: dict[str, dict] = {}
    for method, results in by_method.items():
        leak_counts = [result.metrics.leaked for result in results]
        leak_rates = [count / hostiles for count in leak_counts]
        duplicate_counts = [result.metrics.duplicate_pursuits for result in results]
        neutralization_rates = [result.metrics.cumulative_neutralization for result in results]
        coverage = [result.metrics.retained_coverage for result in results]
        separation = [result.metrics.minimum_separation_m for result in results]
        recovery = [result.metrics.recovery_count for result in results]
        statistics_by_method[method] = {
            "leakage": {**paired_interval(leak_rates), "numerator": sum(leak_counts), "denominator": hostiles * len(results)},
            "duplicate_pursuit": {**paired_interval(duplicate_counts), "numerator": sum(duplicate_counts), "denominator": hostiles * len(results)},
            "cumulative_neutralization": paired_interval(neutralization_rates),
            "retained_coverage": paired_interval(coverage),
            "minimum_separation_m": paired_interval(separation),
            "recovery_count": paired_interval(recovery),
            "latency": {"p50_ms": _percentile(latencies[method], 50), "p95_ms": _percentile(latencies[method], 95), "p99_ms": _percentile(latencies[method], 99)},
            "completed_runs": sum(result.metrics.completed for result in results),
            "entity_drops": sum(result.metrics.entity_drops for result in results),
            "friendly_collisions": sum(result.metrics.friendly_collisions for result in results),
        }
    air_leaks = [r.metrics.leaked / hostiles for r in by_method["airdnd"]]
    comparisons: dict[str, dict] = {}
    for baseline in ("naive_static", "independent_greedy", "deterministic_ablation"):
        base = [r.metrics.leaked / hostiles for r in by_method[baseline]]
        delta = [b - a for b, a in zip(base, air_leaks)]
        comparisons[baseline] = {
            "leakage_reduction_absolute": paired_interval(delta),
            "leakage_reduction_relative_mean": statistics.fmean(delta) / statistics.fmean(base) if statistics.fmean(base) else 0.0,
        }
    greedy_dupes = [r.metrics.duplicate_pursuits for r in by_method["independent_greedy"]]
    air_dupes = [r.metrics.duplicate_pursuits for r in by_method["airdnd"]]
    duplicate_delta = paired_interval([g - a for g, a in zip(greedy_dupes, air_dupes)])
    enough = len(seed_list) >= 30
    ac20 = enough and comparisons["naive_static"]["leakage_reduction_absolute"]["ci95_low"] > 0 and comparisons["independent_greedy"]["leakage_reduction_absolute"]["ci95_low"] > 0
    learned_model_runtime_used = bool(by_method["airdnd"]) and all(
        any(
            event.kind == "policy_decision"
            and event.agent_local.get("belief_source") == "trained_multihead_model"
            and event.agent_local.get("inference_executed") is True
            and "belief" in event.agent_local
            for event in result.events
        )
        for result in by_method["airdnd"]
    )
    ac21 = enough and learned_model_runtime_used and comparisons["deterministic_ablation"]["leakage_reduction_absolute"]["ci95_low"] > 0
    ac31 = enough and duplicate_delta["ci95_low"] > 0
    def status(value: bool) -> str:
        return "insufficient_evidence" if not enough else ("pass" if value else "fail")
    return {
        "schema_version": "1.0",
        "evidence_class": "simulation_evidence",
        "state_schema_separation": ["simulator_truth", "agent_local", "presentation"],
        "paired_seed_count": len(seed_list),
        "seeds": seed_list,
        "hostiles": hostiles,
        "interceptors": interceptors,
        "methods": list(BASELINES),
        "statistics": statistics_by_method,
        "paired_comparisons": comparisons,
        "observer_duplicate_reduction": duplicate_delta,
        "calibration": _calibration(records),
        "learned_model_runtime_used": learned_model_runtime_used,
        "claims": {"ac_020": status(ac20), "ac_021": status(ac21), "ac_031": status(ac31), "note": "AC pass claims are contingent on generated simulation results"},
        "records": records,
    }


def _write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")


def generate_evidence(output_dir: Path, seeds: Iterable[int] = range(30), hostiles: int = 100, interceptors: int = 125) -> dict:
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    benchmark = run_benchmark(seeds, hostiles, interceptors)
    records = benchmark.pop("records")
    try:
        revision = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True, cwd=Path.cwd()).strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        revision = "unavailable"
    benchmark.update({"git_revision": revision, "host": {"platform": platform.platform(), "machine": platform.machine(), "python": platform.python_version()}, "safety_note": "INS, barometer, IFF, path generation, collision filtering, and engagement outcomes are simulation evidence; collision filtering uses vendored snape/RVO2-3D revision c726b3c537639ca2cf202c49bcae0f6b7889f344."})
    raw_jsonl = output_dir / "raw/benchmark.jsonl"
    raw_jsonl.parent.mkdir(parents=True, exist_ok=True)
    raw_jsonl.write_text("".join(json.dumps(record, sort_keys=True) + "\n" for record in records))
    raw_csv = output_dir / "raw/benchmark.csv"
    with raw_csv.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["seed", "method", "hostiles", "neutralized", "leaked", "duplicate_pursuits", "recovery_count", "minimum_separation_m", "per_agent_compute_ms"])
        writer.writeheader()
        for record in records:
            metrics = record["metrics"]
            writer.writerow({"seed": record["seed"], "method": record["method"], "hostiles": metrics["hostiles_total"], "neutralized": metrics["neutralized"], "leaked": metrics["leaked"], "duplicate_pursuits": metrics["duplicate_pursuits"], "recovery_count": metrics["recovery_count"], "minimum_separation_m": metrics["minimum_separation_m"], "per_agent_compute_ms": record["per_agent_compute_ms"]})
    _write_json(output_dir / "reports/benchmark.json", benchmark)
    sensitivity: list[dict] = []
    for ratio in (0.10, 0.15, 0.20, 0.25, 0.30, 0.33):
        ratio_results = [run_scenario(ScenarioConfig(hostiles, interceptors, seed, "airdnd", reserve_ratio=ratio)) for seed in benchmark["seeds"]]
        sensitivity.append({"reserve_ratio": ratio, "seeds": len(ratio_results), "leakage": paired_interval([r.metrics.leaked / hostiles for r in ratio_results]), "retained_coverage": paired_interval([r.metrics.retained_coverage for r in ratio_results]), "recovery_count": paired_interval([r.metrics.recovery_count for r in ratio_results])})
    _write_json(output_dir / "reports/reserve_sensitivity.json", {"evidence_class": "simulation_evidence", "results": sensitivity, "selection": "No threshold-derived selection is claimed until thresholds are frozen."})
    scaling: list[dict] = []
    for count in (20, 40, 60, 80, 100):
        started = time.perf_counter_ns()
        scale_result = run_scenario(ScenarioConfig(count, max(25, math.ceil(count * 1.25)), benchmark["seeds"][0], "airdnd"))
        elapsed_ms = (time.perf_counter_ns() - started) / 1_000_000
        scaling.append({"hostiles": count, "completed": scale_result.metrics.completed, "entity_drops": scale_result.metrics.entity_drops, "elapsed_ms": elapsed_ms, "per_entity_ms": elapsed_ms / count})
    _write_json(output_dir / "reports/scaling.json", {"evidence_class": "simulation_evidence", "results": scaling})
    _write_json(output_dir / "replays/success.json", run_fixed_replay("success").to_dict())
    _write_json(output_dir / "replays/miss_recovery.json", run_fixed_replay("miss_recovery").to_dict())
    model, training = train_belief_model()
    models = output_dir / "models"
    models.mkdir(parents=True, exist_ok=True)
    torch.save({"state_dict": model.state_dict(), "training": asdict(training)}, models / "belief.pt")
    export = export_onnx_int8(model, models / "belief.onnx", models / "belief.int8.onnx")
    import onnxruntime as ort
    session = ort.InferenceSession(str(models / "belief.int8.onnx"), providers=["CPUExecutionProvider"])
    sample = np.zeros((1, 5, model.feature_dim), dtype=np.float32)
    for _ in range(10):
        session.run(None, {"history": sample})
    inference_ms: list[float] = []
    for _ in range(200):
        started = time.perf_counter_ns()
        session.run(None, {"history": sample})
        inference_ms.append((time.perf_counter_ns() - started) / 1_000_000)
    latency = {"p50": _percentile(inference_ms, 50), "p95": _percentile(inference_ms, 95), "p99": _percentile(inference_ms, 99)}
    int8_size = (models / "belief.int8.onnx").stat().st_size
    model_report = {**asdict(training), "onnx_runtime_verified": export.runtime_verified, "quantization": "dynamic INT8", "onnx_int8_size_bytes": int8_size, "onnx_int8_latency_ms": latency, "measured_decision_hz_at_p95": 1000.0 / latency["p95"], "model_input": "agent-local track history only"}
    _write_json(models / "model_report.json", model_report)
    _write_json(models / "training_dataset_manifest.json", {
        "label_source": training.label_source,
        "teacher_backend": training.teacher_backend,
        "samples": training.samples,
        "paired_future_streams": training.samples,
        "counterfactual_branches": ["no_focal_action", "focal_action", "other_friendly_action"],
        "model_inputs": "agent-local relative track history only",
        "teacher_inputs": "offline simulator truth for labels only",
        "feature_shape": [training.samples, 5, 12],
        "label_heads": ["leak", "action_success", "friendly_coverage", "intercept_time", "intercept_point_xyz", "coverage_expiry", "confidence"],
        "seed": 17,
    })
    frozen = {"tie_epsilon": 0.02, "switch_margin_base": 0.05, "switch_margin_progress": 0.10, "switch_ticks": 3, "coverage_window_s": 4.2, "minimum_separation_m": 8.0, "claim_delay_step_s": 0.15}
    _write_json(output_dir / "configs/frozen_parameters.json", frozen)
    profile = _system_profile()
    _write_json(output_dir / "reports/system_profile.json", profile)
    configuration = {"paired_seeds": len(benchmark["seeds"]), "hostiles": hostiles, "interceptors": interceptors, "methods": list(BASELINES), "frozen_parameters": frozen}
    configuration_hash = hashlib.sha256(json.dumps(configuration, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    enough = len(benchmark["seeds"]) >= 30
    host_pass = "M3" in str(profile.get("model")) and profile.get("memory_gb") == 24
    _write_json(output_dir / "final-report.json", {
        "final": enough,
        "evidence_class": "simulation_evidence",
        "paired_seeds": len(benchmark["seeds"]),
        "git_revision": revision,
        "configuration": configuration,
        "configuration_hash": configuration_hash,
        "benchmark_report": "reports/benchmark.json",
        "host": {**profile, "system_profile_artifact": "reports/system_profile.json"},
        "acceptance": {
            "AC-019": {"passed": bool(export.runtime_verified and int8_size < 15_000_000 and latency["p95"] < 2.0), "scope": "Apple Silicon host inference only"},
            "AC-020": {"passed": benchmark["claims"]["ac_020"] == "pass", "scope": "generated paired simulation"},
            "AC-021": {"passed": benchmark["claims"]["ac_021"] == "pass", "scope": "generated paired simulation"},
            "AC-026": {"passed": host_pass, "scope": "benchmark host identity"},
            "AC-031": {"passed": benchmark["claims"]["ac_031"] == "pass", "scope": "generated paired simulation"},
        },
        "limitations": [
            "Collision filtering uses the official vendored snape/RVO2-3D implementation; separation remains simulation evidence, not a physical guarantee",
            "INS, barometer, IFF, guidance, engagement, and separation results are simulation evidence",
            "No flight or hardware validation is implied",
        ],
    })
    manifest_lines: list[str] = []
    for path in sorted(p for p in output_dir.rglob("*") if p.is_file() and p.name != "manifest.sha256"):
        relative = path.relative_to(output_dir).as_posix()
        manifest_lines.append(f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {relative}")
    (output_dir / "manifest.sha256").write_text("\n".join(manifest_lines) + "\n")
    files = [path.relative_to(output_dir).as_posix() for path in sorted(p for p in output_dir.rglob("*") if p.is_file())]
    return {"files": files, "report": benchmark}
