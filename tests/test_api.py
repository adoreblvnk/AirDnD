import json
import hashlib
from pathlib import Path
import time

import pytest
from starlette.testclient import TestClient

from airdnd.api import create_app


def _write_scenario(root: Path, scenario_id: str = "success") -> None:
    scenario_dir = root / "scenarios"
    scenario_dir.mkdir(parents=True)
    (scenario_dir / f"{scenario_id}.json").write_text(
        json.dumps(
            {
                "scenario": {
                    "id": scenario_id,
                    "name": "Successful interception",
                    "seed": 23,
                    "fixed": True,
                },
                "frames": [
                    {
                        "frame": 0,
                        "time_s": 0.0,
                        "truth": {
                            "entities": [
                                {
                                    "physical_id": "hostile-physical-1",
                                    "truth_state": "alive",
                                    "position": [10.0, 20.0, 30.0],
                                }
                            ],
                            "global_assignments": {"I0": "hostile-physical-1"},
                        },
                        "local_views": {
                            "I0": {
                                "agent_id": "I0",
                                "tracks": [
                                    {
                                        "local_track_id": "A-12",
                                        "position_estimate": [9.5, 20.5, 30.0],
                                        "physical_id": "hostile-physical-1",
                                        "truth_state": "alive",
                                    }
                                ],
                                "selected_local_track_id": "A-12",
                                "global_assignments": {"I0": "hostile-physical-1"},
                            }
                        },
                    },
                    {
                        "frame": 1,
                        "time_s": 0.1,
                        "truth": {
                            "entities": [
                                {
                                    "physical_id": "hostile-physical-1",
                                    "truth_state": "neutralized",
                                    "position": [11.0, 21.0, 30.0],
                                }
                            ],
                            "global_assignments": {},
                        },
                        "local_views": {
                            "I0": {
                                "agent_id": "I0",
                                "tracks": [
                                    {
                                        "local_track_id": "A-12",
                                        "position_estimate": [10.5, 21.5, 30.0],
                                        "physical_id": "hostile-physical-1",
                                    }
                                ],
                                "selected_local_track_id": "A-12",
                            }
                        },
                    },
                ],
            }
        )
    )


def _write_generated_replay(root: Path) -> None:
    replay_dir = root / "replays"
    replay_dir.mkdir(parents=True)
    (replay_dir / "success.json").write_text(
        json.dumps(
            {
                "config": {"seed": 101, "method": "airdnd"},
                "events": [
                    {
                        "time_s": 0.0,
                        "kind": "track_observed",
                        "truth": {"hostile_id": "H000", "position": [1, 2, 3]},
                        "agent_local": {
                            "agent_id": "I000",
                            "local_track_id": "I000-abcd",
                            "noisy_position": [1.1, 2.1, 3.1],
                        },
                        "presentation": {"frame": 0, "label": "local observation"},
                    },
                    {
                        "time_s": 0.1,
                        "kind": "coverage_expired",
                        "truth": {"hostile_id": "H000"},
                        "agent_local": {"coverage_probability": 0.0},
                        "presentation": {"frame": 1, "label": "coverage expired"},
                    },
                ],
                "schema_version": "1.0",
                "evidence_class": "simulation_evidence",
            }
        )
    )
    raw_dir = root / "raw"
    raw_dir.mkdir()
    (raw_dir / "benchmark.csv").write_bytes(b"seed,method\n101,airdnd\n")
    (root / "manifest.sha256").write_text(
        "fixture-digest  raw/benchmark.csv\n"
    )


def _write_evidence(root: Path) -> bytes:
    evidence_dir = root / "evidence"
    raw_dir = evidence_dir / "raw"
    raw_dir.mkdir(parents=True)
    exact_bytes = b'{"seed":23,"event":"NEUTRALIZED"}\n'
    (raw_dir / "events.jsonl").write_bytes(exact_bytes)
    (evidence_dir / "manifest.json").write_text(
        json.dumps(
            {
                "git_revision": "abc123",
                "files": [
                    {
                        "path": "raw/events.jsonl",
                        "sha256": "fixture-sha256",
                    }
                ],
            }
        )
    )
    return exact_bytes


def test_health_identifies_display_only_ground_station_stream(tmp_path: Path) -> None:
    client = TestClient(create_app(data_root=tmp_path))

    response = client.get("/health")
    api_response = client.get("/api/health")

    assert response.status_code == 200
    assert api_response.json() == response.json()
    assert response.json() == {
        "status": "ok",
        "service": "airdnd-api",
        "stream_role": "ground-station-display-only",
    }


def test_scenarios_lists_only_fixed_replay_metadata(tmp_path: Path) -> None:
    _write_scenario(tmp_path)
    client = TestClient(create_app(data_root=tmp_path))

    response = client.get("/api/scenarios")

    assert response.status_code == 200
    assert response.json() == {
        "scenarios": [
            {
                "id": "success",
                "name": "Successful interception",
                "seed": 23,
                "fixed": True,
            }
        ]
    }


def test_api_reads_generated_fixed_replay_layout(tmp_path: Path) -> None:
    _write_generated_replay(tmp_path)
    client = TestClient(create_app(data_root=tmp_path))

    scenarios = client.get("/api/scenarios")
    replay = client.get(
        "/api/scenarios/success/replay",
        params={"perspective": "local", "observer_id": "I000"},
    )

    assert scenarios.json() == {
        "scenarios": [
            {"id": "success", "name": "Success", "seed": 101, "fixed": True}
        ]
    }
    assert replay.status_code == 200
    frame = replay.json()["frames"][0]
    assert frame["local_view"]["local_track_id"] == "I000-abcd"
    assert frame["presentation"]["label"] == "local observation"
    assert replay.json()["frames"][1]["local_view"] is None
    assert replay.json()["frames"][1]["presentation"]["label"] == "coverage expired"
    assert "hostile_id" not in json.dumps(replay.json()["frames"])

    manifest = client.get("/api/evidence/manifest")
    download = client.get("/api/evidence/files/raw/benchmark.csv")
    assert manifest.json()["files"] == [
        {
            "path": "raw/benchmark.csv",
            "sha256": "fixture-digest",
            "download_url": "/api/evidence/files/raw/benchmark.csv",
        }
    ]
    assert download.content == b"seed,method\n101,airdnd\n"


def test_replay_accepts_path_safe_hyphenated_scenario_ids(tmp_path: Path) -> None:
    _write_scenario(tmp_path, scenario_id="miss-recovery")
    client = TestClient(create_app(data_root=tmp_path))

    response = client.get("/api/scenarios/miss-recovery/replay")

    assert response.status_code == 200
    assert response.json()["scenario_id"] == "miss-recovery"


def test_replay_rejects_non_fixed_scenarios(tmp_path: Path) -> None:
    _write_scenario(tmp_path)
    path = tmp_path / "scenarios" / "success.json"
    data = json.loads(path.read_text())
    data["scenario"]["fixed"] = False
    path.write_text(json.dumps(data))
    client = TestClient(create_app(data_root=tmp_path))

    response = client.get("/api/scenarios/success/replay")

    assert response.status_code == 404


def test_local_replay_omits_truth_physical_ids_and_global_assignments(tmp_path: Path) -> None:
    _write_scenario(tmp_path)
    client = TestClient(create_app(data_root=tmp_path))

    response = client.get(
        "/api/scenarios/success/replay",
        params={"perspective": "local", "observer_id": "I0"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["perspective"] == {"kind": "local", "observer_id": "I0"}
    assert payload["frames"][0] == {
        "frame": 0,
        "time_s": 0.0,
        "local_view": {
            "agent_id": "I0",
            "tracks": [
                {
                    "local_track_id": "A-12",
                    "position_estimate": [9.5, 20.5, 30.0],
                }
            ],
            "selected_local_track_id": "A-12",
        },
    }
    assert len(payload["frames"]) == 2
    encoded = json.dumps(payload)
    for forbidden in ("truth", "physical_id", "global_assignments"):
        assert forbidden not in encoded


def test_local_replay_adds_truth_only_in_separate_requested_overlay(tmp_path: Path) -> None:
    _write_scenario(tmp_path)
    client = TestClient(create_app(data_root=tmp_path))

    response = client.get(
        "/api/scenarios/success/replay",
        params={
            "perspective": "local",
            "observer_id": "I0",
            "evaluator_overlay": True,
        },
    )

    assert response.status_code == 200
    frame = response.json()["frames"][0]
    assert "physical_id" not in json.dumps(frame["local_view"])
    assert frame["evaluator_overlay"] == {
        "entities": [
            {
                "physical_id": "hostile-physical-1",
                "truth_state": "alive",
                "position": [10.0, 20.0, 30.0],
            }
        ],
        "global_assignments": {"I0": "hostile-physical-1"},
    }


def test_evidence_manifest_and_download_preserve_exact_artifact(tmp_path: Path) -> None:
    exact_bytes = _write_evidence(tmp_path)
    client = TestClient(create_app(data_root=tmp_path))

    manifest = client.get("/api/evidence/manifest")
    download = client.get("/api/evidence/files/raw/events.jsonl")

    assert manifest.status_code == 200
    assert manifest.json()["git_revision"] == "abc123"
    assert manifest.json()["files"][0]["download_url"] == (
        "/api/evidence/files/raw/events.jsonl"
    )
    assert download.status_code == 200
    assert download.content == exact_bytes


def test_evidence_download_rejects_unlisted_and_traversal_paths(tmp_path: Path) -> None:
    _write_evidence(tmp_path)
    (tmp_path / "secret.txt").write_text("not evidence")
    client = TestClient(create_app(data_root=tmp_path))

    unlisted = client.get("/api/evidence/files/manifest.json")
    traversal = client.get("/api/evidence/files/%2E%2E/secret.txt")

    assert unlisted.status_code == 404
    assert traversal.status_code == 404


def test_websocket_local_replay_supports_step_seek_play_and_pause(tmp_path: Path) -> None:
    _write_scenario(tmp_path)
    client = TestClient(create_app(data_root=tmp_path))

    with client.websocket_connect(
        "/ws/replay/success?perspective=local&observer_id=I0"
    ) as websocket:
        initial = websocket.receive_json()
        assert initial["type"] == "telemetry"
        assert initial["frame"] == 0
        assert "physical_id" not in json.dumps(initial)

        websocket.send_json({"command": "step"})
        assert websocket.receive_json()["frame"] == 1

        websocket.send_json({"command": "seek", "frame": 0})
        assert websocket.receive_json()["frame"] == 0

        websocket.send_json({"command": "play"})
        playing = websocket.receive_json()
        assert playing == {"type": "replay_state", "playing": True, "frame": 0}

        websocket.send_json({"command": "pause"})
        paused = websocket.receive_json()
        assert paused == {"type": "replay_state", "playing": False, "frame": 0}


def test_training_run_completes_with_real_metrics_report_and_artifacts(tmp_path: Path) -> None:
    with TestClient(create_app(data_root=tmp_path)) as client:
        started = client.post(
            "/api/training/runs",
            json={"seed": 29, "samples": 8, "epochs": 2},
        )

        assert started.status_code == 202
        run_id = started.json()["id"]
        assert started.json()["status"] == "queued"

        deadline = time.monotonic() + 30.0
        response = client.get(f"/api/training/runs/{run_id}")
        while time.monotonic() < deadline:
            response = client.get(f"/api/training/runs/{run_id}")
            if response.json()["status"] in {"completed", "failed"}:
                break
            time.sleep(0.02)

        result = response.json()
        assert result["status"] == "completed", result.get("error")
        assert [metric["epoch"] for metric in result["metrics"]] == [1, 2]
        assert all(metric["train_loss"] >= 0.0 for metric in result["metrics"])
        assert all(metric["heldout_loss"] >= 0.0 for metric in result["metrics"])
        assert result["report"]["samples"] == 8
        assert result["report"]["epochs"] == 2
        assert result["report"]["final_loss"] == result["metrics"][-1]["train_loss"]
        assert {artifact["format"] for artifact in result["artifacts"]} == {
            "pytorch",
            "onnx",
            "onnx-int8",
        }
        for artifact in result["artifacts"]:
            path = tmp_path / artifact["path"]
            assert path.is_relative_to(tmp_path / "training" / run_id)
            assert path.is_file()
            assert artifact["size_bytes"] == path.stat().st_size
            assert artifact["sha256"] == hashlib.sha256(path.read_bytes()).hexdigest()
            assert artifact["download_url"] == (
                f"/api/training/runs/{run_id}/artifacts/{path.name}"
            )
            download = client.get(artifact["download_url"])
            assert download.status_code == 200
            assert download.content == path.read_bytes()


def test_training_artifact_download_rejects_unknown_file(tmp_path: Path) -> None:
    client = TestClient(create_app(data_root=tmp_path))

    response = client.get("/api/training/runs/not-a-run/artifacts/belief-model.pt")

    assert response.status_code == 404
    assert response.json() == {"detail": "Training artifact not found"}


@pytest.mark.parametrize(
    "payload",
    [
        {"seed": -1, "samples": 8, "epochs": 1},
        {"seed": 2_147_483_648, "samples": 8, "epochs": 1},
        {"seed": 1, "samples": 3, "epochs": 1},
        {"seed": 1, "samples": 4097, "epochs": 1},
        {"seed": 1, "samples": 8, "epochs": 0},
        {"seed": 1, "samples": 8, "epochs": 501},
    ],
)
def test_training_run_validates_bounded_inputs(tmp_path: Path, payload: dict[str, int]) -> None:
    client = TestClient(create_app(data_root=tmp_path))

    assert client.post("/api/training/runs", json=payload).status_code == 422


def test_training_run_returns_404_for_unknown_id(tmp_path: Path) -> None:
    client = TestClient(create_app(data_root=tmp_path))

    response = client.get("/api/training/runs/unknown")

    assert response.status_code == 404
    assert response.json() == {"detail": "Training run not found"}
