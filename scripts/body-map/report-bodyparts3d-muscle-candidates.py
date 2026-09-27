from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
import re
import sys

PATTERN = re.compile(
    r"pectoralis|deltoid|triceps brachii|biceps brachii|brachialis|brachioradialis|"
    r"latissimus dorsi|trapezius|rhomboid|erector spinae|iliocostalis|longissimus|spinalis|"
    r"gluteus|biceps femoris|semitendinosus|semimembranosus|rectus abdominis|oblique|"
    r"transversus abdominis|quadriceps|rectus femoris|vastus|adductor|gracilis|pectineus|"
    r"gastrocnemius|soleus|tibialis anterior|fibularis|peroneus|supraspinatus|"
    r"infraspinatus|teres minor|subscapularis|serratus anterior|iliacus|psoas major",
    re.IGNORECASE,
)


def read_tsv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as stream:
        return list(csv.DictReader(stream, delimiter="\t"))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-root", required=True, type=Path)
    script_args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    args = parser.parse_args(script_args)
    root = args.source_root.resolve()
    trees = {
        "isa": ("isa_parts_list_e.txt", "isa_element_parts.txt"),
        "partof": ("partof_parts_list_e.txt", "partof_element_parts.txt"),
    }
    results = []
    for tree, (parts_file, elements_file) in trees.items():
        parts = read_tsv(root / parts_file)
        elements = read_tsv(root / elements_file)
        element_by_concept: dict[str, set[str]] = {}
        for row in elements:
            element_by_concept.setdefault(row["concept id"], set()).add(row["element file id"])
        for row in parts:
            name = row["en"].strip()
            if not PATTERN.search(name):
                continue
            results.append({
                "tree": tree,
                "conceptId": row["concept id"],
                "representationId": row["representation id"],
                "name": name,
                "objFileIds": sorted(element_by_concept.get(row["concept id"], set())),
            })
    results.sort(key=lambda item: (item["tree"], item["name"].casefold(), item["conceptId"]))
    output = root / "candidate-muscle-inventory.json"
    output.write_text(json.dumps({"source": "BodyParts3D 4.0", "candidateCount": len(results), "candidates": results}, indent=2) + "\n", encoding="utf-8")
    print(f"candidates={len(results)}; output={output}")
    for item in results:
        print(f"{item['tree']}\t{item['conceptId']}\t{item['name']}\t{','.join(item['objFileIds'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
