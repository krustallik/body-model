from __future__ import annotations

import argparse
import csv
import json
from collections import defaultdict, deque
from pathlib import Path
import sys


def rows(path: Path):
    with path.open(encoding="utf-8-sig", newline="") as stream:
        return list(csv.DictReader(stream, delimiter="\t"))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-root", required=True, type=Path)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    root = args.source_root.resolve()
    edges = rows(root / "isa_inclusion_relation_list.txt")
    element_rows = rows(root / "isa_element_parts.txt")
    labels = {row["concept id"]: row["en"].strip() for row in rows(root / "isa_parts_list_e.txt")}
    children: dict[str, set[str]] = defaultdict(set)
    for edge in edges:
        children[edge["parent id"]].add(edge["child id"])
    elements: dict[str, set[str]] = defaultdict(set)
    for row in element_rows:
        elements[row["concept id"]].add(row["element file id"])
    root_id = "FMA5022"  # official IS-A identity for muscle organ
    visited = {root_id}
    queue = deque([root_id])
    while queue:
        parent = queue.popleft()
        for child in children[parent]:
            if child not in visited:
                visited.add(child)
                queue.append(child)
    result = {
        "dataset": "BodyParts3D 4.0",
        "tree": "IS-A",
        "root": {"conceptId": root_id, "name": labels.get(root_id, "muscle organ")},
        "descendantConceptCount": len(visited),
        "conceptsWithMeshElements": sum(bool(elements.get(concept)) for concept in visited),
        "uniqueElementFileCount": len(set().union(*(elements.get(concept, set()) for concept in visited))),
        "muscleConcepts": [
            {"conceptId": concept, "name": labels.get(concept), "elementFileIds": sorted(elements.get(concept, set()))}
            for concept in sorted(visited) if elements.get(concept)
        ],
    }
    output = root / "muscle-tree-inventory.json"
    output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: value for key, value in result.items() if key != "muscleConcepts"}, indent=2))
    print(f"inventory={output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
