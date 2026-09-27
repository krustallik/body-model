from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path, PurePosixPath
import zipfile


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def safe_extract(archive: zipfile.ZipFile, destination: Path) -> None:
    root = destination.resolve()
    for info in archive.infolist():
        relative = PurePosixPath(info.filename)
        if relative.is_absolute() or any(part in {"..", ""} for part in relative.parts):
            raise ValueError(f"Unsafe archive member path: {info.filename!r}")
        output = (root / Path(*relative.parts)).resolve()
        if output != root and root not in output.parents:
            raise ValueError(f"Archive member escaped output directory: {info.filename!r}")
    archive.extractall(destination)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-root", required=True, type=Path)
    parser.add_argument("--extract", action="store_true")
    script_args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    args = parser.parse_args(script_args)
    root = args.source_root.resolve()
    provenance_path = root / "source-provenance.json"
    provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
    if provenance["dataset"] != "BodyParts3D" or provenance["release"] != "4.0":
        raise ValueError("Unexpected dataset identity or release in provenance")
    if provenance["license"] != "CC BY 4.0":
        raise ValueError("Source license does not match the official license statement")
    results = []
    for name in ("isa_BP3D_4.0_obj_99.zip", "partof_BP3D_4.0_obj_99.zip"):
        path = root / name
        record = next((item for item in provenance["files"] if item["name"] == name), None)
        if not record:
            raise ValueError(f"No acquisition provenance exists for {name}")
        actual_hash = sha256(path)
        if actual_hash != record["sha256"] or path.stat().st_size != record["bytes"]:
            raise ValueError(f"Hash or size mismatch for {name}")
        with zipfile.ZipFile(path) as archive:
            bad_entry = archive.testzip()
            if bad_entry:
                raise ValueError(f"CRC failure in {name}: {bad_entry}")
            entries = archive.infolist()
            obj_files = [entry for entry in entries if entry.filename.lower().endswith(".obj")]
            if not obj_files:
                raise ValueError(f"No OBJ meshes found in {name}")
            for entry in entries:
                relative = PurePosixPath(entry.filename)
                if relative.is_absolute() or any(part == ".." for part in relative.parts):
                    raise ValueError(f"Unsafe path in {name}: {entry.filename}")
            extraction = root / ("extracted-isa" if name.startswith("isa_") else "extracted-partof")
            if args.extract:
                if extraction.exists() and any(extraction.iterdir()):
                    raise FileExistsError(f"Refusing to overwrite extracted source directory: {extraction}")
                extraction.mkdir(parents=True, exist_ok=True)
                safe_extract(archive, extraction)
            results.append({
                "name": name,
                "bytes": path.stat().st_size,
                "sha256": actual_hash,
                "zipEntries": len(entries),
                "objFiles": len(obj_files),
                "objBytes": sum(entry.file_size for entry in obj_files),
                "zipCrcValidation": "passed",
                "extractedTo": str(extraction) if args.extract else None,
                "sampleMembers": [entry.filename for entry in obj_files[:12]],
            })
    result = {"dataset": "BodyParts3D", "release": "4.0", "sourceRoot": str(root), "results": results}
    report = root / "source-validation-report.json"
    report.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
