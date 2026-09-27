from __future__ import annotations
import argparse, hashlib, json, math, sys, time
from pathlib import Path
import bmesh, bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

def sha256(path: Path) -> str:
    h=hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda:f.read(1048576),b""): h.update(chunk)
    return h.hexdigest()

def repair_head_surface(skin, config):
    if not isinstance(config, dict) or config.get("contract") != "bodycast-neutral-head-surface-repair":
        raise ValueError("The versioned neutral head-surface repair contract is missing")
    if skin.get("bodyparts3dFileId") != config["skinEnvelopeSourceObjectId"]:
        raise ValueError("Head repair may only modify the configured official skin-envelope object")

    selection = config["eyeBoundarySelection"]
    eye_closures = config["neutralEyeClosures"]
    before = {
        "vertexCount": len(skin.data.vertices),
        "faceCount": len(skin.data.polygons),
        "triangleCount": sum(max(0, len(poly.vertices) - 2) for poly in skin.data.polygons),
    }
    bm = bmesh.new()
    bm.from_mesh(skin.data)
    try:
        boundary_edges = sorted(
            (edge for edge in bm.edges if edge.is_boundary),
            key=lambda edge: tuple(sorted(vertex.index for vertex in edge.verts)),
        )
        adjacency = {}
        for edge in boundary_edges:
            for vertex in edge.verts:
                adjacency.setdefault(vertex, []).append(edge)

        seen = set()
        selected_components = []
        for start in boundary_edges:
            if start in seen:
                continue
            stack = [start]
            seen.add(start)
            component = []
            vertices = set()
            while stack:
                edge = stack.pop()
                component.append(edge)
                vertices.update(edge.verts)
                for vertex in edge.verts:
                    for neighbor in adjacency.get(vertex, ()):
                        if neighbor not in seen:
                            seen.add(neighbor)
                            stack.append(neighbor)
            ordered_vertices = sorted(vertices, key=lambda vertex: vertex.index)
            if not ordered_vertices:
                continue
            center = sum((vertex.co for vertex in ordered_vertices), Vector()) / len(ordered_vertices)
            z_min, z_max = selection["centerSourceZRange"]
            if (
                len(ordered_vertices) >= selection["minimumVertexCount"]
                and z_min <= center.z <= z_max
                and center.y <= selection["maximumCenterSourceY"]
                and abs(center.x) <= selection["maximumAbsoluteCenterSourceX"]
            ):
                selected_components.append((component, center))
        if len(selected_components) != selection["expectedLoopCount"]:
            raise ValueError(
                "Expected "
                + str(selection["expectedLoopCount"])
                + " eye-region source boundary loops, found "
                + str(len(selected_components))
            )

        head_material_name = "BodyCast neutral head surface closure"
        if bpy.data.materials.get(head_material_name):
            raise ValueError("Refusing to add a duplicate neutral head closure material")
        head_material = bpy.data.materials.new(head_material_name)
        head_color = (0.75, 0.70, 0.65, 1.0)
        head_material.diffuse_color = head_color
        head_material.use_nodes = True
        principled = head_material.node_tree.nodes.get("Principled BSDF")
        if principled:
            principled.inputs["Base Color"].default_value = head_color
            principled.inputs["Roughness"].default_value = 0.95
            principled.inputs["Metallic"].default_value = 0.0
        head_material["bodycastOpaqueFaceClosure"] = True
        skin.data.materials.append(head_material)
        head_material_index = len(skin.data.materials) - 1

        eye_edges = sorted(
            (edge for component, _center in selected_components for edge in component),
            key=lambda edge: tuple(sorted(vertex.index for vertex in edge.verts)),
        )
        fill_result = bmesh.ops.holes_fill(bm, edges=eye_edges, sides=0)
        filled_faces = fill_result.get("faces", [])
        if not filled_faces:
            raise ValueError("No selected eye-region source boundary could be closed")
        for face in filled_faces:
            face.material_index = head_material_index
            face.smooth = True

        opaque_min_z = config["opaqueSurfaceMinSourceZ"]
        opaque_face_count = 0
        for face in bm.faces:
            if face.calc_center_median().z >= opaque_min_z:
                face.material_index = head_material_index
                opaque_face_count += 1

        centers_x = eye_closures["centersSourceX"]
        if len(centers_x) != 2:
            raise ValueError("The neutral face contract must define exactly two eye-surface closures")
        radii = eye_closures["radiiSourceMeters"]
        if len(radii) != 3 or any(float(radius) <= 0 for radius in radii):
            raise ValueError("The neutral eye-closure radii must be three positive meter values")
        cap_face_count = 0
        for center_x in centers_x:
            old_faces = set(bm.faces)
            created = bmesh.ops.create_uvsphere(
                bm,
                u_segments=eye_closures["longitudinalSegments"],
                v_segments=eye_closures["latitudinalSegments"],
                radius=1.0,
            )
            created_faces = [face for face in bm.faces if face not in old_faces]
            for vertex in created["verts"]:
                vertex.co = Vector((
                    float(center_x) + vertex.co.x * float(radii[0]),
                    float(eye_closures["centerSourceY"]) + vertex.co.y * float(radii[1]),
                    float(eye_closures["centerSourceZ"]) + vertex.co.z * float(radii[2]),
                ))
            for face in created_faces:
                face.material_index = head_material_index
                face.smooth = True
            cap_face_count += len(created_faces)

        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        bm.to_mesh(skin.data)
    finally:
        bm.free()
    skin.data.update()
    for polygon in skin.data.polygons:
        polygon.use_smooth = True

    after = {
        "vertexCount": len(skin.data.vertices),
        "faceCount": len(skin.data.polygons),
        "triangleCount": sum(max(0, len(poly.vertices) - 2) for poly in skin.data.polygons),
    }
    skin["bodycastHeadSurfaceRepair"] = config["contract"] + "-v" + config["version"]
    skin["bodycastHeadSurfaceRepairSelectedLoopCount"] = len(selected_components)
    skin["bodycastHeadSurfaceRepairFilledFaceCount"] = len(filled_faces)
    skin["bodycastHeadOpaqueSurfaceMinZ"] = float(opaque_min_z)
    skin["bodycastNeutralEyeCapCount"] = len(centers_x)
    metrics = {
        "sourceObjectId": config["skinEnvelopeSourceObjectId"],
        "selectedEyeBoundaryLoopCount": len(selected_components),
        "filledEyeBoundaryFaceCount": len(filled_faces),
        "opaqueHeadFaceCount": opaque_face_count,
        "neutralEyeClosureCount": len(centers_x),
        "neutralEyeClosureFaceCount": cap_face_count,
        "opaqueSurfaceMinSourceZ": float(opaque_min_z),
        "vertexDelta": after["vertexCount"] - before["vertexCount"],
        "faceDelta": after["faceCount"] - before["faceCount"],
        "triangleDelta": after["triangleCount"] - before["triangleCount"],
        "skinMetrics": after,
    }
    if metrics["vertexDelta"] <= 0 or metrics["faceDelta"] <= 0 or metrics["triangleDelta"] <= 0:
        raise ValueError("Head-surface repair did not add valid closure geometry")
    return metrics

def skin_y(tree,x,z,anterior):
    origin=Vector((x,-1.0 if anterior else 1.0,z))
    direction=Vector((0.0,1.0 if anterior else -1.0,0.0))
    hit,_n,_i,_d=tree.ray_cast(origin,direction,2.0)
    if hit is None: raise ValueError(f"Skin ray missed x={x:.4f}, z={z:.4f}")
    return hit.y

def closed_volume(name,anatomy,side,rows,cols,point_at,inward_sign,collection,mat,layer,note,
                  geometry_contract,profile_contract,profile_metrics,bevel_amount=0.0015):
    outer=[]; thick=[]; surface_offsets=[]; inward_directions=[]
    for i in range(rows):
        t=i/(rows-1)
        for j in range(cols):
            p=point_at(t,j/(cols-1))
            if len(p) not in (4,5,7) or not all(math.isfinite(float(v)) for v in p): raise ValueError(f"{name}: bad vertex")
            x,y,z,d=map(float,p[:4])
            if d<=0: raise ValueError(f"{name}: invalid thickness")
            if len(p)>=5: surface_offsets.append(float(p[4]))
            if len(p)==7:
                nx,ny=map(float,p[5:7]); magnitude=math.hypot(nx,ny)
                if magnitude<=1e-8: raise ValueError(f"{name}: invalid inward surface normal")
                inward_directions.append((nx/magnitude,ny/magnitude))
            else:
                inward_directions.append((0.0,float(inward_sign)))
            outer.append((x,y,z)); thick.append(d)
    n=len(outer); vertices=outer+[(x+inward_directions[i][0]*thick[i],y+inward_directions[i][1]*thick[i],z)
      for i,(x,y,z) in enumerate(outer)]
    faces=[]
    for i in range(rows-1):
        for j in range(cols-1):
            a=i*cols+j; b=a+1; c=a+cols+1; d=a+cols
            faces.extend(((a,b,c,d),(n+d,n+c,n+b,n+a)))
    boundary=list(range(cols))
    boundary.extend(i*cols+cols-1 for i in range(1,rows))
    boundary.extend((rows-1)*cols+j for j in range(cols-2,-1,-1))
    boundary.extend(i*cols for i in range(rows-2,0,-1))
    for k,a in enumerate(boundary):
        b=boundary[(k+1)%len(boundary)]; faces.append((a,b,n+b,n+a))
    mesh=bpy.data.meshes.new(name+"_closed-volume")
    mesh.from_pydata(vertices,[],faces); mesh.validate(verbose=False,clean_customdata=True); mesh.update(calc_edges=True)
    bm=bmesh.new(); bm.from_mesh(mesh)
    if bm.faces: bmesh.ops.recalc_face_normals(bm,faces=bm.faces)
    loop_pairs=set()
    closed_boundary=boundary+[boundary[0]]
    for a,b in zip(closed_boundary,closed_boundary[1:]): loop_pairs.add(tuple(sorted((a,b))))
    for a,b in zip(closed_boundary,closed_boundary[1:]): loop_pairs.add(tuple(sorted((n+a,n+b))))
    bevel_edges=[e for e in bm.edges if tuple(sorted((e.verts[0].index,e.verts[1].index))) in loop_pairs]
    if bevel_edges:
        bmesh.ops.bevel(bm,geom=bevel_edges,offset=bevel_amount,segments=3,profile=0.5,affect='EDGES')
        bmesh.ops.recalc_face_normals(bm,faces=bm.faces)
    bad=sum(not e.is_manifold for e in bm.edges); volume=abs(bm.calc_volume(signed=True))
    if bad or volume<=1e-9:
        bm.free(); bpy.data.meshes.remove(mesh)
        raise ValueError(f"{name}: nonmanifold={bad}, volume={volume}")
    bm.to_mesh(mesh); bm.free(); mesh.update(calc_edges=True)
    for poly in mesh.polygons: poly.use_smooth=True
    mesh.materials.append(mat)
    obj=bpy.data.objects.new(name,mesh); collection.objects.link(obj)
    obj["bodycastMeshId"]=name; obj["bodycastSelectable"]=True; obj["bodycastRole"]="selectable-muscle"
    obj["bodycastContextLayer"]=layer; obj["bodycastContextPresentation"]="selectable-surface"
    obj["bodycastSourceObjectName"]=anatomy.replace("_"," ").title(); obj["bodycastAnatomyIds"]=anatomy
    obj["bodycastSide"]=side; obj["bodycastGeometryOrigin"]=geometry_contract
    obj["bodycastGeometryMethod"]="Smooth, tapered closed muscle volume conformed to the BodyParts3D body envelope; independently authored."
    obj["bodycastAttachmentContract"]=note
    obj["bodycastGeometryProfileContract"]=profile_contract
    geometry_metrics={**profile_metrics,"inputThicknessRangeMeters":[min(thick),max(thick)]}
    if surface_offsets: geometry_metrics["surfaceOffsetRangeMeters"]=[min(surface_offsets),max(surface_offsets)]
    obj["bodycastGeometryMetricsJson"]=json.dumps(geometry_metrics,sort_keys=True,separators=(",",":"))
    return {"meshId":name,"sourceObjectId":"BODYCAST-AUTHORED","selectable":True,"anatomyIds":[anatomy],
      "sourceFmaConceptIds":[],"bindingConceptIds":[],"sourceTermNames":[],
      "sourceObjectName":anatomy.replace("_"," ").title(),
      "geometryOrigin":geometry_contract,
      "geometryMethod":"Smooth, tapered closed muscle volume conformed to the BodyParts3D body envelope; independently authored.",
      "geometryProfileContract":profile_contract,"geometryMetrics":geometry_metrics,
      "attachmentContract":note,"side":side,"depthLayer":layer,"contextPresentation":"selectable-surface",
      "vertexCount":len(mesh.vertices),"faceCount":len(mesh.polygons),
      "triangleCount":sum(max(0,len(p.vertices)-2) for p in mesh.polygons),
      "bounds":{"min":[min(v[i] for v in outer) for i in range(3)],"max":[max(v[i] for v in outer) for i in range(3)]},
      "sourcePath":None,"signedVolumeMetersCubed":volume}

def rectus(tree,side,sign,coll,mat,geometry_definition):
    if geometry_definition.get("geometryProfileContract")!="bodycast-rectus-envelope-relief-v3":
        raise ValueError("The rectus profile must match the versioned visual-mapping contract")
    z0,z1=.868,1.172
    def p(t,u):
        z=z0+(z1-z0)*t; longitudinal=math.sin(math.pi*t); transverse=math.sin(math.pi*u)
        belly=longitudinal**.58*transverse**.62
        intersection=max(math.exp(-((t-level)/.042)**2) for level in (.25,.49,.73))
        medial=.0055+.0015*(1-longitudinal)+.0025*intersection
        width=(.0015+.039*longitudinal**.78)*(1-.16*intersection)
        x=sign*(medial+width*u)
        sy=skin_y(tree,x,z,True)
        prominence=(.0010+.0045*longitudinal**.4)*belly
        tendon_indent=.0075*intersection*belly
        thickness=.0008+.0065*belly
        y=sy-.00045-prominence+tendon_indent
        return x,y,z,thickness,y-sy
    return closed_volume(f"bodycast-authored-rectus-abdominis-{side}","rectus_abdominis",side,73,33,p,1,coll,mat,"superficial",
      "Paired, shallow body-conformed bellies from pubic symphysis toward the xiphoid/costal-cartilage region; soft linea-alba separation and low-relief tendinous intersections.",
      geometry_definition["geometryId"],geometry_definition["geometryProfileContract"],
      {"bodySurfaceConformed":True,"perimeterTapered":True,"longitudinalEndsTapered":True,"profileFamily":"paired-elliptic-bellies","maximumSurfaceReliefMeters":.0055,"maximumTendinousIndentMeters":.0075,"maximumTendonBoundaryNarrowingFraction":.16},.0007)

def abdominal_sheet(tree,anatomy,side,sign,coll,mat,transverse,geometry_definition):
    z0,z1=(.916,1.126) if transverse else (.900,1.145)
    center_by_z={}
    def p(t,u):
        z=z0+(z1-z0)*t; longitudinal=math.sin(math.pi*t)
        if transverse:
            center_angle=.90; maximum_span=.86
            depth=.029; thickness_base=.0008; thickness_belly=.0055; relief_max=.0011
        else:
            center_angle=1.04-.23*t; maximum_span=.92
            depth=.016; thickness_base=.0008; thickness_belly=.0065; relief_max=.0015
        # Sweep around the real torso cross-section from the anterior flank to its side.
        # This keeps the muscle volume body-conformed instead of projecting a front-facing panel.
        front=skin_y(tree,0.0,z,True)
        back=skin_y(tree,0.0,z,False)
        center_y=center_by_z.setdefault(z,(front+back)*.5)
        angular_span=.035+maximum_span*longitudinal**.65
        theta=center_angle+angular_span*(u-.5)
        outward=Vector((sign*math.sin(theta),-math.cos(theta),0.0))
        hit,_normal,_face,_distance=tree.ray_cast(Vector((0.0,center_y,z)),outward,2.0)
        if hit is None: raise ValueError(f"{anatomy}: radial body-envelope ray missed z={z:.4f}, theta={theta:.4f}")
        inward=-outward
        profile=longitudinal**.62*math.sin(math.pi*u)**.62
        thickness=thickness_base+thickness_belly*profile
        relief=relief_max*profile
        offset=depth-relief
        point=hit+inward*offset
        return point.x,point.y,z,thickness,offset,inward.x,inward.y
    if transverse:
        note="Deep transverse abdominal-wall volume wrapping from the anterior flank around the lateral torso; tapered ends and near-transverse fascicle direction."
        profile_contract="bodycast-transversus-envelope-fan-v3"
        profile_metrics={"bodySurfaceConformed":True,"perimeterTapered":True,"longitudinalEndsTapered":True,"wrapsLateralTorso":True,"profileFamily":"deep-transverse-wrapped-fan","maximumAngularSpanRadians":.895,"maximumSurfaceReliefMeters":.0011}
    else:
        note="Deep anterolateral abdominal-wall volume wrapping around the torso; tapered borders and superomedial fiber direction."
        profile_contract="bodycast-internal-oblique-envelope-fan-v3"
        profile_metrics={"bodySurfaceConformed":True,"perimeterTapered":True,"longitudinalEndsTapered":True,"wrapsLateralTorso":True,"profileFamily":"deep-superomedial-wrapped-fan","maximumAngularSpanRadians":.955,"maximumSurfaceReliefMeters":.0015}
    if geometry_definition.get("geometryProfileContract")!=profile_contract:
        raise ValueError(f"{anatomy}: generated profile does not match the versioned visual-mapping contract")
    return closed_volume(f"bodycast-authored-{anatomy}-{side}",anatomy,side,65,49,p,1,coll,mat,"deep",note,
      geometry_definition["geometryId"],geometry_definition["geometryProfileContract"],profile_metrics,.0007)

def latissimus(tree,side,sign,coll,mat,geometry_definition):
    z0,z1=.895,1.328
    def p(t,u):
        z=z0+(z1-z0)*t; medial=.014+.150*t**2.2
        width=.055*(1-t)+.005+.045*math.sin(math.pi*t)*(1-t**3)
        x=sign*(medial+width*u); sy=skin_y(tree,x,z,False)
        belly=math.sin(math.pi*t)**.7*math.sin(math.pi*u)**.65
        return x,sy-.004+.010*belly,z,.014+.008*belly
    return closed_volume(f"bodycast-authored-latissimus-dorsi-{side}","latissimus_dorsi",side,73,41,p,-1,coll,mat,"superficial",
      "Broad lower thoracic/lumbar fascia, posterior iliac crest and lower-rib origin converging superolaterally to humeral intertubercular-groove region.",
      geometry_definition["geometryId"],geometry_definition["geometryProfileContract"],
      {"bodySurfaceConformed":True,"perimeterTapered":False,"profileFamily":"posterior-fan"})

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--base-report",required=True,type=Path); parser.add_argument("--mapping",required=True,type=Path)
    parser.add_argument("--out-dir",required=True,type=Path); parser.add_argument("--revision",default="v2",choices=("v2","v3"))
    a=parser.parse_args(sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else [])
    base=a.base_report.resolve(); mapping_path=a.mapping.resolve(); out=a.out_dir.resolve()
    revision=a.revision
    suffix="-v2" if revision=="v2" else "-v3"
    blend=out/f"bodyparts3d-v4.0-full-body{suffix}.blend"; glb=out/f"bodyparts3d-v4.0-full-body{suffix}.glb"
    report_path=out/f"bodyparts3d-v4.0-generation-report{suffix}.json"; previews=out/"previews"
    for path in (blend,glb,report_path,previews):
        if path.exists(): raise FileExistsError(f"Refusing to overwrite {path}")
    report=json.loads(base.read_text(encoding="utf-8")); mapping=json.loads(mapping_path.read_text(encoding="utf-8"))
    required={"latissimus_dorsi","rectus_abdominis","internal_oblique","transversus_abdominis"}
    geometry_rows={x["anatomyId"]:x for x in mapping.get("independentGeometry",[])}
    if set(geometry_rows)!=required: raise ValueError("v3 mapping missing required anatomy")
    if any(not row.get("geometryId") or not row.get("geometryProfileContract") for row in geometry_rows.values()):
        raise ValueError("Every authored muscle must have a versioned geometry and profile contract")
    if required & {x["anatomyId"] for x in mapping.get("unavailable",[])}: raise ValueError("Required anatomy still unavailable")
    skin=next((o for o in bpy.context.scene.objects if o.get("bodyparts3dFileId")=="FJ2810"),None)
    if skin is None: raise RuntimeError("BodyParts3D skin envelope FJ2810 is absent")
    root=next((c for c in bpy.context.scene.collection.children if c.name=="BodyCast BodyParts3D 4.0"),None)
    if root is None: raise RuntimeError("BodyParts3D root collection is absent")
    tree=BVHTree.FromObject(skin,bpy.context.evaluated_depsgraph_get())
    coll=bpy.data.collections.new("BodyCast independently authored muscle volumes v3.0.0"); root.children.link(coll)
    surf=bpy.data.materials.get("BodyCast muscle surface"); deep=bpy.data.materials.get("BodyCast deep muscle")
    if surf is None or deep is None: raise RuntimeError("Base muscle materials are absent")
    geometry_contracts={row["anatomyId"]:row for row in mapping.get("independentGeometry",[])}
    generated=[]
    for side,sign in (("left",1.0),("right",-1.0)):
        generated.extend((latissimus(tree,side,sign,coll,surf,geometry_contracts["latissimus_dorsi"]),rectus(tree,side,sign,coll,surf,geometry_contracts["rectus_abdominis"]),
            abdominal_sheet(tree,"internal_oblique",side,sign,coll,deep,False,geometry_contracts["internal_oblique"]),
            abdominal_sheet(tree,"transversus_abdominis",side,sign,coll,deep,True,geometry_contracts["transversus_abdominis"])))
    presentation = mapping.get("presentation", {})
    head_repair = repair_head_surface(skin, presentation.get("headSurfaceRepair"))
    skin_report = next((row for row in report["contextNodes"] if row.get("sourceObjectId") == head_repair["sourceObjectId"]), None)
    if skin_report is None:
        raise ValueError("The base generation report has no FJ2810 skin context record")
    skin_report.update(head_repair["skinMetrics"])
    skin_report["headSurfaceRepair"] = {key: value for key, value in head_repair.items() if key not in {"skinMetrics", "vertexDelta", "faceDelta", "triangleDelta"}}
    ids={x["meshId"] for x in report["selectableRegions"]}
    if ids & {x["meshId"] for x in generated}: raise ValueError("Generated mesh identity collision")
    report["selectableRegions"].extend(generated); report["selectableMeshCount"]=len(report["selectableRegions"])
    report["authoredMeshCount"]=len(generated); report["mappingVersion"]=mapping["version"]
    report["unavailableAnatomy"]=mapping.get("unavailable",[]); report["licenseReview"]=mapping["licenseReview"]
    report["authoredAnatomyContract"]={"versions":{row["anatomyId"]:row["geometryId"] for row in mapping["independentGeometry"]},
      "source":"Independently authored Blender volumes guided by documented attachment/fascicle-direction anatomy; no copied source meshes.",
      "limitations":"Educational visual approximations, not surgical or patient-specific models; geometry needs anatomy review.",
      "anatomyIds":sorted(required)}
    report["headSurfaceRepair"]={key: value for key, value in head_repair.items() if key != "skinMetrics"}
    report["geometryProcessing"]="BodyParts3D 4.0 OBJ meshes retained; eight bilateral BodyCast-authored selectable muscle meshes added, including v3 smooth tapered abdominal-wall fans; FJ2810 received the versioned neutral head-surface repair. No Z-Anatomy, mirrored source mesh or decorative plane."
    bpy.ops.wm.save_as_mainfile(filepath=str(blend),check_existing=False)
    bpy.ops.export_scene.gltf(filepath=str(glb),export_format="GLB",export_extras=True,
      export_meshopt_compression_enable=True,export_yup=True,export_apply=True,export_materials="EXPORT",
      export_normals=True,export_texcoords=False,export_cameras=False,export_lights=False,export_animations=False)
    if not glb.is_file() or not glb.stat().st_size: raise RuntimeError("GLB export failed")
    report.update({"generatedAt":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),"glbBytes":glb.stat().st_size,
      "glbSha256":sha256(glb),"blendBytes":blend.stat().st_size,"blendSha256":sha256(blend),
      "glbPath":str(glb),"blendPath":str(blend),
      "triangleCount":report["triangleCount"]+sum(x["triangleCount"] for x in generated)+head_repair["triangleDelta"],
      "faceCount":report["faceCount"]+sum(x["faceCount"] for x in generated)+head_repair["faceDelta"],
      "vertexCount":report["vertexCount"]+sum(x["vertexCount"] for x in generated)+head_repair["vertexDelta"]})
    report_path.write_text(json.dumps(report,indent=2)+"\n",encoding="utf-8")
    scene=bpy.context.scene; scene.render.engine="BLENDER_EEVEE"; scene.render.resolution_x=1120
    scene.render.resolution_y=1560; scene.render.resolution_percentage=75; scene.render.image_settings.file_format="PNG"
    scene.render.film_transparent=False; scene.view_settings.view_transform="AgX"; previews.mkdir(parents=True,exist_ok=False)
    camera=scene.camera
    if camera is None: raise RuntimeError("Preview camera is absent")
    targets={"full-body-front":((0,-4,.82),(0,0,.82),1.92),"full-body-back":((0,4,.82),(0,0,.82),1.92),
      "full-body-side":((3.8,0,.82),(0,0,.82),1.92),"muscles-only-front":((0,-4,.82),(0,0,.82),1.92),
      "muscles-only-back":((0,4,.82),(0,0,.82),1.92),"latissimus-close-up":((0,2.2,1.1),(0,0,1.1),.70),
      "abdomen-close-up":((0,-2.2,1.03),(0,0,1.03),.54)}
    for name,(location,target,scale) in targets.items():
        camera.location=location; camera.rotation_euler=(Vector(target)-camera.location).to_track_quat("-Z","Y").to_euler()
        camera.data.type="ORTHO"; camera.data.ortho_scale=scale; skin.hide_render=name.startswith("muscles-only-")
        scene.render.filepath=str((previews/f"{name}.png").resolve()); bpy.ops.render.render(write_still=True)
    skin.hide_render=False
    print(json.dumps({k:report[k] for k in ("selectableMeshCount","authoredMeshCount","contextMeshCount","triangleCount","glbBytes","glbSha256","blendBytes","blendSha256")},indent=2))
    print(f"report: {report_path}")

if __name__=="__main__": raise SystemExit(main())
