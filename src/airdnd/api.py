from __future__ import annotations

import asyncio
from dataclasses import asdict
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
from typing import Any
from urllib.parse import quote
import uuid

from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
import torch

from .model import export_onnx_int8, train_belief_model

_SCENARIO_ID = re.compile(r"^[A-Za-z0-9_-]+$")
_FIXED_REPLAY_IDS = frozenset({"success", "miss_recovery", "miss-recovery"})
_LOCAL_FORBIDDEN_KEYS = frozenset(
    {
        "physical_id",
        "global_assignment",
        "global_assignments",
        "truth",
        "truth_state",
        "simulator_truth",
    }
)


class TrainingRunRequest(BaseModel):
    seed: int = Field(default=17, ge=0, le=2_147_483_647)
    samples: int = Field(default=256, ge=4, le=4096)
    epochs: int = Field(default=30, ge=1, le=500)


def _training_artifact(path: Path, data_root: Path, format_name: str) -> dict[str, Any]:
    relative = path.relative_to(data_root)
    run_id = relative.parts[1]
    return {
        "format": format_name,
        "path": relative.as_posix(),
        "download_url": (
            f"/api/training/runs/{quote(run_id, safe='')}/artifacts/"
            f"{quote(path.name, safe='')}"
        ),
        "size_bytes": path.stat().st_size,
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
    }


def _load_scenario(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if "events" not in data:
        return data
    scenario_id = path.stem
    frames = []
    for event in data["events"]:
        local = event.get("agent_local", {})
        agent_id = local.get("agent_id")
        frame = {
            "frame": event.get("presentation", {}).get("frame", len(frames)),
            "time_s": event["time_s"],
            "truth": event.get("truth", {}),
            "local_views": {agent_id: local} if agent_id else {},
            "presentation": event.get("presentation", {}),
            "event_kind": event.get("kind"),
        }
        frames.append(frame)
    return {
        "scenario": {
            "id": scenario_id,
            "name": scenario_id.replace("_", " ").replace("-", " ").title(),
            "seed": data.get("config", {}).get("seed"),
            "fixed": scenario_id in _FIXED_REPLAY_IDS,
        },
        "frames": frames,
    }


def _replay_path(data_root: Path, scenario_id: str) -> Path:
    for directory in ("scenarios", "replays"):
        candidate = data_root / directory / f"{scenario_id}.json"
        if candidate.is_file():
            return candidate
    return data_root / "scenarios" / f"{scenario_id}.json"


def _evidence_root(data_root: Path) -> Path:
    nested = data_root / "evidence"
    if (nested / "manifest.json").is_file():
        return nested
    return data_root


def _evidence_manifest(evidence_root: Path) -> dict[str, Any] | None:
    json_path = evidence_root / "manifest.json"
    if json_path.is_file():
        return json.loads(json_path.read_text(encoding="utf-8"))
    sha_path = evidence_root / "manifest.sha256"
    if not sha_path.is_file():
        return None
    files = []
    for line in sha_path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        digest, relative = line.split("  ", 1)
        files.append({"path": relative, "sha256": digest})
    return {"algorithm": "sha256", "files": files}


def _sanitize_local(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: _sanitize_local(item)
            for key, item in value.items()
            if key not in _LOCAL_FORBIDDEN_KEYS
        }
    if isinstance(value, list):
        return [_sanitize_local(item) for item in value]
    return value


def _telemetry_frame(
    frame: dict[str, Any],
    *,
    perspective: str,
    observer_id: str | None,
    evaluator_overlay: bool,
) -> dict[str, Any]:
    rendered: dict[str, Any] = {
        "type": "telemetry",
        "frame": frame["frame"],
        "time_s": frame["time_s"],
        "stream_role": "ground-station-display-only",
    }
    if frame.get("presentation"):
        rendered["presentation"] = frame["presentation"]
    if perspective == "local":
        local_view = frame.get("local_views", {}).get(observer_id)
        rendered["local_view"] = (
            _sanitize_local(local_view) if local_view is not None else None
        )
        if evaluator_overlay:
            rendered["evaluator_overlay"] = frame["truth"]
    else:
        rendered["overview"] = frame["truth"]
    return rendered


def create_app(*, data_root: Path | str = Path("artifacts")) -> FastAPI:
    """Create the local, display-only AirDnD HTTP/WebSocket service."""

    app = FastAPI(title="AirDnD API")
    app.state.data_root = Path(data_root)
    app.state.training_runs = {}
    app.state.training_tasks = set()
    app.state.training_semaphore = asyncio.Semaphore(1)

    async def execute_training(run_id: str, request: TrainingRunRequest) -> None:
        run = app.state.training_runs[run_id]
        async with app.state.training_semaphore:
            run["status"] = "running"
            loop = asyncio.get_running_loop()
            metrics: list[dict[str, Any]] = []
            workspace = app.state.data_root / "training" / run_id

            def publish_progress(epoch: int, train_loss: float, heldout_loss: float) -> None:
                value = {
                    "epoch": epoch,
                    "train_loss": train_loss,
                    "heldout_loss": heldout_loss,
                }
                metrics.append(value)
                loop.call_soon_threadsafe(run.__setitem__, "metrics", list(metrics))

            def train_and_export() -> tuple[dict[str, Any], list[dict[str, Any]]]:
                workspace.mkdir(parents=True, exist_ok=False)
                model, report = train_belief_model(
                    seed=request.seed,
                    samples=request.samples,
                    epochs=request.epochs,
                    epoch_callback=publish_progress,
                )
                pytorch_path = workspace / "belief-model.pt"
                torch.save(
                    {
                        "state_dict": model.state_dict(),
                        "feature_dim": model.feature_dim,
                        "hidden_dim": model.hidden_dim,
                    },
                    pytorch_path,
                )
                export = export_onnx_int8(
                    model,
                    workspace / "belief-model.onnx",
                    workspace / "belief-model.int8.onnx",
                )
                artifacts = [
                    _training_artifact(pytorch_path, app.state.data_root, "pytorch"),
                    {
                        **_training_artifact(export.onnx_path, app.state.data_root, "onnx"),
                        "runtime_verified": export.runtime_verified,
                        "max_abs_error": export.onnx_max_abs_error,
                    },
                ]
                if export.quantized_path is not None:
                    artifacts.append(
                        {
                            **_training_artifact(
                                export.quantized_path,
                                app.state.data_root,
                                "onnx-int8",
                            ),
                            "runtime_verified": export.runtime_verified,
                            "max_abs_error": export.quantized_max_abs_error,
                        }
                    )
                return asdict(report), artifacts

            try:
                report, artifacts = await asyncio.to_thread(train_and_export)
            except Exception as exc:
                run["status"] = "failed"
                run["metrics"] = list(metrics)
                run["error"] = f"{type(exc).__name__}: {exc}"
                return
            run["metrics"] = list(metrics)
            run["report"] = report
            run["artifacts"] = artifacts
            run["status"] = "completed"

    @app.get("/health")
    @app.get("/api/health", include_in_schema=False)
    def health() -> dict[str, str]:
        return {
            "status": "ok",
            "service": "airdnd-api",
            "stream_role": "ground-station-display-only",
        }

    @app.post("/api/training/runs", status_code=202)
    async def start_training(request: TrainingRunRequest) -> dict[str, Any]:
        run_id = uuid.uuid4().hex
        run = {
            "id": run_id,
            "status": "queued",
            "config": request.model_dump(),
            "metrics": [],
            "report": None,
            "artifacts": [],
            "error": None,
        }
        app.state.training_runs[run_id] = run
        task = asyncio.create_task(execute_training(run_id, request))
        app.state.training_tasks.add(task)
        task.add_done_callback(app.state.training_tasks.discard)
        return dict(run)

    @app.get("/api/training/runs/{run_id}")
    async def get_training(run_id: str) -> dict[str, Any]:
        run = app.state.training_runs.get(run_id)
        if run is None:
            raise HTTPException(status_code=404, detail="Training run not found")
        return run

    @app.get("/api/training/runs/{run_id}/artifacts/{filename}")
    async def training_artifact(run_id: str, filename: str) -> FileResponse:
        run = app.state.training_runs.get(run_id)
        if run is None or PurePosixPath(filename).name != filename:
            raise HTTPException(status_code=404, detail="Training artifact not found")
        artifact = next(
            (
                item
                for item in run.get("artifacts", [])
                if PurePosixPath(item["path"]).name == filename
            ),
            None,
        )
        if artifact is None:
            raise HTTPException(status_code=404, detail="Training artifact not found")
        training_root = (app.state.data_root / "training" / run_id).resolve()
        target = (app.state.data_root / artifact["path"]).resolve()
        if not target.is_file() or not target.is_relative_to(training_root):
            raise HTTPException(status_code=404, detail="Training artifact not found")
        return FileResponse(target, filename=target.name)

    @app.get("/api/scenarios")
    def scenarios() -> dict[str, list[dict[str, Any]]]:
        items = []
        paths = {
            path
            for directory in ("scenarios", "replays")
            for path in (app.state.data_root / directory).glob("*.json")
        }
        for path in sorted(paths):
            metadata = _load_scenario(path)["scenario"]
            if metadata.get("fixed") is True:
                items.append(metadata)
        return {"scenarios": items}

    @app.get("/api/scenarios/{scenario_id}/replay")
    def replay(
        scenario_id: str,
        perspective: str = Query("overview", pattern="^(overview|local)$"),
        observer_id: str | None = None,
        evaluator_overlay: bool = False,
    ) -> dict[str, Any]:
        path = _replay_path(app.state.data_root, scenario_id)
        if _SCENARIO_ID.fullmatch(scenario_id) is None or not path.is_file():
            raise HTTPException(status_code=404, detail="Scenario not found")
        replay_data = _load_scenario(path)
        if replay_data.get("scenario", {}).get("fixed") is not True:
            raise HTTPException(status_code=404, detail="Scenario not found")
        if perspective == "local":
            if observer_id is None:
                raise HTTPException(status_code=422, detail="observer_id is required")
            frames = []
            if not any(
                observer_id in frame.get("local_views", {})
                for frame in replay_data["frames"]
            ):
                raise HTTPException(status_code=404, detail="Local observer not found")
            for frame in replay_data["frames"]:
                local_view = frame.get("local_views", {}).get(observer_id)
                rendered = {
                    "frame": frame["frame"],
                    "time_s": frame["time_s"],
                    "local_view": (
                        _sanitize_local(local_view) if local_view is not None else None
                    ),
                }
                if frame.get("presentation"):
                    rendered["presentation"] = frame["presentation"]
                if evaluator_overlay:
                    rendered["evaluator_overlay"] = frame["truth"]
                frames.append(rendered)
            return {
                "scenario_id": scenario_id,
                "perspective": {"kind": "local", "observer_id": observer_id},
                "stream_role": "ground-station-display-only",
                "frames": frames,
            }
        frames = [
            {
                "frame": frame["frame"],
                "time_s": frame["time_s"],
                "overview": frame["truth"],
            }
            for frame in replay_data["frames"]
        ]
        return {
            "scenario_id": scenario_id,
            "perspective": {"kind": "overview"},
            "stream_role": "ground-station-display-only",
            "frames": frames,
        }

    @app.get("/api/evidence/manifest")
    def evidence_manifest() -> dict[str, Any]:
        evidence_root = _evidence_root(app.state.data_root)
        manifest = _evidence_manifest(evidence_root)
        if manifest is None:
            raise HTTPException(status_code=404, detail="Evidence manifest not found")
        manifest["files"] = [
            {
                **item,
                "download_url": f"/api/evidence/files/{quote(item['path'], safe='/')}",
            }
            for item in manifest.get("files", [])
        ]
        return manifest

    @app.get("/api/evidence/files/{file_path:path}")
    def evidence_file(file_path: str) -> FileResponse:
        relative = PurePosixPath(file_path)
        evidence_root = _evidence_root(app.state.data_root).resolve()
        manifest = _evidence_manifest(evidence_root)
        if relative.is_absolute() or ".." in relative.parts or manifest is None:
            raise HTTPException(status_code=404, detail="Evidence file not found")
        allowed = {item["path"] for item in manifest.get("files", [])}
        if file_path not in allowed:
            raise HTTPException(status_code=404, detail="Evidence file not found")
        target = (evidence_root / Path(*relative.parts)).resolve()
        if not target.is_file() or not target.is_relative_to(evidence_root):
            raise HTTPException(status_code=404, detail="Evidence file not found")
        return FileResponse(target, filename=target.name)

    @app.websocket("/ws/replay/{scenario_id}")
    async def replay_stream(websocket: WebSocket, scenario_id: str) -> None:
        perspective = websocket.query_params.get("perspective", "overview")
        observer_id = websocket.query_params.get("observer_id")
        evaluator_overlay = websocket.query_params.get("evaluator_overlay", "false").lower() in {
            "1",
            "true",
            "yes",
        }
        path = _replay_path(app.state.data_root, scenario_id)
        if (
            _SCENARIO_ID.fullmatch(scenario_id) is None
            or not path.is_file()
            or perspective not in {"overview", "local"}
            or (perspective == "local" and observer_id is None)
        ):
            await websocket.close(code=1008, reason="Invalid replay request")
            return
        replay_data = _load_scenario(path)
        if replay_data.get("scenario", {}).get("fixed") is not True:
            await websocket.close(code=1008, reason="Replay is not fixed")
            return
        frames = replay_data.get("frames", [])
        if not frames:
            await websocket.close(code=1008, reason="Replay has no frames")
            return
        if perspective == "local" and not any(
            observer_id in frame.get("local_views", {}) for frame in frames
        ):
            await websocket.close(code=1008, reason="Local observer not found")
            return
        first = _telemetry_frame(
            frames[0],
            perspective=perspective,
            observer_id=observer_id,
            evaluator_overlay=evaluator_overlay,
        )

        await websocket.accept()
        index = 0
        playing = False
        await websocket.send_json(first)
        try:
            while True:
                try:
                    if playing:
                        message = await asyncio.wait_for(
                            websocket.receive_json(), timeout=0.1
                        )
                    else:
                        message = await websocket.receive_json()
                except TimeoutError:
                    if index < len(frames) - 1:
                        index += 1
                        await websocket.send_json(
                            _telemetry_frame(
                                frames[index],
                                perspective=perspective,
                                observer_id=observer_id,
                                evaluator_overlay=evaluator_overlay,
                            )
                        )
                    else:
                        playing = False
                        await websocket.send_json(
                            {"type": "replay_state", "playing": False, "frame": index}
                        )
                    continue

                command = message.get("command")
                if command == "play":
                    playing = True
                    await websocket.send_json(
                        {"type": "replay_state", "playing": True, "frame": index}
                    )
                elif command == "pause":
                    playing = False
                    await websocket.send_json(
                        {"type": "replay_state", "playing": False, "frame": index}
                    )
                elif command == "seek":
                    requested_frame = message.get("frame")
                    matching = next(
                        (
                            position
                            for position, frame in enumerate(frames)
                            if frame.get("frame") == requested_frame
                        ),
                        None,
                    )
                    if matching is None:
                        await websocket.send_json(
                            {"type": "error", "detail": "Frame not found"}
                        )
                        continue
                    index = matching
                    await websocket.send_json(
                        _telemetry_frame(
                            frames[index],
                            perspective=perspective,
                            observer_id=observer_id,
                            evaluator_overlay=evaluator_overlay,
                        )
                    )
                elif command == "step":
                    playing = False
                    index = min(index + 1, len(frames) - 1)
                    await websocket.send_json(
                        _telemetry_frame(
                            frames[index],
                            perspective=perspective,
                            observer_id=observer_id,
                            evaluator_overlay=evaluator_overlay,
                        )
                    )
                else:
                    await websocket.send_json(
                        {"type": "error", "detail": "Unknown replay command"}
                    )
        except WebSocketDisconnect:
            return

    return app


app = create_app(data_root=Path("evidence"))

