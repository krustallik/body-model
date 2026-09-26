"""Create a local GLB variant by excluding explicitly named context mesh IDs."""

import argparse
import hashlib
import json
import sys
import time
from pathlib import Path

import bpy


def arguments():
    raw = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--output-blend", required=True, type=Path)
    parser.add_argument("--output-glb", required=True, type=Path)
    parser.add_argument("--report", required=True, type=Path)
    parser.add_argument("--exclude-id", action="append", default=[])
    return parser.parse_args(raw)


def main():
    started = time.monotonic()
    args = arguments()
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    regions = manifest.get("visualIdentity", {}).get("supportedRegions", [])
    contexts = manifest.get("visualIdentity", {}).get("contextNodes", [])
    manifest_ids = {item["meshId"] for item in regions + contexts}
    excluded = set(args.exclude_id)
    if not excluded:
        raise RuntimeError("At least one context mesh identity must be provided for exclusion.")
    if not excluded <= {item["meshId"] for item in contexts}:
        raise RuntimeError("An excluded identity is not a non-selectable context mesh in the input manifest.")

    objects_by_id = {}
    for obj in bpy.data.objects:
        mesh_id = obj.get("bodycastMeshId")
        if isinstance(mesh_id, str):
            if mesh_id in objects_by_id:
                raise RuntimeError(f"Duplicate Blender object identity: {mesh_id}")
            objects_by_id[mesh_id] = obj
    if set(objects_by_id) != manifest_ids:
        missing = sorted(manifest_ids - set(objects_by_id))
        unlisted = sorted(set(objects_by_id) - manifest_ids)
        raise RuntimeError(f"Blender/manifest identity mismatch; missing={len(missing)} unlisted={len(unlisted)}")

    removed = []
    for mesh_id in sorted(excluded):
        obj = objects_by_id[mesh_id]
        if obj.type != "MESH" or obj.get("bodycastSelectable") is not False:
            raise RuntimeError(f"Refusing to remove non-context or non-mesh object: {mesh_id}")
        removed.append({
            "meshId": mesh_id,
            "polygonCount": len(obj.data.polygons),
            "triangleCount": len(obj.data.loop_triangles),
            "vertexCount": len(obj.data.vertices),
        })
        bpy.data.objects.remove(obj, do_unlink=True)

    remaining_ids = {obj.get("bodycastMeshId") for obj in bpy.data.objects if isinstance(obj.get("bodycastMeshId"), str)}
    if remaining_ids != manifest_ids - excluded:
        raise RuntimeError("Unexpected mesh identity changed during local exclusion.")

    args.output_blend.parent.mkdir(parents=True, exist_ok=True)
    args.output_glb.parent.mkdir(parents=True, exist_ok=True)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    save_result = bpy.ops.wm.save_as_mainfile(filepath=str(args.output_blend), check_existing=False)
    if "FINISHED" not in save_result:
        raise RuntimeError(f"Blender source save failed: {save_result}")

    export_result = bpy.ops.export_scene.gltf(
        filepath=str(args.output_glb),
        export_format="GLB",
        check_existing=False,
        use_selection=False,
        use_active_collection=False,
        use_visible=False,
        export_apply=False,
        export_extras=True,
        export_materials="EXPORT",
        export_normals=True,
        export_cameras=False,
        export_lights=False,
        export_yup=True,
        export_shared_accessors=True,
        export_meshopt_compression_enable=True,
        export_meshopt_extension="EXT_meshopt_compression",
    )
    if "FINISHED" not in export_result or not args.output_glb.exists():
        raise RuntimeError(f"GLB export failed: {export_result}")

    meshes = [obj for obj in bpy.data.objects if obj.type == "MESH"]
    for obj in meshes:
        obj.data.calc_loop_triangles()
    identity_meshes = [obj for obj in meshes if isinstance(obj.get("bodycastMeshId"), str)]
    selectable = sum(obj.get("bodycastSelectable") is True for obj in identity_meshes)
    context = sum(obj.get("bodycastSelectable") is False for obj in identity_meshes)
    report = {
        "status": "completed",
        "blenderVersion": bpy.app.version_string,
        "meshNodeCount": len(identity_meshes),
        "gltfGeometryNodeCount": len(meshes),
        "selectableMeshCount": selectable,
        "contextMeshCount": context,
        "polygonCount": sum(len(obj.data.polygons) for obj in meshes),
        "triangleCount": sum(len(obj.data.loop_triangles) for obj in meshes),
        "vertexCount": sum(len(obj.data.vertices) for obj in meshes),
        "materialSlots": sum(len(obj.material_slots) for obj in meshes),
        "excludedContextCount": len(removed),
        "excludedContextMeshes": removed,
        "glbSha256": hashlib.sha256(args.output_glb.read_bytes()).hexdigest(),
        "glbByteLength": args.output_glb.stat().st_size,
        "elapsedSeconds": round(time.monotonic() - started, 3),
    }
    args.report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
