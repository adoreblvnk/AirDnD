#!/usr/bin/env python3
"""Generate reproducible AirDnD simulation evidence artifacts."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import shutil

from airdnd.benchmark import generate_evidence


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path("evidence"))
    parser.add_argument("--models-output", type=Path, default=Path("models"))
    parser.add_argument("--seeds", type=int, default=30)
    parser.add_argument("--hostiles", type=int, default=100)
    parser.add_argument("--interceptors", type=int, default=125)
    args = parser.parse_args()
    result = generate_evidence(args.output, range(args.seeds), args.hostiles, args.interceptors)
    args.models_output.mkdir(parents=True, exist_ok=True)
    for artifact in (args.output / "models").iterdir():
        if artifact.is_file():
            shutil.copy2(artifact, args.models_output / artifact.name)
    print(json.dumps({"output": str(args.output), "file_count": len(result["files"]), "claims": result["report"]["claims"]}, sort_keys=True))


if __name__ == "__main__":
    main()
