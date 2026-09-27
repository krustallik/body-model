from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
from pathlib import Path, PurePosixPath
import re
import sys
import time

import bpy
import bmesh
from mathutils import Vector


def read_tsv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as stream:
        return list(csv.DictReader(stream, delimiter="\t"))


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_obj(path: Path) -> tuple[list[tuple[float, float, float]], list[tuple[int, ...]]]:
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, ...]] = []
    with path.open("r", encoding="utf-8", errors="strict") as stream:
        for line_number, line in enumerate(stream, start=1):
            if line.startswith("v "):
                values = line.split()
                if len(values) < 4:
                    raise ValueError(f"{path.name}:{line_number}: malformed vertex")
                # BodyParts3D OBJ coordinates are millimeters in a Z-up frame.
                # Blender scenes also use Z-up; Blender's glTF exporter performs
                # the standard conversion to the runtime's Y-up coordinate frame.
                vertices.append(tuple(float(value) * 0.001 for value in values[1:4]))
            elif line.startswith("f "):
                indices: list[int] = []
                for token in line.split()[1:]:
                    raw = int(token.split("/", 1)[0])
                    index = raw - 1 if raw > 0 else len(vertices) + raw
                    if index < 0 or index >= len(vertices):
                        raise ValueError(f"{path.name}:{line_number}: face index {raw} is out of range")
                    indices.append(index)
                if len(indices) >= 3:
                    faces.append(tuple(indices))
    if not vertices or not faces:
        raise ValueError(f"{path.name}: OBJ has no usable vertices/faces")
    return vertices, faces


def bounds_for(vertices: list[tuple[float, float, float]]) -> dict[str, list[float]]:
    mins = [min(point[index] for point in vertices) for index in range(3)]
    maxs = [max(point[index] for point in vertices) for index in range(3)]
    # Blender Z-up to glTF/Three Y-up: (x, y, z) -> (x, z, -y).
    return {
        "min": [mins[0], mins[2], -maxs[1]],
        "max": [maxs[0], maxs[2], -mins[1]],
    }


def material(name: str, color: tuple[float, float, float, float], roughness: float = 0.76) -> bpy.types.Material:
    result = bpy.data.materials.new(name)
    result.diffuse_color = color
    result.use_nodes = True
    principled = result.node_tree.nodes.get("Principled BSDF")
    if principled:
        principled.inputs["Base Color"].default_value = color
        principled.inputs["Roughness"].default_value = roughness
        principled.inputs["Metallic"].default_value = 0.0
        principled.inputs["Alpha"].default_value = color[3]
    if color[3] < 1.0:
        result.surface_render_method = "BLENDED"
    return result


def make_object(file_id: str, filepath: Path, collection: bpy.types.Collection, mat: bpy.types.Material,
                mesh_id: str, selectable: bool, context_presentation: str, depth_layer: str,
                anatomy_ids: list[str], fma_ids: list[str]) -> tuple[bpy.types.Object, dict]:
    vertices, faces = parse_obj(filepath)
    geometry = bpy.data.meshes.new(f"Mesh_{mesh_id}")
    geometry.from_pydata(vertices, [], faces)
    geometry.validate(verbose=False, clean_customdata=True)
    geometry.update(calc_edges=True)
    bm = bmesh.new()
    bm.from_mesh(geometry)
    if bm.faces:
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(geometry)
    bm.free()
    for polygon in geometry.polygons:
        polygon.use_smooth = True
    geometry.materials.append(mat)
    obj = bpy.data.objects.new(mesh_id, geometry)
    collection.objects.link(obj)
    obj["bodycastMeshId"] = mesh_id
    obj["bodycastSelectable"] = selectable
    obj["bodycastRole"] = "selectable-muscle" if selectable else "supplemental-muscle-context"
    obj["bodycastContextLayer"] = depth_layer if selectable else "muscle-context"
    obj["bodycastContextPresentation"] = context_presentation
    obj["bodycastSourceObjectName"] = "Mapped BodyCast anatomy" if selectable else "Supplemental muscle context"
    obj["bodyparts3dFileId"] = file_id
    obj["bodyparts3dConceptIds"] = ",".join(sorted(set(fma_ids)))
    obj["bodycastAnatomyIds"] = ",".join(sorted(set(anatomy_ids)))
    face_count = len(geometry.polygons)
    triangles = sum(max(0, len(poly.vertices) - 2) for poly in geometry.polygons)
    details = {
        "meshId": mesh_id,
        "sourceObjectId": file_id,
        "selectable": selectable,
        "anatomyIds": sorted(set(anatomy_ids)),
        "sourceFmaConceptIds": sorted(set(fma_ids)),
        "vertexCount": len(geometry.vertices),
        "faceCount": face_count,
        "triangleCount": triangles,
        "bounds": bounds_for(vertices),
        "sourcePath": filepath.name,
    }
    return obj, details


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.cameras, bpy.data.lights):
        for datablock in list(datablocks):
            if datablock.users == 0:
                datablocks.remove(datablock)
    for collection in list(bpy.data.collections):
        if collection.name != bpy.context.scene.collection.name:
            bpy.data.collections.remove(collection)


def set_camera(camera: bpy.types.Object, location: tuple[float, float, float], target: tuple[float, float, float], ortho_scale: float) -> None:
    camera.location = location
    camera.rotation_euler = (Vector(target) - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = ortho_scale


def render_previews(preview_dir: Path, skin_obj: bpy.types.Object | None, camera: bpy.types.Object,
                    targets: dict[str, tuple[tuple[float, float, float], tuple[float, float, float], float]]) -> None:
    scene = bpy.context.scene
    preview_dir.mkdir(parents=True, exist_ok=True)
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1120
    scene.render.resolution_y = 1560
    scene.render.resolution_percentage = 75
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.view_transform = "AgX"
    scene.world.color = (0.025, 0.03, 0.04)
    if scene.world.use_nodes:
        background = scene.world.node_tree.nodes.get("Background")
        if background:
            background.inputs["Color"].default_value = (0.018, 0.024, 0.032, 1.0)
            background.inputs["Strength"].default_value = 0.34
    for name, (location, target, scale) in targets.items():
        set_camera(camera, location, target, scale)
        if skin_obj:
            skin_obj.hide_render = name.startswith("muscles-only-")
        scene.render.filepath = str((preview_dir / f"{name}.png").resolve())
        bpy.ops.render.render(write_still=True)
    if skin_obj:
        skin_obj.hide_render = False


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-root", required=True)
    parser.add_argument("--mapping", default="3d-model/bodyparts3d-adapter-v1/visual-mapping-v1.json")
    parser.add_argument("--out-dir", default="3d-model/local-assets")
    parser.add_argument("--skip-renders", action="store_true")
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    source_root = Path(args.source_root).resolve()
    mapping_path = Path(args.mapping).resolve()
    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    mapping = json.loads(mapping_path.read_text(encoding="utf-8-sig"))
    muscle_inventory = json.loads((source_root / "muscle-tree-inventory.json").read_text(encoding="utf-8"))
    source_provenance = json.loads((source_root / "source-provenance.json").read_text(encoding="utf-8"))
    if muscle_inventory.get("root", {}).get("conceptId") != mapping["context"]["muscleTreeRootFmaConceptId"]:
        raise ValueError("IS-A muscle inventory root differs from the versioned visual mapping")
    extracted = source_root / "extracted-isa" / "isa_BP3D_4.0_obj_99"
    available_mesh_ids = {path.stem for path in extracted.glob("*.obj")}
    element_rows = read_tsv(source_root / "isa_element_parts.txt")
    part_rows = read_tsv(source_root / "isa_parts_list_e.txt")
    element_by_concept: dict[str, set[str]] = {}
    for row in element_rows:
        element_by_concept.setdefault(row["concept id"], set()).add(row["element file id"])
    name_by_concept = {row["concept id"]: row["en"].strip() for row in part_rows}
    concepts_by_object: dict[str, set[str]] = {}
    side_by_object: dict[str, set[str]] = {}
    for row in part_rows:
        name = row["en"].strip()
        side_match = re.search(r"\b(right|left)\b", name, re.IGNORECASE)
        for file_id in element_by_concept.get(row["concept id"], set()):
            concepts_by_object.setdefault(file_id, set()).add(row["concept id"])
            if side_match:
                side_by_object.setdefault(file_id, set()).add(side_match.group(1).lower())

    mapping_by_object: dict[str, list[dict]] = {}
    for row in mapping["mappings"]:
        for concept_id in row["sourceConceptIds"]:
            if concept_id not in name_by_concept:
                raise ValueError(f"Unknown official IS-A concept {concept_id} for {row['anatomyId']}")
            object_ids = element_by_concept.get(concept_id, set())
            if not object_ids:
                raise ValueError(f"Official IS-A concept {concept_id} has no mesh element")
            for file_id in sorted(object_ids):
                if file_id in row.get("excludeSourceObjectIds", []):
                    continue
                if file_id not in available_mesh_ids:
                    raise FileNotFoundError(f"Official OBJ missing for {concept_id}: {file_id}")
                mapping_by_object.setdefault(file_id, []).append({**row, "sourceConceptId": concept_id})
    if not mapping_by_object:
        raise ValueError("The visual mapping resolved no selectable object files")
    for file_id, rows in mapping_by_object.items():
        sides = side_by_object.get(file_id, set())
        if len(sides) > 1:
            raise ValueError(f"Conflicting official left/right FMA identities for selectable OBJ {file_id}: {sorted(sides)}")
        if not sides:
            raise ValueError(f"No explicit left/right FMA identity for selectable OBJ {file_id}; refuse to infer side from its filename")
        anatomy_ids = {row["anatomyId"] for row in rows}
        if len(anatomy_ids) > 1 and any("excludeSourceObjectIds" in row for row in rows):
            raise ValueError(f"One selected OBJ has conflicting canonical bindings: {file_id}: {sorted(anatomy_ids)}")

    scene = bpy.context.scene
    clear_scene()
    root_collection = bpy.data.collections.new("BodyCast BodyParts3D 4.0")
    scene.collection.children.link(root_collection)
    selectable_collection = bpy.data.collections.new("Selectable BodyCast regions")
    context_collection = bpy.data.collections.new("Unmapped muscle context")
    silhouette_collection = bpy.data.collections.new("Body silhouette context")
    root_collection.children.link(selectable_collection)
    root_collection.children.link(context_collection)
    root_collection.children.link(silhouette_collection)
    surface_material = material("BodyCast muscle surface", (0.77, 0.48, 0.40, 1.0))
    deep_material = material("BodyCast deep muscle", (0.54, 0.32, 0.30, 1.0))
    context_material = material("Supplemental muscle context", (0.61, 0.48, 0.43, 1.0))
    skin_material = material("BodyParts3D translucent skin context", (0.75, 0.70, 0.65, 0.18), roughness=0.95)
    inventory_ids = sorted({file_id for row in muscle_inventory["muscleConcepts"] for file_id in row["elementFileIds"]})
    if len(inventory_ids) != muscle_inventory["uniqueElementFileCount"]:
        raise ValueError("Muscle inventory element count does not match its deduplicated FJ identities")
    scene_source_ids = sorted(set(inventory_ids) | set(mapping_by_object))
    details_by_object: dict[str, dict] = {}
    object_by_source_id: dict[str, bpy.types.Object] = {}
    for index, file_id in enumerate(scene_source_ids, start=1):
        rows = mapping_by_object.get(file_id, [])
        selectable = bool(rows)
        sides = side_by_object.get(file_id, set())
        side = next(iter(sides)) if len(sides) == 1 else "midline"
        anatomy_ids = sorted({row["anatomyId"] for row in rows})
        concept_ids = sorted(concepts_by_object.get(file_id, set()))
        mesh_id = f"bp3d-v4-{file_id.lower()}"
        presentation = "selectable-surface" if selectable else "supplemental-muscle"
        depth_layer = rows[0]["depthLayer"] if rows else "supplemental"
        collection = selectable_collection if selectable else context_collection
        mat = (deep_material if depth_layer == "deep" else surface_material) if selectable else context_material
        path = extracted / f"{file_id}.obj"
        obj, detail = make_object(file_id, path, collection, mat, mesh_id, selectable, presentation, depth_layer, anatomy_ids, concept_ids)
        detail.update({
            "side": side,
            "sourceTermNames": sorted({name_by_concept.get(concept, "") for concept in concept_ids if name_by_concept.get(concept)}),
            "bindingConceptIds": sorted({row["sourceConceptId"] for row in rows}),
            "depthLayer": depth_layer,
            "contextPresentation": presentation,
        })
        details_by_object[file_id] = detail
        object_by_source_id[file_id] = obj
        if index % 40 == 0 or index == len(scene_source_ids):
            print(f"built source muscle {index}/{len(scene_source_ids)}")

    skin_id = "FJ2810"
    if skin_id not in available_mesh_ids:
        raise FileNotFoundError("The official adult-male skin context OBJ FJ2810 is missing")
    skin_obj, skin_detail = make_object(
        skin_id, extracted / f"{skin_id}.obj", silhouette_collection, skin_material,
        "bp3d-v4-context-skin-shell", False, "body-silhouette-context", "support", [], sorted(concepts_by_object.get(skin_id, set())),
    )
    skin_obj["bodyparts3dContextKind"] = "skin-envelope"
    skin_detail.update({"side": "midline", "contextPresentation": "body-silhouette-context", "contextKind": "whole-body-skin-envelope"})
    object_by_source_id[skin_id] = skin_obj

    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.render.resolution_percentage = 75
    scene.render.image_settings.file_format = "PNG"
    scene.camera = None
    camera_data = bpy.data.cameras.new("BodyCast preview camera")
    camera = bpy.data.objects.new("BodyCast preview camera", camera_data)
    root_collection.objects.link(camera)
    scene.camera = camera
    light_specs = [
        ("Key light", (-2.4, -3.2, 2.7), 850.0, 2.5),
        ("Fill light", (2.6, -2.4, 1.4), 530.0, 2.0),
        ("Rim light", (0.4, 2.5, 2.3), 780.0, 2.2),
    ]
    for name, location, energy, size in light_specs:
        data = bpy.data.lights.new(name, "AREA")
        data.energy = energy
        data.shape = "DISK"
        data.size = size
        light = bpy.data.objects.new(name, data)
        root_collection.objects.link(light)
        light.location = location
        light.rotation_euler = (Vector((0.0, 0.0, 0.82)) - light.location).to_track_quat("-Z", "Y").to_euler()
    camera_targets = {
        "full-body-front": ((0.0, -4.0, 0.82), (0.0, 0.0, 0.82), 1.92),
        "full-body-back": ((0.0, 4.0, 0.82), (0.0, 0.0, 0.82), 1.92),
        "full-body-side": ((3.8, 0.0, 0.82), (0.0, 0.0, 0.82), 1.92),
        "muscles-only-front": ((0.0, -4.0, 0.82), (0.0, 0.0, 0.82), 1.92),
        "muscles-only-back": ((0.0, 4.0, 0.82), (0.0, 0.0, 0.82), 1.92),
        "chest-close-up": ((0.0, -2.1, 1.28), (0.0, 0.0, 1.28), 0.62),
        "deltoids-close-up": ((-0.65, -2.2, 1.31), (0.0, 0.0, 1.31), 0.68),
        "back-close-up": ((0.0, 2.2, 1.18), (0.0, 0.0, 1.18), 0.82),
    }
    glb_path = out_dir / "bodyparts3d-v4.0-full-body.glb"
    blend_path = out_dir / "bodyparts3d-v4.0-full-body.blend"
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))
    bpy.ops.export_scene.gltf(
        filepath=str(glb_path),
        export_format="GLB",
        export_extras=True,
        export_meshopt_compression_enable=True,
        export_yup=True,
        export_apply=True,
        export_materials="EXPORT",
        export_normals=True,
        export_texcoords=False,
        export_cameras=False,
        export_lights=False,
        export_animations=False,
    )
    if not glb_path.is_file() or glb_path.stat().st_size == 0:
        raise RuntimeError("Blender did not produce a GLB asset")
    report = {
        "contract": "bodycast-bodyparts3d-generation-report-v1",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "blenderVersion": bpy.app.version_string,
        "sourceDataset": "BodyParts3D 4.0",
        "sourceArchiveHashes": {row["name"]: row["sha256"] for row in source_provenance["files"] if row["name"].endswith(".zip")},
        "mappingVersion": mapping["version"],
        "coordinateTransform": "source mm, Z-up to GLB Y-up (x, z, -y)",
        "geometryProcessing": "OBJ polygon geometry retained; normals recalculated; no remeshing, sculpting, mirroring, or decimation added.",
        "sourceMuscleObjCount": len(details_by_object),
        "selectableMeshCount": sum(1 for detail in details_by_object.values() if detail["selectable"]),
        "contextMeshCount": sum(1 for detail in details_by_object.values() if not detail["selectable"]) + 1,
        "skinContextMeshCount": 1,
        "vertexCount": sum(detail["vertexCount"] for detail in details_by_object.values()) + skin_detail["vertexCount"],
        "faceCount": sum(detail["faceCount"] for detail in details_by_object.values()) + skin_detail["faceCount"],
        "triangleCount": sum(detail["triangleCount"] for detail in details_by_object.values()) + skin_detail["triangleCount"],
        "compression": "EXT_meshopt_compression",
        "glbBytes": glb_path.stat().st_size,
        "glbSha256": sha256(glb_path),
        "blendBytes": blend_path.stat().st_size,
        "blendSha256": sha256(blend_path),
        "glbPath": str(glb_path),
        "blendPath": str(blend_path),
        "selectableRegions": [detail for detail in details_by_object.values() if detail["selectable"]],
        "contextNodes": [detail for detail in details_by_object.values() if not detail["selectable"]] + [skin_detail],
        "unavailableAnatomy": mapping["unavailable"],
        "licenseReview": mapping["licenseReview"],
    }
    report_path = out_dir / "bodyparts3d-v4.0-generation-report.json"
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    if not args.skip_renders:
        targets = {
            "full-body-front": camera_targets["full-body-front"],
            "full-body-back": camera_targets["full-body-back"],
            "full-body-side": camera_targets["full-body-side"],
            "muscles-only-front": camera_targets["muscles-only-front"],
            "muscles-only-back": camera_targets["muscles-only-back"],
            "chest-close-up": camera_targets["chest-close-up"],
            "deltoids-close-up": camera_targets["deltoids-close-up"],
            "back-close-up": camera_targets["back-close-up"],
        }
        render_previews(out_dir / "bodyparts3d-v4.0-previews", skin_obj, camera, targets)
        report["previewDirectory"] = str(out_dir / "bodyparts3d-v4.0-previews")
        report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: value for key, value in report.items() if key not in {"selectableRegions", "contextNodes"}}, indent=2))
    print(f"generated report: {report_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
